import asyncio
import json
import unittest
from unittest import mock

import httpx
import server

BRASILAPI = {
    "cnpj": "19131243000197", "razao_social": "OPEN KNOWLEDGE BRASIL", "nome_fantasia": "REDE PELO CONHECIMENTO LIVRE",
    "descricao_situacao_cadastral": "ATIVA", "data_situacao_cadastral": "2013-10-03", "data_inicio_atividade": "2013-10-03",
    "cnae_fiscal_descricao": "Atividades de associações de defesa de direitos sociais", "porte": "DEMAIS",
    "natureza_juridica": "Associação Privada", "ddd_telefone_1": "1130000000", "ddd_telefone_2": "",
    "email": "CONTATO@OK.ORG.BR", "cep": "04508000", "descricao_tipo_de_logradouro": "RUA", "logradouro": "JOAQUIM FLORIANO",
    "numero": "466", "complemento": "SALA 12", "bairro": "ITAIM BIBI", "municipio": "SAO PAULO", "uf": "SP",
    "qsa": [{"nome_socio": "NAO DEVE VAZAR"}],
}


class FalsoCliente:
    def __init__(self, resposta, chamadas):
        self.resposta, self.chamadas = resposta, chamadas
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, url):
        self.chamadas.append(url)
        if isinstance(self.resposta, Exception):
            raise self.resposta
        return self.resposta


def consultar(cnpj, resposta, chamadas):
    saidas = []
    async def send(m): saidas.append(m)
    with mock.patch.object(server, "_cliente", lambda *_: FalsoCliente(resposta, chamadas)):
        asyncio.run(server._consulta_cnpj_http(send, cnpj))
    return saidas[0]["status"], json.loads(saidas[1]["body"])


class ConsultaCnpjTest(unittest.TestCase):
    def setUp(self):
        server._CACHE_CNPJ.clear()

    def test_sucesso_recorta_e_guarda_em_cache(self):
        chamadas = []
        ok = httpx.Response(200, json=BRASILAPI)
        status, dados = consultar("19.131.243/0001-97", ok, chamadas)
        self.assertEqual(status, 200)
        self.assertEqual(dados["razao_social"], "OPEN KNOWLEDGE BRASIL")
        self.assertEqual(dados["email"], "contato@ok.org.br")
        self.assertEqual(dados["telefones"], ["1130000000"])
        self.assertEqual(dados["endereco"]["rua"], "RUA JOAQUIM FLORIANO")
        self.assertNotIn("qsa", dados)
        self.assertEqual(consultar("19131243000197", ok, chamadas)[0], 200)
        self.assertEqual(len(chamadas), 1)  # segunda consulta veio do cache
        self.assertTrue(chamadas[0].endswith("/api/cnpj/v1/19131243000197"))

    def test_erros(self):
        self.assertEqual(consultar("123", httpx.Response(200, json={}), [])[0], 400)
        self.assertEqual(consultar("11111111111111", httpx.Response(200, json={}), [])[0], 400)  # dígitos inválidos
        self.assertEqual(consultar("19131243000197", httpx.Response(404, json={}), [])[0], 404)
        self.assertEqual(consultar("19131243000197", httpx.Response(429, json={}), [])[0], 502)
        self.assertEqual(consultar("19131243000197", httpx.ConnectError("x"), [])[0], 502)


if __name__ == "__main__":
    unittest.main()
