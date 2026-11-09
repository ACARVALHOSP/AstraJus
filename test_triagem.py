import asyncio
import json
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import httpx

import db
import server
import triagem

PUBLICACAO = {
    "nome_pesquisado": "Ana Carolina Exemplo", "numero_processo": "10063142720238260005",
    "dados": {
        "data_disponibilizacao": "2026-11-06", "tipoComunicacao": "Intimação", "nomeOrgao": "2ª Vara Cível", "nomeClasse": "Procedimento Comum",
        "siglaTribunal": "TJSP", "destinatarios": [{"nome": "MARIA DAS GRAÇAS SOUZA LIMA", "polo": "A"}, {"nome": "Banco Alfa S.A.", "polo": "P"}],
        "destinatarioadvogados": [{"nome": "Ana Carolina Exemplo", "numero_oab": "123456", "uf_oab": "SP"}, {"advogado": {"nome": "Pedro Teixeira"}}],
        "texto": ("Processo 1006314-27.2023.8.26.0005. Fica a parte ré, Banco Alfa S.A. (CNPJ 12.345.678/0001-90), intimada, na pessoa do "
                  "Dr. Pedro Teixeira (OAB/SP 123.456), para apresentar contestação no prazo de 15 dias. Autora: Maria das Graças Souza Lima, "
                  "CPF 123.456.789-09, e-mail maria@exemplo.com, tel (11) 91234-5678. Contato: Souza."),
    },
}


class AnonimizarTest(unittest.TestCase):
    def test_nada_identificavel_sai(self):
        estado = triagem.anonimizar(PUBLICACAO)
        texto = estado["texto"]
        for proibido in ("Maria", "Graças", "Souza", "Lima", "Banco Alfa", "Alfa", "Pedro", "Teixeira", "Ana Carolina", "Exemplo",
                         "123.456.789-09", "12.345.678/0001-90", "maria@exemplo.com", "91234", "1006314", "123.456"):
            self.assertNotIn(proibido.lower(), texto.lower(), proibido)
        self.assertIn("contestação no prazo de 15 dias", texto)       # o que importa para classificar continua
        self.assertEqual((estado["classe"], estado["orgao"], estado["tribunal"]), ("Procedimento Comum", "2ª Vara Cível", "TJSP"))

    def test_limita_o_tamanho(self):
        grande = {"dados": {"texto": "x " * 20000}}
        self.assertLessEqual(len(triagem.anonimizar(grande)["texto"]), triagem.TAMANHO_MAX_TEXTO)


