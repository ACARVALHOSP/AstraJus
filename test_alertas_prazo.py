import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import db
import notificacoes
import server
from test_publicacoes_filtros import _chamar_asgi


def instante(dia, hora=15):  # 15h UTC = meio-dia em Brasília
    return datetime.fromisoformat(f"{dia}T{hora:02d}:00:00+00:00")


class _Base(unittest.TestCase):
    """Banco temporário, usuários e utilitários comuns."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("ana@teste.com", "bia@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        self.gestao = db.RegistroClientesCasos(self.caminho)
        agora = lambda: instante("2026-11-01")
        cliente = self.gestao.criar_cliente("Maria", None, None, agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Ação A", "ana@teste.com", [], agora)
        self.agora = agora

    def prazo(self, data, tipo="prazo", responsavel="ana@teste.com", titulo="Contestação", hora=None):
        return self.gestao.criar_atividade(self.caso["id"], tipo, titulo, data, hora, None, self.agora, responsavel=responsavel)

    def alertar(self, dia, hora=15, enviar=None, smtp=None):
        with mock.patch.object(server, "_smtp_do_ambiente", return_value=smtp):
            return asyncio.run(server._alertar_prazos(self.gestao, lambda: instante(dia, hora), enviar=enviar))

    def feed(self, usuario="ana@teste.com", dia="2026-11-10"):
        return notificacoes.Repositorio(self.caminho, agora=lambda: instante(dia)).listar(usuario)


class AlertasPrazoTest(_Base):
    def test_faixas(self):
        f = server._faixa_alerta_prazo
        self.assertEqual([f(d) for d in (-1, 0, 1, 2, 3, 4, 5)], ["atrasado", "0", "1", "2", "5", "5", "5"])

    def test_avisa_o_responsavel_uma_vez_por_faixa(self):
        self.prazo("2026-11-10", titulo="Contestação")
        self.assertTrue(self.alertar("2026-11-05"))       # 5 dias
        self.alertar("2026-11-05", hora=21)               # mesma faixa, de novo: não duplica
        self.alertar("2026-11-06")                        # 4 dias: ainda a faixa de 5
        feed = self.feed(dia="2026-11-06")
        self.assertEqual(feed["nao_lidas"], 1)
        item = feed["notificacoes"][0]
        self.assertEqual(item["titulo"], "Prazo vencendo")
        self.assertIn("Contestação — em 4 dias (10/11)", item["mensagem"])
        self.assertEqual(item["destino"]["tipo"], "atividade")
        self.alertar("2026-11-08")                        # 2 dias: nova faixa
        self.alertar("2026-11-09")                        # 1 dia
        self.alertar("2026-11-10")                        # hoje
        self.assertEqual(self.feed(dia="2026-11-10")["nao_lidas"], 4)
        self.assertIn("hoje", self.feed(dia="2026-11-10")["notificacoes"][0]["mensagem"])

    def test_nao_avisa_os_outros_e_audiencia_tem_titulo_proprio(self):
        self.prazo("2026-11-10", tipo="audiencia", titulo="Instrução", hora="14:30")
        self.alertar("2026-11-09")
        self.assertEqual(self.feed("bia@teste.com")["nao_lidas"], 0)
        item = self.feed(dia="2026-11-09")["notificacoes"][0]
        self.assertEqual(item["titulo"], "Audiência próxima")
        self.assertIn("amanhã às 14:30", item["mensagem"])

    def test_sem_responsavel_vai_para_o_do_processo_e_depois_para_administradores(self):
        self.prazo("2026-11-10", responsavel=None)
        self.alertar("2026-11-09")
        self.assertEqual(self.feed("ana@teste.com", "2026-11-09")["nao_lidas"], 1)   # responsável do processo
        self.assertEqual(self.feed("bia@teste.com", "2026-11-09")["nao_lidas"], 0)
        import usuarios_admin
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "bia@teste.com")
        cliente = self.gestao.criar_cliente("João", None, None, self.agora)
        sem_dono = self.gestao.criar_caso(cliente["id"], "Ação B", None, [], self.agora)
        self.gestao.criar_atividade(sem_dono["id"], "prazo", "Apelação", "2026-11-10", None, None, self.agora)
        self.alertar("2026-11-09")
        # sem dono: administradores. (Na 2ª execução do dia, o prazo da Ação A, ainda sem ciência, também
        # é escalonado para a administradora; por isso confere-se a mensagem, não a contagem.)
        textos = [n["mensagem"] for n in self.feed("bia@teste.com", "2026-11-09")["notificacoes"]]
        self.assertTrue(any("Apelação" in t for t in textos))

    def test_concluida_some_e_atrasada_so_para_prazo_recente(self):
        a = self.prazo("2026-11-10")
        self.alertar("2026-11-09")
        self.assertEqual(self.feed()["nao_lidas"], 1)
        self.gestao.atualizar_atividade(self.caso["id"], a["id"], status="concluida")
        self.assertEqual(self.feed()["nao_lidas"], 0)                  # concluir remove o aviso
        self.prazo("2026-11-11", titulo="Recente")
        self.prazo("2026-08-01", titulo="Antigo")
        self.alertar("2026-11-13")                                     # venceu há 2 dias / há 3 meses
        textos = [n["mensagem"] for n in self.feed(dia="2026-11-13")["notificacoes"]]
        self.assertTrue(any("Recente — venceu há 2 dias" in t for t in textos))
        self.assertFalse(any("Antigo" in t for t in textos))

    def test_email_uma_vez_e_falha_nao_derruba(self):
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "avisos@teste.com")
        enviados = []
        self.prazo("2026-11-10", titulo="Réplica")
        self.alertar("2026-11-09", enviar=lambda c, d, a, corpo: enviados.append((d, a, corpo)), smtp=cfg)
        self.alertar("2026-11-09", hora=21, enviar=lambda c, d, a, corpo: enviados.append((d, a, corpo)), smtp=cfg)
        self.assertEqual(len(enviados), 1)
        destino, assunto, corpo = enviados[0]
        self.assertEqual(destino, "ana@teste.com")
        self.assertIn("vence amanhã: Réplica", assunto)
        self.assertIn("Processo: Ação A", corpo)

        def quebrado(*_):
            raise OSError("smtp fora do ar")
        self.prazo("2026-11-10", titulo="Outra")
        self.assertFalse(self.alertar("2026-11-09", enviar=quebrado, smtp=cfg))   # registra a falha, mas o aviso no sino existe
        self.assertEqual(self.feed(dia="2026-11-09")["nao_lidas"], 2)


class CienciaEEscalonamentoTest(_Base):
    """Confirmação de ciência e aviso aos administradores quando ninguém confirma."""

    def setUp(self):
        super().setUp()
        import usuarios_admin
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "bia@teste.com")

    def escalonados(self, usuario="bia@teste.com", dia="2026-11-09"):
        return [n for n in self.feed(usuario, dia)["notificacoes"] if n["tipo"] == "prazo_escalonado"]

    def test_escalona_so_na_execucao_seguinte_ao_primeiro_aviso_e_uma_vez(self):
        p = self.prazo("2026-11-10", titulo="Contestação")
        self.alertar("2026-11-08")                       # faixa de 2 dias: não escalona
        self.alertar("2026-11-09")                       # primeiro aviso de "amanhã": ainda não
        self.assertEqual(self.escalonados(), [])
        self.alertar("2026-11-09", hora=21)              # nada mudou e ninguém confirmou
        itens = self.escalonados()
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]["titulo"], "Prazo sem confirmação de ciência")
        self.assertIn("Contestação", itens[0]["mensagem"])
        self.assertIn("Responsável: ana@teste.com", itens[0]["mensagem"])
        self.assertEqual(itens[0]["destino"], {"tipo": "atividade", "caso_id": self.caso["id"], "atividade_id": p["id"]})
        self.alertar("2026-11-10")                       # no dia: não repete o escalonamento
        self.assertEqual(len(self.escalonados(dia="2026-11-10")), 1)
        self.assertEqual(self.escalonados("ana@teste.com"), [])   # o responsável não recebe o escalonamento

    def test_ciencia_evita_o_escalonamento_e_aparece_no_feed(self):
        p = self.prazo("2026-11-10")
        self.alertar("2026-11-09")
        item = self.feed("ana@teste.com", "2026-11-09")["notificacoes"][0]
        self.assertEqual((item["exige_ciencia"], item["ciente"]), (True, False))
        ciencia = self.gestao.confirmar_ciencia(self.caso["id"], p["id"], "ana@teste.com", lambda: instante("2026-11-09", 16))
        self.assertEqual(ciencia["usuario"], "ana@teste.com")
        self.alertar("2026-11-09", hora=21)
        self.assertEqual(self.escalonados(), [])
        self.assertTrue(self.feed("ana@teste.com", "2026-11-09")["notificacoes"][0]["ciente"])

    def test_ciencia_vale_para_a_data_confirmada(self):
        p = self.prazo("2026-11-10")
        self.gestao.confirmar_ciencia(self.caso["id"], p["id"], "ana@teste.com", lambda: instante("2026-11-05"))
        self.gestao.atualizar_atividade(self.caso["id"], p["id"], data="2026-11-12")   # prazo mudou de data
        self.alertar("2026-11-11")
        self.alertar("2026-11-11", hora=21)
        self.assertEqual(len(self.escalonados(dia="2026-11-11")), 1)
        # confirmar de novo, agora para a data nova, volta a valer
        nova = self.gestao.confirmar_ciencia(self.caso["id"], p["id"], "bia@teste.com", lambda: instante("2026-11-11"))
        self.assertEqual(nova["usuario"], "bia@teste.com")

    def test_confirmar_e_idempotente_e_so_vale_para_prazo(self):
        p = self.prazo("2026-11-10")
        a = self.prazo("2026-11-10", tipo="audiencia", titulo="Instrução")
        primeira = self.gestao.confirmar_ciencia(self.caso["id"], p["id"], "ana@teste.com", lambda: instante("2026-11-06"))
        segunda = self.gestao.confirmar_ciencia(self.caso["id"], p["id"], "bia@teste.com", lambda: instante("2026-11-07"))
        self.assertEqual(primeira, segunda)                     # vale a primeira confirmação da data
        self.assertIsNone(self.gestao.confirmar_ciencia(self.caso["id"], a["id"], "ana@teste.com", lambda: instante("2026-11-06")))
        self.assertIsNone(self.gestao.confirmar_ciencia(self.caso["id"], 99999, "ana@teste.com", lambda: instante("2026-11-06")))
        self.assertIsNone(self.gestao.confirmar_ciencia("outro-processo", p["id"], "ana@teste.com", lambda: instante("2026-11-06")))

    def test_audiencia_nao_escalona_e_sem_outro_administrador_nao_ha_reserva(self):
        self.prazo("2026-11-10", tipo="audiencia", titulo="Instrução")
        self.alertar("2026-11-09"); self.alertar("2026-11-09", hora=21)
        self.assertEqual(self.escalonados(), [])
        import usuarios_admin
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "ana@teste.com")
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "operador"}, "bootstrap", "bia@teste.com")
        self.prazo("2026-11-10", titulo="Réplica")      # responsável é a única administradora
        self.alertar("2026-11-09", hora=22); self.alertar("2026-11-09", hora=23)
        self.assertEqual(self.escalonados("ana@teste.com"), [])

    def test_escalonamento_sai_por_email_para_os_administradores(self):
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "avisos@teste.com")
        enviados = []
        registrar = lambda c, d, a, corpo: enviados.append((d, a, corpo))
        self.prazo("2026-11-10", titulo="Réplica")
        self.alertar("2026-11-09", enviar=registrar, smtp=cfg)
        self.assertEqual([d for d, *_ in enviados], ["ana@teste.com"])
        self.alertar("2026-11-09", hora=21, enviar=registrar, smtp=cfg)
        self.assertEqual([d for d, *_ in enviados], ["ana@teste.com", "bia@teste.com"])
        destino, assunto, corpo = enviados[1]
        self.assertEqual(assunto, "Prazo sem confirmação de ciência: Réplica")
        self.assertIn("Responsável: ana@teste.com", corpo)
        self.alertar("2026-11-09", hora=22, enviar=registrar, smtp=cfg)    # uma vez só
        self.assertEqual(len(enviados), 2)

    def test_rota_http_de_ciencia(self):
        import usuarios_admin
        _, _, token_consulta = server._criar_usuario_core(self.registro, "cid@teste.com")
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "consulta"}, "bootstrap", "cid@teste.com")
        p = self.prazo("2026-11-10")
        a = self.prazo("2026-11-10", tipo="audiencia", titulo="Instrução")
        mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        auth = lambda token: [(b"authorization", ("Bearer " + token).encode())]
        rota = lambda aid: f"/casos/{self.caso['id']}/atividades/{aid}/ciencia"
        status, corpo = _chamar_asgi(mw, "POST", rota(p["id"]), headers=auth(self.token["ana@teste.com"]))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(corpo)["ciencia"]["usuario"], "ana@teste.com")
        # repetir, mesmo por outra pessoa, devolve a primeira confirmação
        status, corpo = _chamar_asgi(mw, "POST", rota(p["id"]), headers=auth(self.token["bia@teste.com"]))
        self.assertEqual((status, json.loads(corpo)["ciencia"]["usuario"]), (200, "ana@teste.com"))
        self.assertEqual(_chamar_asgi(mw, "GET", rota(p["id"]), headers=auth(self.token["ana@teste.com"]))[0], 405)
        self.assertEqual(_chamar_asgi(mw, "POST", rota(a["id"]), headers=auth(self.token["ana@teste.com"]))[0], 404)   # audiência
        self.assertEqual(_chamar_asgi(mw, "POST", rota(99999), headers=auth(self.token["ana@teste.com"]))[0], 404)
        self.assertEqual(_chamar_asgi(mw, "POST", rota(p["id"]), headers=[])[0], 401)                                  # sem token
        self.assertEqual(_chamar_asgi(mw, "POST", rota(p["id"]), headers=auth(token_consulta))[0], 403)                # só consulta


if __name__ == "__main__":
    unittest.main()
