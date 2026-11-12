"""Administração de usuários: novo token (com envio por e-mail) e exclusão com desatribuição."""
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import db
import horas
import modelos_prazo
import server
import usuarios_admin
from test_modelos_prazo import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("adm@teste.com", "adm2@teste.com", "bia@teste.com", "cid@teste.com", "ope@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        for adm in ("adm@teste.com", "adm2@teste.com"):
            usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", adm)
        usuarios_admin.alterar(self.registro, {"nome_completo": "Bia Lima"}, "bootstrap", "bia@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.cliente = self.gestao.criar_cliente("Maria", None, None, AGORA)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)

    def req(self, metodo, url, corpo=None, quem="adm@teste.com"):
        return chamar(self.mw, metodo, url, self.token.get(quem), corpo)

    def perfil(self, login):
        return self.registro.carregar().get(login)

    def sql(self, consulta, *args):
        with sqlite3.connect(self.caminho) as c:
            return c.execute(consulta, args).fetchall()


class NovoTokenTest(_Base):
    def test_gera_novo_token_e_invalida_o_anterior(self):
        antigo = self.token["bia@teste.com"]
        self.assertEqual(self.registro.identificar(antigo), "bia@teste.com")
        status, corpo = self.req("POST", "/admin/usuarios/api/bia%40teste.com/token", {})
        self.assertEqual(status, 200, corpo)
        novo = corpo["token"]
        self.assertNotEqual(novo, antigo)
        self.assertIsNone(self.registro.identificar(antigo))                      # o anterior morreu na hora
        self.assertEqual(self.registro.identificar(novo), "bia@teste.com")
        self.assertEqual((corpo["encerra_sessao_atual"], corpo["email"]), (False, None))
        self.assertNotIn("hash", corpo["usuario"])                                 # nunca devolve o hash
        self.assertEqual(self.sql("SELECT acao, campos FROM usuarios_auditoria WHERE usuario='bia@teste.com' ORDER BY id DESC LIMIT 1"), [("novo_token", "[]")])
        self.assertNotIn(novo, str(self.sql("SELECT * FROM usuarios_auditoria")))   # o token não vai para a auditoria

    def test_so_para_usuario_ativo_e_existente(self):
        usuarios_admin.alterar(self.registro, {"status": "bloqueado"}, "bootstrap", "cid@teste.com")
        status, corpo = self.req("POST", "/admin/usuarios/api/cid%40teste.com/token", {})
        self.assertEqual(status, 400)
        self.assertIn("usuários ativos", corpo["mensagem"])
        self.assertEqual(self.req("POST", "/admin/usuarios/api/fantasma/token", {})[0], 404)

    def test_administrador_gerando_o_proprio_token_e_avisado(self):
        status, corpo = self.req("POST", "/admin/usuarios/api/adm%40teste.com/token", {})
        self.assertEqual((status, corpo["encerra_sessao_atual"]), (200, True))
        self.assertEqual(self.req("GET", "/admin/usuarios/api")[0], 403)           # o token antigo já não vale

    def test_so_administrador_gera_token_de_alguem(self):
        self.assertEqual(self.req("POST", "/admin/usuarios/api/bia%40teste.com/token", {}, "ope@teste.com")[0], 403)
        self.assertEqual(self.req("POST", "/admin/usuarios/api/bia%40teste.com/token", {}, None)[0], 403)

    def enviar(self, smtp, enviar_mock=None):
        with mock.patch.object(server, "_smtp_do_ambiente", return_value=smtp), \
             mock.patch.object(server, "_enviar_email_simples", enviar_mock or mock.Mock()) as enviado:
            resposta = self.req("POST", "/admin/usuarios/api/bia%40teste.com/token", {"enviar_email": True})
        return resposta, enviado

    def test_envia_por_email_e_ainda_mostra_o_token(self):
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "avisos@teste.com")
        (status, corpo), enviado = self.enviar(cfg)
        self.assertEqual(status, 200)
        self.assertEqual(corpo["email"], {"enviado": True, "destino": "bia@teste.com", "motivo": None})
        enviado.assert_called_once()
        _, destino, assunto, texto = enviado.call_args.args
        self.assertEqual((destino, assunto), ("bia@teste.com", "Seu novo token de acesso ao AstraJus"))
        self.assertIn(corpo["token"], texto)
        self.assertIn("Bia Lima", texto)
        self.assertIn("O token anterior deixou de funcionar", texto)
        self.assertEqual(self.registro.identificar(corpo["token"]), "bia@teste.com")

    def test_falha_no_envio_nao_perde_o_token(self):
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "avisos@teste.com")
        (status, corpo), _ = self.enviar(cfg, mock.Mock(side_effect=OSError("smtp fora do ar")))
        self.assertEqual(status, 200)
        self.assertFalse(corpo["email"]["enviado"])
        self.assertIn("outro canal seguro", corpo["email"]["motivo"])
        self.assertEqual(self.registro.identificar(corpo["token"]), "bia@teste.com")

    def test_sem_smtp_ou_sem_email_valido_explica_e_entrega_o_token(self):
        (status, corpo), enviado = self.enviar(None)
        self.assertEqual((status, corpo["email"]["enviado"]), (200, False))
        self.assertIn("SMTP", corpo["email"]["motivo"])
        enviado.assert_not_called()
        # usuário sem e-mail válido
        with sqlite3.connect(self.caminho) as c:
            c.execute("UPDATE usuarios SET email = NULL, dados = json_set(dados, '$.email', NULL) WHERE nome = 'cid@teste.com'")
        with mock.patch.object(server, "_smtp_do_ambiente", return_value=server.ConfiguracaoSMTP("h", 587, "u", "s", "r@x.com")):
            status, corpo = self.req("POST", "/admin/usuarios/api/cid%40teste.com/token", {"enviar_email": True})
        self.assertEqual((status, corpo["email"]["enviado"]), (200, False))
        self.assertIn("e-mail válido", corpo["email"]["motivo"])

    def test_corpo_invalido(self):
        self.assertEqual(self.req("POST", "/admin/usuarios/api/bia%40teste.com/token", [1])[0], 400)


