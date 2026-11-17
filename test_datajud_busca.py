import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import server

NUMERO = "10063142720238260005"


def _resp(hits, total=None):
    return httpx.Response(200, json={"hits": {"total": {"value": len(hits) if total is None else total}, "hits": hits}})


def _hit(numero, ajuiz, sort, **extra):
    return {"_source": {"numeroProcesso": numero, "tribunal": "TJSP", "grau": "G1",
                        "classe": {"codigo": 7, "nome": "Procedimento Comum Cível"},
                        "assuntos": [{"codigo": 1, "nome": "Indenização"}],
                        "orgaoJulgador": {"codigo": 42, "nome": "1ª Vara"}, "dataAjuizamento": ajuiz, **extra},
            "sort": sort}


class CorpoBuscaTest(unittest.TestCase):
    def test_filtros_ordem_e_cursor(self):
        corpo = server._corpo_busca_datajud(
            classe_codigo=7, orgao_julgador_codigo=42, assunto_codigo=1, ajuizamento_inicio="2026-01-01",
            ajuizamento_fim="2026-01-31", grau="G1", tamanho=5, search_after=[1767225600000, 99])
        filtros = corpo["query"]["bool"]["filter"]
        self.assertIn({"match": {"classe.codigo": 7}}, filtros)
        self.assertIn({"match": {"orgaoJulgador.codigo": 42}}, filtros)
        self.assertIn({"match": {"assuntos.codigo": 1}}, filtros)
        self.assertIn({"range": {"dataAjuizamento": {"gte": "2026-01-01T00:00:00", "lte": "2026-01-31T23:59:59"}}}, filtros)
        self.assertEqual(corpo["sort"][0], {"dataAjuizamento": {"order": "desc"}})
        self.assertEqual(corpo["sort"][1], {"@timestamp": {"order": "asc"}})
        self.assertEqual(corpo["search_after"], [1767225600000, 99])
        self.assertEqual(corpo["size"], 5)

    def test_sem_cursor_nao_envia_search_after(self):
        self.assertNotIn("search_after", server._corpo_busca_datajud(classe_codigo=7))


class BuscarProcessosTest(unittest.TestCase):
    def buscar(self, **kw):
        return asyncio.run(server.buscar_processos_datajud(**{"tribunal": "tjsp", **kw}))

    def test_validacoes_nao_chamam_a_rede(self):
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock()) as rede:
            for kw in ({}, {"classe_codigo": 0}, {"classe_codigo": "x"}, {"classe_codigo": 7, "tamanho": 0},
                       {"classe_codigo": 7, "tamanho": 101}, {"tribunal": "TJ SP", "classe_codigo": 7},
                       {"classe_codigo": 7, "ajuizamento_inicio": "01/01/2026"},
                       {"ajuizamento_inicio": "2026-02-01", "ajuizamento_fim": "2026-01-01"},
                       {"classe_codigo": 7, "search_after": "x"}, {"classe_codigo": 7, "search_after": [{"a": 1}]},
                       {"classe_codigo": 7, "grau": "g 1!"}):
                with self.subTest(kw=kw):
                    self.assertTrue(self.buscar(**kw).get("erro"))
            rede.assert_not_awaited()

    def test_pagina_cheia_devolve_cursor_e_ultima_pagina_nao(self):
        hits = [_hit("1", "2026-01-02T00:00:00Z", [200, 1]), _hit("2", "2026-01-01T00:00:00Z", [100, 2])]
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=_resp(hits, total=5))) as rede:
            r = self.buscar(classe_codigo=7, tamanho=2)
            corpo = rede.await_args.args[2]
        self.assertEqual(r["total"], 5)
        self.assertEqual(r["proximo_cursor"], [100, 2])
        self.assertTrue(r["tem_mais"])
        self.assertEqual(corpo["size"], 2)
        self.assertEqual(r["processos"][0]["classe_codigo"], 7)
        self.assertEqual(r["processos"][0]["orgao_julgador_codigo"], 42)
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=_resp(hits[:1], total=3))):
            ultima = self.buscar(classe_codigo=7, tamanho=2, search_after=[100, 2])
        self.assertIsNone(ultima["proximo_cursor"])
        self.assertFalse(ultima["tem_mais"])

    def test_sem_resultado_e_erro_da_api(self):
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=_resp([]))):
            r = self.buscar(classe_codigo=7)
        self.assertFalse(r["encontrado"])
        self.assertEqual(r["processos"], [])
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=server._erro("HTTP 404"))):
            self.assertTrue(self.buscar(classe_codigo=7).get("erro"))


