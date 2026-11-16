"""E-mail pela API do Brevo: envio, prioridade sobre o SMTP, teste do cofre e e-mail de teste do administrador (sem rede)."""
import asyncio
import tempfile
import time
import unittest
from email.message import EmailMessage
from pathlib import Path
from unittest import mock

import httpx
from cryptography.fernet import Fernet

import db
import integracoes as i
import server
from _util import _hash_token

CHAVE = "xkeysib-segredo-do-teste"
BREVO = server.ConfiguracaoBrevo(CHAVE, "avisos@escritorio.com", "Escritório Silva")
SMTP = server.ConfiguracaoSMTP("smtp.teste", 587, "usuario", "senha", "noreply@teste")


def mensagem(destino="ana@exemplo.com", assunto="Assunto de teste", corpo="Corpo do e-mail\ncom acentuação: ção."):
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = assunto, "ignorado@x.com", destino
    m.set_content(corpo)
    return m


def resposta(status, corpo=None):
    return httpx.Response(status, json=corpo if corpo is not None else {})


class EnvioPelaApiTest(unittest.TestCase):
    def test_monta_a_requisicao_da_api(self):
        with mock.patch.object(server.httpx, "post", return_value=resposta(201, {"messageId": "<1>"})) as post:
            server._entregar_email(BREVO, mensagem())
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(kwargs["headers"]["api-key"], CHAVE)
        self.assertEqual(kwargs["timeout"], 30)
        carga = kwargs["json"]
        self.assertEqual(carga["sender"], {"email": "avisos@escritorio.com", "name": "Escritório Silva"})
        self.assertEqual(carga["to"], [{"email": "ana@exemplo.com"}])
        self.assertEqual(carga["subject"], "Assunto de teste")
        self.assertIn("com acentuação: ção.", carga["textContent"])
        self.assertNotIn(CHAVE, str(carga))                 # a chave só vai no cabeçalho

    def test_remetente_vem_da_configuracao_e_nome_e_opcional(self):
        sem_nome = server.ConfiguracaoBrevo(CHAVE, "avisos@escritorio.com")
        with mock.patch.object(server.httpx, "post", return_value=resposta(201)) as post:
            server._entregar_email(sem_nome, mensagem())
        self.assertEqual(post.call_args.kwargs["json"]["sender"], {"email": "avisos@escritorio.com"})

    def test_status_de_sucesso(self):
        for status in (200, 201, 202):
            with mock.patch.object(server.httpx, "post", return_value=resposta(status)):
                server._entregar_email(BREVO, mensagem())

    def test_recusas_viram_erro_com_motivo_e_sem_a_chave(self):
        casos = [
            (401, {"message": "Key not found"}, "HTTP 401", "IPs autorizados"),
            (403, {"message": "We have detected you are using an unrecognised IP address"}, "HTTP 403", "IPs autorizados"),
            (400, {"message": "Sender is not valid"}, "HTTP 400", "cadastrado e validado"),
            (429, {"message": "Too many requests"}, "HTTP 429", "Too many requests"),
            (500, None, "HTTP 500", "Brevo recusou"),
        ]
        for status, corpo, esperado1, esperado2 in casos:
            with mock.patch.object(server.httpx, "post", return_value=resposta(status, corpo)):
                with self.assertRaises(RuntimeError) as e:
                    server._entregar_email(BREVO, mensagem())
            self.assertIn(esperado1, str(e.exception))
            self.assertIn(esperado2, str(e.exception))
            self.assertNotIn(CHAVE, str(e.exception))

    def test_falha_de_rede_propaga_sem_a_chave(self):
        with mock.patch.object(server.httpx, "post", side_effect=httpx.ConnectTimeout("tempo esgotado")):
            with self.assertRaises(httpx.ConnectTimeout):
                server._entregar_email(BREVO, mensagem())

    def test_smtp_continua_funcionando_e_nao_chama_a_api(self):
        with mock.patch.object(server.httpx, "post") as post, mock.patch.object(server.smtplib, "SMTP") as smtp:
            server._entregar_email(SMTP, mensagem())
        post.assert_not_called()
        smtp.assert_called_once_with("smtp.teste", 587, timeout=30)
        smtp.return_value.__enter__.return_value.starttls.assert_called_once()

    def test_todos_os_envios_do_sistema_passam_pelo_mesmo_ponto(self):
        # cadastro (token), monitoramento e e-mail simples (alertas, novo token) usam o Brevo quando é a configuração ativa
        with mock.patch.object(server, "_COFRE_INTEGRACOES", None), mock.patch.object(server.httpx, "post", return_value=resposta(201)) as post:
            server._enviar_token_por_email(BREVO, "ana@exemplo.com", "TOKEN-XYZ")
            server._enviar_email_simples(BREVO, "bia@exemplo.com", "Alerta", "Prazo vence amanhã")
            server._enviar_aviso_monitoramento(BREVO, "cid@exemplo.com", {"numero_processo": "123"}, [{"data_disponibilizacao": "10/11/2026"}])
        destinos = [c.kwargs["json"]["to"][0]["email"] for c in post.call_args_list]
        self.assertEqual(destinos, ["ana@exemplo.com", "bia@exemplo.com", "cid@exemplo.com"])
        self.assertIn("TOKEN-XYZ", post.call_args_list[0].kwargs["json"]["textContent"])
        self.assertIn("TOKEN-XYZ", post.call_args_list[0].kwargs["json"]["htmlContent"])     # versão HTML vai junto
        self.assertIn("<!doctype html>", post.call_args_list[2].kwargs["json"]["htmlContent"])
        self.assertNotIn("htmlContent", post.call_args_list[1].kwargs["json"])              # sem html, só texto


