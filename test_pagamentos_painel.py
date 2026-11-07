"""Painel da tela Pagamentos: totais, contadores, filtros, ordem e paginação."""

import unittest
from datetime import date

import asaas_integracao


def _cobrancas():
    return [
        {"id": "p1", "status": "PENDING", "value": 1200, "dueDate": "2026-11-10", "billingType": "BOLETO",
         "cliente_id": "c1", "cliente_nome": "Ana Exemplo", "description": "Honorários", "installment": "ins_1"},
        {"id": "p2", "status": "PENDING", "value": 1200, "dueDate": "2026-12-10", "billingType": "BOLETO",
         "cliente_id": "c1", "cliente_nome": "Ana Exemplo", "description": "Honorários", "installment": "ins_1"},
        {"id": "p3", "status": "OVERDUE", "value": 800, "dueDate": "2026-10-26", "billingType": "PIX",
         "cliente_id": "c2", "cliente_nome": "Mercado Bom Preço", "description": "Parecer contratual"},
        {"id": "p4", "status": "RECEIVED", "value": 500, "dueDate": "2026-11-01", "billingType": "PIX",
         "paymentDate": "2026-11-02", "cliente_id": "c2", "cliente_nome": "Mercado Bom Preço", "description": "Consulta"},
        {"id": "p5", "status": "CONFIRMED", "value": 300, "dueDate": "2026-10-01", "billingType": "BOLETO",
         "paymentDate": "2026-10-03", "cliente_id": None, "cliente_nome": None, "description": "Antiga"},
    ]


class PainelPagamentosTest(unittest.TestCase):
    hoje = date(2026, 11, 7)

    def test_resumo_e_contagens(self):
        painel = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje)
        self.assertEqual(painel["resumo"]["a_receber"], {"total": 2400.0, "quantidade": 2, "proximo_vencimento": "2026-11-10"})
        self.assertEqual(painel["resumo"]["vencidas"], {"total": 800.0, "quantidade": 1, "mais_antigo": "2026-10-26"})
        self.assertEqual(painel["resumo"]["recebidas_mes"], {"total": 500.0, "quantidade": 1, "mes": "2026-11"})
        self.assertEqual(painel["contagens"], {"a_receber": 2, "vencidas": 1, "recebidas": 2, "todas": 5})
        self.assertEqual([c["id"] for c in painel["cobrancas"]], ["p1", "p2"])
        self.assertEqual(painel["cobrancas"][0]["parcelas_total"], 2)

    def test_filtros_afetam_contagens_mas_nao_o_resumo(self):
        painel = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje, situacao="todas", forma="pix")
        self.assertEqual(painel["contagens"], {"a_receber": 0, "vencidas": 1, "recebidas": 1, "todas": 2})
        self.assertEqual(painel["resumo"]["a_receber"]["quantidade"], 2)

    def test_busca_por_nome_sem_acento_descricao_e_cpf(self):
        cpfs = {"c2": "12.345.678/0001-90"}
        por_nome = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje, situacao="todas", busca="preco")
        self.assertEqual({c["id"] for c in por_nome["cobrancas"]}, {"p3", "p4"})
        por_desc = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje, situacao="todas", busca="honorá")
        self.assertEqual({c["id"] for c in por_desc["cobrancas"]}, {"p1", "p2"})
        por_cpf = asaas_integracao.montar_painel_pagamentos(
            _cobrancas(), hoje=self.hoje, situacao="todas", busca="12345678", cpf_por_cliente=cpfs)
        self.assertEqual({c["id"] for c in por_cpf["cobrancas"]}, {"p3", "p4"})

    def test_vencimento_ordem_e_paginacao(self):
        painel = asaas_integracao.montar_painel_pagamentos(
            _cobrancas(), hoje=self.hoje, situacao="todas", vencimento_de="2026-10-15", vencimento_ate="2026-11-30")
        self.assertEqual([c["id"] for c in painel["cobrancas"]], ["p1", "p4", "p3"])
        recebidas = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje, situacao="recebidas")
        self.assertEqual([c["id"] for c in recebidas["cobrancas"]], ["p4", "p5"])
        pagina = asaas_integracao.montar_painel_pagamentos(_cobrancas(), hoje=self.hoje, situacao="todas", limite=2, offset=2)
        self.assertEqual(len(pagina["cobrancas"]), 2)
        self.assertTrue(pagina["hasMore"])
        self.assertEqual(pagina["totalCount"], 5)


if __name__ == "__main__":
    unittest.main()
