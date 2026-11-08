"""Cadastro de cliente: CPF/CNPJ válido, sem duplicar e com corpo maior que 4 KB."""
import asyncio
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import db
import server


def _chamar(mw, metodo, url, headers=(), corpo=b""):
    respostas = []

    async def receive():
        return {"type": "http.request", "body": corpo, "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    scope = {"type": "http", "method": metodo, "path": url, "query_string": b"", "headers": list(headers)}
    asyncio.run(mw(scope, receive, send))
    return respostas[0]["status"], json.loads(b"".join(m.get("body", b"") for m in respostas[1:]) or b"{}")


class CadastroClienteTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.gestao = db.RegistroClientesCasos(self.tmp / "teste.db")
        registro = server.RegistroUsuarios(self.tmp / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        token = saida.getvalue().strip().splitlines()[-1]
        self.mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao)
        self.auth = [(b"authorization", ("Bearer " + token).encode())]

    def criar(self, dados):
        return _chamar(self.mw, "POST", "/clientes", self.auth, json.dumps(dados).encode())

    def test_valida_digitos_do_cpf_e_cnpj(self):
        self.assertTrue(server._cpf_valido("52998224725"))
        self.assertFalse(server._cpf_valido("52998224726"))
        self.assertFalse(server._cpf_valido("11111111111"))
        self.assertTrue(server._cnpj_valido("11222333000181"))
        self.assertFalse(server._cnpj_valido("11222333000182"))
        status, corpo = self.criar({"nome": "X", "cpf_cnpj": "529.982.247-26"})
        self.assertEqual((status, corpo["mensagem"]), (400, "CPF inválido. Confira os números digitados."))
        self.assertEqual(self.criar({"nome": "X", "cpf_cnpj": "111"})[0], 400)
        self.assertEqual(self.criar({"nome": "Sem documento"})[0], 201)

    def test_nao_duplica_documento(self):
        status, ana = self.criar({"nome": "Ana", "cpf_cnpj": "529.982.247-25"})
        self.assertEqual(status, 201)
        status, corpo = self.criar({"nome": "Outra", "cpf_cnpj": "52998224725"})
        self.assertEqual(status, 409)
        self.assertEqual(corpo["cliente_existente"], {"id": ana["id"], "nome": "Ana"})
        # Editar o próprio cadastro mantendo o CPF é permitido; trocar para o CPF de outro, não.
        _, bia = self.criar({"nome": "Bia", "cpf_cnpj": "11.222.333/0001-81"})
        self.assertEqual(_chamar(self.mw, "PATCH", f"/clientes/{ana['id']}", self.auth,
                                 json.dumps({"nome": "Ana Souza", "cpf_cnpj": "529.982.247-25"}).encode())[0], 200)
        self.assertEqual(_chamar(self.mw, "PATCH", f"/clientes/{bia['id']}", self.auth,
                                 json.dumps({"nome": "Bia", "cpf_cnpj": "529.982.247-25"}).encode())[0], 409)

    def test_cadastro_maior_que_4kb(self):
        dados = {"nome": "Cadastro Grande", "observacoes": "x" * 6000,
                 "enderecos": [{"rua": "Rua Longa " * 20, "cidade": "São Paulo"}] * 3}
        status, cliente = self.criar(dados)
        self.assertEqual(status, 201)
        status, _ = _chamar(self.mw, "PATCH", f"/clientes/{cliente['id']}", self.auth, json.dumps(dados).encode())
        self.assertEqual(status, 200)


    def test_textos_longos_nas_outras_rotas_nao_se_perdem(self):
        _, cli = self.criar({"nome": "Cliente"})
        status, caso = _chamar(self.mw, "POST", "/casos", self.auth,
                               json.dumps({"cliente_id": cli["id"], "titulo": "Caso", "processos": []}).encode())
        self.assertEqual(status, 201)
        longo = "Observação longa. " * 400  # ~7 KB
        status, ativ = _chamar(self.mw, "POST", f"/casos/{caso['id']}/atividades", self.auth,
                               json.dumps({"tipo": "tarefa", "titulo": "Prazo", "observacoes": longo}).encode())
        self.assertEqual(status, 201)
        self.assertEqual(ativ["observacoes"].strip(), longo.strip())
        # Antes, acima de 4 KB a edição respondia 200 e descartava o texto em silêncio.
        status, ativ = _chamar(self.mw, "PATCH", f"/casos/{caso['id']}/atividades/{ativ['id']}", self.auth,
                               json.dumps({"observacoes": longo + "fim"}).encode())
        self.assertEqual((status, ativ["observacoes"].endswith("fim")), (200, True))
        status, corpo = _chamar(self.mw, "PATCH", f"/casos/{caso['id']}/atividades/{ativ['id']}", self.auth,
                                json.dumps({"observacoes": "x" * 70000}).encode())
        self.assertEqual(status, 413)
        self.assertIn("64 KB", corpo["mensagem"])


if __name__ == "__main__":
    unittest.main()
