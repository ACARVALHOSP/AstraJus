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


class PeriodoLongoTest(unittest.TestCase):
    def test_janelas_de_um_ano_sem_buracos_nem_sobreposicao(self):
        j = servico._janelas_cjpg("15/11/2023", "13/11/2026")  # 36 meses
        self.assertEqual(j, [("15/11/2023", "13/11/2024"), ("14/11/2024", "13/11/2025"), ("14/11/2025", "13/11/2026")])
        self.assertEqual(servico._janelas_cjpg("14/11/2025", "13/11/2026"), [("14/11/2025", "13/11/2026")])
        self.assertEqual(servico._janelas_cjpg("", ""), [("", "")])

    def test_validacao_do_periodo_longo_e_opt_in(self):
        v = servico._validar_periodo_cjpg
        self.assertIn("até 1 ano", v("15/11/2023", "13/11/2026"))               # padrão: continua recusando
        self.assertIsNone(v("15/11/2023", "13/11/2026", longo=True))            # 36 meses
        self.assertIn("3 anos", v("01/01/2022", "13/11/2026", longo=True))      # mais que 3 anos

    def test_soma_as_janelas_da_mais_recente_para_a_mais_antiga(self):
        chamadas = []

        async def janela(params, paginas, ignorar_cache=False):
            chamadas.append(params["dadosConsulta.dtInicio"])
            ini = params["dadosConsulta.dtInicio"]
            if ini == "14/11/2024":
                raise ValueError("e-SAJ fora do ar")
            return 10, [{"numero_processo": ini}], [f"aviso {ini}"]
        params = {"dadosConsulta.dtInicio": "15/11/2023", "dadosConsulta.dtFim": "13/11/2026"}
        with mock.patch.object(servico, "_cjpg_executar_janela", janela):
            total, todos, avisos = asyncio.run(servico._cjpg_executar_busca(params, 8))
        self.assertEqual(sorted(chamadas), ["14/11/2024", "14/11/2025", "15/11/2023"])
        self.assertEqual((total, [r["numero_processo"] for r in todos]), (20, ["14/11/2025", "15/11/2023"]))
        self.assertTrue(any("14/11/2024" in a and "falhou" in a for a in avisos))
