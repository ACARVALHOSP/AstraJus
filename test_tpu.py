import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import server
import tpu


class TpuTest(unittest.TestCase):
    def test_tabelas_embutidas_tem_tamanho_coerente(self):
        for tabela, minimo in (("classes", 800), ("assuntos", 5000), ("movimentos", 900)):
            with self.subTest(tabela=tabela):
                self.assertGreaterEqual(len(tpu._carregar(tabela)["itens"]), minimo)
        self.assertRegex(tpu.versao(), r"^\d{2}/\d{2}/\d{4}$")

    def test_integridade_dos_pais_e_ausencia_de_ciclos(self):
        for tabela in tpu.TABELAS:
            itens = tpu._carregar(tabela)["itens"]
            for codigo, (nome, pai) in itens.items():
                self.assertTrue(nome, f"{tabela} {codigo} sem nome")
                self.assertTrue(pai == 0 or pai in itens, f"{tabela} {codigo}: pai {pai} fora da tabela")
                self.assertLess(len(tpu.caminho(tabela, codigo)), tpu._PROFUNDIDADE_MAX, f"{tabela} {codigo}: ciclo?")

    def test_itens_conhecidos(self):
        self.assertEqual(tpu.nome("classes", 7), "Procedimento Comum Cível")
        self.assertEqual(tpu.nome("movimentos", 26), "Distribuição")
        self.assertEqual(tpu.nome("assuntos", 10433), "Indenização por Dano Moral")
        self.assertEqual([i["codigo"] for i in tpu.caminho("classes", 7)], [2, 1106, 1107, 7])
        self.assertEqual(tpu.grupo("assuntos", 10433, 0), "DIREITO CIVIL")

    def test_nome_e_caminho_com_entrada_ruim(self):
        self.assertIsNone(tpu.nome("classes", "abc"))
        self.assertIsNone(tpu.nome("classes", None))
        self.assertIsNone(tpu.nome("classes", 999999999))
        self.assertEqual(tpu.caminho("classes", "x"), [])
        self.assertIsNone(tpu.grupo("classes", 999999999))
        with self.assertRaises(ValueError):
            tpu.nome("outra", 1)

    def test_busca_sem_acento_caixa_e_por_palavras(self):
        codigos = [i["codigo"] for i in tpu.buscar("classes", "PROCEDIMENTO  comum civel")]
        self.assertIn(7, codigos)
        self.assertEqual(tpu.buscar("classes", "procedimento comum", 1)[0]["nome"].lower().startswith("procedimento comum"), True)
        self.assertEqual(tpu.buscar("classes", "zzzzqqq"), [])
        self.assertEqual(tpu.buscar("classes", "   "), [])
        self.assertEqual([i["codigo"] for i in tpu.buscar("classes", "7")], [7])
        self.assertEqual(tpu.buscar("classes", "99999999"), [])
        self.assertLessEqual(len(tpu.buscar("assuntos", "a", 5)), 5)


class ToolConsultarTpuTest(unittest.TestCase):
    def chamar(self, **kw):
        return asyncio.run(server.consultar_tpu(**kw))

    def test_busca_por_nome_devolve_codigo_e_caminho(self):
        r = self.chamar(tabela="classes", busca="procedimento comum civel")
        self.assertTrue(r["encontrado"])
        item = next(i for i in r["itens"] if i["codigo"] == 7)
        self.assertIn("Procedimento de Conhecimento", item["caminho"])
        self.assertEqual(r["versao_tabelas"], tpu.versao())

    def test_por_codigo_traz_hierarquia_completa(self):
        r = self.chamar(tabela="assuntos", codigo=10433)
        self.assertEqual(r["itens"][0]["nome"], "Indenização por Dano Moral")
        self.assertEqual([h["nome"] for h in r["itens"][0]["hierarquia"]][0], "DIREITO CIVIL")

    def test_codigo_inexistente_nao_e_erro(self):
        r = self.chamar(tabela="classes", codigo=999999999)
        self.assertFalse(r["encontrado"])
        self.assertNotIn("erro", r)

    def test_entradas_invalidas(self):
        for kw in ({"tabela": "outra", "busca": "x"}, {"tabela": "classes"}, {"tabela": "classes", "busca": "  "},
                   {"tabela": "classes", "busca": "x", "limite": 0}, {"tabela": "classes", "busca": "x", "limite": 51}):
            with self.subTest(kw=kw):
                self.assertTrue(self.chamar(**kw).get("erro"))


class EnriquecimentoPelaTpuTest(unittest.TestCase):
    def test_resumo_da_busca_traz_hierarquia_e_area(self):
        resumo = server._resumo_processo_busca({
            "numeroProcesso": "1", "classe": {"codigo": 7, "nome": "Procedimento Comum Cível"},
            "assuntos": [{"codigo": 10433, "nome": "Indenização por Dano Moral"}, {"codigo": 999999999, "nome": "Inexistente"}]})
        self.assertEqual(resumo["classe_caminho"], ["PROCESSO CÍVEL E DO TRABALHO", "Processo de Conhecimento", "Procedimento de Conhecimento"])
        self.assertEqual(resumo["assuntos"][0]["area"], "DIREITO CIVIL")
        self.assertIsNone(resumo["assuntos"][1]["area"])  # código fora da tabela: sem quebrar

    def test_movimentos_novos_ganham_categoria(self):
        hit = {"_source": {"numeroProcesso": "10063142720238260005", "grau": "G1", "tribunal": "TJSP", "movimentos": [
            {"codigo": 26, "nome": "Distribuição", "dataHora": "2026-03-01T00:00:00Z"}, {"codigo": 999999999, "nome": "X", "dataHora": "2026-03-02T00:00:00Z"}]}}
        resposta = httpx.Response(200, json={"hits": {"total": {"value": 1}, "hits": [hit]}})
        with patch.object(server, "_datajud_post_com_retry", new=AsyncMock(return_value=resposta)):
            r = asyncio.run(server.consultar_movimentos_datajud("tjsp", "10063142720238260005"))
        movs = r["instancias"][0]["movimentos"]
        self.assertTrue(movs[0]["categoria"])
        self.assertIsNone(movs[1]["categoria"])


if __name__ == "__main__":
    unittest.main()
