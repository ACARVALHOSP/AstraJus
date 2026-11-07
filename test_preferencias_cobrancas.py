"""Preferências por usuário no servidor e cópia local das cobranças do Asaas (webhook + cache)."""
import asyncio
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import httpx

import db
import server


def _chamar(mw, metodo, url, headers=(), corpo=b""):
    caminho, _, consulta = url.partition("?")
    respostas = []

    async def receive():
        return {"type": "http.request", "body": corpo, "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    scope = {"type": "http", "method": metodo, "path": caminho, "query_string": consulta.encode(),
             "headers": list(headers)}
    asyncio.run(mw(scope, receive, send))
    return respostas[0]["status"], b"".join(m.get("body", b"") for m in respostas[1:])


AGORA = lambda: datetime(2026, 11, 7, 12, tzinfo=timezone.utc)  # noqa: E731


class PreferenciasCobrancasTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.gestao = db.RegistroClientesCasos(self.tmp / "teste.db")
        registro = server.RegistroUsuarios(self.tmp / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        self.token = saida.getvalue().strip().splitlines()[-1]
        self.mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao)
        self.auth = [(b"authorization", ("Bearer " + self.token).encode())]

    def test_preferencias_por_usuario(self):
        status, corpo = _chamar(self.mw, "GET", "/preferencias", self.auth)
        self.assertEqual((status, json.loads(corpo)["preferencias"]), (200, {}))
        lista = [{"tribunal": "tjsp", "numero": "10012345620268260100"}]
        status, _ = _chamar(self.mw, "PUT", "/preferencias/favoritos_consultas", self.auth,
                            json.dumps({"valor": lista}).encode())
        self.assertEqual(status, 200)
        status, corpo = _chamar(self.mw, "GET", "/preferencias", self.auth)
        self.assertEqual(json.loads(corpo)["preferencias"], {"favoritos_consultas": lista})
        self.assertEqual(self.gestao.obter_preferencias("outro"), {})
        self.assertEqual(_chamar(self.mw, "PUT", "/preferencias/xyz", self.auth, b'{"valor": []}')[0], 404)
        self.assertEqual(_chamar(self.mw, "PUT", "/preferencias/favoritos_casos", self.auth, b'{"valor": "x"}')[0], 400)
        self.assertEqual(_chamar(self.mw, "GET", "/preferencias")[0], 401)

    def test_webhook_atualiza_copia_local(self):
        cobranca = {"id": "pay_1", "status": "PENDING", "value": 100, "customer": "cus_1", "dueDate": "2026-11-10"}
        env = {"ASAAS_API_KEY_SANDBOX": "chave", "ASAAS_WEBHOOK_TOKEN": "segredo"}
        with mock.patch.dict(os.environ, env), mock.patch.object(server, "_COFRE_INTEGRACOES", None):
            corpo = json.dumps({"event": "PAYMENT_CREATED", "payment": cobranca}).encode()
            self.assertEqual(_chamar(self.mw, "POST", "/asaas/webhook", [(b"asaas-access-token", b"errado")], corpo)[0], 401)
            self.assertEqual(_chamar(self.mw, "POST", "/asaas/webhook", [(b"asaas-access-token", b"segredo")], corpo)[0], 200)
            self.assertEqual(self.gestao.listar_cobrancas_asaas("sandbox")[0][0]["status"], "PENDING")
            pago = json.dumps({"event": "PAYMENT_RECEIVED", "payment": {**cobranca, "status": "RECEIVED"}}).encode()
            _chamar(self.mw, "POST", "/asaas/webhook", [(b"asaas-access-token", b"segredo")], pago)
            self.assertEqual(self.gestao.listar_cobrancas_asaas("sandbox")[0][0]["status"], "RECEIVED")
            excluida = json.dumps({"event": "PAYMENT_DELETED", "payment": cobranca}).encode()
            _chamar(self.mw, "POST", "/asaas/webhook", [(b"asaas-access-token", b"segredo")], excluida)
            self.assertEqual(self.gestao.listar_cobrancas_asaas("sandbox")[0], [])
        with mock.patch.dict(os.environ, {"ASAAS_API_KEY_SANDBOX": "chave"}, clear=False), \
                mock.patch.object(server, "_COFRE_INTEGRACOES", None):
            os.environ.pop("ASAAS_WEBHOOK_TOKEN", None)
            # Sem token configurado, o webhook fica desligado.
            self.assertEqual(_chamar(self.mw, "POST", "/asaas/webhook", [], b"{}")[0], 404)

    def test_painel_le_copia_recente_sem_chamar_o_asaas(self):
        chamadas = []

        def handler(request):
            chamadas.append(str(request.url))
            return httpx.Response(200, json={"data": [{"id": "pay_9", "status": "OVERDUE", "value": 50,
                                                       "dueDate": "2026-11-01"}], "hasMore": False})

        env = {"ASAAS_API_KEY_SANDBOX": "chave"}
        with mock.patch.dict(os.environ, env), mock.patch.object(server, "_COFRE_INTEGRACOES", None), \
                mock.patch.object(server, "_TRANSPORTE_HTTP", httpx.MockTransport(handler)):
            # Primeira abertura: sem cópia, busca no Asaas e guarda.
            status, corpo = _chamar(self.mw, "GET", "/pagamentos?situacao=todas", self.auth)
            self.assertEqual(status, 200)
            painel = json.loads(corpo)
            self.assertEqual([c["id"] for c in painel["cobrancas"]], ["pay_9"])
            self.assertIsNotNone(painel["atualizado_em"])
            self.assertEqual(len(chamadas), 1)
            # Segunda abertura: cópia recente, não chama o Asaas.
            _chamar(self.mw, "GET", "/pagamentos?situacao=todas", self.auth)
            self.assertEqual(len(chamadas), 1)
            # "Atualizar" força a busca.
            _chamar(self.mw, "GET", "/pagamentos?situacao=todas&atualizar=1", self.auth)
            self.assertEqual(len(chamadas), 2)


if __name__ == "__main__":
    unittest.main()
