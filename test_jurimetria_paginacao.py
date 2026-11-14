"""CJPG: não pedir páginas que não existem (o e-SAJ responde 500 e o resultado vira "parcial")."""
import asyncio
import unittest
from unittest import mock

from modulos.jurimetria import servico

FORM = "<html>Parâmetros de Consulta</html>"
LINHA = ('<tr class="fundocinza1"><span class="fonteNegrito">1000000-00.2026.8.26.0100</span>'
         '<strong>Classe:</strong> X</td></tr>')


class _Resp:
    def __init__(self, texto):
        self.text = texto

    def raise_for_status(self):
        pass


class _Cliente:
    def __init__(self, paginas):
        self.paginas, self.pedidos = paginas, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        self.pedidos.append(url.rsplit("/", 1)[-1])
        if "trocarDePagina" in url:
            return _Resp(self.paginas[params["pagina"]])
        return _Resp(self.paginas.get(1, FORM))


class PaginacaoTest(unittest.TestCase):
    def _buscar(self, paginas, quantas):
        cliente = _Cliente(paginas)
        nucleo = mock.MagicMock()
        nucleo._cliente.return_value = cliente
        nucleo._html_para_texto = lambda t: t
        with mock.patch.object(servico, "nucleo", nucleo), mock.patch.object(servico.asyncio, "sleep", mock.AsyncMock()):
            resultado = asyncio.run(servico._cjpg_buscar_no_esaj({}, quantas))
        return cliente, resultado

    def test_primeira_pagina_vazia_nao_pede_a_segunda(self):
        cliente, (total, todos, avisos) = self._buscar({1: FORM}, 3)
        self.assertEqual((todos, avisos), ([], []))
        self.assertNotIn("trocarDePagina.do", cliente.pedidos)

    def test_nao_passa_da_ultima_pagina(self):
        html = "Resultados <strong>1 a 1</strong> de 1" + LINHA
        cliente, (total, todos, avisos) = self._buscar({1: html}, 3)
        self.assertEqual((total, len(todos), avisos), (1, 1, []))
        self.assertNotIn("trocarDePagina.do", cliente.pedidos)


if __name__ == "__main__":
    unittest.main()
