"""Testes da resposta PARCIAL do DataJud e das rodadas do job de movimentos (offline, sem rede).

O Elasticsearch do DataJud, quando saturado, devolve HTTP 200 com `_shards.failed > 0` e
`hits.hits` vazio (às vezes com `hits.total.value >= 1`). Isso não é "processo não encontrado":
é falha temporária, que precisa ser retentada, nunca cacheada. O job de movimentos também
reprocessa em rodadas só os processos que falharam por instabilidade.

As esperas são simuladas para os testes rodarem rápido.

Uso:
    python -m pytest test_datajud_parcial.py -q
"""

import asyncio
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import httpx

import db
import server

URL = "https://exemplo.invalid/api_publica_tjsp/_search"
HEADERS = {"Authorization": "APIKey teste", "Content-Type": "application/json"}
NUMERO = "10063142720238260005"
CORPO = {"size": 100, "query": {"match": {"numeroProcesso": NUMERO}}}
FONTE = {
    "tribunal": "TJSP",
    "numeroProcesso": NUMERO,
    "grau": "G1",
    "movimentos": [{"codigo": 26, "nome": "Distribuição", "dataHora": "2023-01-01T00:00:00Z"}],
}


def _parcial(shards_falhos: int = 14, total: int = 1) -> httpx.Response:
    """HTTP 200 do cluster saturado: shards falhos e nenhum documento devolvido."""
    return httpx.Response(200, json={
        "_shards": {"total": 20, "successful": 20 - shards_falhos, "failed": shards_falhos},
        "timed_out": False,
        "hits": {"total": {"value": total, "relation": "eq"}, "hits": []},
    })


def _completa(fonte: dict = FONTE) -> httpx.Response:
    return httpx.Response(200, json={
        "_shards": {"total": 20, "successful": 20, "failed": 0},
        "timed_out": False,
        "hits": {"total": {"value": 1, "relation": "eq"}, "hits": [{"_source": fonte}]},
    })


def _sem_hits() -> httpx.Response:
    return httpx.Response(200, json={
        "_shards": {"total": 20, "successful": 20, "failed": 0},
        "timed_out": False,
        "hits": {"total": {"value": 0, "relation": "eq"}, "hits": []},
    })


class _CacheFalso:
    """CacheDataJud em memória: registra gravações e devolve as entradas pré-carregadas."""

    def __init__(self) -> None:
        self.caminho = Path(tempfile.mkdtemp()) / "cache.sqlite"
        self.entradas: dict[str, dict] = {}
        self.gravados: dict[str, dict] = {}

    def obter(self, chave):
        return self.entradas.get(chave)

    def gravar(self, chave, resultado):
        self.gravados[chave] = resultado


class _Base(unittest.TestCase):
    """Transporte simulado, limitador/backoff zerados e esperas registradas."""

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
            mock.patch.object(server, "_CACHE_DATAJUD", None),
        ]
        for p in self._patches:
            p.start()
        self.addCleanup(self._restaurar)
        self.chamadas: list[httpx.Request] = []
        self.dormidas: list[float] = []

        async def dormir(segundos):
            self.dormidas.append(segundos)

        self._sleep = mock.patch.object(server.asyncio, "sleep", dormir)
        self._sleep.start()

    def _restaurar(self):
        self._sleep.stop()
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


class RespostaParcialTest(_Base):
    def test_parcial_seguida_de_completa_devolve_a_completa(self):
        self.responder(_parcial(), _completa())
        with self.assertLogs(server.log, level="WARNING") as logs:
            resposta = asyncio.run(server._datajud_post_com_retry(URL, HEADERS, CORPO))

        self.assertIsInstance(resposta, httpx.Response)
        self.assertEqual(len(self.chamadas), 2)
        self.assertEqual(len(resposta.json()["hits"]["hits"]), 1)
        self.assertEqual(len(self.dormidas), 1)  # backoff entre a parcial e a nova tentativa
        self.assertTrue(any("resposta parcial (14 shards falhos)" in linha for linha in logs.output))

    def test_quatro_parciais_esgotam_com_erro_temporario_e_sem_cache(self):
        self.responder(_parcial())
        cache = _CacheFalso()
        with mock.patch.object(server, "_CACHE_DATAJUD", cache):
            resultado = asyncio.run(server.consultar_processo_datajud("tjsp", NUMERO))

        self.assertTrue(resultado.get("erro"))
        self.assertTrue(resultado.get("temporario"))
        self.assertEqual(len(self.chamadas), server.DATAJUD_TENTATIVAS)
        self.assertEqual(cache.gravados, {})

    def test_200_legitimo_sem_hits_continua_nao_encontrado(self):
        self.responder(_sem_hits())
        cache = _CacheFalso()
        with mock.patch.object(server, "_CACHE_DATAJUD", cache):
            resultado = asyncio.run(server.consultar_processo_datajud("tjsp", NUMERO))

        self.assertFalse(resultado.get("encontrado"))
        self.assertNotIn("erro", resultado)
        self.assertEqual(len(self.chamadas), 1)  # não retenta: é ausência legítima
        self.assertEqual(cache.gravados, {})

    def test_entrada_de_cache_vazia_e_ignorada(self):
        cache = _CacheFalso()
        chave = f"v2:tjsp:{NUMERO}"
        # Entrada antiga gravada como "encontrado" sem processos (falso negativo da resposta parcial).
        cache.entradas[chave] = {"encontrado": True, "total": 1, "processos": []}
        self.responder(_completa())
        with mock.patch.object(server, "_CACHE_DATAJUD", cache):
            resultado = asyncio.run(server.consultar_processo_datajud("tjsp", NUMERO))

        self.assertEqual(len(self.chamadas), 1)  # foi à API em vez de usar o cache vazio
        self.assertTrue(resultado["encontrado"])
        self.assertEqual(len(resultado["processos"]), 1)
        self.assertIn(chave, cache.gravados)


