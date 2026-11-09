import asyncio
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import db
import notificacoes
import server


def instante(dia, hora=15):  # 15h UTC = meio-dia em Brasília
    return datetime.fromisoformat(f"{dia}T{hora:02d}:00:00+00:00")


class AlertasPrazoTest(unittest.TestCase):
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
        self.assertEqual(self.feed("bia@teste.com", "2026-11-09")["nao_lidas"], 1)   # sem dono: administradores

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


if __name__ == "__main__":
    unittest.main()
