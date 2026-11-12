"""Rotas de horas: lançamento, relatório, tarifas, cronômetro e faturamento."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import db
import server
import usuarios_admin
from test_modelos_prazo import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)
ONTEM = (datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-3))).date() - timedelta(days=1)).isoformat()


class HorasHttpTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("adm@teste.com", "ana@teste.com", "bia@teste.com", "cid@teste.com", "dora@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "adm@teste.com")
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "consulta"}, "bootstrap", "cid@teste.com")
        usuarios_admin.alterar(self.registro, {"permissoes": {"financeiro": "nenhum", "pagamentos": "nenhum"}}, "bootstrap", "dora@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.caso = self.gestao.criar_caso(cliente["id"], "Silva x Banco", "ana@teste.com", [], AGORA)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)

    def req(self, metodo, url, corpo=None, quem="ana@teste.com"):
        return chamar(self.mw, metodo, url, self.token.get(quem), corpo)

    def lancar(self, minutos=60, quem="ana@teste.com", **extra):
        status, corpo = self.req("POST", "/horas", {"caso_id": self.caso["id"], "data": ONTEM, "minutos": minutos, **extra}, quem)
        self.assertEqual(status, 201, corpo)
        return corpo["horas"]

    def test_lancar_listar_e_totais(self):
        self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 300}, "adm@teste.com")
        h = self.lancar(90, descricao="Petição")
        self.assertEqual((h["usuario"], h["valor_hora"], h["valor"], h["faturado"]), ("ana@teste.com", 300.0, 450.0, False))
        self.lancar(30, faturavel=False)
        status, corpo = self.req("GET", f"/horas?de={ONTEM}&ate={ONTEM}&usuario=ana@teste.com")
        self.assertEqual(status, 200)
        self.assertEqual(len(corpo["horas"]), 2)
        self.assertEqual((corpo["totais"]["minutos"], corpo["totais"]["minutos_faturaveis"], corpo["totais"]["a_faturar"]), (120, 90, 450.0))
        self.assertEqual(len(self.req("GET", "/horas?faturavel=false")[1]["horas"]), 1)
        self.assertEqual(len(self.req("GET", "/horas?usuario=bia@teste.com")[1]["horas"]), 0)
        self.assertEqual(self.req("GET", "/horas?faturavel=talvez")[0], 400)
        self.assertEqual(self.req("GET", "/horas?de=ontem")[0], 400)

    def test_data_padrao_e_validacoes(self):
        status, corpo = self.req("POST", "/horas", {"caso_id": self.caso["id"], "minutos": 15})
        self.assertEqual(status, 201)
        self.assertRegex(corpo["horas"]["data"], r"^\d{4}-\d{2}-\d{2}$")
        for ruim in ({"minutos": 0}, {"minutos": "60"}, {"minutos": 60, "data": "2999-01-01"}, {"minutos": 60, "valor_hora": -1}, {}):
            self.assertEqual(self.req("POST", "/horas", {"caso_id": self.caso["id"], **ruim})[0], 400, ruim)
        self.assertEqual(self.req("POST", "/horas", {"caso_id": "nao-existe", "minutos": 60})[0], 404)

    def test_so_o_dono_ou_o_administrador_altera(self):
        h = self.lancar(60)
        self.assertEqual(self.req("PATCH", f"/horas/{h['id']}", {"minutos": 5}, "bia@teste.com")[0], 403)
        self.assertEqual(self.req("DELETE", f"/horas/{h['id']}", None, "bia@teste.com")[0], 403)
        self.assertEqual(self.req("PATCH", f"/horas/{h['id']}", {"minutos": 45})[1]["horas"]["minutos"], 45)
        self.assertEqual(self.req("PATCH", f"/horas/{h['id']}", {"minutos": 30}, "adm@teste.com")[1]["horas"]["minutos"], 30)
        self.assertEqual(self.req("DELETE", f"/horas/{h['id']}")[0], 200)
        self.assertEqual(self.req("DELETE", f"/horas/{h['id']}")[0], 404)
        self.assertEqual(self.req("PATCH", "/horas/999", {"minutos": 5})[0], 404)

    def test_administrador_lanca_em_nome_de_outra_pessoa(self):
        h = self.lancar(60, "adm@teste.com", usuario="bia@teste.com")
        self.assertEqual(h["usuario"], "bia@teste.com")
        status, _ = self.req("POST", "/horas", {"caso_id": self.caso["id"], "minutos": 60, "usuario": "bia@teste.com"}, "ana@teste.com")
        self.assertEqual(status, 403)
        self.assertEqual(self.req("POST", "/horas", {"caso_id": self.caso["id"], "minutos": 60, "usuario": "fantasma"}, "adm@teste.com")[0], 404)

    def test_consulta_so_le_e_sem_token_e_negado(self):
        self.assertEqual(self.req("GET", "/horas", None, "cid@teste.com")[0], 200)
        self.assertEqual(self.req("POST", "/horas", {"caso_id": self.caso["id"], "minutos": 60}, "cid@teste.com")[0], 403)
        self.assertEqual(self.req("POST", "/horas/cronometro", {"caso_id": self.caso["id"]}, "cid@teste.com")[0], 403)
        self.assertEqual(self.req("GET", "/horas", None, None)[0], 401)

    def test_tarifas(self):
        self.assertEqual(self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 300})[0], 403)           # não administrador
        self.assertEqual(self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 300}, "adm@teste.com")[1]["valor_hora"], 300.0)
        self.req("PUT", "/horas/tarifas/bia%40teste.com", {"valor_hora": 200}, "adm@teste.com")
        self.assertEqual(self.req("GET", "/horas/tarifas", None, "adm@teste.com")[1]["tarifas"], {"ana@teste.com": 300.0, "bia@teste.com": 200.0})
        self.assertEqual(self.req("GET", "/horas/tarifas")[1], {"tarifas": {"ana@teste.com": 300.0}, "administrador": False})   # só a própria
        self.assertEqual(self.req("PUT", "/horas/tarifas/fantasma", {"valor_hora": 1}, "adm@teste.com")[0], 404)
        self.assertEqual(self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 0}, "adm@teste.com")[0], 400)
        self.assertIsNone(self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": None}, "adm@teste.com")[1]["valor_hora"])

    def test_cronometro(self):
        rota = "/horas/cronometro"
        self.assertEqual(self.req("GET", rota)[1], {"cronometro": None})
        self.assertEqual(self.req("POST", rota, {"caso_id": "nao-existe"})[0], 404)
        status, corpo = self.req("POST", rota, {"caso_id": self.caso["id"], "descricao": "Minuta"})
        self.assertEqual((status, corpo["cronometro"]["descricao"], corpo["cronometro"]["caso_titulo"]), (201, "Minuta", "Silva x Banco"))
        self.assertEqual(self.req("POST", rota, {"caso_id": self.caso["id"]})[0], 409)
        self.assertEqual(self.req("GET", rota, None, "bia@teste.com")[1], {"cronometro": None})                    # é individual
        status, corpo = self.req("POST", f"{rota}/parar", {})
        self.assertEqual(status, 200)
        self.assertEqual((corpo["horas"]["minutos"], corpo["horas"]["descricao"], corpo["horas"]["limitado"]), (1, "Minuta", False))
        self.assertEqual(self.req("POST", f"{rota}/parar", {})[0], 404)
        self.req("POST", rota, {"caso_id": self.caso["id"]})
        self.assertEqual(self.req("DELETE", rota)[1], {"descartado": True})
        self.assertEqual(self.req("GET", rota)[1], {"cronometro": None})

    def test_relatorio(self):
        self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 300}, "adm@teste.com")
        self.lancar(60); self.lancar(120, "bia@teste.com", valor_hora=100)
        status, corpo = self.req("GET", "/horas/relatorio")
        self.assertEqual(status, 200)
        self.assertEqual((corpo["totais"]["minutos"], corpo["totais"]["a_faturar"]), (180, 500.0))
        self.assertEqual([(u["usuario"], u["minutos"]) for u in corpo["por_usuario"]], [("ana@teste.com", 60), ("bia@teste.com", 120)])
        self.assertEqual([(p["caso_titulo"], p["minutos"]) for p in corpo["por_processo"]], [("Silva x Banco", 180)])

    def test_faturar_cria_lancamento_exige_financeiro_e_nao_repete(self):
        self.req("PUT", "/horas/tarifas/ana%40teste.com", {"valor_hora": 300}, "adm@teste.com")
        a, b = self.lancar(60), self.lancar(90)
        corpo = {"ids": [a["id"], b["id"]], "vencimento": "2026-12-15"}
        self.assertEqual(self.req("POST", "/horas/faturar", corpo, "dora@teste.com")[0], 403)                # sem acesso ao financeiro
        self.assertEqual(self.req("POST", "/horas/faturar", corpo, "cid@teste.com")[0], 403)                 # só consulta
        self.assertEqual(self.req("POST", "/horas/faturar", {**corpo, "vencimento": "15/12/2026"})[0], 400)
        self.assertEqual(self.req("POST", "/horas/faturar", {"ids": [], "vencimento": "2026-12-15"})[0], 400)
        self.assertEqual(self.req("POST", "/horas/faturar", {"ids": [999], "vencimento": "2026-12-15"})[0], 404)
        self.assertEqual(self.gestao.listar_lancamentos(), [])
        status, r = self.req("POST", "/horas/faturar", corpo)
        self.assertEqual(status, 200, r)
        self.assertEqual((r["horas"], r["minutos"], r["valor"], r["lancamento"]["tipo"]), (2, 150, 750.0, "HONORARIO"))
        self.assertEqual(r["lancamento"]["responsavel"], "ana@teste.com")
        self.assertEqual(self.req("POST", "/horas/faturar", corpo)[0], 409)                                  # já faturadas
        self.assertEqual(self.req("PATCH", f"/horas/{a['id']}", {"minutos": 5})[0], 409)                     # e travadas
        self.assertEqual(self.req("DELETE", f"/horas/{a['id']}")[0], 409)
        self.assertEqual(len(self.gestao.listar_lancamentos()), 1)
        listadas = self.req("GET", "/horas?faturado=true")[1]["horas"]
        self.assertEqual({h["lancamento_id"] for h in listadas}, {r["lancamento"]["id"]})

    def test_metodos_e_caminhos(self):
        self.assertEqual(self.req("PUT", "/horas")[0], 405)
        self.assertEqual(self.req("GET", "/horas/faturar")[0], 405)
        self.assertEqual(self.req("POST", "/horas/relatorio", {})[0], 405)
        self.assertEqual(self.req("GET", "/horas/outra-coisa")[0], 404)
        self.assertEqual(self.req("PUT", "/horas/tarifas")[0], 405)


if __name__ == "__main__":
    unittest.main()