class MovimentosDesdeTest(unittest.TestCase):
    MOVS = [{"codigo": 3, "dataHora": "2026-03-01T10:00:00.000Z"}, {"codigo": 1, "dataHora": "2026-01-01T00:00:00Z"},
            {"codigo": 2, "dataHora": "2026-02-01T00:00:00"}, {"codigo": 9, "dataHora": None}]

    def test_filtra_estritamente_maior_ordena_e_mantem_sem_data(self):
        desde = server._datahora("2026-02-01T00:00:00Z")
        r = server._movimentos_desde(self.MOVS, desde)
        self.assertEqual([m["codigo"] for m in r], [3, 9])
        self.assertEqual([m["codigo"] for m in server._movimentos_desde(self.MOVS, None)], [1, 2, 3, 9])

    def test_datahora(self):
        self.assertIsNone(server._datahora("lixo"))
        self.assertIsNone(server._datahora(None))
        self.assertEqual(server._datahora("2026-02-01T00:00:00").tzinfo, server.timezone.utc)


class ConsultarMovimentosTest(unittest.TestCase):
    def rodar(self, hits, **kw):
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=_resp(hits))) as rede:
            r = asyncio.run(server.consultar_movimentos_datajud("tjsp", kw.pop("numero", NUMERO), **kw))
        return r, rede

    def test_so_movimentos_novos_por_grau_e_corpo_enxuto(self):
        hits = [_hit(NUMERO, "2023-01-01T00:00:00Z", [1], dataHoraUltimaAtualizacao="2026-03-02T00:00:00Z", movimentos=[
            {"codigo": 1, "dataHora": "2023-01-01T00:00:00Z"}, {"codigo": 2, "dataHora": "2026-03-01T00:00:00Z"}])]
        r, rede = self.rodar(hits, desde="2026-01-01")
        corpo = rede.await_args.args[2]
        self.assertEqual(corpo["_source"], server._CAMPOS_MOVIMENTOS)
        self.assertEqual(r["total_novos"], 1)
        self.assertEqual(r["instancias"][0]["total_movimentos"], 2)
        self.assertEqual(r["instancias"][0]["movimentos"][0]["codigo"], 2)

    def test_entradas_invalidas_nao_chamam_a_rede(self):
        r, rede = self.rodar([], numero="10063142720238260006")
        self.assertIn("dígito verificador", r["mensagem"])
        r, rede = self.rodar([], desde="ontem")
        self.assertTrue(r["erro"])
        rede.assert_not_awaited()

    def test_nao_encontrado(self):
        r, _ = self.rodar([])
        self.assertFalse(r["encontrado"])


class TemMovimentoNovoTest(unittest.TestCase):
    CONHECIDOS = [{"codigo": 1, "dataHora": "2026-01-01T00:00:00Z"}, {"codigo": 2, "dataHora": "2026-02-01T00:00:00Z"}]

    def checar(self, resposta):
        with patch.object(server, "consultar_movimentos_datajud", new=AsyncMock(return_value=resposta)) as consulta:
            r = asyncio.run(server._datajud_tem_movimento_novo("tjsp", NUMERO, self.CONHECIDOS))
        return r, consulta

    def test_sem_mudanca(self):
        r, consulta = self.checar({"encontrado": True, "total_novos": 0, "instancias": [{"total_movimentos": 2}]})
        self.assertIs(r, False)
        self.assertEqual(consulta.await_args.kwargs["desde"], "2026-02-01T00:00:00+00:00")

    def test_movimento_novo_ou_retroativo(self):
        self.assertIs(self.checar({"encontrado": True, "total_novos": 1, "instancias": [{"total_movimentos": 3}]})[0], True)
        self.assertIs(self.checar({"encontrado": True, "total_novos": 0, "instancias": [{"total_movimentos": 3}]})[0], True)

    def test_erro_ou_nao_encontrado_devolve_none(self):
        self.assertIsNone(self.checar({"erro": True, "mensagem": "x"})[0])
        self.assertIsNone(self.checar({"encontrado": False})[0])


if __name__ == "__main__":
    unittest.main()
