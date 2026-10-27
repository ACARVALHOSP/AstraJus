"""I04: API autenticada, SQLite temporário e transporte Google inteiramente simulado."""
import asyncio
import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest import mock

import httpx
import agenda_atividades as agenda
import db
import server


class AgendaAtividadesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.agora = lambda: datetime(2026, 10, 26)
        cliente = self.gestao.criar_cliente("Cliente fictício", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Processo fictício", "ana", [], self.agora)
        self.atv = self.gestao.criar_atividade(self.caso["id"], "prazo", "Conferir publicação", "2026-10-30", None, None, self.agora)
        self.registro = db.RegistroUsuarios(self.caminho)
        _, _, self.token = server._criar_usuario_core(self.registro, "ana")
        self.google = db.RegistroIntegracaoGoogle(self.caminho)
        self.google.salvar_conexao("refresh-simulado", self.agora)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao, registro_google=self.google,
                                           google_client_id="client-simulado", google_client_secret="segredo-simulado")
        self.repo = agenda.Repositorio(self.caminho)
        self.calendario = "escritorio@teste"
        self.eventos = {}
        self.requisicoes = []
        self.timeout_criar = self.timeout_atualizar = self.conflito_patch = False
        self.erro_get_evento = None
        self.etag = 0
        patch = mock.patch.object(server, "_TRANSPORTE_HTTP", httpx.MockTransport(self.responder))
        patch.start()
        self.addCleanup(patch.stop)
        self.rota = f"/casos/{self.caso['id']}/atividades/{self.atv['id']}/agenda"

    def versao_remota(self, evento):
        self.etag += 1
        evento["etag"] = f'"etag-{self.etag}"'
        return evento

    def responder(self, request):
        self.requisicoes.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "access-simulado"})
        path = request.url.path
        if path.endswith("/calendars/primary"):
            return httpx.Response(200, json={"id": self.calendario})
        partes = path.split("/calendars/")[1].split("/events")
        calendario = partes[0]
        evento_id = partes[1].lstrip("/")
        if request.method == "POST":
            corpo = json.loads(request.content)
            chave = (calendario, corpo["id"])
            if chave in self.eventos:
                return httpx.Response(409, json={})
            evento = self.versao_remota({**corpo, "status": "confirmed", "htmlLink": "https://www.google.com/calendar/event?eid=teste"})
            self.eventos[chave] = evento
            if self.timeout_criar:
                self.timeout_criar = False
                raise httpx.ReadTimeout("Timeout simulado após criação", request=request)
            return httpx.Response(200, json=copy.deepcopy(evento))
        chave = (calendario, evento_id)
        evento = self.eventos.get(chave)
        if evento is None:
            return httpx.Response(404, json={})
        if request.method == "GET":
            if self.erro_get_evento:
                return httpx.Response(self.erro_get_evento, json={})
            return httpx.Response(200, json=copy.deepcopy(evento))
        if self.conflito_patch and request.method == "PATCH":
            self.conflito_patch = False
            self.versao_remota(evento)
            evento["summary"] = "Alterado durante o envio"
        if request.headers.get("if-match") != evento.get("etag"):
            return httpx.Response(412, json={})
        if request.method == "PATCH":
            self.versao_remota(evento)
            evento.update(json.loads(request.content))
            if self.timeout_atualizar:
                self.timeout_atualizar = False
                raise httpx.ReadTimeout("Timeout simulado após atualização", request=request)
            return httpx.Response(200, json=copy.deepcopy(evento))
        if request.method == "DELETE":
            self.eventos[chave] = {"id": evento_id, "status": "cancelled"}
            return httpx.Response(204)
        raise AssertionError(request)

    def chamar(self, metodo="POST", corpo=None, chave="operacao-1", rota=None, autenticado=True):
        async def executar():
            mensagens = []
            async def send(m):
                mensagens.append(m)
            async def receive():
                return {"type": "http.request", "body": json.dumps({} if corpo is None else corpo).encode(), "more_body": False}
            headers = [(b"authorization", f"Bearer {self.token}".encode())] if autenticado else []
            if chave is not None:
                headers.append((b"idempotency-key", chave.encode()))
            await self.mw({"type": "http", "method": metodo, "path": rota or self.rota, "query_string": b"", "headers": headers}, receive, send)
            status = next(m["status"] for m in mensagens if m["type"] == "http.response.start")
            dados = b"".join(m.get("body", b"") for m in mensagens if m["type"] == "http.response.body")
            return status, json.loads(dados) if dados.startswith(b"{") else dados
        return asyncio.run(executar())

    def criar(self):
        status, dados = self.chamar()
        self.assertEqual(status, 200, dados)
        self.assertEqual(dados["agenda"]["estado"], "sincronizado")
        return dados["agenda"]

    def atual(self):
        return self.repo.obter(self.caso["id"], self.atv["id"])

    def evento(self):
        v = self.atual()
        return self.eventos[(v["calendario_id"], v["evento_id"])]

    def mudar_remoto(self, titulo="Alteração externa", data="2026-11-02"):
        evento = self.evento()
        evento.update(summary=titulo, start={"date": data}, end={"date": "2026-11-03"})
        self.versao_remota(evento)

    def comando(self, comando, v=None):
        v = v or self.atual()
        return self.chamar("PATCH", {"vinculo_id": v["id"], "versao": v["versao"], "comando": comando})

    def test_criacao_idempotente_persistente_chave_distinta_e_conflito_de_payload(self):
        primeiro = self.criar()
        self.assertEqual(self.evento()["end"], {"date": "2026-10-31"})
        self.assertEqual(self.evento()["extendedProperties"]["private"]["cnj_atividade_id"], str(self.atv["id"]))
        self.repo = agenda.Repositorio(self.caminho)
        self.assertEqual(self.chamar()[1]["agenda"]["id"], primeiro["id"])
        self.assertEqual(self.chamar(chave="outra-chave")[1]["agenda"]["id"], primeiro["id"])
        self.assertEqual(sum(r.method == "POST" and r.url.path.endswith("/events") for r in self.requisicoes), 1)
        self.assertEqual(self.chamar(corpo={"data": "2027-01-01"})[0], 409)
        self.assertEqual(self.chamar(chave=None)[0], 400)
        self.assertNotIn("simulado", json.dumps(self.chamar("GET")[1]))

    def test_timeout_apos_criar_e_restart_nao_duplicam_evento(self):
        self.timeout_criar = True
        status, dados = self.chamar()
        self.assertEqual(status, 202)
        self.assertEqual(dados["agenda"]["estado"], "falha")
        identificador = self.atual()["evento_id"]
        self.repo = agenda.Repositorio(self.caminho)
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "sincronizado")
        self.assertEqual(self.atual()["evento_id"], identificador)
        self.assertEqual(len(self.eventos), 1)

    def test_reservas_concorrentes_usam_um_unico_vinculo(self):
        def reservar(chave):
            return agenda.Repositorio(self.caminho).reservar(self.caso["id"], self.atv["id"], self.calendario,
                "ana", chave, agenda.assinatura_pedido(self.caso["id"], self.atv["id"], {}))["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(reservar, ["concorrente-1", "concorrente-2"]))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(len(self.repo.listar()), 1)

    def test_edicao_local_enfileira_e_usa_etag_sem_cancelar_na_conclusao(self):
        self.criar()
        etag = self.evento()["etag"]
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Novo título", data="2026-11-04")
        self.assertEqual(self.atual()["estado"], "pendente")
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "sincronizado")
        patches = [r for r in self.requisicoes if r.method == "PATCH"]
        self.assertEqual(patches[-1].headers["if-match"], etag)
        self.assertEqual(self.evento()["start"]["date"], "2026-11-04")
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], status="concluida")
        self.assertEqual(self.atual()["estado"], "sincronizado")
        self.assertFalse(any(r.method == "DELETE" for r in self.requisicoes))

    def test_timeout_apos_atualizar_reconcilia_sem_segundo_patch(self):
        self.criar()
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Atualizado")
        self.timeout_atualizar = True
        self.assertEqual(self.chamar()[0], 202)
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "sincronizado")
        self.assertEqual(sum(r.method == "PATCH" for r in self.requisicoes), 1)

    def test_alteracao_externa_exige_revisao_e_aceitar_atualiza_atividade(self):
        self.criar()
        self.mudar_remoto()
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "divergente")
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"])[0]["data"], "2026-10-30")
        status, dados = self.comando("aceitar_data_da_agenda")
        self.assertEqual(status, 200, dados)
        atividade = self.gestao.listar_atividades(self.caso["id"])[0]
        self.assertEqual((atividade["titulo"], atividade["data"]), ("Alteração externa", "2026-11-02"))

    def test_manter_atividade_resolve_conflito_e_recusa_versao_obsoleta(self):
        self.criar()
        self.mudar_remoto()
        self.chamar()
        antiga = self.atual()
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Título revisado")
        self.assertEqual(self.comando("usar_data_da_atividade", antiga)[0], 409)
        self.assertEqual(self.comando("usar_data_da_atividade")[0], 200)
        self.assertEqual(self.evento()["summary"], "Título revisado")
        self.assertEqual(self.evento()["start"]["date"], "2026-10-30")

    def test_etag_412_nao_sobrescreve_mudanca_concorrente(self):
        self.criar()
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Mudança local")
        self.conflito_patch = True
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "divergente")
        self.assertEqual(self.evento()["summary"], "Alterado durante o envio")

    def test_cancelamento_remoto_sem_marcadores_nao_conclui_atividade(self):
        self.criar()
        v = self.atual()
        self.eventos[(v["calendario_id"], v["evento_id"])] = {"id": v["evento_id"], "status": "cancelled"}
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "cancelado")
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"])[0]["status"], "pendente")

    def test_cancelamento_idempotente_barreiras_e_replay_nao_recriam(self):
        self.criar()
        rota_atv = self.rota.removesuffix("/agenda")
        self.assertEqual(self.chamar("DELETE", rota=rota_atv)[0], 409)
        self.assertEqual(self.chamar("DELETE", rota=f"/casos/{self.caso['id']}")[0], 409)
        v = self.atual()
        pedido = {"vinculo_id": v["id"], "versao": v["versao"]}
        self.assertEqual(self.chamar("DELETE", pedido)[1]["agenda"]["estado"], "cancelado")
        self.assertEqual(self.chamar("DELETE", pedido)[1]["agenda"]["estado"], "cancelado")
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "cancelado")
        novo = self.chamar(chave="nova-vinculacao")[1]["agenda"]
        self.assertNotEqual(novo["id"], v["id"])
        self.chamar("DELETE", pedido)  # pedido antigo não cancela o vínculo novo
        self.assertEqual(self.atual()["estado"], "sincronizado")

    def test_exclusao_apos_cancelar_preserva_tombstone_da_chave(self):
        self.criar()
        v = self.atual()
        self.chamar("DELETE", {"vinculo_id": v["id"], "versao": v["versao"]})
        self.assertEqual(self.chamar("DELETE", rota=self.rota.removesuffix("/agenda"))[0], 200)
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "cancelado")
        self.assertEqual(len(self.eventos), 1)

    def test_calendario_errado_e_desconexao_nao_modificam_evento(self):
        self.criar()
        self.calendario = "outra-conta@teste"
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "falha")
        self.assertEqual(len(self.eventos), 1)
        self.google.desconectar()
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "falha")
        self.google.salvar_conexao("outro-refresh", self.agora)
        self.calendario = "escritorio@teste"
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "sincronizado")

    def test_data_hora_invalidas_autenticacao_e_pertencimento(self):
        for data, hora in ((None, None), ("2026-02-30", None), ("2026-10-30", "10:00")):
            self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], data=data or "", hora=hora or "")
            self.assertEqual(self.chamar()[0], 409)
        self.assertFalse(self.eventos)
        self.assertEqual(self.chamar(autenticado=False)[0], 401)
        self.assertEqual(self.chamar("GET", rota=self.rota.replace(self.caso["id"], "outro-processo"))[0], 404)
        self.assertEqual(self.chamar(rota=self.rota + "/invalida")[0], 404)

    def test_resposta_antiga_nao_descarta_edicao_mais_nova_e_lease_exclusivo(self):
        self.criar()
        v = self.repo.adquirir(self.atual()["id"])
        self.assertIsNone(self.repo.adquirir(v["id"]))
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Mais recente")
        self.repo.concluir(v, "sincronizado", copy.deepcopy(self.evento()), aplicado=True)
        self.assertEqual(self.atual()["titulo"], "Mais recente")
        self.assertEqual(self.atual()["estado"], "pendente")
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "sincronizado")
        self.assertEqual(self.evento()["summary"], "Mais recente")

    def test_evento_recorrente_ou_timed_nao_e_silenciosamente_convertido(self):
        self.criar()
        self.evento()["recurrence"] = ["RRULE:FREQ=DAILY"]
        self.versao_remota(self.evento())
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "divergente")
        self.assertEqual(self.comando("aceitar_data_da_agenda")[0], 409)
        self.assertFalse(any(r.method == "PATCH" for r in self.requisicoes))

    def test_id_remoto_pertencente_a_outro_vinculo_nao_e_alterado(self):
        self.criar()
        self.evento()["extendedProperties"]["private"]["cnj_vinculo_id"] = "outro-vinculo"
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "falha")
        self.assertFalse(any(r.method in ("PATCH", "DELETE") for r in self.requisicoes))

    def test_lease_expirado_permite_retomada_sem_resultado_antigo_sobrescrever(self):
        self.criar()
        v = self.repo.adquirir(self.atual()["id"])
        with self.repo.transacao() as c:
            c.execute("UPDATE atividade_agenda SET execucao_ate=0 WHERE id=?", (v["id"],))
        novo = self.repo.adquirir(v["id"])
        self.assertNotEqual(v["execucao"], novo["execucao"])
        self.repo.concluir(v, "falha", erro="Resposta antiga")
        self.assertEqual(self.atual()["execucao"], novo["execucao"])
        self.repo.concluir(novo, "sincronizado", copy.deepcopy(self.evento()), aplicado=True)
        self.assertIsNone(self.atual()["execucao"])

    def test_worker_periodico_processa_fila_e_preserva_job_legado(self):
        self.criar()
        self.gestao.atualizar_atividade(self.caso["id"], self.atv["id"], titulo="Processar no job")
        with mock.patch.object(server, "_sincronizar_calendar_google", new_callable=mock.AsyncMock) as legado:
            asyncio.run(server._sincronizar_calendar_google_job(self.google, self.gestao, "client-simulado", "segredo-simulado"))
        legado.assert_awaited_once()
        self.assertEqual(self.atual()["estado"], "sincronizado")
        self.assertEqual(self.evento()["summary"], "Processar no job")

    def test_evento_avulso_continua_sem_criar_atividade_ou_vinculo(self):
        with mock.patch.object(server.google_integracao, "criar_evento_calendar", new_callable=mock.AsyncMock,
                               return_value={"id": "evento-avulso", "htmlLink": "https://www.google.com/calendar/event?eid=avulso"}):
            status, _ = self.chamar(corpo={"titulo": "Evento avulso", "data": "2026-11-01"}, rota=f"/casos/{self.caso['id']}/evento-calendar")
        self.assertEqual(status, 201)
        self.assertEqual(len(self.gestao.listar_atividades(self.caso["id"])), 1)
        self.assertEqual(self.repo.listar(), [])

    def test_evento_ausente_so_e_cancelado_apos_confirmar_calendario_e_criacao_anterior(self):
        self.criar()
        self.erro_get_evento = 403
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "falha")
        self.erro_get_evento = 404
        self.assertEqual(self.chamar()[1]["agenda"]["estado"], "cancelado")

    def test_data_null_nao_simula_remocao_em_atividade_vinculada(self):
        self.criar()
        self.assertEqual(self.chamar("PATCH", {"data": None}, rota=self.rota.removesuffix('/agenda'))[0], 409)
        self.assertEqual(self.gestao.listar_atividades(self.caso['id'])[0]['data'], '2026-10-30')

    def test_410_apos_timeout_de_criacao_reconhece_cancelamento_sem_recriar(self):
        self.timeout_criar = True
        self.chamar()
        self.erro_get_evento = 410
        self.assertEqual(self.chamar()[1]['agenda']['estado'], 'cancelado')
        self.assertEqual(sum(r.method == 'POST' and r.url.path.endswith('/events') for r in self.requisicoes), 1)


if __name__ == "__main__":
    unittest.main()
