import asyncio
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db
import server


def item(hash_, texto="Fica a parte intimada para contestar no prazo de 15 dias.", dia="2026-11-06", numero="1006314-27.2023.8.26.0005"):
    return {"hash": hash_, "data_disponibilizacao": dia, "tipoComunicacao": "Intimação", "siglaTribunal": "TJSP",
            "numeroprocessocommascara": numero, "texto": texto, "destinatarios": [{"nome": "Maria", "polo": "P"}], "destinatarioadvogados": []}


class DuplicacaoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.pub = db.RegistroPublicacoesOAB(self.caminho)
        self.agora = lambda: datetime(2026, 11, 9, tzinfo=timezone.utc)
        cliente = self.gestao.criar_cliente("Maria", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Ação", None, ["10063142720238260005"], self.agora)

    def registrar(self, *itens):
        return server._registrar_itens_capturados(list(itens), None, "Ana", self.pub, self.gestao, self.agora)

    def total(self):
        return self.pub.contar()

    def test_mesmo_hash_na_captura_manual_e_automatica(self):
        self.assertEqual(self.registrar(item("h1")), 1)
        self.assertEqual(self.registrar(item("h1")), 0)            # captura repetida
        self.assertEqual(self.total(), 1)

    def test_mesmo_conteudo_com_hash_diferente_nao_duplica(self):
        self.assertEqual(self.registrar(item("h1")), 1)
        self.assertEqual(self.registrar(item("h2", texto="  FICA a parte  intimada para contestar NO prazo de 15 dias. ")), 0)
        self.assertEqual(self.total(), 1)
        self.assertEqual(self.registrar(item("h3", numero="1006314-27.2023.8.26.0005")), 0)       # mesmo número, com ou sem máscara
        self.assertEqual(self.total(), 1)

    def test_outra_data_ou_outro_texto_sao_publicacoes_diferentes(self):
        self.registrar(item("h1"))
        self.assertEqual(self.registrar(item("h2", dia="2026-11-09")), 1)                        # republicação: novo prazo
        self.assertEqual(self.registrar(item("h3", texto="Outro texto, outra intimação.")), 1)
        self.assertEqual(self.registrar(item("h4", numero="1000000-00.2023.8.26.0001")), 1)
        self.assertEqual(self.total(), 4)

    def test_chegada_duplicada_completa_o_vinculo(self):
        self.pub.registrar("h1", None, "Ana", None, item("h1"), "nao_tratada", None, self.agora)
        self.assertFalse(self.pub.registrar("h2", None, None, None, item("h2"), "nao_tratada", self.caso["id"], self.agora))
        self.assertEqual(self.pub.obter("h1")["caso_id"], self.caso["id"])
        self.assertIsNone(self.pub.obter("h2"))

    def test_unificar_duplicadas_ja_existentes(self):
        self.registrar(item("velha"), item("outra", texto="Texto diferente."))
        with sqlite3.connect(self.caminho) as c:                    # simula duplicadas antigas, gravadas antes da regra
            impressao = c.execute("SELECT impressao FROM publicacoes_capturadas WHERE hash='velha'").fetchone()[0]
            for h, status, caso, criado in (("dup_tratada", "tratada", self.caso["id"], "2026-11-10T00:00:00+00:00"), ("dup_nova", "nao_tratada", None, "2026-11-11T00:00:00+00:00")):
                c.execute("INSERT INTO publicacoes_capturadas (hash,monitoramento_id,nome_pesquisado,numero_processo,dados,status,caso_id,criado_em,impressao) VALUES (?,?,?,?,?,?,?,?,?)",
                          (h, None, "Ana", "10063142720238260005", json.dumps(item(h)), status, caso, criado, impressao))
        ativ = self.gestao.criar_atividade(self.caso["id"], "prazo", "Contestar", "2026-11-30", None, None, self.agora, origem_djen_hash="dup_nova") if False else None
        previa = self.pub.unificar_duplicadas(aplicar=False)
        self.assertEqual((previa["grupos"], previa["removidas"], previa["aplicado"]), (1, 2, False))
        self.assertEqual(self.total(), 4)                            # a prévia não mexe em nada
        r = self.pub.unificar_duplicadas(aplicar=True)
        self.assertEqual((r["grupos"], r["removidas"]), (1, 2))
        self.assertEqual(self.pub.obter("dup_tratada")["status"], "tratada")                     # ficou a mais trabalhada
        self.assertEqual(self.pub.obter("dup_tratada")["caso_id"], self.caso["id"])
        self.assertIsNone(self.pub.obter("velha"))
        self.assertIsNone(self.pub.obter("dup_nova"))
        self.assertEqual(self.total(), 2)
        self.assertEqual(self.pub.unificar_duplicadas(aplicar=True)["grupos"], 0)               # nada mais a fazer

    def test_atividade_passa_a_apontar_para_a_que_ficou(self):
        self.registrar(item("a"))
        with sqlite3.connect(self.caminho) as c:
            impressao = c.execute("SELECT impressao FROM publicacoes_capturadas WHERE hash='a'").fetchone()[0]
            c.execute("INSERT INTO publicacoes_capturadas (hash,monitoramento_id,nome_pesquisado,numero_processo,dados,status,caso_id,criado_em,impressao) VALUES (?,?,?,?,?,?,?,?,?)",
                      ("b", None, "Ana", "10063142720238260005", json.dumps(item("b")), "nao_tratada", self.caso["id"], "2026-11-20T00:00:00+00:00", impressao))
        self.pub.vincular_caso("b", self.caso["id"])
        self.gestao.criar_atividade(self.caso["id"], "prazo", "Contestar", "2026-11-30", None, None, self.agora, origem_djen_hash="b")
        self.pub.unificar_duplicadas(aplicar=True)
        self.assertIsNone(self.pub.obter("a"))                                                   # "b" tem caso e atividade: vence
        self.assertEqual([a["origem_djen_hash"] for a in self.gestao.listar_atividades(self.caso["id"])], ["b"])

    def test_banco_antigo_recebe_a_impressao(self):
        with sqlite3.connect(self.caminho) as c:
            c.execute("INSERT INTO publicacoes_capturadas (hash,monitoramento_id,nome_pesquisado,numero_processo,dados,status,caso_id,criado_em) VALUES (?,?,?,?,?,?,?,?)",
                      ("antiga", None, "Ana", "10063142720238260005", json.dumps(item("antiga")), "nao_tratada", None, "2026-11-01T00:00:00+00:00"))
        self.pub.contar()                                         # qualquer conexão nova roda a migração
        with sqlite3.connect(self.caminho) as c:
            self.assertIsNotNone(c.execute("SELECT impressao FROM publicacoes_capturadas WHERE hash='antiga'").fetchone()[0])
        self.assertEqual(self.registrar(item("nova_igual_a_antiga")), 0)                          # e já bloqueia a repetição


class MovimentosTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.agora = lambda: datetime(2026, 11, 9, tzinfo=timezone.utc)
        cliente = self.gestao.criar_cliente("Maria", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Ação", None, ["10063142720238260005"], self.agora)
        self.numero = "10063142720238260005"

    def test_movimentos_identicos_sao_gravados_uma_vez(self):
        m1 = {"codigo": 26, "nome": "Distribuição", "dataHora": "2023-05-01T10:00:00Z", "grau": "1º grau"}
        m2 = {"codigo": 193, "nome": "Juntada", "dataHora": "2023-05-02T10:00:00Z", "grau": "1º grau"}
        capa = self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, tribunal="TJSP", movimentos=[m1, m2, dict(m1), dict(m2), dict(m1)])
        self.assertEqual(capa["movimentos"], [m1, m2])
        # mesmo movimento em outro grau NÃO é repetido: são andamentos de instâncias diferentes
        capa = self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, movimentos=[m1, {**m1, "grau": "2º grau"}])
        self.assertEqual(len(capa["movimentos"]), 2)
        # atualizar de novo com a mesma lista não acumula
        capa = self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, movimentos=[m1, {**m1, "grau": "2º grau"}])
        self.assertEqual(len(capa["movimentos"]), 2)

    def test_capa_antiga_com_repeticao_e_limpa_na_leitura(self):
        m = {"codigo": 26, "nome": "Distribuição", "dataHora": "2023-05-01T10:00:00Z"}
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, tribunal="TJSP")
        with sqlite3.connect(self.caminho) as c:
            c.execute("UPDATE caso_processo_capa SET movimentos = ? WHERE caso_id = ?", (json.dumps([m, m, m]), self.caso["id"]))
        self.assertEqual(self.gestao.obter_capa_processo(self.caso["id"], self.numero)["movimentos"], [m])


if __name__ == "__main__":
    unittest.main()
