"""Contratos de honorários: migração, prévia, ativação, parcelas no Financeiro e permissões."""
import contextlib
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import contratos_honorarios
import db
import server
import usuarios_admin
from helpers_http import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)


class ContratosHonorariosHttpTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("adm@teste.com", "ana@teste.com", "cid@teste.com", "dora@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "adm@teste.com")
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "consulta"}, "bootstrap", "cid@teste.com")
        usuarios_admin.alterar(
            self.registro,
            {"permissoes": {"financeiro": "nenhum", "pagamentos": "nenhum", "contatos": "nenhum", "casos": "nenhum"}},
            "bootstrap", "dora@teste.com",
        )
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.cliente = self.gestao.criar_cliente("Maria Souza", None, None, AGORA)
        self.caso = self.gestao.criar_caso(self.cliente["id"], "Silva x Banco", "ana@teste.com", [], AGORA)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        self.repo = contratos_honorarios.Repositorio(self.caminho, self.gestao)

    def req(self, metodo, url, corpo=None, quem="ana@teste.com"):
        return chamar(self.mw, metodo, url, self.token.get(quem), corpo)

    def dados(self, **extra):
        base = {
            "cliente_id": self.cliente["id"], "caso_id": self.caso["id"], "titulo": "Honorários iniciais",
            "valor_total": 1000, "entrada": 100, "entrada_vencimento": "2026-01-15",
            "parcelas": 3, "primeiro_vencimento": "2026-01-31", "responsavel": "ana@teste.com",
        }
        base.update(extra)
        return base

    def criar(self, **extra):
        status, corpo = self.req("POST", "/contratos-honorarios", self.dados(**extra))
        self.assertEqual(status, 201, corpo)
        return corpo["contrato"]

    def test_migracao_de_lancamentos_sem_processo(self):
        """Reproduz a tabela antiga (caso_id NOT NULL e colunas migradas) e confere a reconstrução."""
        # Deixa o schema completo criar clientes/casos e depois troca a tabela pela versão antiga.
        db.conectar(self.caminho).close()
        with contextlib.closing(sqlite3.connect(self.caminho)) as c:
            c.execute("DROP TABLE lancamentos_financeiros")
            c.execute("""
                CREATE TABLE lancamentos_financeiros (
                    id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT 'HONORARIO', vencimento TEXT NOT NULL,
                    valor REAL NOT NULL, descricao TEXT NOT NULL, recorrente INTEGER NOT NULL DEFAULT 0,
                    caso_id TEXT NOT NULL REFERENCES casos(id), cliente_id TEXT NOT NULL REFERENCES clientes(id),
                    responsavel TEXT NOT NULL, criado_em TEXT NOT NULL, direcao TEXT NOT NULL DEFAULT 'RECEITA',
                    pago INTEGER NOT NULL DEFAULT 0, asaas_cobranca_id TEXT, pago_em TEXT, grupo_parcelas TEXT,
                    parcela_numero INTEGER, parcela_total INTEGER, reembolsavel INTEGER NOT NULL DEFAULT 0,
                    favorecido TEXT, origem_id TEXT
                )
            """)
            c.execute(
                "INSERT INTO lancamentos_financeiros (id, tipo, vencimento, valor, descricao, recorrente, caso_id, "
                "cliente_id, responsavel, criado_em, direcao, pago, asaas_cobranca_id, pago_em, grupo_parcelas, "
                "parcela_numero, parcela_total, reembolsavel, favorecido, origem_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("antigo1", "HONORARIO", "2026-01-31", 500.0, "Parcela antiga", 0, self.caso["id"],
                 self.cliente["id"], "ana", "2026-01-01T10:00:00", "RECEITA", 1, "pay_1",
                 "2026-02-01", "grupo_1", 2, 2, 1, "Maria", "origem_1"),
            )
            c.execute(
                "INSERT INTO lancamentos_financeiros (id, tipo, vencimento, valor, descricao, recorrente, caso_id, "
                "cliente_id, responsavel, criado_em, direcao, pago) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("antigo2", "CUSTAS", "2026-02-10", 80.0, "Custa antiga", 0, self.caso["id"],
                 self.cliente["id"], "ana", "2026-01-02T10:00:00", "DESPESA", 0),
            )
            c.commit()

        db.conectar(self.caminho).close()

        with contextlib.closing(sqlite3.connect(self.caminho)) as c:
            c.row_factory = sqlite3.Row
            colunas = {linha["name"]: linha for linha in c.execute("PRAGMA table_info(lancamentos_financeiros)")}
            self.assertEqual(colunas["caso_id"]["notnull"], 0)
            self.assertIn("contrato_id", colunas)
            linhas = {linha["id"]: dict(linha) for linha in c.execute("SELECT * FROM lancamentos_financeiros")}
            self.assertEqual(set(linhas), {"antigo1", "antigo2"})
            self.assertEqual(linhas["antigo1"]["asaas_cobranca_id"], "pay_1")
            self.assertEqual(linhas["antigo1"]["pago_em"], "2026-02-01")
            self.assertEqual(linhas["antigo1"]["grupo_parcelas"], "grupo_1")
            self.assertEqual(linhas["antigo1"]["parcela_numero"], 2)
            self.assertEqual(linhas["antigo1"]["favorecido"], "Maria")
            self.assertEqual(linhas["antigo1"]["origem_id"], "origem_1")
            self.assertIsNone(linhas["antigo1"]["contrato_id"])
            self.assertEqual(linhas["antigo2"]["direcao"], "DESPESA")
            self.assertFalse(c.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lancamentos_financeiros_novo'"
            ).fetchone())

        db.conectar(self.caminho).close()  # idempotente: rodar de novo não muda nada
        with contextlib.closing(sqlite3.connect(self.caminho)) as c:
            c.row_factory = sqlite3.Row
            self.assertEqual(c.execute("SELECT count(*) FROM lancamentos_financeiros").fetchone()[0], 2)
            self.assertEqual(c.execute("PRAGMA table_info(lancamentos_financeiros)").fetchall()[6]["notnull"], 0)

    def test_lancamento_sem_processo_no_post_lista_e_resumo(self):
        status, criado = self.req("POST", "/lancamentos", {
            "vencimento": "2026-12-01", "valor": 150, "descricao": "Honorário avulso",
            "responsavel": "ana@teste.com", "cliente_id": self.cliente["id"],
        })
        self.assertEqual(status, 201, criado)
        self.assertIsNone(criado["caso_id"])
        self.assertEqual(criado["cliente_id"], self.cliente["id"])

        status, listados = self.req("GET", "/lancamentos")
        self.assertEqual(status, 200)
        self.assertEqual([l["id"] for l in listados["lancamentos"]], [criado["id"]])

        status, resumo = self.req("GET", "/lancamentos/resumo?hoje=2026-11-12")
        self.assertEqual(status, 200)
        self.assertEqual(len(resumo["processos"]), 1)
        self.assertIsNone(resumo["processos"][0]["caso_id"])
        self.assertEqual(resumo["processos"][0]["honorarios"]["em_aberto"], 150.0)

        self.assertEqual(self.req("POST", "/lancamentos", {
            "vencimento": "2026-12-01", "valor": 10, "descricao": "x", "responsavel": "ana",
            "cliente_id": self.cliente["id"], "caso_id": "nao-existe",
        })[0], 400)

    def test_previa_soma_exata_e_dia_31(self):
        sem_entrada = self.repo.previa({
            "valor_total": 1000, "entrada": 0, "parcelas": 3, "primeiro_vencimento": "2026-01-31",
        })
        self.assertEqual([p["valor"] for p in sem_entrada], [333.33, 333.33, 333.34])
        self.assertEqual([p["vencimento"] for p in sem_entrada], ["2026-01-31", "2026-02-28", "2026-03-31"])
        self.assertEqual([p["rotulo"] for p in sem_entrada], ["Parcela 1/3", "Parcela 2/3", "Parcela 3/3"])
        self.assertEqual(sum(round(p["valor"] * 100) for p in sem_entrada), 100000)

        com_entrada = self.repo.previa({
            "valor_total": 1000, "entrada": 100, "entrada_vencimento": "2026-01-15",
            "parcelas": 3, "primeiro_vencimento": "2026-01-31",
        })
        self.assertEqual([p["rotulo"] for p in com_entrada], ["Entrada", "Parcela 1/3", "Parcela 2/3", "Parcela 3/3"])
        self.assertEqual([p["valor"] for p in com_entrada], [100.0, 300.0, 300.0, 300.0])
        self.assertEqual(com_entrada[0]["vencimento"], "2026-01-15")
        self.assertEqual(sum(round(p["valor"] * 100) for p in com_entrada), 100000)

        status, corpo = self.req("POST", "/contratos-honorarios/previa", {
            "valor_total": 1000, "entrada": 0, "parcelas": 3, "primeiro_vencimento": "2026-01-31",
        })
        self.assertEqual((status, [p["valor"] for p in corpo["parcelas"]]),
                         (200, [333.33, 333.33, 333.34]))

    def test_criar_ativar_e_nao_duplicar(self):
        contrato = self.criar()
        self.assertEqual((contrato["situacao"], contrato["valor_total"], contrato["entrada"], contrato["parcelas"]),
                         ("rascunho", 1000.0, 100.0, 3))
        self.assertEqual(contrato["parcelas_lancamentos"], [])
        self.assertFalse(contrato["resumo"]["quitado"])

        status, ativado = self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})
        self.assertEqual(status, 200, ativado)
        contrato = ativado["contrato"]
        self.assertEqual(contrato["situacao"], "vigente")
        self.assertTrue(contrato["ativado_em"])
        lancamentos = contrato["parcelas_lancamentos"]
        self.assertEqual(len(lancamentos), 4)
        self.assertTrue(all(l["contrato_id"] == contrato["id"] for l in lancamentos))
        self.assertTrue(all((l["tipo"], l["direcao"]) == ("HONORARIO", "RECEITA") for l in lancamentos))
        self.assertTrue(lancamentos[0]["descricao"].endswith("(entrada)"))
        self.assertEqual(lancamentos[0]["valor"], 100.0)
        self.assertEqual([l["valor"] for l in lancamentos[1:]], [300.0, 300.0, 300.0])
        self.assertEqual([l["parcela_numero"] for l in lancamentos[1:]], [1, 2, 3])
        self.assertEqual({l["grupo_parcelas"] for l in lancamentos[1:]}, {lancamentos[1]["grupo_parcelas"]})
        self.assertEqual(contrato["resumo"], {
            "total": 1000.0, "pago": 0.0, "em_aberto": 1000.0, "vencido": 1000.0, "quitado": False,
        })

        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})[0], 409)
        self.assertEqual(len(self.gestao.listar_lancamentos()), 4)

        status, obtido = self.req("GET", f"/contratos-honorarios/{contrato['id']}")
        self.assertEqual((status, len(obtido["contrato"]["parcelas_lancamentos"])), (200, 4))

    def test_contrato_sem_processo(self):
        contrato = self.criar(caso_id=None, entrada=0, entrada_vencimento=None, parcelas=2)
        self.assertIsNone(contrato["caso_id"])
        status, ativado = self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})
        self.assertEqual(status, 200, ativado)
        lancamentos = ativado["contrato"]["parcelas_lancamentos"]
        self.assertEqual(len(lancamentos), 2)
        self.assertTrue(all(l["caso_id"] is None for l in lancamentos))
        self.assertTrue(all(l["cliente_id"] == self.cliente["id"] for l in lancamentos))

    def test_validacoes_de_criacao(self):
        ruins = (
            {"entrada": 1000},
            {"entrada": 1200},
            {"parcelas": 0},
            {"parcelas": 121},
            {"primeiro_vencimento": "31/01/2026"},
            {"primeiro_vencimento": "2026-02-30"},
            {"cliente_id": "nao-existe"},
            {"caso_id": "nao-existe"},
            {"valor_total": 0},
            {"exito_percentual": 101},
            {"ativar_ao_assinar": "sim"},
        )
        for ruim in ruins:
            with self.subTest(ruim=ruim):
                self.assertEqual(self.req("POST", "/contratos-honorarios", self.dados(**ruim))[0], 400)

    def test_atualizar_trava_valores_apos_ativar(self):
        contrato = self.criar(parcelas=1, entrada=0)
        self.assertEqual(self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"valor_total": 1200})[0], 200)

        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})[0], 200)
        status, corpo = self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"titulo": "Novo título"})
        self.assertEqual((status, corpo["contrato"]["titulo"]), (200, "Novo título"))
        self.assertEqual(self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"valor_total": 1300})[0], 400)
        self.assertEqual(self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"parcelas": 5})[0], 400)
        # Reenviar o mesmo valor é aceito (formulários costumam mandar o objeto inteiro).
        self.assertEqual(self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"valor_total": 1200})[0], 200)

    def test_cancelar_remove_so_nao_pagos_sem_cobranca(self):
        contrato = self.criar()
        self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})
        lancamentos = self.repo.obter(contrato["id"])["parcelas_lancamentos"]
        self.gestao.atualizar_lancamento_pago(lancamentos[0]["id"], True)
        self.gestao.definir_cobranca_lancamento(lancamentos[1]["id"], "pay_contrato")
        restantes = {l["id"] for l in lancamentos[2:]}

        status, corpo = self.req("POST", f"/contratos-honorarios/{contrato['id']}/cancelar", {})
        self.assertEqual(status, 200, corpo)
        self.assertEqual((corpo["removidos"], corpo["mantidos"], corpo["contrato"]["situacao"]),
                         (2, 2, "cancelado"))
        self.assertEqual({l["id"] for l in self.gestao.listar_lancamentos()},
                         {lancamentos[0]["id"], lancamentos[1]["id"]})
        self.assertFalse(restantes & {l["id"] for l in self.gestao.listar_lancamentos()})

        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/cancelar", {})[0], 409)
        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/encerrar", {})[0], 409)
        self.assertEqual(self.req("PATCH", f"/contratos-honorarios/{contrato['id']}", {"titulo": "x"})[0], 409)

    def test_encerrar(self):
        contrato = self.criar()
        self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})
        status, corpo = self.req("POST", f"/contratos-honorarios/{contrato['id']}/encerrar", {})
        self.assertEqual((status, corpo["contrato"]["situacao"]), (200, "encerrado"))
        self.assertEqual(len(self.gestao.listar_lancamentos()), 4)
        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/encerrar", {})[0], 409)
        self.assertEqual(self.req("POST", f"/contratos-honorarios/{contrato['id']}/ativar", {})[0], 409)

    def test_permissoes(self):
        self.assertEqual(self.req("GET", "/contratos-honorarios", None, "dora@teste.com")[0], 403)
        self.assertEqual(self.req("POST", "/contratos-honorarios", self.dados(), "dora@teste.com")[0], 403)
        self.assertEqual(self.req("GET", "/contratos-honorarios", None, "cid@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/contratos-honorarios", self.dados(), "cid@teste.com")[0], 403)
        self.assertEqual(self.req("GET", "/contratos-honorarios", None, None)[0], 401)

    def test_filtros_e_metodos(self):
        primeiro = self.criar(titulo="Primeiro")
        self.criar(titulo="Segundo")
        self.req("POST", f"/contratos-honorarios/{primeiro['id']}/ativar", {})
        status, corpo = self.req("GET", f"/contratos-honorarios?cliente_id={self.cliente['id']}&situacao=vigente")
        self.assertEqual((status, [c["titulo"] for c in corpo["contratos"]]), (200, ["Primeiro"]))
        self.assertEqual(self.req("GET", "/contratos-honorarios?situacao=inventada")[0], 400)
        self.assertEqual(self.req("POST", "/contratos-honorarios/nao-existe/ativar", {})[0], 404)
        self.assertEqual(self.req("GET", "/contratos-honorarios/nao-existe")[0], 404)
        self.assertEqual(self.req("DELETE", f"/contratos-honorarios/{primeiro['id']}")[0], 405)


if __name__ == "__main__":
    unittest.main()