class ClassificadoresTest(unittest.TestCase):
    def test_ids_dos_prazos_iguais_aos_do_frontend(self):
        ts = Path("frontend/src/routes/publicacoes-oab/prazos.ts").read_text(encoding="utf-8")
        ids_ts = set(re.findall(r"\{ id: '([a-z_]+)', rotulo:", ts))
        self.assertEqual(set(triagem.PRAZOS_PADRAO) - {"nenhum"}, ids_ts)

    def test_faixas(self):
        self.assertEqual([triagem.faixa(p) for p in (0.99, 0.91, 0.90, 0.75, 0.50, 0.49, 0.0, None)],
                         ["alta", "alta", "revisar", "revisar", "revisar", "baixa", "baixa", "baixa"])

    def test_interpretar_notas_e_faixas(self):
        base = {"tipo": {"choice": "ciencia", "probabilities": {"ciencia": 0.97}}, "prazo_padrao": {"choice": "nenhum", "probabilities": {"nenhum": 0.4}}}
        r = triagem.interpretar({**base, "gera_prazo": {"noul": 0.02}, "urgencia": {"score": 0, "confidence": 0.95}}, "jev-1.14.0")
        self.assertEqual((r["urgencia"]["nota"], r["gera_prazo"]["valor"], r["faixas"]["gera_prazo"]), (1.0, False, "alta"))  # 0,02 de chance = certeza de "não"
        self.assertEqual((r["faixas"]["tipo"], r["faixas"]["prazo_padrao"], r["faixas"]["urgencia"]), ("alta", "baixa", "alta"))
        self.assertEqual(triagem.interpretar({**base, "gera_prazo": {"noul": 0.6}, "urgencia": {"score": 4, "confidence": 0.5}}, "m")["urgencia"]["nota"], 10.0)
        self.assertEqual(triagem.interpretar({**base, "gera_prazo": {"noul": 0.6}, "urgencia": {"score": 2, "confidence": 0.5}}, "m")["urgencia"]["nota"], 5.5)
        with self.assertRaises(triagem.ErroTriagem):
            triagem.interpretar({"tipo": {}}, "m")

    def test_simulado_reconhece_intimacao_com_prazo(self):
        r = asyncio.run(triagem.ClassificadorSimulado().classificar(triagem.anonimizar(PUBLICACAO)))
        self.assertEqual(r["modelo"], "simulado")
        self.assertEqual((r["tipo"]["valor"], r["prazo_padrao"]["valor"], r["gera_prazo"]["valor"]), ("exige_manifestacao", "contestacao", True))
        ciencia = asyncio.run(triagem.ClassificadorSimulado().classificar({"tipo_comunicacao": "Intimação", "texto": "Tomar ciência do despacho. Nada a prover. Arquive-se."}))
        self.assertFalse(ciencia["gera_prazo"]["valor"])
        self.assertLess(ciencia["urgencia"]["nota"], r["urgencia"]["nota"])

    def test_jev_formata_a_chamada_e_le_a_resposta(self):
        chamadas = []

        def tratar(req: httpx.Request) -> httpx.Response:
            chamadas.append(req)
            return httpx.Response(200, json={"model": "jev-1.14.0", "usage": {"input_tokens": 300, "output_tokens": 0}, "answers": {
                "tipo": {"type": "choice", "choice": "exige_manifestacao", "confidence": 0.9, "probabilities": {"exige_manifestacao": 0.94, "ciencia": 0.06}},
                "gera_prazo": {"type": "noul", "noul": 0.97},
                "prazo_padrao": {"type": "choice", "choice": "contestacao", "confidence": 0.9, "probabilities": {"contestacao": 0.92, "nenhum": 0.08}},
                "urgencia": {"type": "score", "score": 3.1, "confidence": 0.8, "legend": {}, "probabilities": {}}}})
        cl = triagem.ClassificadorJev("chave-secreta", cliente_http=lambda: httpx.AsyncClient(transport=httpx.MockTransport(tratar)))
        r = asyncio.run(cl.classificar(triagem.anonimizar(PUBLICACAO)))
        req = chamadas[0]
        corpo = json.loads(req.content)
        self.assertEqual(str(req.url), "https://api.typesafe.ai/v1/systemone")
        self.assertEqual(req.headers["authorization"], "Bearer chave-secreta")
        self.assertEqual(corpo["model"], "jev-latest")
        self.assertEqual(set(corpo["questions"]), {"tipo", "gera_prazo", "prazo_padrao", "urgencia"})          # tudo numa chamada só
        self.assertEqual({q["type"] for q in corpo["questions"].values()}, {"choice", "noul", "score"})
        self.assertLessEqual(len(corpo["questions"]["urgencia"]["criteria"]), 10)                                # limite do score
        self.assertLessEqual(len(corpo["questions"]["prazo_padrao"]["criteria"]), 255)                          # limite do choice
        self.assertNotIn("Teixeira", json.dumps(corpo, ensure_ascii=False))                                       # nada identificável sai
        self.assertEqual((r["modelo"], r["tipo"]["valor"], r["faixas"]["gera_prazo"], r["urgencia"]["nota"]), ("jev-1.14.0", "exige_manifestacao", "alta", 8.0))

    def test_jev_repete_429_e_recusa_chave_invalida(self):
        respostas = iter([httpx.Response(429), httpx.Response(529), httpx.Response(200, json={"model": "m", "answers": {
            "tipo": {"choice": "ciencia", "probabilities": {"ciencia": 1.0}}, "gera_prazo": {"noul": 0.1},
            "prazo_padrao": {"choice": "nenhum", "probabilities": {"nenhum": 1.0}}, "urgencia": {"score": 0, "confidence": 1.0}}})])
        cl = triagem.ClassificadorJev("k", espera_s=0, cliente_http=lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: next(respostas))))
        self.assertEqual(asyncio.run(cl.classificar({"texto": "x"}))["tipo"]["valor"], "ciencia")
        recusa = triagem.ClassificadorJev("k", cliente_http=lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))))
        with self.assertRaisesRegex(triagem.ErroTriagem, "401"):
            asyncio.run(recusa.classificar({"texto": "x"}))
        fora = triagem.ClassificadorJev("k", tentativas=2, espera_s=0, cliente_http=lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(529))))
        with self.assertRaisesRegex(triagem.ErroTriagem, "não respondeu"):
            asyncio.run(fora.classificar({"texto": "x"}))

    def test_modos(self):
        self.assertIsNone(triagem.criar_classificador("desligado"))
        self.assertIsNone(triagem.criar_classificador("jev", ""))          # sem chave: não liga
        self.assertEqual(triagem.criar_classificador("simulado").modelo, "simulado")
        self.assertEqual(triagem.criar_classificador("jev", "k").modelo, "jev-latest")


class TriagemServidorTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        _, _, self.token = server._criar_usuario_core(self.registro, "ana@teste.com")
        self.publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        self.agora = lambda: datetime(2026, 11, 8, tzinfo=timezone.utc)
        db.RegistroClientesCasos(self.caminho)  # cria o esquema
        for h, texto in (("h1", "Intime-se a parte para apresentar contestação no prazo de 15 dias. Liminar deferida."),
                         ("h2", "Tomar ciência do despacho. Nada a prover.")):
            dados = {**PUBLICACAO["dados"], "texto": texto}
            self.publicacoes.registrar(h, None, "Ana", None, dados, "nao_tratada", None, self.agora)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=db.RegistroClientesCasos(self.caminho), publicacoes=self.publicacoes)

    def chamar(self, modo, metodo, rota, dados=None):
        config = {"CNJ_TRIAGEM_MODO": modo}

        async def executar():
            http = httpx.AsyncClient(transport=httpx.ASGITransport(self.mw), base_url="http://t")
            r = await http.request(metodo, rota, json=dados, headers={"Authorization": "Bearer " + self.token})
            return r.status_code, r.json()
        with mock.patch.object(server, "_config_integracao", lambda nome, padrao="": config.get(nome, padrao)):
            return asyncio.run(executar())

    def test_desligado_nao_classifica_e_a_lista_informa_o_modo(self):
        status, corpo = self.chamar("desligado", "POST", "/publicacoes-oab/triagem", {"hashes": ["h1"]})
        self.assertEqual(status, 409)
        status, corpo = self.chamar("desligado", "GET", "/publicacoes-oab")
        self.assertEqual((corpo["triagem"]["modo"], corpo["publicacoes"][0]["triagem"]), ("desligado", None))
        self.assertEqual(self.chamar("jev", "POST", "/publicacoes-oab/triagem", {"hashes": ["h1"]})[0], 409)    # sem chave

    def test_simulado_classifica_guarda_e_ordena_por_urgencia(self):
        self.assertEqual(self.chamar("simulado", "POST", "/publicacoes-oab/triagem", {"hashes": []})[0], 400)
        status, corpo = self.chamar("simulado", "POST", "/publicacoes-oab/triagem", {"hashes": ["h1", "h2", "inexistente"]})
        self.assertEqual(status, 200)
        self.assertEqual(set(corpo["resultados"]), {"h1", "h2"})
        self.assertIn("inexistente", corpo["falhas"])
        self.assertEqual(corpo["resultados"]["h1"]["modelo"], "simulado")
        _, lista = self.chamar("simulado", "GET", "/publicacoes-oab?ordem=urgencia_desc")
        self.assertEqual([p["hash"] for p in lista["publicacoes"]], ["h1", "h2"])                  # a mais urgente primeiro
        self.assertGreater(lista["publicacoes"][0]["triagem"]["urgencia"]["nota"], lista["publicacoes"][1]["triagem"]["urgencia"]["nota"])
        self.assertEqual(self.publicacoes.hashes_sem_triagem(), [])

    def test_triagem_automatica_so_pega_as_novas(self):
        with mock.patch.object(server, "_config_integracao", lambda nome, padrao="": {"CNJ_TRIAGEM_MODO": "simulado"}.get(nome, padrao)):
            self.assertTrue(asyncio.run(server._triagem_automatica(self.publicacoes, self.agora)))
            self.assertEqual(len(self.publicacoes.obter_triagens(["h1", "h2"])), 2)
            self.assertTrue(asyncio.run(server._triagem_automatica(self.publicacoes, self.agora)))   # nada novo: não refaz


if __name__ == "__main__":
    unittest.main()
