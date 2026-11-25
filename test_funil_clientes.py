"""Estágio e origem dos contatos: listas editáveis e migração (quem tem processo vira ativo)."""
import sqlite3
from contextlib import closing
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db

agora = lambda: datetime.now(timezone.utc)


class FunilClientesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "t.db"

    def test_quem_tem_processo_vira_ativo_so_na_criacao_das_tabelas(self):
        g = db.RegistroClientesCasos(self.path)
        com = g.criar_cliente("Com processo", None, None, agora)
        sem = g.criar_cliente("Sem processo", None, None, agora)
        g.criar_caso(com["id"], "c", None, ["1234567-52.2020.8.26.0100"], agora)
        with closing(sqlite3.connect(self.path)) as c:  # simula banco anterior ao funil
            c.executescript("DROP TABLE cliente_funil; DROP TABLE funil_estagios; DROP TABLE funil_origens;")
        g = db.RegistroClientesCasos(self.path)
        self.assertEqual(g.obter_cliente(com["id"])["estagio"], "ativo")
        self.assertIsNone(g.obter_cliente(sem["id"])["estagio"])
        g.definir_funil(com["id"], "perdido", None, None)
        g = db.RegistroClientesCasos(self.path)  # reabrir não refaz a migração
        self.assertEqual(g.obter_cliente(com["id"])["estagio"], "perdido")

    def test_definir_valida_e_aparece_na_listagem(self):
        g = db.RegistroClientesCasos(self.path)
        a = g.criar_cliente("A", None, None, agora)
        g.definir_funil(a["id"], "lead", "indicacao", " Dra. Ana ")
        item = next(c for c in g.listar_clientes() if c["id"] == a["id"])
        self.assertEqual((item["estagio"], item["origem"], item["origem_detalhe"]), ("lead", "indicacao", "Dra. Ana"))
        with self.assertRaises(ValueError):
            g.definir_funil(a["id"], "inexistente", None, None)

    def test_editar_listas_renomeia_cria_e_protege_item_em_uso(self):
        g = db.RegistroClientesCasos(self.path)
        a = g.criar_cliente("A", None, None, agora)
        g.definir_funil(a["id"], "lead", None, None)
        cat = g.funil_catalogo()
        novos = [{"chave": e["chave"], "nome": "Prospect" if e["chave"] == "lead" else e["nome"]}
                 for e in cat["estagios"] if e["chave"] != "perdido"] + [{"nome": "Em negociação"}]
        out = g.salvar_funil_catalogo({"estagios": novos})
        self.assertIn(("lead", "Prospect"), [(e["chave"], e["nome"]) for e in out["estagios"]])
        self.assertIn("em_negociacao", [e["chave"] for e in out["estagios"]])
        with self.assertRaises(ValueError):  # 'lead' está em uso
            g.salvar_funil_catalogo({"estagios": [e for e in out["estagios"] if e["chave"] != "lead"]})
        with self.assertRaises(ValueError):
            g.salvar_funil_catalogo({"origens": [{"nome": "X"}, {"nome": "x"}]})


if __name__ == "__main__":
    unittest.main()
