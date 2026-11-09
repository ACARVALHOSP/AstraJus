import asyncio
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

import httpx

import db
import server


def dados(texto="Intimação", *partes):
    return {"data_disponibilizacao": "2026-11-06", "tipoComunicacao": "Intimação", "nomeOrgao": "2ª Vara", "texto": texto,
            "destinatarios": [{"nome": n, "polo": p} for n, p in partes], "destinatarioadvogados": []}


class PolosBancoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.caminho = self.tmp / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.pub = db.RegistroPublicacoesOAB(self.caminho)
        self.agora = lambda: datetime(2026, 11, 9, tzinfo=timezone.utc)
        self.maria = self.gestao.criar_cliente("Maria das Graças Souza Lima", "123.456.789-09", None, self.agora)
        self.banco = self.gestao.criar_cliente("Banco Alfa S.A.", None, None, self.agora, detalhes={"perfil": "contato"})
        self.caso = self.gestao.criar_caso(self.maria["id"], "Maria x Banco", None, ["10063142720238260005"], self.agora)
        self.numero = "10063142720238260005"

    def registrar(self, h, partes, caso_id=None):
        self.pub.registrar(h, None, "Ana", self.numero, dados("x", *partes), "nao_tratada", caso_id, self.agora)

    def test_polo_vem_da_capa_e_pode_ser_corrigido(self):
        self.assertEqual(self.gestao.obter_caso(self.caso["id"])["polos"],
                         [{"cliente_id": self.maria["id"], "nome": "Maria das Graças Souza Lima", "polo": None, "origem": None}])
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, tribunal="TJSP",
                                         partes=[{"nome": "MARIA DAS GRACAS SOUZA LIMA", "polo": "P"}, {"nome": "Banco Alfa S.A.", "polo": "A"}])
        polo = self.gestao.obter_caso(self.caso["id"])["polos"][0]
        self.assertEqual((polo["polo"], polo["origem"]), ("passivo", "automatico"))
        self.assertTrue(self.gestao.definir_polo(self.caso["id"], self.maria["id"], "ativo", self.agora))
        polo = self.gestao.obter_caso(self.caso["id"])["polos"][0]
        self.assertEqual((polo["polo"], polo["origem"]), ("ativo", "manual"))
        self.assertEqual([c for c in self.gestao.listar_casos() if c["id"] == self.caso["id"]][0]["polos"][0]["polo"], "ativo")
        self.assertTrue(self.gestao.definir_polo(self.caso["id"], self.maria["id"], None, self.agora))      # volta ao automático
        self.assertEqual(self.gestao.obter_caso(self.caso["id"])["polos"][0]["origem"], "automatico")
        self.assertFalse(self.gestao.definir_polo(self.caso["id"], "outro-cliente", "ativo", self.agora))   # não é do processo
        with self.assertRaises(ValueError):
            self.gestao.definir_polo(self.caso["id"], self.maria["id"], "autor", self.agora)

    def test_polo_pelas_publicacoes_vinculadas(self):
        self.registrar("p1", [("Maria das Graças Souza Lima", "A")], self.caso["id"])
        self.assertEqual(self.gestao.obter_caso(self.caso["id"])["polos"][0]["polo"], "ativo")

    def test_destino_das_publicacoes(self):
        self.registrar("vinc", [("MARIA DAS GRACAS SOUZA LIMA", "P")], self.caso["id"])
        self.registrar("contraria", [("Banco Alfa S.A.", "A")], self.caso["id"])
        self.registrar("livre", [("Maria das Graças Souza Lima", "A")])           # sem vínculo: vale qualquer cliente
        self.registrar("parcial", [("Maria Souza Lima", "A")])                     # nome parcial: não reconhece
        self.registrar("contato", [("Banco Alfa S.A.", "P")])                      # contato não é cliente
        # a 'vinc' define o polo passivo da Maria; 'contraria' é do polo ativo, oposto
        d = {p["hash"]: p["destino"] for p in self.pub.listar()}
        self.assertEqual(d["vinc"]["tipo"], "cliente")
        self.assertEqual((d["vinc"]["clientes"][0]["nome"], d["vinc"]["clientes"][0]["polo"]), ("Maria das Graças Souza Lima", "passivo"))
        self.assertEqual(d["contraria"], {"tipo": "contraria", "clientes": []})
        self.assertEqual((d["livre"]["tipo"], d["livre"]["clientes"][0]["polo"]), ("cliente", "ativo"))
        self.assertIsNone(d["parcial"])
        self.assertIsNone(d["contato"])

    def test_prioridade_e_contagem(self):
        self.registrar("a_comum", [("Fulano de Tal", "P")])
        self.registrar("b_cliente", [("Maria das Graças Souza Lima", "P")])
        self.registrar("c_comum", [("Beltrano", "P")])
        self.assertEqual(self.pub.hashes_para_clientes("nao_tratada"), ["b_cliente"])
        self.assertEqual(self.pub.listar("nao_tratada", ordem="prioridade")[0]["hash"], "b_cliente")
        self.assertEqual(self.pub.listar("tratada", ordem="prioridade"), [])

    def test_endpoint(self):
        registro = server.RegistroUsuarios(self.tmp / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            server._criar_usuario(registro, "ana")
        token = saida.getvalue().strip().splitlines()[-1]
        self.registrar("p1", [("Maria das Graças Souza Lima", "P")], self.caso["id"])
        mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao, publicacoes=self.pub)

        async def chamar(metodo, rota, corpo=None):
            http = httpx.AsyncClient(transport=httpx.ASGITransport(mw), base_url="http://t")
            r = await http.request(metodo, rota, json=corpo, headers={"Authorization": "Bearer " + token})
            try:
                return r.status_code, r.json()
            except ValueError:
                return r.status_code, r.text
        status, r = asyncio.run(chamar("PUT", f"/casos/{self.caso['id']}/polos", {"cliente_id": self.maria["id"], "polo": "terceiro"}))
        self.assertEqual((status, r["polos"][0]["polo"], r["polos"][0]["origem"]), (200, "terceiro", "manual"))
        self.assertEqual(asyncio.run(chamar("PUT", f"/casos/{self.caso['id']}/polos", {"cliente_id": self.maria["id"], "polo": "xyz"}))[0], 400)
        self.assertEqual(asyncio.run(chamar("PUT", f"/casos/{self.caso['id']}/polos", {"cliente_id": "nada", "polo": "ativo"}))[0], 404)
        self.assertEqual(asyncio.run(chamar("GET", f"/casos/{self.caso['id']}/polos"))[0], 405)
        status, r = asyncio.run(chamar("GET", "/publicacoes-oab?status=nao_tratada&ordem=prioridade"))
        self.assertEqual((status, r["destinadas_a_clientes"], r["publicacoes"][0]["destino"]["tipo"]), (200, 1, "cliente"))
        status, r = asyncio.run(chamar("GET", f"/casos/{self.caso['id']}"))
        self.assertEqual(r["polos"][0]["polo"], "terceiro")


if __name__ == "__main__":
    unittest.main()
