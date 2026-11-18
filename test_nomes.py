"""Normalização de nomes: regra única (casos compartilhados com o frontend), saneamento em lote, desfazer e rotas."""
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import db
import nomes
import server
import usuarios_admin as u

CASOS = json.loads((Path(__file__).parent / "frontend" / "tests" / "casos-nomes.json").read_text(encoding="utf-8"))


class RegraTest(unittest.TestCase):
    def test_casos_de_referencia(self):
        for entrada, esperado in CASOS:
            self.assertEqual(nomes.normalizar(entrada), esperado, entrada)

    def test_idempotente_e_caixa_mista_intacta(self):
        for entrada, _ in CASOS:
            uma = nomes.normalizar(entrada)
            self.assertEqual(nomes.normalizar(uma), uma, entrada)
        self.assertFalse(nomes.precisa_normalizar("Maria da SILVA"))
        self.assertTrue(nomes.precisa_normalizar("MARIA"))
        self.assertTrue(nomes.precisa_normalizar("maria"))
        self.assertFalse(nomes.precisa_normalizar("123"))
        self.assertIsNone(nomes.normalizar(None))

    def test_excecoes_valem_para_uma_ou_varias_palavras(self):
        self.assertEqual(nomes.normalizar("IFOOD AGENCIA LTDA", ["iFood"]), "iFood Agencia Ltda")
        self.assertEqual(nomes.normalizar("XP INVESTIMENTOS S/A", ["XP Investimentos"]), "XP Investimentos S/A")
        self.assertEqual(nomes.normalizar("MARIA DA SILVA", ["iFood"]), "Maria da Silva")
        self.assertEqual(nomes.normalizar("BRFX SA", ["BRF"]), "Brfx SA")                 # só palavra inteira

    def test_dobrar_ignora_acento_caixa_e_espacos(self):
        self.assertEqual(nomes.dobrar("  JOSÉ   da Silva "), nomes.dobrar("José da  silva"))


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "t.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.nomes = nomes.Nomes(self.caminho)
        self.agora = lambda: datetime(2026, 11, 18, 12, tzinfo=timezone.utc)

    def cliente(self, nome):
        return self.gestao.criar_cliente(nome, None, None, self.agora)

    def caso(self, cliente, titulo):
        return self.gestao.criar_caso(cliente["id"], titulo, None, [], self.agora)