class PrioridadeDaConfiguracaoTest(unittest.TestCase):
    def config(self, valores):
        with mock.patch.object(server, "_config_integracao", side_effect=lambda nome, padrao="": valores.get(nome, padrao)):
            return server._smtp_do_ambiente()

    def test_brevo_tem_prioridade_sobre_o_smtp(self):
        cfg = self.config({"CNJ_BREVO_API_KEY": CHAVE, "CNJ_BREVO_REMETENTE": "a@b.com", "CNJ_BREVO_NOME_REMETENTE": "Nome", "CNJ_SMTP_HOST": "smtp.x"})
        self.assertIsInstance(cfg, server.ConfiguracaoBrevo)
        self.assertEqual((cfg.api_key, cfg.remetente, cfg.nome), (CHAVE, "a@b.com", "Nome"))

    def test_brevo_incompleto_cai_no_smtp_ou_em_nada(self):
        so_chave = {"CNJ_BREVO_API_KEY": CHAVE, "CNJ_SMTP_HOST": "smtp.x", "CNJ_SMTP_PORTA": "465", "CNJ_SMTP_USUARIO": "u@x", "CNJ_SMTP_SENHA": "s"}
        cfg = self.config(so_chave)
        self.assertIsInstance(cfg, server.ConfiguracaoSMTP)
        self.assertEqual((cfg.porta, cfg.remetente), (465, "u@x"))
        self.assertIsNone(self.config({"CNJ_BREVO_API_KEY": CHAVE}))
        self.assertIsNone(self.config({"CNJ_BREVO_REMETENTE": "a@b.com"}))
        self.assertIsNone(self.config({}))

    def test_espacos_sao_aparados(self):
        cfg = self.config({"CNJ_BREVO_API_KEY": f"  {CHAVE}\n", "CNJ_BREVO_REMETENTE": " a@b.com "})
        self.assertEqual((cfg.api_key, cfg.remetente), (CHAVE, "a@b.com"))


