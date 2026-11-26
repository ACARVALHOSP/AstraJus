"""Rotas de documentos: modelo DOCX, geração, envio à ZapSign (simulado) e webhook."""
import asyncio
import base64
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from docx import Document

import db
import documentos
import server
import usuarios_admin
from helpers_http import chamar

AGORA = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)


def _docx():
    d = Document()
    d.add_paragraph("Outorgante: {{cliente_nome}}, CPF {{cliente_cpf_cnpj}}. Poderes: {{poderes}}.")
    s = io.BytesIO()
    d.save(s)
    return s.getvalue()


def _webhook(mw, token, corpo):
    saida = []
    dados = json.dumps(corpo).encode()

    async def receive():
        return {"type": "http.request", "body": dados, "more_body": False}

    async def send(m):
        saida.append(m)

    scope = {"type": "http", "method": "POST", "path": "/zapsign/webhook", "query_string": b"",
             "headers": [(b"x-webhook-token", token.encode())]}
    asyncio.run(mw(scope, receive, send))
    return saida[0]["status"]


class DocumentosHttpTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        self.token = {}
        for nome in ("adm@teste.com", "ana@teste.com"):
            _, _, self.token[nome] = server._criar_usuario_core(self.registro, nome)
        usuarios_admin.alterar(self.registro, {"nivel_acesso": "administrador"}, "bootstrap", "adm@teste.com")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.cliente = self.gestao.criar_cliente("Maria Souza", "52998224725", None, AGORA)
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        patch = mock.patch.object(documentos, "converter_pdf", lambda docx, tempo=90: b"%PDF-falso")
        patch.start()
        self.addCleanup(patch.stop)

    def req(self, metodo, url, corpo=None, quem="ana@teste.com"):
        return chamar(self.mw, metodo, url, self.token[quem], corpo)

    def modelo(self):
        status, corpo = self.req("POST", "/documentos/modelos", {"nome": "Procuração", "tipo": "procuracao",
                                 "arquivo_base64": base64.b64encode(_docx()).decode()}, "adm@teste.com")
        self.assertEqual(status, 201, corpo)
        return corpo["modelo"]

    def test_modelo_so_administrador_e_validacao(self):
        arquivo = base64.b64encode(_docx()).decode()
        self.assertEqual(self.req("POST", "/documentos/modelos", {"nome": "X", "arquivo_base64": arquivo})[0], 403)
        self.assertEqual(self.req("POST", "/documentos/modelos", {"nome": "X", "arquivo_base64": "bm9wZQ=="}, "adm@teste.com")[0], 400)
        m = self.modelo()
        self.assertEqual(m["variaveis"], ["cliente_nome", "cliente_cpf_cnpj", "poderes"])
        self.assertEqual(len(self.req("GET", "/documentos/modelos")[1]["modelos"]), 1)

    def test_previa_gerar_e_baixar(self):
        m = self.modelo()
        _, previa = self.req("POST", f"/documentos/modelos/{m['id']}/previa", {"cliente_id": self.cliente["id"]})
        valores = {c["chave"]: c["valor"] for c in previa["campos"]}
        self.assertTrue(any("Outorgante" in p["texto"] for p in previa["paragrafos"]))
        self.assertEqual(valores["cliente_nome"], "Maria Souza")
        self.assertEqual(valores["poderes"], "")
        valores["poderes"] = "ad judicia"
        status, corpo = self.req("POST", "/documentos", {"modelo_id": m["id"], "cliente_id": self.cliente["id"], "valores": valores})
        self.assertEqual((status, corpo["documento"]["status"]), (201, "gerado"))
        self.assertEqual(self.req("GET", f"/documentos?cliente_id={self.cliente['id']}")[1]["documentos"][0]["id"], corpo["documento"]["id"])
        self.assertEqual(self.req("POST", "/documentos", {"modelo_id": 999, "valores": {}})[0], 404)

    def test_envio_e_webhook(self):
        m = self.modelo()
        doc = self.req("POST", "/documentos", {"modelo_id": m["id"], "valores": {}})[1]["documento"]
        retorno = {"token": "zap1", "signers": [{"name": "Maria", "email": "m@x.com", "status": "new", "sign_url": "https://z/1"}]}
        enviar = mock.AsyncMock(return_value=retorno)
        with mock.patch.dict(os.environ, {"ZAPSIGN_API_KEY": "k", "ZAPSIGN_WEBHOOK_TOKEN": "segredo"}), \
                mock.patch.object(documentos, "enviar_para_assinatura", enviar):
            ruim = self.req("POST", f"/documentos/{doc['id']}/enviar", {"signatarios": [{"nome": "Maria", "email": "sem-arroba"}]})
            self.assertEqual(ruim[0], 400)
            ok = self.req("POST", f"/documentos/{doc['id']}/enviar", {"signatarios": [{"nome": "Maria", "email": "m@x.com"}], "canal": "email"})
            self.assertEqual((ok[0], ok[1]["documento"]["status"]), (200, "enviado"))
            self.assertEqual(self.req("POST", f"/documentos/{doc['id']}/enviar", {"signatarios": [{"nome": "Maria", "email": "m@x.com"}]})[0], 400)  # já enviado
            assinado = {"event_type": "doc_signed", "token": "zap1", "status": "signed", "signed_file": "https://z/assinado.pdf",
                        "signers": [{"name": "Maria", "status": "signed", "signed_at": "2026-11-13"}]}
            self.assertEqual(_webhook(self.mw, "errado", assinado), 401)
            with mock.patch.object(documentos, "baixar", mock.AsyncMock(return_value=b"%PDF-assinado")):
                self.assertEqual(_webhook(self.mw, "segredo", assinado), 200)
                self.assertEqual(_webhook(self.mw, "segredo", assinado), 200)  # reenvio duplicado é inofensivo
        d = self.req("GET", "/documentos")[1]["documentos"][0]
        self.assertEqual((d["status"], d["tem_assinado"]), ("assinado", True))

    def _enviado(self, token="zapX"):
        m = self.modelo()
        doc = self.req("POST", "/documentos", {"modelo_id": m["id"], "valores": {}})[1]["documento"]
        documentos.Repositorio(self.caminho).marcar_enviado(doc["id"], token, [])
        return doc

    def test_avisos_de_visualizacao_bounce_e_prazo(self):
        _, _, bia = server._criar_usuario_core(self.registro, "bia@teste.com")
        doc = self._enviado()
        casos = (("doc_viewed", "Documento visualizado"), ("email_bounce", "E-mail devolvido"),
                 ("doc-expiration-alert", "Prazo para assinar acabando"))
        with mock.patch.dict(os.environ, {"ZAPSIGN_WEBHOOK_TOKEN": "segredo"}):
            self.assertEqual(_webhook(self.mw, "segredo", {"event_type": "doc_viewed", "token": "desconhecido"}), 200)
            for evento, _ in casos:
                for _ in range(2):  # o reenvio do mesmo aviso não duplica
                    self.assertEqual(_webhook(self.mw, "segredo", {"event_type": evento, "token": "zapX"}), 200)
        titulos = [n["titulo"] for n in self.req("GET", "/notificacoes")[1]["notificacoes"]]
        self.assertEqual(sorted(titulos), sorted(t for _, t in casos))
        self.assertEqual(chamar(self.mw, "GET", "/notificacoes", bia)[1]["notificacoes"], [])
        d = self.req("GET", "/documentos")[1]["documentos"][0]
        self.assertTrue(d["visualizado_em"])
        self.assertEqual((d["alerta"], d["status"]), ("prazo_acabando", "enviado"))

    def test_avisos_ignorados_em_documento_final(self):
        doc = self._enviado()
        with mock.patch.dict(os.environ, {"ZAPSIGN_WEBHOOK_TOKEN": "segredo"}):
            self.assertEqual(_webhook(self.mw, "segredo", {"event_type": "doc_signed", "token": "zapX", "status": "signed", "signers": []}), 200)
            for evento in ("doc_viewed", "email_bounce", "doc-expiration-alert"):
                self.assertEqual(_webhook(self.mw, "segredo", {"event_type": evento, "token": "zapX"}), 200)
        self.assertEqual(self.req("GET", "/notificacoes")[1]["notificacoes"], [])
        d = self.req("GET", "/documentos")[1]["documentos"][0]
        self.assertEqual((d["status"], d["visualizado_em"], d["alerta"]), ("assinado", None, None))


if __name__ == "__main__":
    unittest.main()
