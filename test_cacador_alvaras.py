"""Caçador de Alvarás: regex, Jev com fallback e o serviço do módulo."""
import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import httpx

import server  # noqa: F401  (vincula o núcleo aos módulos)
from modulos.cacador_alvaras import deteccao, servico


def _pub(texto, hash_="h1"):
    return {"hash": hash_, "nome_pesquisado": "Fulano de Tal", "dados": {"texto": texto, "siglaTribunal": "TJSP"}}


class RegexTest(unittest.TestCase):
    def casos(self):
        return {
            "expedido": "Informamos que o alvará foi expedido e está disponível para retirada no valor de R$ 12.345,67.",
            "determinado": "Defiro o pedido. Expeça-se alvará de levantamento em favor da autora.",
            "providencia_parte": "Indique a parte os dados bancários para expedição do alvará.",
            "indeferido": "Indefiro o pedido de alvará, por ora.",
            "mencao": "Aguarde-se o decurso de prazo; o alvará será analisado depois.",
            "nenhum": "Intime-se o réu para apresentar contestação no prazo de 15 dias.",
        }

    def test_situacoes(self):
        for esperado, texto in self.casos().items():
            self.assertEqual(deteccao.detectar_regex(texto)["situacao"], esperado, texto)

    def test_valor_e_trechos(self):
        r = deteccao.detectar_regex(self.casos()["expedido"])
        self.assertTrue(r["encontrou"])
        self.assertEqual((r["valor"], r["origem"]), (12345.67, "regex"))
        self.assertIn("alvar", r["trechos"][0].lower())

    def test_sem_alvara(self):
        r = deteccao.detectar_regex(self.casos()["nenhum"])
        self.assertEqual((r["encontrou"], r["faixa"], r["trechos"]), (False, "baixa", []))
        self.assertFalse(deteccao.eh_candidata(self.casos()["nenhum"]))

    def test_levantamento_sem_a_palavra_alvara(self):
        self.assertTrue(deteccao.eh_candidata("Autorizo o levantamento do depósito judicial."))
        self.assertEqual(deteccao.detectar_regex("Autorizo o levantamento do depósito judicial.")["situacao"], "determinado")

    def test_prioridade_prefere_a_situacao_mais_acionavel(self):
        r = deteccao.detectar_regex("Indefiro o pedido de alvará de fls. 3. No mais, expeça-se alvará em favor do exequente.")
        self.assertEqual(r["situacao"], "determinado")


class FalsoJev:
    def __init__(self, resposta=None, erro=None):
        self.resposta, self.erro, self.estados = resposta, erro, []

    async def classificar(self, estado):
        self.estados.append(estado)
        if self.erro:
            raise deteccao.ErroTriagem(self.erro)
        return dict(self.resposta)


class CacarTest(unittest.TestCase):
    TEXTO = "Fulano de Tal, CPF 123.456.789-09: o alvará foi expedido, valor R$ 1.000,00."

    def test_jev_vale_quando_responde(self):
        jev = FalsoJev({"origem": "jev", "modelo": "m", "encontrou": True, "situacao": "determinado", "confianca": 0.95, "faixa": "alta", "valor": None})
        r = asyncio.run(deteccao.cacar(_pub(self.TEXTO), jev))
        self.assertEqual((r["origem"], r["situacao"], r["valor"]), ("jev", "determinado", 1000.0))  # valor do regex completa
        self.assertTrue(r["trechos"])
        enviado = json.dumps(jev.estados[0], ensure_ascii=False)
        self.assertNotIn("Fulano", enviado)
        self.assertNotIn("123.456.789-09", enviado)

    def test_fallback_para_regex_em_erro(self):
        r = asyncio.run(deteccao.cacar(_pub(self.TEXTO), FalsoJev(erro="O OpenRouter não respondeu (HTTP 503).")))
        self.assertEqual((r["origem"], r["situacao"]), ("regex", "expedido"))
        self.assertIn("503", r["fallback_motivo"])

    def test_sem_classificador_usa_regex(self):
        r = asyncio.run(deteccao.cacar(_pub(self.TEXTO), None))
        self.assertEqual((r["origem"], r["situacao"]), ("regex", "expedido"))
        self.assertNotIn("fallback_motivo", r)

    def test_nao_candidata_nao_chama_o_jev(self):
        jev = FalsoJev({})
        r = asyncio.run(deteccao.cacar(_pub("Intime-se para contestar."), jev))
        self.assertFalse(r["encontrou"])
        self.assertEqual(jev.estados, [])


