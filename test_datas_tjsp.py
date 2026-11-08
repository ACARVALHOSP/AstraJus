"""Buscas do TJSP (Jurisprudência e Jurimetria) aceitam a data como dd/mm/aaaa ou AAAA-MM-DD."""
import unittest

import server


class DatasTjspTest(unittest.TestCase):
    def test_converte_iso_para_formato_do_tjsp(self):
        self.assertEqual(server._data_tjsp("2026-10-01"), "01/10/2026")
        self.assertEqual(server._data_tjsp("01/10/2026"), "01/10/2026")
        self.assertEqual(server._data_tjsp(None), "")

    def test_intervalo_da_jurisprudencia_aceita_os_dois_formatos(self):
        self.assertIsNotNone(server._jurisprudencia_tjsp_epoch_ms("2026-10-01"))
        self.assertEqual(server._jurisprudencia_tjsp_epoch_ms("2026-10-01"),
                         server._jurisprudencia_tjsp_epoch_ms("01/10/2026"))
        self.assertIsNone(server._jurisprudencia_tjsp_epoch_ms("10/2026"))


if __name__ == "__main__":
    unittest.main()
