"""Regras de sugestão de prazos: expressão de palavras-chave, cadastros e sugestões."""
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db
import regras_prazo

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)
NUMERO = "10012348320268260100"

TIPO = {"nome": "Contestação", "dias": 15, "contagem": "uteis",
        "base_legal": "CPC, art. 335", "inicio": "disponibilizacao"}
ESCOPO_CLASSE = [{"tipo": "classe", "codigo": None, "nome": "Ação de Cobrança"}]
ESCOPO_ASSUNTO = [{"tipo": "assunto", "codigo": None, "nome": "Cobrança"}]


def definir_acao(caminho, caso_id, acao):
    """Grava a "ação" (classe informada à mão) do processo direto no banco."""
    conexao = sqlite3.connect(caminho)
    try:
        with conexao:
            conexao.execute("UPDATE casos SET acao = ? WHERE id = ?", (acao, caso_id))
    finally:
        conexao.close()


class ExpressaoTest(unittest.TestCase):
    def test_palavra_inteira_caixa_e_acento(self):
        expr = regras_prazo.compilar("RECURSO")
        self.assertEqual(expr.avaliar("Prazo para RECURSO"), ["RECURSO"])
        self.assertIsNone(expr.avaliar("Prazo para recursos"))          # só palavra inteira
        self.assertIsNone(expr.avaliar("") )
        self.assertIsNone(expr.avaliar(None))
        self.assertEqual(regras_prazo.compilar("contestação").avaliar("PRAZO DE CONTESTACAO"), ["contestação"])

    def test_frase_exata(self):
        expr = regras_prazo.compilar('"prazo de 15 dias"')
        self.assertEqual(expr.avaliar("Concedo o prazo de 15 dias."), ["prazo de 15 dias"])
        self.assertIsNone(expr.avaliar("prazo de 10 dias"))
        self.assertIsNone(expr.avaliar("prazos de 15 dias"))

    def test_e_tem_precedencia_sobre_ou(self):
        expr = regras_prazo.compilar("contestar ou replicar e impugnar")
        self.assertIsNone(expr.avaliar("prazo para replicar"))          # 'replicar e impugnar' é um bloco
        self.assertEqual(expr.avaliar("replicar e impugnar"), ["replicar", "impugnar"])
        self.assertEqual(expr.avaliar("prazo para contestar"), ["contestar"])

    def test_sem_exclui(self):
        expr = regras_prazo.compilar("contestar sem recurso")
        self.assertEqual(expr.avaliar("Prazo para contestar"), ["contestar"])
        self.assertIsNone(expr.avaliar("Prazo para contestar, com RECURSO"))
        self.assertIsNone(regras_prazo.compilar("contestar SEM acao").avaliar("contestar com ação"))
        # vários 'sem' seguidos, todos excluem
        expr = regras_prazo.compilar("contestar sem recurso sem embargos")
        self.assertEqual(expr.avaliar("contestar"), ["contestar"])
        self.assertIsNone(expr.avaliar("contestar com embargos"))

    def test_operadores_sem_diferenca_de_caixa_nem_acento(self):
        self.assertEqual(regras_prazo.compilar("A E B").avaliar("a b"), ["A", "B"])
        self.assertEqual(regras_prazo.compilar("a OU b").avaliar("b"), ["b"])
        self.assertEqual(regras_prazo.compilar("a É b").avaliar("a b"), ["a", "b"])   # 'é' normaliza para 'e'
        self.assertEqual(regras_prazo.compilar('"ou"').avaliar("ou isto"), ["ou"])   # aspas buscam o literal

    def test_descrever(self):
        expr = regras_prazo.compilar('contestar ou "prazo de 15 dias" sem recurso')
        self.assertEqual(expr.descrever(), 'contestar OU "prazo de 15 dias" mas SEM recurso')
        self.assertEqual(regras_prazo.compilar("a e b sem c sem d").descrever(), "a E b mas SEM c E SEM d")

    def test_expressao_vazia_nunca_casa(self):
        for vazio in ("", "   ", None):
            expr = regras_prazo.compilar(vazio)
            self.assertEqual(expr.descrever(), "")
            self.assertIsNone(expr.avaliar("qualquer publicação"))

    def test_erros_de_sintaxe(self):
        erros = {
            "a b": 'Use "e", "ou" ou "sem" entre os termos.',
            "a e": "termina com um operador",
            "a ou": 'termina com "ou"',
            "e a": 'não pode começar com "e"',
            "sem a": 'não pode começar com "sem"',
            "ou a": 'não pode começar com "ou"',
            "a e ou b": "não podem ficar em sequência",
            "a e sem b": "não podem ficar em sequência",
            '"prazo': "Feche as aspas",
            "a (b)": "parênteses",
            "(a)": "parênteses",
            '""': "termo vazio",
            '"   "': "termo vazio",
            "a" * 501: "passa de 500",
        }
        for texto, trecho in erros.items():
            with self.assertRaises(ValueError, msg=texto[:40]) as ctx:
                regras_prazo.compilar(texto)
            self.assertIn(trecho, str(ctx.exception), texto[:40])
        with self.assertRaises(ValueError):
            regras_prazo.compilar(123)


