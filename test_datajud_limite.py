"""Testes do limitador global e das retentativas do DataJud (offline, sem rede).

Cobrem o semáforo de concorrência, o intervalo entre requisições e as esperas de retentativa
(Retry-After e backoff). As esperas são simuladas para os testes rodarem rápido.

Uso:
    python -m pytest test_datajud_limite.py -q
"""

import asyncio
import unittest
from unittest import mock

import httpx

import server

URL = "https://exemplo.invalid/api_publica_tjsp/_search"
HEADERS = {"Authorization": "APIKey teste", "Content-Type": "application/json"}
CORPO = {"query": {"match": {"numeroProcesso": "1"}}}


def _rodar(coro):
    return asyncio.run(coro)


class _Base(unittest.TestCase):
    """Transporte simulado e limitador/backoff zerados (o limitador é recriado a cada loop)."""

    def setUp(self):
        self._transporte_original = server._TRANSPORTE_HTTP
        self._patches = [
            mock.patch.object(server, "DATAJUD_INTERVALO_S", 0.0),
            mock.patch.object(server, "DATAJUD_BACKOFF_JITTER", 0.0),
            mock.patch.object(server, "DATAJUD_BACKOFFS_S", (0.0, 0.0, 0.0)),
            mock.patch.object(server, "_LOOP_DATAJUD", None),
            mock.patch.object(server, "_SEM_DATAJUD", None),
            mock.patch.object(server, "_LOCK_INTERVALO_DATAJUD", None),
            mock.patch.object(server, "_ULTIMO_INICIO_DATAJUD", 0.0),
        ]
        for p in self._patches:
            p.start()
        self.chamadas: list[httpx.Request] = []

    def tearDown(self):
        server._TRANSPORTE_HTTP = self._transporte_original
        for p in reversed(self._patches):
            p.stop()

    def responder(self, *respostas):
        """Cada chamada HTTP consome a próxima resposta; a última se repete."""
        fila = list(respostas)

        def handler(request: httpx.Request) -> httpx.Response:
            self.chamadas.append(request)
            item = fila.pop(0) if len(fila) > 1 else fila[0]
            if isinstance(item, Exception):
                raise item
            return item

        server._TRANSPORTE_HTTP = httpx.MockTransport(handler)


class RetentativaTest(_Base):
    def test_429_com_retry_after_espera_e_repete(self):
        self.responder(
            httpx.Response(429, headers={"Retry-After": "1"}),
            httpx.Response(200, json={"hits": {}}),
        )
        dormidas: list[float] = []

        async def dormir(segundos):
            dormidas.append(segundos)

        with mock.patch.object(server.asyncio, "sleep", dormir):
            resposta = _rodar(server._datajud_post_com_retry(URL, HEADERS, CORPO))

        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(len(self.chamadas), 2)
        self.assertEqual(len(dormidas), 1)
        self.assertAlmostEqual(dormidas[0], 1.0, places=3)

    def test_quatro_504_esgotam_as_tentativas_com_erro_estruturado(self):
        self.responder(httpx.Response(504))
        dormidas: list[float] = []

        async def dormir(segundos):
            dormidas.append(segundos)

        with mock.patch.object(server.asyncio, "sleep", dormir):
            resultado = _rodar(server._datajud_post_com_retry(URL, HEADERS, CORPO))

        self.assertTrue(resultado.get("erro"))
        self.assertIn(f"após {server.DATAJUD_TENTATIVAS} tentativas", resultado["mensagem"])
        self.assertEqual(len(self.chamadas), server.DATAJUD_TENTATIVAS)
        self.assertEqual(len(dormidas), server.DATAJUD_TENTATIVAS - 1)


class LimitadorTest(_Base):
    def test_semaforo_limita_chamadas_simultaneas(self):
        em_voo = 0
        pico = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal em_voo, pico
            em_voo += 1
            pico = max(pico, em_voo)
            try:
                await asyncio.sleep(0.05)
                return httpx.Response(200, json={"hits": {}})
            finally:
                em_voo -= 1

        server._TRANSPORTE_HTTP = httpx.MockTransport(handler)

        async def cenario():
            tarefas = [
                asyncio.create_task(server._datajud_post_com_retry(URL, HEADERS, CORPO))
                for _ in range(6)
            ]
            return await asyncio.gather(*tarefas)

        with mock.patch.object(server, "DATAJUD_MAX_CONCORRENTES", 2):
            respostas = _rodar(cenario())

        self.assertEqual(len(respostas), 6)
        self.assertTrue(all(r.status_code == 200 for r in respostas))
        self.assertEqual(pico, 2)


if __name__ == "__main__":
    unittest.main()