class ClassificadorHttpTest(unittest.TestCase):
    def _classificador(self, manipulador, tentativas=2):
        return deteccao.ClassificadorAlvaraJev("k", cliente_http=lambda: httpx.AsyncClient(transport=httpx.MockTransport(manipulador)),
                                               tentativas=tentativas, espera_s=0)

    def test_resposta_valida_com_cerca_de_codigo(self):
        def m(req):
            conteudo = '```json\n{"situacao": "expedido", "confianca": 0.93, "valor": "1500.5"}\n```'
            return httpx.Response(200, json={"model": "typesafe/jev-router", "choices": [{"message": {"content": conteudo}}]})
        r = asyncio.run(self._classificador(m).classificar({"texto": "x"}))
        self.assertEqual((r["origem"], r["situacao"], r["faixa"], r["valor"]), ("jev", "expedido", "alta", 1500.5))

    def test_situacao_fora_da_lista_e_erro(self):
        def m(req):
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"situacao": "xyz", "confianca": 1}'}}]})
        with self.assertRaises(deteccao.ErroTriagem):
            asyncio.run(self._classificador(m).classificar({"texto": "x"}))

    def test_repete_em_503_e_falha(self):
        chamadas = []
        def m(req):
            chamadas.append(1)
            return httpx.Response(503)
        with self.assertRaises(deteccao.ErroTriagem):
            asyncio.run(self._classificador(m, tentativas=3).classificar({"texto": "x"}))
        self.assertEqual(len(chamadas), 3)

    def test_chave_recusada_nao_repete(self):
        chamadas = []
        def m(req):
            chamadas.append(1)
            return httpx.Response(401)
        with self.assertRaises(deteccao.ErroTriagem):
            asyncio.run(self._classificador(m, tentativas=3).classificar({"texto": "x"}))
        self.assertEqual(len(chamadas), 1)


class ServicoTest(unittest.TestCase):
    def setUp(self):
        self.banco = str(Path(tempfile.mkdtemp()) / "t.db")
        con = sqlite3.connect(self.banco)
        con.execute("CREATE TABLE publicacoes_capturadas (hash TEXT PRIMARY KEY, monitoramento_id TEXT, nome_pesquisado TEXT, "
                    "numero_processo TEXT, dados TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'nao_tratada', caso_id TEXT, criado_em TEXT NOT NULL)")
        publicacoes = [
            ("a", "Alvará expedido, disponível para retirada. R$ 500,00.", "2026-01-03"),
            ("b", "Intime-se para contestar.", "2026-01-02"),
            ("c", "Indefiro o pedido de levantamento.", "2026-01-01"),
        ]
        for h, texto, dia in publicacoes:
            con.execute("INSERT INTO publicacoes_capturadas VALUES (?,?,?,?,?,?,?,?)",
                        (h, None, None, f"proc-{h}", json.dumps({"texto": texto, "data_disponibilizacao": dia, "siglaTribunal": "tjsp"}),
                         "nao_tratada", None, f"{dia}T10:00:00"))
        con.commit()
        servico.migrar(con)
        con.commit()
        con.close()
        self._original = servico._classificador
        servico._classificador = lambda: None

    def tearDown(self):
        servico._classificador = self._original

    def test_cacar_e_listar_so_com_regex(self):
        r = asyncio.run(servico._cacar())
        self.assertEqual((r["analisadas"], r["encontradas"], r["via_regex"], r["via_jev"], r["jev_disponivel"]), (3, 2, 3, 0, False))
        lista = servico._listar()
        self.assertEqual([i["hash"] for i in lista["alvaras"]], ["a", "c"])  # expedido antes de indeferido
        self.assertEqual((lista["alvaras"][0]["valor"], lista["alvaras"][0]["tribunal"]), (500.0, "TJSP"))
        self.assertEqual(lista["resumo"], {"expedido": 1, "indeferido": 1})
        self.assertEqual([i["hash"] for i in servico._listar("indeferido")["alvaras"]], ["c"])
        with self.assertRaises(ValueError):
            servico._listar("nenhum")

    def test_segunda_rodada_nao_reanalisa(self):
        asyncio.run(servico._cacar())
        self.assertEqual(asyncio.run(servico._cacar())["analisadas"], 0)
        self.assertEqual(asyncio.run(servico._cacar(refazer=True))["analisadas"], 3)

    def test_quando_o_jev_chega_reanalisa_so_o_que_ficou_no_regex(self):
        asyncio.run(servico._cacar())
        jev = FalsoJev({"origem": "jev", "modelo": "m", "encontrou": True, "situacao": "expedido", "confianca": 0.97, "faixa": "alta", "valor": 500.0})
        servico._classificador = lambda: jev
        r = asyncio.run(servico._cacar())
        self.assertEqual((r["analisadas"], r["via_jev"]), (2, 2))  # 'b' (nenhum) não volta
        self.assertEqual({i["origem"] for i in servico._listar()["alvaras"]}, {"jev"})

    def test_http_listar_e_cacar(self):
        enviados = []
        async def send(msg):
            enviados.append(msg)
        async def sem_corpo():
            return {"type": "http.request", "body": b"{}", "more_body": False}
        escopo = {"method": "POST", "query_string": b""}
        self.assertTrue(asyncio.run(servico.http_com_corpo(escopo, sem_corpo, send, "/alvaras/cacador/cacar")))
        self.assertEqual(enviados[0]["status"], 200)
        enviados.clear()
        escopo = {"method": "GET", "query_string": b"situacao=expedido"}
        self.assertTrue(asyncio.run(servico.http_com_corpo(escopo, sem_corpo, send, "/alvaras/cacador")))
        self.assertEqual(json.loads(enviados[1]["body"])["alvaras"][0]["hash"], "a")


if __name__ == "__main__":
    unittest.main()
