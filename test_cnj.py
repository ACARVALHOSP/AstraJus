import unittest

import cnj

VALIDO = "1006314-27.2023.8.26.0005"  # TJSP


class CnjTest(unittest.TestCase):
    def test_partes_e_dv(self):
        p = cnj.partes_cnj(VALIDO)
        self.assertEqual((p.sequencial, p.dv, p.ano, p.justica, p.tribunal, p.origem), ("1006314", "27", "2023", "8", "26", "0005"))
        self.assertEqual(cnj.calcular_dv(VALIDO), "27")
        self.assertTrue(cnj.dv_valido(VALIDO))
        self.assertFalse(cnj.dv_valido("1006314-28.2023.8.26.0005"))
        self.assertIsNone(cnj.partes_cnj("123"))
        self.assertIsNone(cnj.calcular_dv(""))

    def test_dv_com_resto_baixo_tem_dois_digitos(self):
        # 98 - resto pode dar 98 ou 02: sempre dois dígitos
        for seq in range(1000, 1300):
            n = f"{seq:07d}00" + "2024" + "5" + "02" + "0001"
            self.assertEqual(len(cnj.calcular_dv(n)), 2)
            self.assertTrue(cnj.dv_valido(n[:7] + cnj.calcular_dv(n) + n[9:]))

    def test_validar_cnj(self):
        self.assertEqual(cnj.validar_cnj(VALIDO), ("10063142720238260005", None))
        d, erro = cnj.validar_cnj("1006314-99.2023.8.26.0005")
        self.assertIsNone(d)
        self.assertIn("dígito verificador", erro)
        self.assertIn("esperado 27", erro)
        d, erro = cnj.validar_cnj("123")
        self.assertIn("20 dígitos", erro)
        self.assertIsNotNone(cnj.validar_cnj(None)[1])

    def test_tribunal_do_numero(self):
        casos = {
            "8.26": "tjsp", "8.07": "tjdft", "8.19": "tjrj", "4.01": "trf1", "4.06": "trf6",
            "5.02": "trt2", "5.24": "trt24", "6.26": "tre-sp", "6.01": "tre-ac",
            "3.00": "stj", "5.00": "tst", "6.00": "tse", "7.00": "stm",
            "9.13": "tjmmg", "9.21": "tjmrs", "9.26": "tjmsp",
            "1.00": None, "2.00": None, "9.01": None, "8.28": None, "4.07": None,
        }
        for jtr, esperado in casos.items():
            j, tr = jtr.split(".")
            self.assertEqual(cnj.tribunal_do_numero("1006314" + "00" + "2023" + j + tr + "0005"), esperado, jtr)
        self.assertIsNone(cnj.tribunal_do_numero("abc"))


if __name__ == "__main__":
    unittest.main()