class RodadasJobMovimentosTest(unittest.TestCase):
    """O job de movimentos só encerra quando não resta processo com falha temporária."""

    NUMERO_A = "10063142720238260005"
    NUMERO_B = "10063150920238260006"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.gestao = db.RegistroClientesCasos(Path(self.tmp.name) / "teste.db")
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente", None, None, self.agora)
        self.caso_a = self.gestao.criar_caso(cliente["id"], "Caso A", None, [self.NUMERO_A], self.agora)
        self.caso_b = self.gestao.criar_caso(cliente["id"], "Caso B", None, [self.NUMERO_B], self.agora)

    def test_repete_so_itens_com_falha_temporaria(self):
        contagem = {self.NUMERO_A: 0, self.NUMERO_B: 0}

        async def consultar(tribunal, numero):
            contagem[numero] += 1
            if numero == self.NUMERO_A:
                if contagem[numero] < 3:
                    return {"erro": True, "temporario": True, "mensagem": "resposta parcial (14 shards falhos)"}
                return {"encontrado": True, "processos": [server._extrair_processo_datajud(FONTE)]}
            return {"erro": True, "mensagem": "número inválido"}

        dormidas: list[float] = []

        async def dormir(segundos):
            dormidas.append(segundos)

        with mock.patch.object(server, "consultar_processo_datajud", consultar), \
                mock.patch.object(server, "DATAJUD_RODADA_INTERVALO_S", 0.0), \
                mock.patch.object(server.asyncio, "sleep", dormir):
            retorno = asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))

        # A falhou 2 vezes e funcionou na 3ª; B tinha erro permanente e saiu na 1ª.
        self.assertEqual(contagem, {self.NUMERO_A: 3, self.NUMERO_B: 1})
        self.assertEqual(dormidas, [0.0, 0.0])  # espera entre as rodadas, com o intervalo configurado
        self.assertFalse(retorno)  # o erro permanente do processo B é reportado
        self.assertEqual(self.gestao.obter_datajud(self.NUMERO_A, "TJSP")[0]["numeroProcesso"], self.NUMERO_A)

    def test_capa_com_erro_temporario_volta_para_a_rodada(self):
        self.gestao.salvar_capa_processo(self.caso_a["id"], self.NUMERO_A, self.agora, tribunal="TJSP")
        chamadas = []

        async def montar(numero, tribunal):
            chamadas.append(numero)
            if len(chamadas) == 1:
                return None, {"erro": True, "temporario": True, "mensagem": "resposta parcial"}
            return {"tribunal": "TJSP", "movimentos": FONTE["movimentos"], "datajud": [FONTE]}, None

        dormidas: list[float] = []

        async def dormir(segundos):
            dormidas.append(segundos)

        with mock.patch.object(server, "_montar_capa_via_tribunal", montar), \
                mock.patch.object(server, "consultar_processo_datajud",
                                  mock.AsyncMock(return_value={"encontrado": False})), \
                mock.patch.object(server, "DATAJUD_RODADA_INTERVALO_S", 0.0), \
                mock.patch.object(server.asyncio, "sleep", dormir):
            retorno = asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))

        self.assertEqual(chamadas, [self.NUMERO_A, self.NUMERO_A])
        self.assertEqual(dormidas, [0.0])
        self.assertTrue(retorno)
        capa = self.gestao.obter_capa_processo(self.caso_a["id"], self.NUMERO_A)
        self.assertEqual(len(capa["movimentos"]), 1)


if __name__ == "__main__":
    unittest.main()
