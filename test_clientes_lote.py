"""Operações em massa: SQLite real temporário e middleware autenticado, sem rede."""
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import db
import server


class ClientesLoteTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.path)
        agora = lambda: datetime.now(timezone.utc)
        self.a = self.gestao.criar_cliente("Álvaro", "123", "Manter", agora,
            telefones=[{"telefone": "11999990000"}], emails=[{"email": "a@example.com"}],
            detalhes={"perfil": "contato", "tipo_pessoa": "juridica", "rg_numero": "456"})
        self.b = self.gestao.criar_cliente("Beatriz", None, None, agora)
        self.ids = [self.a["id"], self.b["id"]]

    def aplicar(self, **pedido):
        dados = {"ids": self.ids, **pedido}
        previa = self.gestao.clientes_em_massa(dados)
        return self.gestao.clientes_em_massa({**dados, "confirmar": True, "esperado": previa["esperado"]})

    def test_perfil_preserva_cadastro_e_previa_nao_grava(self):
        previa = self.gestao.clientes_em_massa({"ids": self.ids, "acao": "perfil", "perfil": "cliente"})
        self.assertEqual(previa["alterados"], 1)
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "contato")
        resposta = self.aplicar(acao="perfil", perfil="cliente")
        self.assertEqual(resposta["sem_alteracao"], 1)
        atual = self.gestao.obter_cliente(self.a["id"])
        self.assertEqual({k: v for k, v in atual.items() if k != "perfil"}, {k: v for k, v in self.a.items() if k != "perfil"})

    def test_etiquetas_aditivas_normalizadas_remocao_e_idempotencia(self):
        self.aplicar(acao="aplicar_etiquetas", etiquetas=["  Prioritário  ", "Prioritário"])
        self.aplicar(acao="aplicar_etiquetas", etiquetas=["Previdenciário", "PRIORITÁRIO"])
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["etiquetas"], ["Previdenciário", "Prioritário"])
        self.assertEqual(self.aplicar(acao="aplicar_etiquetas", etiquetas=["prioritário"])["alterados"], 0)
        self.aplicar(acao="remover_etiquetas", etiquetas=["PRIORITÁRIO"])
        self.assertEqual(self.gestao.listar_clientes()[0]["etiquetas"], ["Previdenciário"])
        self.assertEqual(self.aplicar(acao="remover_etiquetas", etiquetas=["Ausente"])["alterados"], 0)

    def test_conflito_entre_instancias_nao_grava_parcial(self):
        pedido = {"ids": self.ids, "acao": "perfil", "perfil": "cliente"}
        previa = self.gestao.clientes_em_massa(pedido)
        outra = db.RegistroClientesCasos(self.path)
        outro = {"ids": [self.b["id"]], "acao": "perfil", "perfil": "contato"}
        p = outra.clientes_em_massa(outro)
        outra.clientes_em_massa({**outro, "confirmar": True, "esperado": p["esperado"]})
        with self.assertRaises(db.ConflitoClientesLote):
            self.gestao.clientes_em_massa({**pedido, "confirmar": True, "esperado": previa["esperado"]})
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["perfil"], "contato")

    def test_id_inexistente_limites_e_corpos_invalidos(self):
        for dados in ([], {"ids": []}, {"ids": self.ids * 101},
                      {"ids": self.ids, "acao": "perfil", "perfil": "admin"},
                      {"ids": self.ids, "acao": "aplicar_etiquetas", "etiquetas": ["x" * 41]},
                      {"ids": self.ids, "acao": "aplicar_etiquetas", "etiquetas": [12]},
                      {"ids": self.ids, "acao": "perfil", "perfil": "contato", "confirmar": True}):
            with self.subTest(dados=dados), self.assertRaises(ValueError):
                self.gestao.clientes_em_massa(dados)
        with self.assertRaises(ValueError):
            self.gestao.clientes_em_massa({"ids": [self.a["id"], "ausente"], "acao": "aplicar_etiquetas", "etiquetas": ["Nova"]})
        self.assertEqual(self.gestao.obter_cliente(self.a["id"])["etiquetas"], [])

    def test_limite_vinte_etiquetas_e_cascade(self):
        self.aplicar(acao="aplicar_etiquetas", etiquetas=[str(i) for i in range(20)])
        with self.assertRaises(ValueError):
            self.aplicar(acao="aplicar_etiquetas", etiquetas=["Excedente"])
        self.assertEqual(len(self.gestao.obter_cliente(self.a["id"])["etiquetas"]), 20)
        self.gestao.excluir_cliente(self.a["id"])
        self.assertEqual(len(self.gestao.obter_cliente(self.b["id"])["etiquetas"]), 20)

    def test_endpoint_autenticacao_validacao_e_conflito(self):
        registro = db.RegistroUsuarios(self.path)
        _, _, token = server._criar_usuario_core(registro, "teste@example.com")
        app = server._AutenticacaoBearer(None, registro, gestao=self.gestao)
        async def chamar(dados, autenticar=True):
            mensagens = []
            async def receive():
                return {"type": "http.request", "body": json.dumps(dados).encode(), "more_body": False}
            async def send(m):
                mensagens.append(m)
            await app({"type": "http", "method": "POST", "path": "/clientes/acoes-em-massa", "headers": [(b"authorization", f"Bearer {token}".encode())] if autenticar else []}, receive, send)
            status = mensagens[0]["status"]
            corpo = b"".join(m.get("body", b"") for m in mensagens)
            return status, json.loads(corpo) if status == 200 else corpo
        pedido = {"ids": self.ids, "acao": "perfil", "perfil": "contato"}
        self.assertEqual(asyncio.run(chamar(pedido, False))[0], 401)
        self.assertEqual(asyncio.run(chamar([]))[0], 400)
        status, previa = asyncio.run(chamar(pedido))
        self.assertEqual(status, 200)
        self.assertEqual(asyncio.run(chamar({**pedido, "confirmar": True, "esperado": previa["esperado"]}))[0], 200)
        self.assertEqual(asyncio.run(chamar({**pedido, "confirmar": True, "esperado": previa["esperado"]}))[0], 409)


if __name__ == "__main__":
    unittest.main()