class ValidacaoTest(unittest.TestCase):
    def test_validar_tipo_aplica_padroes(self):
        d = regras_prazo.validar_tipo({"nome": " Contestação ", "dias": 15})
        self.assertEqual(d, {"nome": "Contestação", "dias": 15, "contagem": "uteis",
                             "base_legal": None, "inicio": "disponibilizacao", "ativo": True})
        d = regras_prazo.validar_tipo({"nome": "Embargos", "dias": 5, "contagem": "corridos",
                                       "inicio": "movimento", "base_legal": "  ", "ativo": False})
        self.assertEqual((d["contagem"], d["inicio"], d["base_legal"], d["ativo"]),
                         ("corridos", "movimento", None, False))

    def test_validar_tipo_recusa_dados_ruins(self):
        ruins = [
            None, [], {},
            {"nome": "", "dias": 15},
            {"nome": "x" * 121, "dias": 15},
            {"nome": "Contestação"},
            {"nome": "Contestação", "dias": 0},
            {"nome": "Contestação", "dias": 366},
            {"nome": "Contestação", "dias": True},
            {"nome": "Contestação", "dias": "15"},
            {"nome": "Contestação", "dias": 15, "contagem": "semanas"},
            {"nome": "Contestação", "dias": 15, "inicio": "citacao"},
            {"nome": "Contestação", "dias": 15, "base_legal": "x" * 201},
            {"nome": "Contestação", "dias": 15, "ativo": "sim"},
        ]
        for dados in ruins:
            with self.assertRaises(ValueError, msg=str(dados)[:80]):
                regras_prazo.validar_tipo(dados)

    def test_validar_regra_aplica_padroes(self):
        d = regras_prazo.validar_regra({"tipo_id": "t1", "palavras": "  contestar   "}, {"nome": "Contestação"})
        self.assertEqual((d["nome"], d["tipo_id"], d["escopo"], d["palavras"], d["combinacao"], d["ativo"]),
                         ("Contestação", "t1", [], "contestar", "e", True))
        d = regras_prazo.validar_regra({"nome": "X", "tipo_id": "t", "combinacao": "ou",
                                        "escopo": [{"tipo": "classe", "nome": "Ação de Cobrança"},
                                                   {"tipo": "classe", "nome": "acao de cobranca"}]},
                                       {"nome": "Contestação"})
        self.assertEqual(d["escopo"], ESCOPO_CLASSE)                     # duplicado some
        self.assertEqual(d["combinacao"], "ou")

    def test_validar_regra_recusa_dados_ruins(self):
        ruins = [
            None, [], {},
            {"escopo": ESCOPO_CLASSE},                                   # sem tipo
            {"tipo_id": "  ", "palavras": "a"},
            {"tipo_id": "t", "escopo": [], "palavras": ""},              # nada preenchido
            {"tipo_id": "t", "escopo": "x", "palavras": "a"},
            {"tipo_id": "t", "escopo": [{"tipo": "orgao", "nome": "Cobrança"}]},
            {"tipo_id": "t", "escopo": [{"tipo": "classe", "nome": "ab"}]},
            {"tipo_id": "t", "escopo": [{"tipo": "classe", "nome": "Cobrança", "codigo": True}]},
            {"tipo_id": "t", "escopo": [{"tipo": "classe", "nome": "Cobrança", "codigo": "1"}]},
            {"tipo_id": "t", "escopo": ["texto"]},
            {"tipo_id": "t", "escopo": ESCOPO_CLASSE * 21, "palavras": ""},
            {"tipo_id": "t", "palavras": "a" * 501},
            {"tipo_id": "t", "palavras": "a b"},
            {"tipo_id": "t", "palavras": 123},
            {"tipo_id": "t", "escopo": ESCOPO_CLASSE, "combinacao": "xor"},
            {"tipo_id": "t", "escopo": ESCOPO_CLASSE, "ativo": "sim"},
        ]
        for dados in ruins:
            with self.assertRaises(ValueError, msg=str(dados)[:80]):
                regras_prazo.validar_regra(dados, {"nome": "Contestação"})


class RepositorioTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.repo = regras_prazo.Repositorio(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana", [NUMERO], AGORA)

    def criar_tipo(self, **extra):
        return self.repo.criar_tipo({**TIPO, **extra}, "ana", AGORA)

    def test_crud_de_tipos(self):
        t = self.criar_tipo()
        self.assertEqual((t["nome"], t["dias"], t["contagem"], t["base_legal"], t["inicio"], t["ativo"], t["criado_por"]),
                         ("Contestação", 15, "uteis", "CPC, art. 335", "disponibilizacao", True, "ana"))
        self.assertEqual([x["id"] for x in self.repo.listar_tipos()], [t["id"]])
        novo = self.repo.atualizar_tipo(t["id"], {"dias": 30, "ativo": False}, AGORA)
        self.assertEqual((novo["dias"], novo["nome"], novo["ativo"]), (30, "Contestação", False))
        with self.assertRaises(ValueError):
            self.repo.atualizar_tipo(t["id"], {"dias": 0}, AGORA)
        self.assertIsNone(self.repo.atualizar_tipo("nao-existe", {"dias": 30}, AGORA))
        self.assertTrue(self.repo.excluir_tipo(t["id"]))
        self.assertFalse(self.repo.excluir_tipo(t["id"]))
        self.assertEqual(self.repo.listar_tipos(), [])

    def test_crud_de_regras(self):
        t = self.criar_tipo()
        r = self.repo.criar_regra({"tipo_id": t["id"], "escopo": ESCOPO_CLASSE, "palavras": "contestar"}, "ana", AGORA)
        self.assertEqual((r["nome"], r["tipo_id"], r["combinacao"], r["ativo"], r["criado_por"]),
                         ("Contestação", t["id"], "e", True, "ana"))     # nome padrão = nome do tipo
        self.assertEqual([x["id"] for x in self.repo.listar_regras()], [r["id"]])
        novo = self.repo.atualizar_regra(r["id"], {"palavras": "recorrer", "combinacao": "ou"}, AGORA)
        self.assertEqual((novo["palavras"], novo["combinacao"], novo["escopo"]), ("recorrer", "ou", ESCOPO_CLASSE))
        with self.assertRaises(ValueError):
            self.repo.atualizar_regra(r["id"], {"tipo_id": "nao-existe"}, AGORA)
        with self.assertRaises(ValueError):
            self.repo.criar_regra({"tipo_id": "nao-existe", "palavras": "x"}, "ana", AGORA)
        self.assertIsNone(self.repo.atualizar_regra("nao-existe", {"palavras": "x"}, AGORA))
        self.assertTrue(self.repo.excluir_regra(r["id"]))
        self.assertFalse(self.repo.excluir_regra(r["id"]))
        self.assertEqual(self.repo.listar_regras(), [])

    def test_excluir_tipo_em_uso_e_recusado(self):
        t = self.criar_tipo()
        r = self.repo.criar_regra({"tipo_id": t["id"], "escopo": ESCOPO_CLASSE}, "ana", AGORA)
        with self.assertRaises(ValueError) as ctx:
            self.repo.excluir_tipo(t["id"])
        self.assertIn("1 regra", str(ctx.exception))
        self.assertIsNotNone(self.repo.obter_tipo(t["id"]))
        self.repo.excluir_regra(r["id"])
        self.assertTrue(self.repo.excluir_tipo(t["id"]))

    def test_reservar_e_liberar(self):
        t = self.criar_tipo()
        r = self.repo.criar_regra({"tipo_id": t["id"], "escopo": ESCOPO_CLASSE}, "ana", AGORA)
        caso_id = self.caso["id"]
        self.assertTrue(self.repo.reservar(r["id"], "publicacao", "pub-1", caso_id, "aplicado", "ana", AGORA))
        self.assertFalse(self.repo.reservar(r["id"], "publicacao", "pub-1", caso_id, "dispensado", "bia", AGORA))
        self.assertEqual([(d["regra_id"], d["origem"], d["origem_id"], d["acao"], d["usuario"]) for d in self.repo.decisoes(caso_id)],
                         [(r["id"], "publicacao", "pub-1", "aplicado", "ana")])
        self.assertTrue(self.repo.reservar(r["id"], "movimento", "mov-1", caso_id, "dispensado", "ana", AGORA))
        self.assertEqual(len(self.repo.decisoes(caso_id)), 2)
        self.repo.liberar(r["id"], "publicacao", "pub-1")
        self.assertEqual([d["origem_id"] for d in self.repo.decisoes(caso_id)], ["mov-1"])
        with self.assertRaises(ValueError):
            self.repo.reservar(r["id"], "email", "x", caso_id, "aplicado", "ana", AGORA)
        with self.assertRaises(ValueError):
            self.repo.reservar(r["id"], "publicacao", "pub-2", caso_id, "talvez", "ana", AGORA)
        with self.assertRaises(ValueError):
            self.repo.reservar(r["id"], "publicacao", "  ", caso_id, "aplicado", "ana", AGORA)
        with self.assertRaises(ValueError):
            self.repo.liberar(r["id"], "email", "x")

    def test_excluir_regra_apaga_as_decisoes_dela(self):
        t = self.criar_tipo()
        r = self.repo.criar_regra({"tipo_id": t["id"], "escopo": ESCOPO_CLASSE}, "ana", AGORA)
        self.repo.reservar(r["id"], "publicacao", "pub-1", self.caso["id"], "dispensado", "ana", AGORA)
        self.repo.excluir_regra(r["id"])
        self.assertEqual(self.repo.decisoes(self.caso["id"]), [])


class SugestoesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.repo = regras_prazo.Repositorio(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana", [NUMERO], AGORA)

    def criar_tipo(self, **extra):
        return self.repo.criar_tipo({**TIPO, **extra}, "ana", AGORA)

    def criar_regra(self, tipo, **extra):
        dados = {"tipo_id": tipo["id"], "escopo": ESCOPO_CLASSE, "palavras": "contestar"}
        dados.update(extra)
        return self.repo.criar_regra(dados, "ana", AGORA)

    def definir_acao(self, acao):
        definir_acao(self.caminho, self.caso["id"], acao)

    def evento(self, texto, origem="publicacao", id="pub-1"):
        return {"origem": origem, "id": id, "texto": texto}

    def test_e_com_escopo_vazio_casa_pelas_palavras(self):
        t = self.criar_tipo()
        r = self.criar_regra(t, escopo=[], palavras="contestar")
        achados = self.repo.sugestoes(self.caso["id"], self.evento("Prazo para contestar"))
        self.assertEqual([(s["regra"]["id"], s["tipo"]["id"], s["correspondeu_a"], s["termos"]) for s in achados],
                         [(r["id"], t["id"], None, ["contestar"])])
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Prazo para recorrer")), [])

    def test_e_com_palavras_vazias_casa_pelo_escopo(self):
        t = self.criar_tipo()
        self.criar_regra(t, escopo=ESCOPO_CLASSE, palavras="")
        self.definir_acao("Ação de Cobrança")
        achados = self.repo.sugestoes(self.caso["id"], self.evento("Publicação qualquer"))
        self.assertEqual([(s["correspondeu_a"], s["termos"]) for s in achados], [(ESCOPO_CLASSE[0], [])])
        self.definir_acao(None)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Publicação qualquer")), [])

    def test_ou_com_um_lado_vazio_nao_conta_como_casado(self):
        t = self.criar_tipo()
        self.criar_regra(t, nome="Só escopo", escopo=ESCOPO_CLASSE, palavras="", combinacao="ou")
        self.definir_acao(None)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])
        self.definir_acao("Outra ação")
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)
        # espelho: só palavras
        self.definir_acao(None)
        self.repo.excluir_regra(self.repo.listar_regras()[0]["id"])
        r = self.criar_regra(t, nome="Só palavras", escopo=[], palavras="contestar", combinacao="ou")
        self.assertEqual([s["regra"]["id"] for s in self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))], [r["id"]])
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Nada a ver")), [])

    def test_ou_com_dois_lados_basta_um(self):
        t = self.criar_tipo()
        self.criar_regra(t, escopo=ESCOPO_CLASSE, palavras="contestar", combinacao="ou")
        self.definir_acao(None)
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)   # só palavras
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Nada a ver"))), 1)  # só escopo
        self.definir_acao(None)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Nada a ver")), [])

    def test_e_com_dois_lados_exige_os_dois(self):
        t = self.criar_tipo()
        self.criar_regra(t, escopo=ESCOPO_CLASSE, palavras="contestar", combinacao="e")
        self.definir_acao(None)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Nada a ver")), [])
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)

    def test_escopo_bate_com_acao_classe_da_capa_e_assuntos(self):
        t = self.criar_tipo()
        self.criar_regra(t, escopo=ESCOPO_CLASSE, palavras="")
        self.definir_acao("AÇÃO DE COBRANÇA de contrato")
        self.assertEqual([s["correspondeu_a"]["nome"] for s in self.repo.sugestoes(self.caso["id"], self.evento("x"))],
                         ["Ação de Cobrança"])
        self.definir_acao(None)
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, classe="Procedimento Comum Cível",
                                         assuntos=["Direito Civil"])
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("x")), [])
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, classe="Ação de Cobrança - Rito Comum")
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("x"))), 1)
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, classe="Procedimento Comum Cível",
                                         assuntos=["Direito Civil", "acao de cobranca"])
        self.repo.excluir_regra(self.repo.listar_regras()[0]["id"])
        self.criar_regra(t, escopo=ESCOPO_ASSUNTO, palavras="")
        self.assertEqual([s["correspondeu_a"]["nome"] for s in self.repo.sugestoes(self.caso["id"], self.evento("x"))],
                         ["Cobrança"])
        # item de escopo 'assunto' não olha a classe
        self.gestao.salvar_capa_processo(self.caso["id"], NUMERO, AGORA, classe="Ação de Cobrança",
                                         assuntos=["Direito Civil"])
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("x")), [])

    def test_ordem_do_mais_especifico_para_o_menos_especifico(self):
        t = self.criar_tipo()
        self.criar_regra(t, nome="B - palavras", escopo=[], palavras="contestar")
        self.criar_regra(t, nome="A - escopo", escopo=ESCOPO_CLASSE, palavras="")
        self.criar_regra(t, nome="Z - tudo", escopo=ESCOPO_CLASSE, palavras="contestar")
        self.definir_acao("Ação de Cobrança")
        nomes = [s["regra"]["nome"] for s in self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))]
        self.assertEqual(nomes, ["Z - tudo", "A - escopo", "B - palavras"])

    def test_regra_ou_tipo_inativo_nao_e_sugerido(self):
        t = self.criar_tipo()
        r = self.criar_regra(t, ativo=False)
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])
        self.repo.atualizar_regra(r["id"], {"ativo": True}, AGORA)
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)
        self.repo.atualizar_tipo(t["id"], {"ativo": False}, AGORA)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])

    def test_evento_ja_decidido_nao_e_sugerido_de_novo(self):
        t = self.criar_tipo()
        r = self.criar_regra(t)
        self.definir_acao("Ação de Cobrança")
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)
        self.repo.reservar(r["id"], "publicacao", "pub-1", self.caso["id"], "dispensado", "ana", AGORA)
        self.assertEqual(self.repo.sugestoes(self.caso["id"], self.evento("Contestar")), [])
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar", id="pub-2"))), 1)
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar", origem="movimento"))), 1)
        self.repo.liberar(r["id"], "publicacao", "pub-1")
        self.assertEqual(len(self.repo.sugestoes(self.caso["id"], self.evento("Contestar"))), 1)

    def test_caso_inexistente_devolve_none(self):
        self.assertIsNone(self.repo.sugestoes("nao-existe", self.evento("Contestar")))

    def test_duas_regras_casando_o_mesmo_evento(self):
        t = self.criar_tipo()
        a = self.criar_regra(t, nome="A - escopo e palavras", escopo=ESCOPO_CLASSE, palavras="contestar")
        b = self.criar_regra(t, nome="B - só palavras", escopo=[], palavras='contestar e "prazo de 15 dias"')
        self.definir_acao("Ação de Cobrança")
        achados = self.repo.sugestoes(self.caso["id"], self.evento("Prazo de 15 dias para contestar"))
        self.assertEqual([(s["regra"]["id"], s["termos"]) for s in achados],
                         [(a["id"], ["contestar"]), (b["id"], ["contestar", "prazo de 15 dias"])])

    def test_evento_invalido_e_recusado(self):
        ruins = [None, "x", {"origem": "email", "id": "1", "texto": "x"},
                 {"origem": "publicacao", "id": " ", "texto": "x"},
                 {"origem": "publicacao", "id": "1", "texto": 123}]
        for evento in ruins:
            with self.assertRaises(ValueError, msg=str(evento)[:60]):
                self.repo.sugestoes(self.caso["id"], evento)


if __name__ == "__main__":
    unittest.main()
