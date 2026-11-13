"""A lista de vínculos do processo informa quando cada vínculo foi criado (base da Linha do tempo)."""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db

AGORA = lambda: datetime(2026, 11, 10, 15, 30, tzinfo=timezone.utc)


class VinculosComDataTest(unittest.TestCase):
    def test_vinculo_traz_criado_em_dos_dois_lados(self):
        with tempfile.TemporaryDirectory() as tmp:
            gestao = db.RegistroClientesCasos(Path(tmp) / "t.db")
            cliente = gestao.criar_cliente("Maria", None, None, AGORA)
            a = gestao.criar_caso(cliente["id"], "Ação principal", None, [], AGORA)
            b = gestao.criar_caso(cliente["id"], "Apelação", None, [], AGORA)
            gestao.adicionar_vinculo(a["id"], b["id"], "recurso", AGORA)
            do_a = gestao.listar_vinculos_do_caso(a["id"])
            do_b = gestao.listar_vinculos_do_caso(b["id"])
            self.assertEqual([v["caso_id"] for v in do_a], [b["id"]])
            self.assertEqual([v["caso_id"] for v in do_b], [a["id"]])
            self.assertTrue(do_a[0]["criado_em"].startswith("2026-11-10T15:30"))
            self.assertEqual(do_a[0]["criado_em"], do_b[0]["criado_em"])


if __name__ == "__main__":
    unittest.main()
