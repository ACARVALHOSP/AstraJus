import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import automacoes
import db
import monitoramento_runtime
import server
import usuarios_admin as u

CATALOGO_TESTE = {
    "rotina_a": {"nome": "A", "descricao": "Rotina A", "parametros": {
        "dias": {"tipo": "int", "rotulo": "Dias", "minimo": 15, "maximo": 365, "padrao": 60}}},
    "rotina_b": {"nome": "B", "descricao": "Rotina B", "parametros": {}},
}


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.repo = automacoes.Repositorio(self.caminho, CATALOGO_TESTE)


class RepositorioTest(_Base):
    def test_sem_configuracao_vale_o_padrao_do_catalogo(self):
        self.assertEqual(self.repo.estado("rotina_a"), {"ativo": True, "parametros": {"dias": 60}})
        self.assertTrue(self.repo.ativa("rotina_b"))

    def test_catalogo_real_traz_as_rotinas_do_agendador(self):
        self.assertEqual(set(automacoes.CATALOGO),
                         {"monitoramentos", "captura_oab", "movimentos", "alertas_prazo", "triagem_publicacoes", "processo_parado"})

    def test_rotinas_antigas_nascem_ligadas_e_as_novas_desligadas(self):
        repo = automacoes.Repositorio(self.caminho)
        for chave in ("monitoramentos", "captura_oab", "movimentos", "alertas_prazo", "triagem_publicacoes"):
            self.assertTrue(repo.ativa(chave), chave)
        self.assertFalse(repo.ativa("processo_parado"))
        self.assertEqual(repo.estado("processo_parado")["parametros"], {"dias": 60})

    def test_desligar_persiste_e_entra_no_historico(self):
        depois = self.repo.definir("rotina_a", "usuario:ana", ativo=False)
        self.assertEqual(depois, {"ativo": False, "parametros": {"dias": 60}})
        # nova instância lê do banco
        self.assertFalse(automacoes.Repositorio(self.caminho, CATALOGO_TESTE).ativa("rotina_a"))
        historico = self.repo.historico()
        self.assertEqual(len(historico), 1)
        self.assertEqual(historico[0]["ator"], "usuario:ana")
        self.assertEqual(historico[0]["chave"], "rotina_a")
        self.assertTrue(historico[0]["antes"]["ativo"])
        self.assertFalse(historico[0]["depois"]["ativo"])

    def test_alterar_parametro_mantem_o_estado_ligado(self):
        self.repo.definir("rotina_a", "bootstrap", parametros={"dias": 90})
        self.assertEqual(self.repo.estado("rotina_a"), {"ativo": True, "parametros": {"dias": 90}})

    def test_sem_mudanca_nao_grava_historico(self):
        self.repo.definir("rotina_a", "bootstrap", ativo=True)
        self.repo.definir("rotina_a", "bootstrap", parametros={"dias": 60})
        self.assertEqual(self.repo.historico(), [])
        self.repo.definir("rotina_a", "bootstrap", ativo=False)
        self.repo.definir("rotina_a", "bootstrap", ativo=False)
        self.assertEqual(len(self.repo.historico()), 1)

    def test_validacoes(self):
        with self.assertRaises(LookupError):
            self.repo.definir("inexistente", "x", ativo=False)
        with self.assertRaises(LookupError):
            self.repo.estado("inexistente")
        for ativo in ("sim", 1, 0):
            with self.assertRaises(ValueError):
                self.repo.definir("rotina_a", "x", ativo=ativo)
        for parametros in ({"dias": 14}, {"dias": 366}, {"dias": "60"}, {"dias": True}, {"dias": 60.5},
                           {"outro": 1}, [("dias", 60)]):
            with self.assertRaises(ValueError, msg=str(parametros)):
                self.repo.definir("rotina_a", "x", parametros=parametros)
        # nada foi gravado pelas tentativas inválidas
        self.assertEqual(self.repo.historico(), [])
        self.assertEqual(self.repo.estado("rotina_a")["parametros"], {"dias": 60})

    def test_rotina_fora_do_catalogo_segue_ligada(self):
        self.assertTrue(self.repo.ativa("rotina_nova_sem_cadastro"))

    def test_listar_junta_estado_e_ultima_execucao(self):
        self.repo.definir("rotina_b", "x", ativo=False)
        itens = {i["chave"]: i for i in self.repo.listar(
            lambda chave: [{"inicio": "2026-11-17T10:00:00+00:00", "estado": "concluida"}] if chave == "rotina_a" else [])}
        self.assertTrue(itens["rotina_a"]["ativo"])
        self.assertEqual(itens["rotina_a"]["ultima_execucao"]["estado"], "concluida")
        self.assertFalse(itens["rotina_b"]["ativo"])
        self.assertIsNone(itens["rotina_b"]["ultima_execucao"])
        self.assertEqual(itens["rotina_a"]["parametros_definidos"]["dias"]["padrao"], 60)


class ExecucaoRespeitaInterruptorTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.runtime = monitoramento_runtime.Repositorio(self.caminho)
        self.chamadas = 0

    async def _funcao(self):
        self.chamadas += 1

    def executar(self, rotina="alertas_prazo"):
        asyncio.run(self.runtime.executar(rotina, 6, self._funcao, []))

    def test_rotina_ligada_executa(self):
        self.executar()
        self.assertEqual(self.chamadas, 1)
        self.assertEqual(self.runtime.historico("alertas_prazo")[0]["estado"], "concluida")

    def test_rotina_desligada_nao_executa_nem_registra_falha(self):
        automacoes.Repositorio(self.caminho).definir("alertas_prazo", "bootstrap", ativo=False)
        self.executar()
        self.assertEqual(self.chamadas, 0)
        self.assertEqual(self.runtime.historico("alertas_prazo"), [])

    def test_religar_retoma_sem_rodada_duplicada(self):
        repo = automacoes.Repositorio(self.caminho)
        repo.definir("alertas_prazo", "bootstrap", ativo=False)
        self.executar()
        repo.definir("alertas_prazo", "bootstrap", ativo=True)
        self.executar()
        self.executar()  # ainda dentro do intervalo de 6 h: não repete
        self.assertEqual(self.chamadas, 1)

    def test_desligar_uma_rotina_nao_afeta_outra(self):
        automacoes.Repositorio(self.caminho).definir("movimentos", "bootstrap", ativo=False)
        self.executar("alertas_prazo")
        self.assertEqual(self.chamadas, 1)


class RotasAdministrativasTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.reg = db.RegistroUsuarios(self.caminho)
        u.configurar_token_admin(self.reg, "bootstrap-seguro", somente_se_ausente=True)
        self.admin = u.alterar(self.reg, dict(login="adm", nome_completo="Adm", email="adm@example.org",
                                              nivel_acesso="administrador"), "bootstrap")["token"]
        self.comum = u.alterar(self.reg, dict(login="ana", nome_completo="Ana", email="ana@example.org"), "bootstrap")["token"]

    async def chamar(self, path, token, method="GET", corpo=None):
        app = SimpleNamespace(registro=self.reg, admin_token="bootstrap-seguro", falhas=None, oauth=None)
        scope = {"path": path, "method": method, "headers": [(b"authorization", ("Bearer " + token).encode())],
                 "client": ("127.0.0.1", 1)}
        eventos = []

        async def send(e):
            eventos.append(e)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo).encode(), "more_body": False}

        await u.tratar(app, scope, receive, send, server)
        return eventos[0]["status"], json.loads(eventos[1]["body"])

    def run_(self, *args, **kwargs):
        return asyncio.run(self.chamar(*args, **kwargs))

    def test_somente_administrador(self):
        for token in ("", "invalido", self.comum):
            self.assertEqual(self.run_("/admin/automacoes/api", token)[0], 403)
            self.assertEqual(self.run_("/admin/automacoes/api/alertas_prazo", token, "PUT", {"ativo": False})[0], 403)
        self.assertTrue(automacoes.Repositorio(self.caminho).ativa("alertas_prazo"))

    def test_lista_o_catalogo_completo_para_admin_e_token_administrativo(self):
        for token in (self.admin, "bootstrap-seguro"):
            status, corpo = self.run_("/admin/automacoes/api", token)
            self.assertEqual(status, 200)
            self.assertEqual({r["chave"] for r in corpo["rotinas"]}, set(automacoes.CATALOGO))
            self.assertEqual({r["chave"] for r in corpo["rotinas"] if not r["ativo"]}, {"processo_parado"})
            self.assertEqual(corpo["historico"], [])

    def test_desligar_pela_rota_grava_historico_com_ator(self):
        status, corpo = self.run_("/admin/automacoes/api/alertas_prazo", self.admin, "PUT", {"ativo": False})
        self.assertEqual(status, 200)
        self.assertFalse(corpo["ativo"])
        _, lista = self.run_("/admin/automacoes/api", self.admin)
        self.assertFalse(next(r for r in lista["rotinas"] if r["chave"] == "alertas_prazo")["ativo"])
        self.assertEqual(lista["historico"][0]["ator"], "usuario:adm")
        self.run_("/admin/automacoes/api/movimentos", "bootstrap-seguro", "PUT", {"ativo": False})
        self.assertEqual(self.run_("/admin/automacoes/api", self.admin)[1]["historico"][0]["ator"], "bootstrap")

    def test_pedido_invalido_e_rotina_inexistente(self):
        self.assertEqual(self.run_("/admin/automacoes/api/inexistente", self.admin, "PUT", {"ativo": False})[0], 404)
        self.assertEqual(self.run_("/admin/automacoes/api/alertas_prazo", self.admin, "PUT", {"ativo": "sim"})[0], 400)
        self.assertEqual(self.run_("/admin/automacoes/api/alertas_prazo", self.admin, "PUT", {"parametros": {"x": 1}})[0], 400)
        self.assertEqual(self.run_("/admin/automacoes/api/alertas_prazo", self.admin, "PUT", [1])[0], 400)
        # parâmetro da rotina nova: dentro e fora da faixa 15-365
        self.assertEqual(self.run_("/admin/automacoes/api/processo_parado", self.admin, "PUT", {"parametros": {"dias": 14}})[0], 400)
        status, corpo = self.run_("/admin/automacoes/api/processo_parado", self.admin, "PUT", {"ativo": True, "parametros": {"dias": 90}})
        self.assertEqual((status, corpo["ativo"], corpo["parametros"]), (200, True, {"dias": 90}))
        self.assertTrue(automacoes.Repositorio(self.caminho).ativa("alertas_prazo"))

    def test_ultima_execucao_aparece_na_listagem(self):
        async def funcao():
            return None
        asyncio.run(monitoramento_runtime.Repositorio(self.caminho).executar("movimentos", 12, funcao, []))
        _, lista = self.run_("/admin/automacoes/api", self.admin)
        movimentos = next(r for r in lista["rotinas"] if r["chave"] == "movimentos")
        self.assertEqual(movimentos["ultima_execucao"]["estado"], "concluida")


if __name__ == "__main__":
    unittest.main()