class TesteDoCofreTest(unittest.TestCase):
    def rodar(self, dados, responder):
        chamadas = []

        def tratar(req):
            chamadas.append(req)
            return responder(req)

        async def executar():
            async with httpx.AsyncClient(transport=httpx.MockTransport(tratar)) as cliente:
                return await i.testar("brevo", "padrao", dados, cliente)
        return asyncio.run(executar()), chamadas

    @staticmethod
    def servidor(conta=200, senders=None, senders_status=200):
        def responder(req):
            if str(req.url).endswith("/v3/account"):
                return resposta(conta, {"email": "dono@x.com", "plan": [{"credits": 300}]})
            return resposta(senders_status, {"senders": senders if senders is not None else []})
        return responder

    DADOS = {"api_key": CHAVE, "remetente": "Avisos <avisos@escritorio.com>"}

    def test_chave_e_remetente_ativo_aprovam_sem_enviar_nada(self):
        (ok, msg), chamadas = self.rodar(self.DADOS, self.servidor(senders=[{"email": "AVISOS@escritorio.com", "active": True}]))
        self.assertTrue(ok, msg)
        self.assertIn("Nenhum e-mail enviado", msg)
        self.assertEqual({c.method for c in chamadas}, {"GET"})
        self.assertTrue(all(c.headers["api-key"] == CHAVE for c in chamadas))
        self.assertNotIn(CHAVE, msg)

    def test_remetente_nao_cadastrado_ou_nao_validado(self):
        (ok, msg), _ = self.rodar(self.DADOS, self.servidor(senders=[{"email": "outro@x.com", "active": True}]))
        self.assertFalse(ok)
        self.assertIn("não está cadastrado", msg)
        (ok, msg), _ = self.rodar(self.DADOS, self.servidor(senders=[{"email": "avisos@escritorio.com", "active": False}]))
        self.assertFalse(ok)
        self.assertIn("ainda não foi validado", msg)

    def test_chave_rejeitada_explica_o_ip_autorizado(self):
        for status in (401, 403):
            (ok, msg), chamadas = self.rodar(self.DADOS, self.servidor(conta=status))
            self.assertFalse(ok)
            self.assertIn("IPs autorizados", msg)
            self.assertEqual(len(chamadas), 1)                 # nem tenta listar remetentes

    def test_instabilidade_nao_e_chave_rejeitada(self):
        for status in (429, 500, 503):
            (ok, msg), _ = self.rodar(self.DADOS, self.servidor(conta=status))
            self.assertFalse(ok)
            self.assertIn("instável", msg)

    def test_sem_permissao_para_listar_remetentes_aprova_com_aviso(self):
        (ok, msg), _ = self.rodar(self.DADOS, self.servidor(senders_status=403))
        self.assertTrue(ok)
        self.assertIn("não foi possível conferir o remetente", msg)

    def test_campos_obrigatorios(self):
        for dados, trecho in (({"remetente": "a@b.com"}, "chave"), ({"api_key": CHAVE}, "remetente"), ({"api_key": CHAVE, "remetente": "sem-arroba"}, "remetente")):
            (ok, msg), chamadas = self.rodar(dados, self.servidor())
            self.assertFalse(ok)
            self.assertIn(trecho, msg)
            self.assertEqual(chamadas, [])

    def test_excecao_do_provedor_nao_vaza(self):
        def estoura(req):
            raise httpx.ConnectError("conexão recusada para api.brevo.com com a chave " + CHAVE)
        (ok, msg), _ = self.rodar(self.DADOS, estoura)
        self.assertFalse(ok)
        self.assertNotIn(CHAVE, msg)


class CofreDoBrevoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cofre = i.Cofre(Path(tmp.name) / "t.db", Fernet.generate_key())
        self.ator = self.cofre.ator()

    def test_provedor_e_variaveis_existem_e_a_chave_fica_cifrada(self):
        self.assertEqual(i.PROVEDORES["brevo"], ("sistema", {"api_key"}, {"remetente", "nome_remetente"}))
        ident = self.cofre.candidato("brevo", "padrao", {"api_key": CHAVE, "remetente": "a@b.com"}, 0, self.ator)
        with self.cofre.abrir() as c:
            linha = dict(c.execute("SELECT * FROM integracoes_config WHERE id=?", (ident,)).fetchone())
        self.assertNotIn(CHAVE.encode(), linha["segredo"] if isinstance(linha["segredo"], bytes) else linha["segredo"].encode())
        self.assertNotIn(CHAVE, linha["parametros"])
        self.assertIn("a@b.com", linha["parametros"])
        with self.assertRaises(ValueError):
            self.cofre.candidato("brevo", "padrao", {"senha": "x"}, 0, self.ator)  # campo de outro provedor

    def test_ativo_alimenta_as_variaveis_que_o_servidor_le(self):
        ident = self.cofre.candidato("brevo", "padrao", {"api_key": CHAVE, "remetente": "a@b.com", "nome_remetente": "Escritório"}, 0, self.ator)
        with self.cofre.abrir() as c:
            c.execute("UPDATE integracoes_config SET estado='ativo' WHERE id=?", (ident,))
        self.assertEqual(self.cofre.valor("CNJ_BREVO_API_KEY"), CHAVE)
        self.assertEqual(self.cofre.valor("CNJ_BREVO_REMETENTE"), "a@b.com")
        self.assertEqual(self.cofre.valor("CNJ_BREVO_NOME_REMETENTE"), "Escritório")
        catalogo = {(x["provedor"], x["ambiente"]): x for x in self.cofre.catalogo()}
        self.assertEqual(catalogo[("brevo", "padrao")]["estado"], "ativo")
        self.assertEqual(catalogo[("brevo", "padrao")]["segredos"], {"api_key": "••••••••"})  # mascarada
        self.assertNotIn(CHAVE, str(catalogo))

    def test_importa_do_ambiente(self):
        self.cofre.importar_ambiente({"CNJ_BREVO_API_KEY": CHAVE, "CNJ_BREVO_REMETENTE": "a@b.com"})
        self.assertEqual(self.cofre.valor("CNJ_BREVO_API_KEY"), CHAVE)


class EmailDeTesteTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "t.db"
        self.cofre = i.Cofre(self.caminho, Fernet.generate_key())
        registro = db.RegistroUsuarios(self.caminho)
        registro.salvar({
            "adm": {"hash": _hash_token("adm-token"), "nivel_acesso": "administrador", "email": "adm@escritorio.com"},
            "ana": {"hash": _hash_token("ana-token"), "email": "ana@escritorio.com"},
        })

        async def abaixo(scope, receive, send):
            await server._json(send, 404, {})
        with mock.patch.object(server, "_COFRE_INTEGRACOES", self.cofre):
            self.app = server._AutenticacaoBearer(abaixo, registro, admin_token="bootstrap")

    def postar(self, corpo=None, token="adm-token", cfg=BREVO, envio=None):
        async def rodar():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="https://exemplo.test") as c:
                return await c.post("/admin/integracoes/email-teste", headers={"Authorization": "Bearer " + token}, json=corpo or {})
        with mock.patch.object(server, "_smtp_do_ambiente", return_value=cfg), \
                mock.patch.object(server, "_enviar_email_simples", envio or mock.Mock()) as enviar:
            return asyncio.run(rodar()), enviar

    def test_envia_para_o_e_mail_do_proprio_administrador(self):
        r, enviar = self.postar()
        self.assertEqual((r.status_code, r.json()), (200, {"enviado": True, "destino": "adm@escritorio.com", "via": "Brevo"}))
        cfg, destino, assunto, corpo = enviar.call_args.args
        self.assertIs(cfg, BREVO)
        self.assertEqual((destino, assunto), ("adm@escritorio.com", "Teste de e-mail do AstraJus"))
        self.assertNotIn(CHAVE, corpo)
        self.assertEqual(self.cofre.historico()[0]["acao"], "email_teste")

    def test_via_smtp_e_destino_informado(self):
        r, enviar = self.postar({"destino": "outro@exemplo.com"}, cfg=SMTP)
        self.assertEqual((r.status_code, r.json()["via"], r.json()["destino"]), (200, "SMTP", "outro@exemplo.com"))
        self.assertEqual(enviar.call_args.args[1], "outro@exemplo.com")

    def test_falha_devolve_o_motivo_sem_a_chave(self):
        r, _ = self.postar(envio=mock.Mock(side_effect=RuntimeError("Brevo recusou o envio (HTTP 401): Key not found. Confira a chave.")))
        self.assertEqual(r.status_code, 502)
        self.assertIn("pelo Brevo", r.json()["erro"])
        self.assertIn("HTTP 401", r.json()["erro"])
        self.assertNotIn(CHAVE, r.text)
        self.assertEqual(self.cofre.historico()[0]["resultado"], "falhou")

    def test_falha_de_rede_mostra_o_tipo_do_erro(self):
        r, _ = self.postar(envio=mock.Mock(side_effect=OSError("porta 587 fechada")))
        self.assertEqual(r.status_code, 502)
        self.assertIn("OSError: porta 587 fechada", r.json()["erro"])

    def test_sem_configuracao_ou_destino_invalido(self):
        r, enviar = self.postar(cfg=None)
        self.assertEqual(r.status_code, 400)
        self.assertIn("Brevo ou SMTP", r.json()["erro"])
        enviar.assert_not_called()
        r, enviar = self.postar({"destino": "sem-arroba"})
        self.assertEqual(r.status_code, 400)
        enviar.assert_not_called()

    def test_so_administrador(self):
        r, enviar = self.postar(token="ana-token")
        self.assertEqual(r.status_code, 403)
        enviar.assert_not_called()
        r, enviar = self.postar(token="invalido")
        self.assertEqual(r.status_code, 403)

    def test_segundo_envio_seguido_e_limitado(self):
        self.assertEqual(self.postar()[0].status_code, 200)
        r, enviar = self.postar()
        self.assertEqual(r.status_code, 429)
        enviar.assert_not_called()

    def test_token_de_recuperacao_precisa_informar_o_destino(self):
        r, _ = self.postar(token="bootstrap")
        self.assertEqual(r.status_code, 400)                    # sem usuário, não há e-mail próprio
        r, enviar = self.postar({"destino": "adm@escritorio.com"}, token="bootstrap")
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
