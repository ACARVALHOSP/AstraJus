"""Rotas HTTP de tipos e regras de prazo, incluindo sugestões, decisões e migração do legado."""
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import db
import regras_prazo
import server
import usuarios_admin
from helpers_http import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)
NUMERO = "10012348320268260100"

TIPO = {"nome": "Contestação", "dias": 15, "contagem": "uteis",
        "base_legal": "CPC, art. 335", "inicio": "disponibilizacao"}
ESCOPO_CLASSE = [{"tipo": "classe", "codigo": None, "nome": "Ação de Cobrança"}]


def definir_acao(caminho, caso_id, acao):
    """Grava a "ação" (classe informada à mão) do processo direto no banco."""
    conexao = sqlite3.connect(caminho)
    try:
        with conexao:
            conexao.execute("UPDATE casos SET acao = ? WHERE id = ?", (acao, caso_id))
    finally:
        conexao.close()


class RotasTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("ana@teste.com", "cid@teste.com", "dora@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "consulta"}, "bootstrap", "cid@teste.com")
        usuarios_admin.alterar(self.registro, {"permissoes": {"atividades": "nenhum", "casos": "editar"}},
                               "bootstrap", "dora@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana@teste.com", [NUMERO], AGORA)
        definir_acao(self.caminho, self.caso["id"], "Ação de Cobrança")
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        self.repo = regras_prazo.Repositorio(self.caminho)

    def req(self, metodo, url, corpo=None, quem="ana@teste.com"):
        return chamar(self.mw, metodo, url, self.token[quem], corpo)

    def criar_tipo(self, **extra):
        status, corpo = self.req("POST", "/tipos-prazo", {**TIPO, **extra})
        self.assertEqual(status, 201, corpo)
        return corpo["tipo"]

    def criar_regra(self, tipo_id, **extra):
        dados = {"tipo_id": tipo_id, "escopo": ESCOPO_CLASSE, "palavras": "contestar"}
        dados.update(extra)
        status, corpo = self.req("POST", "/regras-prazo", dados)
        self.assertEqual(status, 201, corpo)
        return corpo["regra"]

    def test_crud_de_tipos(self):
        tipo = self.criar_tipo()
        self.assertEqual((tipo["nome"], tipo["dias"], tipo["contagem"], tipo["base_legal"], tipo["inicio"],
                          tipo["ativo"], tipo["criado_por"]),
                         ("Contestação", 15, "uteis", "CPC, art. 335", "disponibilizacao", True, "ana@teste.com"))
        self.assertEqual([t["id"] for t in self.req("GET", "/tipos-prazo")[1]["tipos"]], [tipo["id"]])
        self.assertEqual(self.req("GET", f"/tipos-prazo/{tipo['id']}")[1]["tipo"]["id"], tipo["id"])
        status, corpo = self.req("PATCH", f"/tipos-prazo/{tipo['id']}", {"nome": "Outro", "dias": 30})
        self.assertEqual((status, corpo["tipo"]["nome"], corpo["tipo"]["dias"]), (200, "Outro", 30))
        self.assertEqual(self.req("POST", "/tipos-prazo", {"nome": "Ruim"})[0], 400)
        self.assertEqual(self.req("PATCH", f"/tipos-prazo/{tipo['id']}", {"dias": 0})[0], 400)
        self.assertEqual(self.req("PATCH", "/tipos-prazo/nao-existe", {"nome": "x"})[0], 404)
        self.assertEqual(self.req("GET", "/tipos-prazo/nao-existe")[0], 404)
        self.assertEqual(self.req("PUT", "/tipos-prazo")[0], 405)
        self.assertEqual(self.req("DELETE", f"/tipos-prazo/{tipo['id']}"), (200, {"excluido": True}))
        self.assertEqual(self.req("DELETE", f"/tipos-prazo/{tipo['id']}")[0], 404)

    def test_crud_de_regras(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        self.assertEqual((regra["nome"], regra["tipo_id"], regra["escopo"], regra["palavras"],
                          regra["combinacao"], regra["ativo"], regra["criado_por"]),
                         ("Contestação", tipo["id"], ESCOPO_CLASSE, "contestar", "e", True, "ana@teste.com"))
        self.assertEqual([r["id"] for r in self.req("GET", "/regras-prazo")[1]["regras"]], [regra["id"]])
        self.assertEqual(self.req("GET", f"/regras-prazo/{regra['id']}")[1]["regra"]["id"], regra["id"])
        status, corpo = self.req("PATCH", f"/regras-prazo/{regra['id']}", {"palavras": "recorrer", "combinacao": "ou"})
        self.assertEqual((status, corpo["regra"]["palavras"], corpo["regra"]["combinacao"]), (200, "recorrer", "ou"))
        self.assertEqual(self.req("POST", "/regras-prazo", {"nome": "Sem tipo", "palavras": "x"})[0], 400)
        self.assertEqual(self.req("POST", "/regras-prazo", {"tipo_id": tipo["id"], "palavras": "a b"})[0], 400)
        self.assertEqual(self.req("PATCH", "/regras-prazo/nao-existe", {"palavras": "x"})[0], 404)
        self.assertEqual(self.req("GET", "/regras-prazo/nao-existe")[0], 404)
        self.assertEqual(self.req("PUT", "/regras-prazo")[0], 405)
        self.assertEqual(self.req("DELETE", f"/regras-prazo/{regra['id']}"), (200, {"excluido": True}))
        self.assertEqual(self.req("DELETE", f"/regras-prazo/{regra['id']}")[0], 404)

    def test_tipo_em_uso_nao_pode_ser_excluido(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        status, corpo = self.req("DELETE", f"/tipos-prazo/{tipo['id']}")
        self.assertEqual(status, 409)
        self.assertIn("1 regra", corpo["mensagem"])
        self.assertIsNotNone(self.repo.obter_tipo(tipo["id"]))
        self.assertEqual(self.req("DELETE", f"/regras-prazo/{regra['id']}")[0], 200)
        self.assertEqual(self.req("DELETE", f"/tipos-prazo/{tipo['id']}")[0], 200)

    def test_previa_da_expressao(self):
        status, corpo = self.req("POST", "/regras-prazo/previa",
                                 {"palavras": 'contestar ou "prazo de 15 dias" sem recurso'})
        self.assertEqual(status, 200)
        self.assertEqual(corpo["leitura"], 'contestar OU "prazo de 15 dias" mas SEM recurso')
        status, corpo = self.req("POST", "/regras-prazo/previa", {"palavras": "a b"})
        self.assertEqual(status, 400)
        self.assertIn('Use "e", "ou" ou "sem" entre os termos.', corpo["mensagem"])
        self.assertEqual(self.req("GET", "/regras-prazo/previa")[0], 405)

    def test_sugestoes_casam_escopo_e_palavras(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        rota = f"/casos/{self.caso['id']}/regras-prazo/sugestoes"
        status, corpo = self.req("POST", rota, {"origem": "publicacao", "id": "pub-1",
                                                "texto": "Prazo para contestar"})
        self.assertEqual(status, 200)
        self.assertEqual([(s["regra"]["id"], s["tipo"]["id"], s["correspondeu_a"], s["termos"]) for s in corpo["sugestoes"]],
                         [(regra["id"], tipo["id"], ESCOPO_CLASSE[0], ["contestar"])])
        self.assertEqual(self.req("POST", rota, {"origem": "publicacao", "id": "pub-2",
                                                 "texto": "Prazo para recorrer"})[1]["sugestoes"], [])
        # só o escopo não basta quando a combinação é 'e'
        self.assertEqual(self.req("POST", rota, {"origem": "movimento", "id": "mov-1",
                                                 "texto": "Nada a ver"})[1]["sugestoes"], [])
        self.assertEqual(self.req("POST", "/casos/nao-existe/regras-prazo/sugestoes",
                                  {"origem": "publicacao", "id": "pub-1", "texto": "x"})[0], 404)
        self.assertEqual(self.req("POST", rota, {"origem": "email", "id": "pub-1", "texto": "x"})[0], 400)
        self.assertEqual(self.req("POST", rota, {"origem": "publicacao", "id": " ", "texto": "x"})[0], 400)

    def test_aplicar_cria_um_prazo_e_nao_repete(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        rota = f"/casos/{self.caso['id']}/regras-prazo/{regra['id']}/aplicar"
        corpo = {"origem": "publicacao", "origem_id": "pub-1", "titulo": "Contestação", "data": "2026-12-04"}
        status, resposta = self.req("POST", rota, corpo)
        self.assertEqual(status, 201, resposta)
        atividade = resposta["atividade"]
        self.assertEqual((atividade["tipo"], atividade["titulo"], atividade["data"]),
                         ("prazo", "Contestação", "2026-12-04"))
        self.assertIn("Sugerido pela regra “Contestação”. Confira antes de cumprir.", atividade["observacoes"])
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 1)
        self.assertEqual(self.req("POST", rota, corpo)[0], 409)
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 1)
        # sugestão do mesmo evento some depois da decisão
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/sugestoes",
                                  {"origem": "publicacao", "id": "pub-1", "texto": "Prazo para contestar"})[1]["sugestoes"], [])

    def test_aplicar_customiza_observacoes_e_valida_o_corpo(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        rota = f"/casos/{self.caso['id']}/regras-prazo/{regra['id']}/aplicar"
        base = {"origem": "publicacao", "origem_id": "pub-1", "titulo": "Contestação", "data": "2026-12-04"}
        ruins = [{**base, "titulo": ""}, {**base, "titulo": "x" * 201}, {**base, "data": "04/12/2026"},
                 {**base, "origem": "email"}, {**base, "origem_id": " "}, {**base, "observacoes": 123}, {}]
        for corpo in ruins:
            self.assertEqual(self.req("POST", rota, corpo)[0], 400, corpo)
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/nao-existe/aplicar", base)[0], 404)
        self.assertEqual(self.req("POST", f"/casos/nao-existe/regras-prazo/{regra['id']}/aplicar", base)[0], 404)
        status, resposta = self.req("POST", rota, {**base, "observacoes": "  Revisar  com  a cliente  "})
        self.assertEqual(status, 201)
        self.assertEqual(resposta["atividade"]["observacoes"], "Revisar com a cliente")

    def test_falha_ao_criar_desfaz_a_decisao_e_permite_tentar_de_novo(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        rota = f"/casos/{self.caso['id']}/regras-prazo/{regra['id']}/aplicar"
        corpo = {"origem": "publicacao", "origem_id": "pub-1", "titulo": "Contestação", "data": "2026-12-04"}
        with mock.patch.object(self.gestao, "criar_atividade", side_effect=RuntimeError("banco indisponível")):
            status, resposta = self.req("POST", rota, corpo)
        self.assertEqual(status, 500)
        self.assertIn("Nada foi criado; tente de novo.", resposta["mensagem"])
        self.assertEqual(self.repo.decisoes(self.caso["id"]), [])
        self.assertEqual(self.req("POST", rota, corpo)[0], 201)
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 1)

    def test_dispensar(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        rota = f"/casos/{self.caso['id']}/regras-prazo/{regra['id']}/dispensar"
        corpo = {"origem": "publicacao", "origem_id": "pub-1"}
        self.assertEqual(self.req("POST", rota, corpo), (200, {"dispensado": True}))
        self.assertEqual(self.req("POST", rota, corpo)[0], 409)
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/sugestoes",
                                  {"origem": "publicacao", "id": "pub-1", "texto": "Prazo para contestar"})[1]["sugestoes"], [])
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/{regra['id']}/dispensar",
                                  {"origem": "email", "origem_id": "pub-1"})[0], 400)
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/nao-existe/dispensar", corpo)[0], 404)
        self.assertEqual(self.req("POST", f"/casos/nao-existe/regras-prazo/{regra['id']}/dispensar", corpo)[0], 404)

    def test_permissoes(self):
        # consulta só lê
        self.assertEqual(self.req("GET", "/tipos-prazo", quem="cid@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/tipos-prazo", TIPO, quem="cid@teste.com")[0], 403)
        self.assertEqual(self.req("GET", "/regras-prazo", quem="cid@teste.com")[0], 200)
        # sem acesso à área de atividades: nem escreve (a leitura aceita 'casos')
        self.assertEqual(self.req("GET", "/tipos-prazo", quem="dora@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/tipos-prazo", TIPO, quem="dora@teste.com")[0], 403)
        self.assertEqual(self.req("GET", "/regras-prazo", quem="dora@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/regras-prazo", {"tipo_id": "x", "palavras": "x"},
                                  quem="dora@teste.com")[0], 403)
        self.assertEqual(self.req("POST", f"/casos/{self.caso['id']}/regras-prazo/sugestoes",
                                  {"origem": "publicacao", "id": "pub-1", "texto": "x"},
                                  quem="dora@teste.com")[0], 403)
        self.assertEqual(chamar(self.mw, "GET", "/tipos-prazo")[0], 401)

    def test_recursos_inexistentes_e_metodos(self):
        tipo = self.criar_tipo()
        regra = self.criar_regra(tipo["id"])
        base = f"/casos/{self.caso['id']}/regras-prazo"
        self.assertEqual(self.req("GET", base)[0], 405)
        self.assertEqual(self.req("POST", f"{base}/sugestoes", None)[0], 400)
        self.assertEqual(self.req("POST", f"{base}/{regra['id']}/apagar", {})[0], 404)
        self.assertEqual(self.req("GET", f"{base}/{regra['id']}/aplicar")[0], 405)
        self.assertEqual(self.req("POST", f"{base}/{regra['id']}/aplicar", None)[0], 400)


class MigracaoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.repo = regras_prazo.Repositorio(self.caminho)

    def criar_tabelas_antigas(self, modelos):
        with sqlite3.connect(self.caminho) as c:
            c.executescript("""
                CREATE TABLE modelos_prazo (
                    id TEXT PRIMARY KEY, nome TEXT NOT NULL, criterio TEXT NOT NULL,
                    prazos TEXT NOT NULL, tarefas TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
                    criado_por TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
                CREATE TABLE modelo_prazo_decisoes (
                    caso_id TEXT NOT NULL, modelo_id TEXT NOT NULL, acao TEXT NOT NULL,
                    usuario TEXT, em TEXT NOT NULL, PRIMARY KEY (caso_id, modelo_id));
            """)
            for modelo in modelos:
                c.execute("INSERT INTO modelos_prazo (id, nome, criterio, prazos, tarefas, ativo, criado_por, criado_em, atualizado_em) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          (modelo["id"], modelo["nome"], modelo["criterio"], json.dumps(modelo["prazos"]),
                           json.dumps(modelo.get("tarefas", [])), 1, "ana", "2026-01-01T00:00:00+00:00",
                           "2026-01-01T00:00:00+00:00"))
            c.execute("INSERT INTO modelo_prazo_decisoes (caso_id, modelo_id, acao, usuario, em) "
                      "VALUES ('caso-1', 'm1', 'aplicado', 'ana', '2026-01-01T00:00:00+00:00')")

    def test_migra_tipos_e_regras_inativas_e_apaga_as_tabelas_antigas(self):
        existente = self.repo.criar_tipo({"nome": "Contestação", "dias": 15, "contagem": "uteis"}, "ana", AGORA)
        self.criar_tabelas_antigas([
            {"id": "m1", "nome": "Cobrança", "criterio": "Ação de Cobrança",
             "prazos": [{"titulo": "CONTESTAÇÃO", "dias": 15, "contagem": "uteis"},   # reutiliza o tipo
                        {"titulo": "Contestação", "dias": 20},                       # dias diferentes: novo tipo
                        {"titulo": "Réplica", "dias": 15, "contagem": "corridos"}],
             "tarefas": [{"titulo": "Pedir documentos", "dias": 2}]},
            {"id": "m2", "nome": "Só tarefas", "criterio": "Ação de Cobrança", "prazos": [],
             "tarefas": [{"titulo": "Ligar", "dias": 1}]},
        ])
        self.assertEqual(regras_prazo.migrar_legado(self.caminho), 3)
        tipos = {t["id"]: t for t in self.repo.listar_tipos()}
        self.assertEqual(len(tipos), 3)                                          # o existente + 2 novos
        self.assertIn(existente["id"], tipos)
        contestacao = [t for t in tipos.values() if regras_prazo.normalizar(t["nome"]) == "contestacao"]
        self.assertEqual(sorted(t["dias"] for t in contestacao), [15, 20])       # não duplicou os 15 dias
        regras = self.repo.listar_regras()
        self.assertEqual(len(regras), 3)
        self.assertEqual({r["nome"] for r in regras},
                         {"Cobrança – CONTESTAÇÃO", "Cobrança – Contestação", "Cobrança – Réplica"})
        for regra in regras:
            self.assertFalse(regra["ativo"])                                     # regra sem palavras fica inativa
            self.assertEqual((regra["palavras"], regra["combinacao"], regra["criado_por"], regra["escopo"]),
                             ("", "e", "migração",
                              [{"tipo": "classe", "codigo": None, "nome": "Ação de Cobrança"},
                               {"tipo": "assunto", "codigo": None, "nome": "Ação de Cobrança"}]))
        self.assertTrue(all(t["inicio"] == "disponibilizacao" for t in tipos.values()))
        self.assertTrue(all(t["criado_por"] == "migração" for t in tipos.values() if t["id"] != existente["id"]))
        with sqlite3.connect(self.caminho) as c:
            tabelas = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertNotIn("modelos_prazo", tabelas)
        self.assertNotIn("modelo_prazo_decisoes", tabelas)

    def test_rodar_de_novo_nao_duplica(self):
        self.criar_tabelas_antigas([
            {"id": "m1", "nome": "Cobrança", "criterio": "Ação de Cobrança",
             "prazos": [{"titulo": "Contestação", "dias": 15}]},
        ])
        self.assertEqual(regras_prazo.migrar_legado(self.caminho), 1)
        antes = (len(self.repo.listar_tipos()), len(self.repo.listar_regras()))
        regras_prazo.Repositorio(self.caminho)
        self.assertEqual(regras_prazo.migrar_legado(self.caminho), 0)
        self.assertEqual((len(self.repo.listar_tipos()), len(self.repo.listar_regras())), antes)

    def test_migrar_legado_cria_as_tabelas_novas_quando_chamado_direto(self):
        caminho = Path(self.caminho.parent) / "direto.db"
        with sqlite3.connect(caminho) as c:
            c.executescript("""
                CREATE TABLE modelos_prazo (
                    id TEXT PRIMARY KEY, nome TEXT NOT NULL, criterio TEXT NOT NULL,
                    prazos TEXT NOT NULL, tarefas TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
                    criado_por TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
            """)
            c.execute("INSERT INTO modelos_prazo (id, nome, criterio, prazos, tarefas, ativo, criado_por, criado_em, atualizado_em) "
                      "VALUES ('m1', 'Cobrança', 'Ação de Cobrança', ?, '[]', 1, 'ana', '2026-01-01', '2026-01-01')",
                      (json.dumps([{"titulo": "Contestação", "dias": 15}]),))
        self.assertEqual(regras_prazo.migrar_legado(caminho), 1)
        repo = regras_prazo.Repositorio(caminho)
        self.assertEqual([r["nome"] for r in repo.listar_regras()], ["Cobrança – Contestação"])
        self.assertFalse(repo.listar_regras()[0]["ativo"])


if __name__ == "__main__":
    unittest.main()
