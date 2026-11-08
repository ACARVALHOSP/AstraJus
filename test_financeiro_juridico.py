import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db
import financeiro_juridico as fj
import server
from test_publicacoes_filtros import _chamar_asgi


class FinanceiroJuridicoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.gestao = db.RegistroClientesCasos(Path(tmp.name) / 'teste.db')
        self.agora = lambda: datetime(2026, 11, 8, tzinfo=timezone.utc)
        self.cli = self.gestao.criar_cliente('Maria Teste', None, None, self.agora)
        self.cli2 = self.gestao.criar_cliente('João Teste', None, None, self.agora)
        self.caso = self.gestao.criar_caso(self.cli['id'], 'Ação A', None, [], self.agora)
        self.caso2 = self.gestao.criar_caso(self.cli2['id'], 'Ação B', None, [], self.agora)

    def novo(self, **kw):
        base = dict(tipo='HONORARIO', vencimento='2026-11-01', valor=100.0, descricao='x', recorrente=False,
                    caso_id=self.caso['id'], cliente_id=self.cli['id'], responsavel='ana', agora=self.agora, direcao='RECEITA')
        base.update(kw)
        return self.gestao.criar_lancamento(**base)

    def test_parcelamento_no_servidor(self):
        r = self.novo(valor=100.0, parcelas=3, vencimento='2026-01-31', descricao='Honorários')
        parcelas = r['parcelas']
        self.assertEqual([p['valor'] for p in parcelas], [33.33, 33.33, 33.34])
        self.assertEqual([p['vencimento'] for p in parcelas], ['2026-01-31', '2026-02-28', '2026-03-31'])
        self.assertEqual({p['grupo_parcelas'] for p in parcelas}, {parcelas[0]['grupo_parcelas']})
        self.assertEqual([p['parcela_numero'] for p in parcelas], [1, 2, 3])
        self.assertTrue(parcelas[1]['descricao'].endswith('(parcela 2/3)'))
        self.assertEqual(len(self.gestao.listar_lancamentos()), 3)
        with self.assertRaises(ValueError):
            self.novo(parcelas=0)
        with self.assertRaises(ValueError):
            self.novo(tipo='INVENTADO')

    def test_baixa_guarda_a_data(self):
        l = self.novo()
        pago = self.gestao.atualizar_lancamento_pago(l['id'], True, '2026-11-05')
        self.assertEqual((pago['pago'], pago['pago_em']), (True, '2026-11-05'))
        aberto = self.gestao.atualizar_lancamento_pago(l['id'], False)
        self.assertEqual((aberto['pago'], aberto['pago_em']), (False, None))

    def test_por_processo(self):
        h1 = self.novo(valor=1000.0, vencimento='2026-10-01')           # vencido
        self.novo(valor=500.0, vencimento='2026-12-01', tipo='EXITO')   # a vencer
        self.gestao.atualizar_lancamento_pago(h1['id'], True)
        h2 = self.novo(valor=300.0, vencimento='2026-10-15')            # vencido e aberto
        custa = self.novo(tipo='CUSTAS', direcao='DESPESA', valor=80.0, reembolsavel=True, descricao='Custas iniciais')
        self.gestao.atualizar_lancamento_pago(custa['id'], True)
        self.novo(tipo='REPASSE', direcao='DESPESA', valor=200.0, favorecido='Maria')
        linha = {r['caso_id']: r for r in fj.por_processo(self.gestao.listar_lancamentos(), '2026-11-08')}[self.caso['id']]
        self.assertEqual(linha['honorarios'], {'previstos': 1800.0, 'recebidos': 1000.0, 'em_aberto': 800.0, 'vencidos': 300.0})
        self.assertEqual(linha['custas']['gastas'], 80.0)
        self.assertEqual(linha['custas']['a_reembolsar'], 80.0)
        self.assertEqual(linha['repasses'], {'total': 200.0, 'repassado': 0.0, 'pendente': 200.0})
        self.assertEqual((linha['entrou'], linha['saiu'], linha['saldo']), (1000.0, 80.0, 920.0))
        self.assertTrue(h2['id'])

    def test_inadimplencia(self):
        self.novo(valor=100.0, vencimento='2026-10-20')                       # 19 dias
        self.novo(valor=200.0, vencimento='2026-09-01')                       # 68 dias
        self.novo(valor=50.0, vencimento='2026-06-01', cliente_id=self.cli2['id'], caso_id=self.caso2['id'])  # 160 dias
        pago = self.novo(valor=400.0, vencimento='2026-10-01')
        self.gestao.atualizar_lancamento_pago(pago['id'], True)
        self.novo(valor=999.0, vencimento='2026-12-01')                       # ainda não venceu
        r = fj.inadimplencia(self.gestao.listar_lancamentos(), '2026-11-08')
        self.assertEqual((r['total_vencido'], r['quantidade'], r['clientes_inadimplentes']), (350.0, 3, 2))
        self.assertEqual({f['faixa']: f['valor'] for f in r['faixas']}, {'1-30': 100.0, '31-60': 0.0, '61-90': 200.0, '90+': 50.0})
        self.assertEqual([c['valor'] for c in r['clientes']], [300.0, 50.0])
        self.assertEqual(r['clientes'][0]['maior_atraso'], 68)
        self.assertEqual(r['taxa'], round(350 / 750 * 100, 1))

    def test_endpoints(self):
        asyncio.run(self._endpoints())

    async def _endpoints(self):
        import io
        from contextlib import redirect_stdout
        registro = server.RegistroUsuarios(Path(tempfile.mkdtemp()) / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        token = saida.getvalue().strip().splitlines()[-1]
        mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao)
        auth = [(b"authorization", ("Bearer " + token).encode())]
        base = {"vencimento": "2026-11-20", "valor": 300, "descricao": "Honorários", "responsavel": "ana",
                "caso_id": self.caso["id"], "cliente_id": self.cli["id"]}

        import httpx
        http = httpx.AsyncClient(transport=httpx.ASGITransport(mw), base_url="http://test")

        async def chamar(metodo, rota, dados=None):
            r = await http.request(metodo, rota, json=dados, headers={"Authorization": "Bearer " + token})
            return r.status_code, r.json()

        status, r = await chamar("POST", "/lancamentos", {**base, "parcelas": 3})
        self.assertEqual(status, 201)
        self.assertEqual([p["valor"] for p in r["parcelas"]], [100.0, 100.0, 100.0])
        self.assertEqual((await chamar("POST", "/lancamentos", {**base, "tipo": "INVENTADO"}))[0], 400)
        self.assertEqual((await chamar("POST", "/lancamentos", {**base, "tipo": "REPASSE"}))[0], 400)  # sem favorecido
        status, repasse = await chamar("POST", "/lancamentos", {**base, "tipo": "REPASSE", "favorecido": "Maria Teste"})
        self.assertEqual((status, repasse["direcao"], repasse["favorecido"]), (201, "DESPESA", "Maria Teste"))
        self.assertEqual((await chamar("POST", "/lancamentos", {**base, "tipo": "EXITO", "direcao": "DESPESA"}))[0], 400)

        status, custa = await chamar("POST", "/lancamentos", {**base, "tipo": "CUSTAS", "reembolsavel": True, "descricao": "Custas"})
        self.assertEqual((status, custa["direcao"], custa["reembolsavel"]), (201, "DESPESA", True))
        status, reembolso = await chamar("POST", f"/lancamentos/{custa['id']}/reembolso", {})
        self.assertEqual((status, reembolso["direcao"], reembolso["origem_id"]), (201, "RECEITA", custa["id"]))
        self.assertEqual((await chamar("POST", f"/lancamentos/{custa['id']}/reembolso", {}))[0], 409)  # só uma vez
        self.assertEqual((await chamar("POST", f"/lancamentos/{r['id']}/reembolso", {}))[0], 400)  # não é custa

        status, pago = await chamar("PATCH", f"/lancamentos/{r['id']}", {"pago": True, "pago_em": "2026-11-09"})
        self.assertEqual((status, pago["pago_em"]), (200, "2026-11-09"))
        status, resumo = await chamar("GET", "/lancamentos/resumo?hoje=2026-12-31")
        self.assertEqual(status, 200)
        self.assertEqual(resumo["inadimplencia"]["quantidade"], 2)  # 2ª parcela e o reembolso; a 1ª foi paga e a 3ª ainda não venceu
        self.assertEqual((await chamar("GET", "/lancamentos/resumo?hoje=ontem"))[0], 400)

if __name__ == '__main__':
    unittest.main()
