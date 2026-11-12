"""Modelos de prazos e tarefas por assunto ou classe processual."""
import asyncio
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import db
import modelos_prazo
import server
import usuarios_admin

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)
NUMERO = "10012345620268260100"


def chamar(middleware, metodo, url, token=None, corpo=None):
    """Chamada ASGI com corpo JSON opcional. Devolve (status, dict)."""
    enviado = json.dumps(corpo).encode() if corpo is not None else b""
    respostas = []

    async def receive():
        return {"type": "http.request", "body": enviado, "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    cabecalhos = [(b"authorization", f"Bearer {token}".encode())] if token else []
    if corpo is not None:
        cabecalhos.append((b"content-type", b"application/json"))
    caminho, _, consulta = url.partition("?")
    scope = {"type": "http", "method": metodo, "path": caminho, "query_string": consulta.encode(), "headers": cabecalhos}
    asyncio.run(middleware(scope, receive, send))
    bruto = b"".join(m.get("body", b"") for m in respostas[1:])
    try:
        return respostas[0]["status"], json.loads(bruto) if bruto else {}
    except ValueError:
        return respostas[0]["status"], {}


def definir_acao(caminho, caso_id, acao):
    """Grava a "ação" (classe informada à mão) do processo direto no banco."""
    with sqlite3.connect(caminho) as c:
        c.execute("UPDATE casos SET acao = ? WHERE id = ?", (acao, caso_id))


MODELO = {"nome": "Cobrança", "criterio": "Ação de Cobrança",
          "prazos": [{"titulo": "Contestação", "dias": 15}, {"titulo": "Réplica", "dias": 15, "contagem": "corridos"}],
          "tarefas": [{"titulo": "Pedir documentos ao cliente", "dias": 2}]}


class RegraTest(unittest.TestCase):
    def test_normalizar_ignora_acento_caixa_e_espacos(self):
        self.assertEqual(modelos_prazo.normalizar("  Ação   de COBRANÇA "), "acao de cobranca")
        self.assertEqual(modelos_prazo.normalizar(None), "")

    def test_validar_aceita_modelo_completo_e_aplica_padroes(self):
        d = modelos_prazo.validar({"criterio": "Cobrança", "prazos": [{"titulo": " Contestação ", "dias": 15}], "tarefas": [{"titulo": "Ligar"}]})
        self.assertEqual(d["prazos"], [{"titulo": "Contestação", "dias": 15, "contagem": "uteis"}])
        self.assertEqual(d["tarefas"], [{"titulo": "Ligar", "dias": 0}])
        self.assertEqual((d["nome"], d["ativo"]), ("Cobrança", True))

    def test_validar_recusa_dados_ruins(self):
        ruins = [
            {}, {"criterio": "Cobrança"}, {"criterio": "ab", "prazos": [{"titulo": "x", "dias": 1}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": 0}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": 366}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": True}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": "15"}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": 5, "contagem": "semanas"}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "", "dias": 5}]},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x" * 121, "dias": 5}]},
            {"criterio": "Cobrança", "tarefas": [{"titulo": "x", "dias": -1}]},
            {"criterio": "Cobrança", "prazos": "x"},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": 5}], "ativo": "sim"},
            {"criterio": "Cobrança", "prazos": [{"titulo": "x", "dias": 5}] * 21},
        ]
        for dados in ruins:
            with self.assertRaises(ValueError, msg=str(dados)[:80]):
                modelos_prazo.validar(dados)
        with self.assertRaises(ValueError):
            modelos_prazo.validar([])


class RepositorioTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.repo = modelos_prazo.Repositorio(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana", [NUMERO], AGORA)

    def definir_acao(self, acao):
        definir_acao(self.caminho, self.caso["id"], acao)

    def test_crud(self):
        m = self.repo.criar(MODELO, "ana", AGORA)
        self.assertEqual((m["nome"], m["criterio"], m["ativo"], m["criado_por"]), ("Cobrança", "Ação de Cobrança", True, "ana"))
        self.assertEqual([x["id"] for x in self.repo.listar()], [m["id"]])
        novo = self.repo.atualizar(m["id"], {"nome": "Cobrança (2026)", "ativo": False}, AGORA)
        self.assertEqual((novo["nome"], novo["ativo"], novo["prazos"]), ("Cobrança (2026)", False, m["prazos"]))
        with self.assertRaises(ValueError):
            self.repo.atualizar(m["id"], {"prazos": [], "tarefas": []}, AGORA)
        self.assertIsNone(self.repo.atualizar("inexistente", {"nome": "x"}, AGORA))
        self.assertTrue(self.repo.excluir(m["id"]))
        self.assertFalse(self.repo.excluir(m["id"]))
        self.assertEqual(self.repo.listar(), [])

    def test_sugere_pela_acao_pela_classe_e_pelos_assuntos_sem_acento_nem_caixa(self):
        self.repo.criar(MODELO, "ana", AGORA)
        self.assertEqual(self.repo.sugestoes(self.caso["id"]), [])
        self.definir_acao("AÇÃO DE COBRANÇA de contrato")
        achados = self.repo.sugestoes(self.caso["id"])
        self.assertEqual([a["correspondeu_a"] for a in achados], ["AÇÃO DE COBRANÇA de contrato"])
        self.definir_acao(None)
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, classe="Procedimento Comum Cível", assuntos=["Direito Civil", "acao de cobranca"])
        self.assertEqual([a["correspondeu_a"] for a in self.repo.sugestoes(self.caso["id"])], ["acao de cobranca"])
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, assuntos=["Direito Civil"], classe="Ação de Cobrança - Rito Comum")
        self.assertEqual([a["correspondeu_a"] for a in self.repo.sugestoes(self.caso["id"])], ["Ação de Cobrança - Rito Comum"])

    def test_modelo_inativo_nao_e_sugerido_e_processo_inexistente_devolve_none(self):
        m = self.repo.criar({**MODELO, "ativo": False}, "ana", AGORA)
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(self.repo.sugestoes(self.caso["id"]), [])
        self.repo.atualizar(m["id"], {"ativo": True}, AGORA)
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"])), 1)
        self.assertIsNone(self.repo.sugestoes("nao-existe"))

    def test_decisao_vale_uma_vez_por_processo_e_pode_ser_liberada(self):
        m = self.repo.criar(MODELO, "ana", AGORA)
        self.definir_acao("Ação de Cobrança")
        self.assertTrue(self.repo.reservar(self.caso["id"], m["id"], "aplicado", "ana", AGORA))
        self.assertFalse(self.repo.reservar(self.caso["id"], m["id"], "dispensado", "bia", AGORA))   # já decidido
        self.assertEqual(self.repo.sugestoes(self.caso["id"]), [])
        self.assertEqual(self.repo.decisoes(self.caso["id"]), {m["id"]: "aplicado"})
        self.repo.liberar(self.caso["id"], m["id"])
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"])), 1)
        with self.assertRaises(ValueError):
            self.repo.reservar(self.caso["id"], m["id"], "talvez", "ana", AGORA)

    def test_excluir_modelo_apaga_as_decisoes_dele(self):
        m = self.repo.criar(MODELO, "ana", AGORA)
        self.repo.reservar(self.caso["id"], m["id"], "dispensado", "ana", AGORA)
        self.repo.excluir(m["id"])
        self.assertEqual(self.repo.decisoes(self.caso["id"]), {})


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
        usuarios_admin.alterar(self.registro, {"permissoes": {"atividades": "nenhum", "casos": "editar"}}, "bootstrap", "dora@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana@teste.com", [NUMERO], AGORA)
        definir_acao(self.caminho, self.caso["id"], "Ação de Cobrança")
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        self.t = self.token["ana@teste.com"]

    def req(self, metodo, url, corpo=None, quem="ana@teste.com"):
        return chamar(self.mw, metodo, url, self.token[quem], corpo)

    def criar_modelo(self, **extra):
        status, corpo = self.req("POST", "/modelos-prazo", {**MODELO, **extra})
        self.assertEqual(status, 201, corpo)
        return corpo["modelo"]

    def test_crud_pela_api_e_validacao(self):
        m = self.criar_modelo()
        self.assertEqual(self.req("GET", "/modelos-prazo")[1]["modelos"][0]["id"], m["id"])
        self.assertEqual(self.req("GET", f"/modelos-prazo/{m['id']}")[0], 200)
        status, corpo = self.req("PATCH", f"/modelos-prazo/{m['id']}", {"nome": "Outro"})
        self.assertEqual((status, corpo["modelo"]["nome"]), (200, "Outro"))
        self.assertEqual(self.req("POST", "/modelos-prazo", {"criterio": "x"})[0], 400)
        self.assertEqual(self.req("PATCH", "/modelos-prazo/nao-existe", {"nome": "x"})[0], 404)
        self.assertEqual(self.req("GET", "/modelos-prazo/nao-existe")[0], 404)
        self.assertEqual(self.req("PUT", "/modelos-prazo")[0], 405)
        self.assertEqual(self.req("DELETE", f"/modelos-prazo/{m['id']}")[0], 200)
        self.assertEqual(self.req("DELETE", f"/modelos-prazo/{m['id']}")[0], 404)

    def test_permissoes(self):
        # consulta só lê
        self.assertEqual(self.req("GET", "/modelos-prazo", quem="cid@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/modelos-prazo", MODELO, quem="cid@teste.com")[0], 403)
        # sem acesso à área de atividades: nem lê
        self.assertEqual(self.req("GET", "/modelos-prazo", quem="dora@teste.com")[0], 200)   # leitura aceita 'casos'
        self.assertEqual(self.req("POST", "/modelos-prazo", MODELO, quem="dora@teste.com")[0], 403)
        self.assertEqual(chamar(self.mw, "GET", "/modelos-prazo")[0], 401)

    def test_sugestao_aplicacao_cria_atividades_e_nao_repete(self):
        m = self.criar_modelo()
        rota = f"/casos/{self.caso['id']}/modelos-prazo"
        sug = self.req("GET", rota)[1]["sugestoes"]
        self.assertEqual([(s["modelo"]["id"], s["correspondeu_a"]) for s in sug], [(m["id"], "Ação de Cobrança")])
        itens = [{"tipo": "prazo", "titulo": "Contestação", "data": "2026-12-04"}, {"tipo": "tarefa", "titulo": "Pedir documentos ao cliente", "data": "2026-11-14"}]
        status, corpo = self.req("POST", f"{rota}/{m['id']}/aplicar", {"itens": itens})
        self.assertEqual(status, 200, corpo)
        self.assertEqual([(a["tipo"], a["titulo"], a["data"]) for a in corpo["atividades"]],
                         [("prazo", "Contestação", "2026-12-04"), ("tarefa", "Pedir documentos ao cliente", "2026-11-14")])
        self.assertIn("Sugerido pelo modelo “Cobrança”", corpo["atividades"][0]["observacoes"])
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 2)
        self.assertEqual(self.req("GET", rota)[1]["sugestoes"], [])                           # não sugere de novo
        self.assertEqual(self.req("POST", f"{rota}/{m['id']}/aplicar", {"itens": itens})[0], 409)   # nem aplica de novo
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 2)

    def test_dispensar(self):
        m = self.criar_modelo()
        rota = f"/casos/{self.caso['id']}/modelos-prazo/{m['id']}"
        self.assertEqual(self.req("POST", f"{rota}/dispensar")[0], 200)
        self.assertEqual(self.req("POST", f"{rota}/dispensar")[0], 409)
        self.assertEqual(self.req("GET", f"/casos/{self.caso['id']}/modelos-prazo")[1]["sugestoes"], [])
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])

    def test_aplicar_valida_itens_antes_de_gravar_qualquer_coisa(self):
        m = self.criar_modelo()
        rota = f"/casos/{self.caso['id']}/modelos-prazo/{m['id']}/aplicar"
        ruins = [{}, {"itens": []}, {"itens": "x"},
                 {"itens": [{"tipo": "prazo", "titulo": "Ok", "data": "2026-12-04"}, {"tipo": "prazo", "titulo": "Sem data"}]},
                 {"itens": [{"tipo": "prazo", "titulo": "Data ruim", "data": "04/12/2026"}]},
                 {"itens": [{"tipo": "audiencia", "titulo": "Tipo errado", "data": "2026-12-04"}]},
                 {"itens": [{"tipo": "prazo", "titulo": "", "data": "2026-12-04"}]},
                 {"itens": [{"tipo": "prazo", "titulo": "x" * 201, "data": "2026-12-04"}]},
                 {"itens": ["texto"]}]
        for corpo in ruins:
            self.assertEqual(self.req("POST", rota, corpo)[0], 400, corpo)
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])
        # a reserva não foi consumida: ainda dá para aplicar depois
        self.assertEqual(self.req("POST", rota, {"itens": [{"tipo": "prazo", "titulo": "Ok", "data": "2026-12-04"}]})[0], 200)

    def test_falha_no_meio_desfaz_o_que_criou_e_libera_para_nova_tentativa(self):
        m = self.criar_modelo()
        rota = f"/casos/{self.caso['id']}/modelos-prazo/{m['id']}/aplicar"
        itens = [{"tipo": "prazo", "titulo": "Um", "data": "2026-12-04"}, {"tipo": "prazo", "titulo": "Dois", "data": "2026-12-05"}]
        original = self.gestao.criar_atividade
        chamadas = []

        def falha_na_segunda(*args, **kwargs):
            chamadas.append(1)
            if len(chamadas) == 2:
                raise RuntimeError("banco indisponível")
            return original(*args, **kwargs)

        with mock.patch.object(self.gestao, "criar_atividade", side_effect=falha_na_segunda):
            status, corpo = self.req("POST", rota, {"itens": itens})
        self.assertEqual(status, 500)
        self.assertIn("Nada foi criado", corpo["mensagem"])
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])          # desfez a primeira
        self.assertEqual(self.req("POST", rota, {"itens": itens})[0], 200)            # e libera para tentar de novo
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 2)

    def test_recursos_inexistentes_e_metodos(self):
        m = self.criar_modelo()
        base = f"/casos/{self.caso['id']}/modelos-prazo"
        self.assertEqual(self.req("GET", "/casos/nao-existe/modelos-prazo")[0], 404)
        self.assertEqual(self.req("POST", f"{base}/nao-existe/dispensar")[0], 404)
        self.assertEqual(self.req("POST", f"/casos/nao-existe/modelos-prazo/{m['id']}/dispensar")[0], 404)
        self.assertEqual(self.req("POST", base)[0], 405)
        self.assertEqual(self.req("GET", f"{base}/{m['id']}/aplicar")[0], 404)
        self.assertEqual(self.req("POST", f"{base}/{m['id']}/apagar")[0], 404)
        self.assertEqual(self.req("POST", f"{base}/{m['id']}/aplicar", None)[0], 400)


if __name__ == "__main__":
    unittest.main()
