"""Filtros, ordenação e contagens da listagem de Publicações OAB (GET /publicacoes-oab)."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

import db
import server
from test_unit import _rodar


def _chamar_asgi(middleware, metodo, url, headers=()):
    """GET simulado com query string separada do caminho, como faz o servidor ASGI."""
    caminho, _, consulta = url.partition("?")
    respostas = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    scope = {"type": "http", "method": metodo, "path": caminho, "query_string": consulta.encode(),
             "headers": list(headers)}
    _rodar(middleware(scope, receive, send))
    return respostas[0]["status"], b"".join(m.get("body", b"") for m in respostas[1:])


def _dados(dia, tipo, partes, texto="", orgao="1ª Vara Cível"):
    return {"data_disponibilizacao": dia, "tipoComunicacao": tipo, "nomeOrgao": orgao, "nomeClasse": "Procedimento comum",
            "texto": texto, "destinatarios": [{"nome": p, "polo": "A"} for p in partes],
            "destinatarioadvogados": [{"nome": "Ana Exemplo", "numero_oab": "123456", "uf_oab": "SP"}]}


class PublicacoesFiltrosTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        caminho = self.tmp / "teste.db"
        self.gestao = db.RegistroClientesCasos(caminho)
        self.pubs = db.RegistroPublicacoesOAB(caminho)
        agora = lambda: datetime(2026, 11, 7, 8, tzinfo=timezone.utc)
        cliente = self.gestao.criar_cliente("Maria Teste", None, None, agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Execução de Título", "ana", ["10056789020268260100"], agora)
        registros = [
            ("h1", "10012345620268260100", _dados("2026-11-07", "Intimação", ["Maria Aparecida"], "manifestar sobre 100% do valor"), "nao_tratada", None),
            ("h2", "10056789020268260100", _dados("2026-11-06", "Citação", ["Construtora Exemplo"]), "nao_tratada", self.caso["id"]),
            ("h3", "00123456720255020001", _dados("2026-11-05", "Intimação", ["Carla Souza"], orgao="TRT2"), "tratada", None),
            ("h4", "10033334420238260100", _dados("2026-11-01", "Edital", ["Interessados"]), "arquivada", None),
        ]
        for h, numero, dados, status, caso_id in registros:
            self.pubs.registrar(h, None, "Ana Exemplo", numero, dados, status, caso_id, agora)

    def hashes(self, **kw):
        return [p["hash"] for p in self.pubs.listar(**kw)]

    def test_ordem_padrao_e_invertida(self):
        self.assertEqual(self.hashes(), ["h1", "h2", "h3", "h4"])
        self.assertEqual(self.hashes(ordem="divulgado_asc"), ["h4", "h3", "h2", "h1"])

    def test_filtros_tipo_periodo_e_busca(self):
        self.assertEqual(self.hashes(tipo="intimação"), ["h1", "h3"])
        self.assertEqual(self.hashes(desde="2026-11-05", ate="2026-11-06"), ["h2", "h3"])
        self.assertEqual(self.hashes(busca="construtora"), ["h2"])
        self.assertEqual(self.hashes(busca="1005678-90.2026"), ["h2"])
        self.assertEqual(self.hashes(busca="trt2"), ["h3"])
        # Curingas do LIKE são literais e nomes de campos do JSON não casam.
        self.assertEqual(self.hashes(busca="100%"), ["h1"])
        self.assertEqual(self.hashes(busca="destinatarios"), [])
        self.assertEqual(self.pubs.contar(tipo="Intimação", busca="carla"), 1)

    def test_contagem_por_status_respeita_filtros_e_titulo_do_caso(self):
        self.assertEqual(self.pubs.contar_por_status(), {"arquivada": 1, "nao_tratada": 2, "tratada": 1})
        self.assertEqual(self.pubs.contar_por_status(tipo="Intimação"), {"arquivada": 0, "nao_tratada": 1, "tratada": 1})
        self.assertEqual(self.pubs.tipos_disponiveis(), ["Citação", "Edital", "Intimação"])
        por_hash = {p["hash"]: p for p in self.pubs.listar()}
        self.assertEqual(por_hash["h2"]["caso_titulo"], "Execução de Título")
        self.assertIsNone(por_hash["h1"]["caso_titulo"])

    def test_endpoint_aceita_filtros_e_valida_parametros(self):
        registro = server.RegistroUsuarios(self.tmp / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        token = saida.getvalue().strip().splitlines()[-1]
        mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao, publicacoes=self.pubs)
        auth = [(b"authorization", ("Bearer " + token).encode())]
        status, corpo = _chamar_asgi(mw, "GET", "/publicacoes-oab?status=nao_tratada&tipo=Cita%C3%A7%C3%A3o&ordem=divulgado_asc", headers=auth)
        self.assertEqual(status, 200)
        dados = json.loads(corpo)
        self.assertEqual([p["hash"] for p in dados["publicacoes"]], ["h2"])
        self.assertEqual(dados["contagem_status"], {"arquivada": 0, "nao_tratada": 1, "tratada": 0})
        self.assertIn("Edital", dados["tipos_disponiveis"])
        self.assertEqual(_chamar_asgi(mw, "GET", "/publicacoes-oab?ordem=xyz", headers=auth)[0], 400)
        self.assertEqual(_chamar_asgi(mw, "GET", "/publicacoes-oab?desde=07/11/2026", headers=auth)[0], 400)


if __name__ == "__main__":
    unittest.main()