class SaneamentoTest(_Base):
    def test_verificar_lista_so_o_que_muda(self):
        maria = self.cliente("MARIA DA SILVA")
        self.cliente("João Souza")
        self.caso(maria, "MARIA DA SILVA X BANCO X S/A")
        self.caso(maria, "Título digitado à mão")
        r = self.nomes.verificar()
        self.assertEqual({(i["tipo"], i["antes"], i["depois"]) for i in r["itens"]},
                         {("cliente", "MARIA DA SILVA", "Maria da Silva"), ("caso", "MARIA DA SILVA X BANCO X S/A", "Maria da Silva X Banco X S/A")})
        self.assertEqual((r["total"], r["duplicados"]), (2, 0))

    def test_aplicar_grava_anterior_e_e_idempotente(self):
        c = self.cliente("MARIA DA SILVA")
        r = self.nomes.aplicar("adm", [{"tipo": "cliente", "id": c["id"]}])
        self.assertEqual(r, {"aplicados": 1, "ignorados": 0})
        self.assertEqual(self.gestao.obter_cliente(c["id"])["nome"], "Maria da Silva")
        self.assertEqual(self.nomes.aplicar("adm", todos=True), {"aplicados": 0, "ignorados": 0})
        self.assertEqual([(a["antes"], a["depois"], a["aplicado_por"]) for a in self.nomes.aplicados()], [("MARIA DA SILVA", "Maria da Silva", "adm")])

    def test_aplicar_so_o_que_foi_marcado_e_ignora_o_que_mudou(self):
        a, b = self.cliente("ANA SOUZA"), self.cliente("BIA SOUZA")
        self.nomes.aplicar("adm", [{"tipo": "cliente", "id": a["id"]}, {"tipo": "cliente", "id": "inexistente"}])
        self.assertEqual(self.gestao.obter_cliente(a["id"])["nome"], "Ana Souza")
        self.assertEqual(self.gestao.obter_cliente(b["id"])["nome"], "BIA SOUZA")        # não marcado: intacto
        r = self.nomes.aplicar("adm", [{"tipo": "cliente", "id": a["id"]}])            # já normalizado: ignorado
        self.assertEqual((r["aplicados"], r["ignorados"]), (0, 1))

    def test_duplicado_fica_marcado_e_fora_do_todos(self):
        existente = self.cliente("Maria da Silva")
        dup = self.cliente("MARIA DA SILVA")
        item = next(i for i in self.nomes.verificar()["itens"] if i["id"] == dup["id"])
        self.assertTrue(item["duplicado"])
        self.assertEqual(self.nomes.aplicar("adm", todos=True)["aplicados"], 0)
        self.assertEqual(self.gestao.obter_cliente(dup["id"])["nome"], "MARIA DA SILVA")
        self.assertEqual(self.gestao.obter_cliente(existente["id"])["nome"], "Maria da Silva")
        # marcado à mão pela pessoa, aplica (decisão consciente)
        self.assertEqual(self.nomes.aplicar("adm", [{"tipo": "cliente", "id": dup["id"]}])["aplicados"], 1)

    def test_desfazer_restaura_e_recusa_se_foi_editado(self):
        a, b = self.cliente("ANA SOUZA"), self.cliente("BIA SOUZA")
        self.nomes.aplicar("adm", todos=True)
        ids = {x["alvo_id"]: x["id"] for x in self.nomes.aplicados()}
        self.gestao.atualizar_cliente(b["id"], "Beatriz Souza", None, None)               # alguém editou depois
        r = self.nomes.desfazer([ids[a["id"]], ids[b["id"]], 9999, "x"], "adm")
        self.assertEqual(r, {"desfeitos": 1, "ignorados": 2})
        self.assertEqual(self.gestao.obter_cliente(a["id"])["nome"], "ANA SOUZA")
        self.assertEqual(self.gestao.obter_cliente(b["id"])["nome"], "Beatriz Souza")
        self.assertEqual(self.nomes.desfazer([ids[a["id"]]], "adm")["desfeitos"], 0)       # não desfaz duas vezes

    def test_nao_toca_documento_nem_o_resto_do_cadastro(self):
        c = self.gestao.criar_cliente("MARIA DA SILVA", "123.456.789-09", "OBS EM MAIÚSCULAS", self.agora)
        self.nomes.aplicar("adm", todos=True)
        depois = self.gestao.obter_cliente(c["id"])
        self.assertEqual((depois["nome"], depois["cpf_cnpj"], depois["observacoes"]), ("Maria da Silva", "123.456.789-09", "OBS EM MAIÚSCULAS"))

    def test_excecoes_persistem_e_entram_na_previa(self):
        self.assertEqual(self.nomes.salvar_excecoes([" iFood ", "ifood", "", "XP Investimentos"]), ["iFood", "XP Investimentos"])
        self.cliente("IFOOD LTDA")
        self.assertEqual(self.nomes.verificar()["itens"][0]["depois"], "iFood Ltda")
        for ruim in ("x", [1], ["a"] * 201 and [str(i) for i in range(201)], ["y" * 101]):
            with self.assertRaises(ValueError):
                self.nomes.salvar_excecoes(ruim)

    def test_busca_de_cliente_por_nome_ignora_acento_e_caixa(self):
        c = self.cliente("José da Silva")
        self.assertEqual(self.gestao.buscar_cliente_por_nome("JOSÉ DA SILVA")["id"], c["id"])
        self.assertEqual(self.gestao.buscar_cliente_por_nome("jose da silva")["id"], c["id"])
        self.assertIsNone(self.gestao.buscar_cliente_por_nome("José da Silva Junior"))


class CriacaoPorPublicacaoTest(_Base):
    def test_titulo_e_cliente_novo_saem_normalizados_e_partes_ficam(self):
        self.nomes.salvar_excecoes(["iFood"])
        pub = {"numero_processo": "00000012620268260100", "nome_pesquisado": "ANA PEREIRA", "dados": {
            "destinatarios": [{"nome": "ANA PEREIRA", "polo": "A"}, {"nome": "IFOOD LTDA", "polo": "P"}], "nomeClasse": "X", "nomeOrgao": "Y"}}
        import cnj
        base = "00000012026826" + "0100"
        pub["numero_processo"] = base[:7] + cnj.calcular_dv(base[:7] + "00" + base[7:]) + base[7:]
        pub["hash"] = "h1"
        publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        publicacoes.registrar("h1", "m1", "ANA PEREIRA", pub["numero_processo"], pub["dados"], "nao_tratada", None, self.agora)
        caso, erro = server._criar_caso_de_publicacao(self.gestao, publicacoes, pub, {})
        self.assertIsNone(erro)
        self.assertEqual(self.gestao.obter_caso(caso["id"])["titulo"], "Ana Pereira X iFood Ltda")
        self.assertEqual(self.gestao.obter_cliente(caso["cliente_id"])["nome"], "Ana Pereira")


