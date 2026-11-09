import unittest

import polos as p

MARIA = {"id": "c1", "nome": "Maria das Graças Souza Lima", "cpf_cnpj": "123.456.789-09", "perfil": "cliente"}
BANCO = {"id": "c2", "nome": "Banco Alfa S.A.", "cpf_cnpj": "12.345.678/0001-90", "perfil": "cliente"}
CONTATO = {"id": "c3", "nome": "Pedro Contato", "cpf_cnpj": "", "perfil": "contato"}
OUTRA = {"id": "c4", "nome": "Maria das Gracas Souza Lima", "cpf_cnpj": "", "perfil": "cliente"}   # mesmo nome, outro cadastro


class ReconhecimentoTest(unittest.TestCase):
    def test_normalizacao_e_polo(self):
        self.assertEqual(p.normalizar_nome("  MARIA   das Graças "), "maria das gracas")
        self.assertEqual([p.polo_da_parte(x) for x in ("A", "at", "Ativo", "P", "PA", "passivo", "T", "", None)],
                         ["ativo", "ativo", "ativo", "passivo", "passivo", "passivo", None, None, None])

    def test_estrito_documento_ou_nome_completo(self):
        idx = p.montar_indice([MARIA, BANCO, CONTATO])
        self.assertEqual(p.cliente_da_parte({"nome": "MARIA DAS GRACAS SOUZA LIMA"}, idx), "c1")        # sem acento e caixa alta
        self.assertEqual(p.cliente_da_parte({"nome": "Fulana", "cpf_cnpj": "12345678909"}, idx), "c1")   # pelo CPF
        self.assertEqual(p.cliente_da_parte({"nome": "Banco Alfa S/A", "cpf_cnpj": "12345678000190"}, idx), "c2")
        self.assertIsNone(p.cliente_da_parte({"nome": "Maria Souza Lima"}, idx))                         # nome parcial: não reconhece
        self.assertIsNone(p.cliente_da_parte({"nome": "Maria"}, idx))
        self.assertIsNone(p.cliente_da_parte({"nome": "Pedro Contato"}, idx))                            # contato não é cliente
        self.assertIsNone(p.cliente_da_parte({}, idx))

    def test_ambiguidade_nao_reconhece(self):
        idx = p.montar_indice([MARIA, OUTRA])
        self.assertIsNone(p.cliente_da_parte({"nome": "Maria das Graças Souza Lima"}, idx))               # dois cadastros iguais
        self.assertEqual(p.cliente_da_parte({"nome": "x", "cpf_cnpj": "123.456.789-09"}, idx), "c1")      # o CPF desempata

    def test_limitado_aos_clientes_do_processo(self):
        idx = p.montar_indice([MARIA, BANCO], limitar_a={"c2"})
        self.assertIsNone(p.cliente_da_parte({"nome": "Maria das Graças Souza Lima"}, idx))
        self.assertEqual(p.cliente_da_parte({"nome": "Banco Alfa S.A."}, idx), "c2")


class PolosTest(unittest.TestCase):
    def test_polo_pela_maioria_das_fontes(self):
        capa = [{"nome": "Maria das Graças Souza Lima", "polo": "P"}, {"nome": "Banco Alfa S.A.", "polo": "A"}]
        pubs = [[{"nome": "MARIA DAS GRACAS SOUZA LIMA", "polo": "P"}], [{"nome": "Maria das Graças Souza Lima", "polo": "P"}]]
        r = p.polos_no_caso([MARIA], [capa, *pubs])
        self.assertEqual(r, {"c1": "passivo"})

    def test_sem_informacao_ou_empate_fica_vazio(self):
        self.assertEqual(p.polos_no_caso([MARIA], []), {"c1": None})
        self.assertEqual(p.polos_no_caso([MARIA], [[{"nome": "Outra Pessoa", "polo": "P"}]]), {"c1": None})
        empate = [[{"nome": "Maria das Graças Souza Lima", "polo": "A"}], [{"nome": "Maria das Graças Souza Lima", "polo": "P"}]]
        self.assertEqual(p.polos_no_caso([MARIA], empate), {"c1": None})
        self.assertEqual(p.polos_no_caso([MARIA], [[{"nome": "Maria das Graças Souza Lima", "polo": "T"}]]), {"c1": None})

    def test_cada_cliente_tem_o_seu_polo(self):
        capa = [{"nome": "Maria das Graças Souza Lima", "polo": "A"}, {"nome": "Banco Alfa S.A.", "polo": "P"}]
        self.assertEqual(p.polos_no_caso([MARIA, BANCO], [capa]), {"c1": "ativo", "c2": "passivo"})


class DestinoTest(unittest.TestCase):
    def test_para_cliente(self):
        idx = p.montar_indice([MARIA])
        d = p.destino_da_publicacao([{"nome": "MARIA DAS GRACAS SOUZA LIMA", "polo": "P"}, {"nome": "Banco Beta", "polo": "A"}], idx)
        self.assertEqual(d, {"tipo": "cliente", "clientes": [{"id": "c1", "nome": "Maria das Graças Souza Lima", "polo": "passivo"}]})

    def test_parte_contraria_so_com_polo_conhecido(self):
        idx = p.montar_indice([MARIA])
        contraria = p.destino_da_publicacao([{"nome": "Banco Beta", "polo": "A"}], idx, {"c1": "passivo"})
        self.assertEqual(contraria["tipo"], "contraria")
        self.assertIsNone(p.destino_da_publicacao([{"nome": "Banco Beta", "polo": "A"}], idx, {"c1": None}))          # polo do cliente desconhecido
        self.assertIsNone(p.destino_da_publicacao([{"nome": "Banco Beta", "polo": "P"}], idx, {"c1": "passivo"}))     # mesmo polo: não é a contrária
        self.assertIsNone(p.destino_da_publicacao([{"nome": "Banco Beta", "polo": "A"}, {"nome": "Gama", "polo": "P"}], idx, {"c1": "passivo"}))
        self.assertIsNone(p.destino_da_publicacao([{"nome": "Banco Beta"}], idx, {"c1": "passivo"}))                  # polo ausente
        self.assertIsNone(p.destino_da_publicacao([], idx, {"c1": "passivo"}))


if __name__ == "__main__":
    unittest.main()