class ApagarUsuarioTest(_Base):
    def setUp(self):
        super().setUp()
        bia, cid = "bia@teste.com", "cid@teste.com"
        self.caso_bia = self.gestao.criar_caso(self.cliente["id"], "Processo da Bia", bia, [], AGORA)
        self.caso_cid = self.gestao.criar_caso(self.cliente["id"], "Processo do Cid", cid, [], AGORA)
        self.ativ_bia = self.gestao.criar_atividade(self.caso_cid["id"], "prazo", "Atividade da Bia", "2026-12-01", None, None, AGORA, responsavel=bia)
        self.ativ_cid = self.gestao.criar_atividade(self.caso_cid["id"], "tarefa", "Atividade do Cid", "2026-12-02", None, None, AGORA, responsavel=cid)
        self.lanc_bia = self.gestao.criar_lancamento("HONORARIO", "2026-12-01", 100.0, "Da Bia", False, self.caso_cid["id"], self.cliente["id"], bia, AGORA)
        self.lanc_cid = self.gestao.criar_lancamento("HONORARIO", "2026-12-01", 50.0, "Do Cid", False, self.caso_cid["id"], self.cliente["id"], cid, AGORA)

    def apagar(self, login="bia%40teste.com", quem="adm@teste.com"):
        return self.req("DELETE", f"/admin/usuarios/api/{login}", None, quem)

    def test_vinculos_para_a_confirmacao(self):
        status, corpo = self.req("GET", "/admin/usuarios/api/bia%40teste.com/vinculos")
        self.assertEqual(status, 200)
        self.assertEqual(corpo["vinculos"], {"processos": 1, "atividades": 1, "lancamentos": 1, "monitoramentos": 0, "notificacoes": 0, "horas": 0, "agenda": 0})
        self.assertEqual(self.req("GET", "/admin/usuarios/api/fantasma/vinculos")[0], 404)

    def test_apagar_deixa_tudo_sem_responsavel_e_preserva_o_dos_outros(self):
        status, corpo = self.apagar()
        self.assertEqual(status, 200, corpo)
        self.assertEqual((corpo["apagado"], corpo["resumo"]["processos"], corpo["resumo"]["atividades"], corpo["resumo"]["lancamentos"]), (True, 1, 1, 1))
        self.assertIsNone(self.perfil("bia@teste.com"))
        self.assertIsNone(self.registro.identificar(self.token["bia@teste.com"]))              # o token morre
        self.assertIsNone(self.gestao.obter_caso(self.caso_bia["id"])["responsavel"])           # processo sem responsável
        ativs = {a["titulo"]: a["responsavel"] for a in self.gestao.listar_atividades(self.caso_cid["id"])}
        self.assertEqual(ativs, {"Atividade da Bia": None, "Atividade do Cid": "cid@teste.com"})
        resp_lanc = dict(self.sql("SELECT descricao, responsavel FROM lancamentos_financeiros"))
        self.assertEqual(resp_lanc, {"Da Bia": "", "Do Cid": "cid@teste.com"})                  # coluna não aceita nulo: vazio
        self.assertEqual(self.gestao.obter_caso(self.caso_cid["id"])["responsavel"], "cid@teste.com")
        self.assertEqual(self.sql("SELECT acao, usuario FROM usuarios_auditoria ORDER BY id DESC LIMIT 1"), [("apagar", "bia@teste.com")])
        self.assertEqual(self.apagar()[0], 404)

    def test_dados_pessoais_somem_e_historico_fica(self):
        bia, cid = "bia@teste.com", "cid@teste.com"
        # notificações, preferências, valor por hora, cronômetro e monitoramentos
        with sqlite3.connect(self.caminho) as c:
            for u in (bia, cid):
                c.execute("INSERT INTO notificacao_eventos (usuario, tipo, chave, criado_em) VALUES (?, 'prazo_vencendo', 'x', '2026-11-01')", (u,))
                c.execute("INSERT INTO preferencias_usuario (usuario, chave, valor, atualizado_em) VALUES (?, 'k', '1', '2026-11-01')", (u,)) \
                    if "valor" in {r[1] for r in c.execute("PRAGMA table_info(preferencias_usuario)")} else None
            c.execute("INSERT INTO notificacoes (evento_id) SELECT id FROM notificacao_eventos WHERE usuario = ?", (bia,))
        h = horas.Repositorio(self.caminho)
        h.definir_tarifa(bia, 300, AGORA); h.definir_tarifa(cid, 200, AGORA)
        lancada = h.criar(caso_id=self.caso_bia["id"], usuario=bia, data="2026-11-10", minutos=60, agora=AGORA)
        h.iniciar_cronometro(bia, self.caso_bia["id"], None, AGORA)
        mon = db.RegistroMonitoramentos(self.caminho)
        mon.atualizar(lambda d: d.update({"m-bia": {"usuario": bia, "criterio": {"numero_oab": "123"}}, "m-cid": {"usuario": cid, "criterio": {"numero_oab": "456"}}}))
        antes = self.req("GET", "/admin/usuarios/api/bia%40teste.com/vinculos")[1]["vinculos"]
        self.assertEqual((antes["monitoramentos"], antes["notificacoes"], antes["horas"]), (1, 1, 1))
        self.assertEqual(self.apagar()[0], 200)
        self.assertEqual(set(mon.carregar()), {"m-cid"})                                         # só o monitoramento dele sumiu
        self.assertEqual(self.sql("SELECT usuario FROM notificacao_eventos"), [(cid,)])
        self.assertEqual(self.sql("SELECT count(*) FROM notificacoes"), [(0,)])
        self.assertEqual(h.listar_tarifas(), {cid: 200.0})
        self.assertIsNone(h.cronometro(bia))
        self.assertIsNotNone(h.obter(lancada["id"]))                                             # horas lançadas ficam (histórico)
        self.assertEqual(h.obter(lancada["id"])["usuario"], bia)

    def test_protecoes(self):
        # não apaga a si mesmo
        status, corpo = self.apagar("adm%40teste.com", "adm@teste.com")
        self.assertEqual(status, 400)
        self.assertIn("próprio acesso", corpo["mensagem"])
        self.assertIsNotNone(self.perfil("adm@teste.com"))
        # outro administrador pode, enquanto sobrar um
        self.assertEqual(self.apagar("adm2%40teste.com", "adm@teste.com")[0], 200)
        # o último administrador ativo fica (mesmo pelo token administrativo do servidor)
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "operador"}, "bootstrap", "cid@teste.com")
        token_admin = usuarios_admin.gerar_token_admin(self.registro)
        status, corpo = chamar(self.mw, "DELETE", "/admin/usuarios/api/adm%40teste.com", token_admin)
        self.assertEqual(status, 400)
        self.assertIn("pelo menos um administrador", corpo["mensagem"])
        # não administrador não apaga ninguém
        self.assertEqual(self.apagar("cid%40teste.com", "ope@teste.com")[0], 403)
        self.assertIsNotNone(self.perfil("cid@teste.com"))

    def test_agenda_google_sincronizada_impede_a_exclusao(self):
        with sqlite3.connect(self.caminho) as c:
            c.execute("INSERT INTO atividade_agenda (id, caso_id, atividade_id, calendario_id, evento_id, estado, titulo, data, criado_em, usuario) "
                      "VALUES ('v1', ?, ?, 'cal', 'ev', 'sincronizado', 'X', '2026-12-01', '2026-11-01', 'bia@teste.com')", (self.caso_cid["id"], self.ativ_bia["id"]))
        status, corpo = self.apagar()
        self.assertEqual(status, 400)
        self.assertIn("1 atividade(s) sincronizada(s) com a Google Agenda", corpo["mensagem"])
        self.assertIsNotNone(self.perfil("bia@teste.com"))                                      # nada foi feito
        self.assertEqual(self.gestao.obter_caso(self.caso_bia["id"])["responsavel"], "bia@teste.com")
        with sqlite3.connect(self.caminho) as c:                                                # vínculo cancelado já não impede
            c.execute("UPDATE atividade_agenda SET estado = 'cancelado'")
        self.assertEqual(self.apagar()[0], 200)

    def test_atividade_desatribuida_alerta_o_responsavel_do_processo_e_nunca_a_pessoa_apagada(self):
        import asyncio
        self.apagar()
        enviados = []

        def alertar(dia):
            with mock.patch.object(server, "_smtp_do_ambiente", return_value=server.ConfiguracaoSMTP("h", 587, "u", "s", "r@x.com")):
                asyncio.run(server._alertar_prazos(self.gestao, lambda: datetime(2026, 11, dia, 15, tzinfo=timezone.utc),
                                                   enviar=lambda cfg, d, a, corpo: enviados.append((d, a))))

        alertar(30)                                          # o prazo "Atividade da Bia" vence amanhã
        destinos = {d for d, a in enviados if "Atividade da Bia" in a}
        self.assertEqual(destinos, {"cid@teste.com"})        # sem dono: vale o responsável do processo (Cid)
        self.assertNotIn("bia@teste.com", {d for d, _ in enviados})
        # sem responsável nem no processo: os administradores
        self.gestao.obter_caso(self.caso_cid["id"])
        with sqlite3.connect(self.caminho) as c:
            c.execute("UPDATE casos SET responsavel = NULL WHERE id = ?", (self.caso_cid["id"],))
        enviados.clear()
        alertar(30)
        self.assertEqual({d for d, a in enviados if "Atividade da Bia" in a}, {"adm@teste.com", "adm2@teste.com"})


if __name__ == "__main__":
    unittest.main()