class RotasTest(_Base):
    def setUp(self):
        super().setUp()
        self.usuarios = db.RegistroUsuarios(self.caminho)
        self.admin = u.alterar(self.usuarios, dict(login="chefe", nome_completo="Chefe", email="chefe@teste.com", nivel_acesso="administrador"), "bootstrap")["token"]
        self.comum = u.alterar(self.usuarios, dict(login="rui", nome_completo="Rui", email="rui@teste.com"), "bootstrap")["token"]

    def chamar(self, path, token, metodo="GET", corpo=None):
        async def rodar():
            app = SimpleNamespace(registro=self.usuarios, admin_token="x", falhas=None, oauth=None, gestao=self.gestao)
            scope = {"path": path, "method": metodo, "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1)}
            ev = []

            async def send(e):
                ev.append(e)

            async def receive():
                return {"type": "http.request", "body": json.dumps(corpo).encode(), "more_body": False}

            await u.tratar(app, scope, receive, send, server)
            return ev[0]["status"], json.loads(ev[1]["body"])
        return asyncio.run(rodar())

    def test_so_administrador(self):
        for caminho, metodo in (("/admin/nomes/verificar", "GET"), ("/admin/nomes/aplicar", "POST"), ("/admin/nomes/desfazer", "POST"), ("/admin/nomes/excecoes", "GET")):
            self.assertEqual(self.chamar(caminho, self.comum, metodo, {})[0], 403, caminho)

    def test_fluxo_verificar_aplicar_desfazer_e_excecoes(self):
        c = self.cliente("MARIA DA SILVA")
        status, corpo = self.chamar("/admin/nomes/verificar", self.admin)
        self.assertEqual((status, corpo["total"], corpo["itens"][0]["depois"], corpo["aplicados"]), (200, 1, "Maria da Silva", []))
        self.assertEqual(self.chamar("/admin/nomes/aplicar", self.admin, "POST", {"itens": [{"tipo": "cliente", "id": c["id"]}]})[1], {"aplicados": 1, "ignorados": 0})
        _, corpo = self.chamar("/admin/nomes/verificar", self.admin)
        self.assertEqual((corpo["total"], len(corpo["aplicados"])), (0, 1))
        self.assertEqual(self.chamar("/admin/nomes/desfazer", self.admin, "POST", {"ids": [corpo["aplicados"][0]["id"]]})[1], {"desfeitos": 1, "ignorados": 0})
        self.assertEqual(self.gestao.obter_cliente(c["id"])["nome"], "MARIA DA SILVA")
        self.assertEqual(self.chamar("/admin/nomes/excecoes", self.admin, "PUT", {"excecoes": ["iFood"]})[1], {"excecoes": ["iFood"]})
        self.assertEqual(self.chamar("/admin/nomes/excecoes", self.admin)[1], {"excecoes": ["iFood"]})

    def test_rota_alcanca_o_despachante_do_servidor(self):
        """Passa pelo middleware real (o despachante só encaminha prefixos conhecidos para usuarios_admin)."""
        self.cliente("MARIA DA SILVA")
        app = server._AutenticacaoBearer(None, self.usuarios, gestao=self.gestao)
        saida = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(e):
            saida.append(e)

        scope = {"type": "http", "path": "/admin/nomes/verificar", "query_string": b"", "method": "GET",
                 "headers": [(b"authorization", f"Bearer {self.admin}".encode())], "client": ("127.0.0.1", 1)}
        asyncio.run(app(scope, receive, send))
        self.assertEqual(saida[0]["status"], 200)
        self.assertEqual(json.loads(saida[1]["body"])["total"], 1)

    def test_pedido_invalido(self):
        self.assertEqual(self.chamar("/admin/nomes/desfazer", self.admin, "POST", {"ids": "x"})[0], 400)
        self.assertEqual(self.chamar("/admin/nomes/excecoes", self.admin, "PUT", {"excecoes": "x"})[0], 400)
        self.assertEqual(self.chamar("/admin/nomes/nada", self.admin)[0], 405)


if __name__ == "__main__":
    unittest.main()
