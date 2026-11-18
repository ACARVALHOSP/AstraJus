"""Regras de distribuição de responsável: resolvedor, persistência, simular/aplicar, rotas e sugestão."""
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import automacoes
import cnj
import db
import notificacoes
import regras_responsavel as rr
import server
import usuarios_admin as u

ATIVOS = {"ana", "bia", "caio"}


def cnj_valido(n: int) -> str:
    base = f"{n:07d}2026826" + "0100"
    return base[:7] + cnj.calcular_dv(base[:7] + "00" + base[7:]) + base[7:]


def regra(tipo, valor="", responsavel="", ativo=True, id=None):
    return {"id": id, "tipo": tipo, "valor": valor, "responsavel": responsavel, "ativo": ativo}


class ResolvedorTest(unittest.TestCase):
    def resolver(self, regras, **contexto):
        return rr.resolver_responsavel(contexto, regras, ATIVOS)

    def test_primeira_que_casa_vence_e_o_padrao_fecha(self):
        regras = [regra("cliente", "c1", "ana", id=1), regra("classe", "execução", "bia", id=2), regra("padrao", "", "caio", id=3)]
        self.assertEqual(self.resolver(regras, cliente_ids=["c1"], classe="Execução de Título")["responsavel"], "ana")
        self.assertEqual(self.resolver(regras, cliente_ids=["c9"], classe="Execução de Título")["responsavel"], "bia")
        achado = self.resolver(regras, cliente_ids=["c9"], classe="Despejo")
        self.assertEqual((achado["responsavel"], achado["tipo"], achado["motivo"]), ("caio", "padrao", "Padrão do escritório"))

    def test_regra_de_cliente_acima_do_padrao_vence_o_padrao(self):
        regras = [regra("cliente", "c1", "ana"), regra("padrao", "", "bia")]
        self.assertEqual(self.resolver(regras, cliente_ids=["c1"])["responsavel"], "ana")

    def test_quem_captou_vale_na_posicao_em_que_esta(self):
        antes = [regra("captou"), regra("cliente", "c1", "ana")]
        depois = [regra("cliente", "c1", "ana"), regra("captou")]
        self.assertEqual(self.resolver(antes, captou="bia", cliente_ids=["c1"])["responsavel"], "bia")
        self.assertEqual(self.resolver(depois, captou="bia", cliente_ids=["c1"])["responsavel"], "ana")
        self.assertIsNone(self.resolver([regra("captou")], cliente_ids=["c1"]))            # ninguém captou

    def test_pessoa_inativa_e_regra_desligada_sao_puladas(self):
        regras = [regra("cliente", "c1", "fulano", id=1), regra("classe", "x", "ana", ativo=False, id=2), regra("padrao", "", "bia", id=3)]
        achado = self.resolver(regras, cliente_ids=["c1"], classe="x")
        self.assertEqual((achado["responsavel"], achado["regra_id"]), ("bia", 3))
        self.assertIsNone(self.resolver([regra("captou")], captou="fulano"))                # quem captou saiu da equipe

    def test_texto_sem_acento_e_sem_caixa_mas_tribunal_exige_igualdade(self):
        regras = [regra("classe", "Execucao", "ana"), regra("tribunal", "tjsp", "bia"), regra("orgao", "2ª vara", "caio")]
        self.assertEqual(self.resolver(regras, classe="EXECUÇÃO DE TÍTULO")["responsavel"], "ana")
        self.assertEqual(self.resolver(regras, tribunal="TJSP")["responsavel"], "bia")
        self.assertIsNone(self.resolver([regra("tribunal", "TJ", "bia")], tribunal="TJSP"))
        self.assertEqual(self.resolver(regras, orgao="2ª Vara Cível")["responsavel"], "caio")

    def test_sem_a_informacao_a_regra_nao_casa(self):
        regras = [regra("classe", "execução", "ana"), regra("tribunal", "TJSP", "bia"), regra("cliente", "c1", "caio")]
        self.assertIsNone(self.resolver(regras))
        self.assertIsNone(self.resolver([regra("assunto", "", "ana")], assunto="qualquer"))   # valor vazio nunca casa
        self.assertIsNone(self.resolver([]))

    def test_motivo_mostra_o_nome_do_cliente(self):
        achado = self.resolver([regra("cliente", "c1", "ana")], cliente_ids=["c1"], cliente_nomes={"c1": "Maria Teste"})
        self.assertEqual(achado["motivo"], "Cliente Maria Teste")


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.usuarios = db.RegistroUsuarios(self.caminho)
        for login in ("ana", "bia", "caio"):
            u.alterar(self.usuarios, dict(login=login, nome_completo=login.title(), email=f"{login}@teste.com"), "bootstrap")
        u.alterar(self.usuarios, dict(login="adm", nome_completo="Adm", email="adm@teste.com", nivel_acesso="administrador"), "bootstrap")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.registro_mon = db.RegistroMonitoramentos(self.caminho)
        self.publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        self.config = automacoes.Repositorio(self.caminho)
        self.regras = rr.Regras(self.caminho)
        self.agora = lambda: datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
        self.cliente = self.gestao.criar_cliente("Maria Teste", None, None, self.agora)
        self.ativos = set(self.usuarios.ativos())

    def caso(self, titulo="Ação A", responsavel=None, numero=None, cliente=None):
        c = (cliente or self.cliente)["id"]
        return self.gestao.criar_caso(c, titulo, responsavel, [numero] if numero else [], self.agora)

    def monitorar(self, usuario, mid="m1"):
        self.registro_mon.atualizar(lambda d: d.__setitem__(mid, {"usuario": usuario, "criterio": {"numero_oab": "1", "uf_oab": "SP"},
                                                                   "expira_em": "2027-06-01T00:00:00+00:00"}))
        return mid


class RegrasPersistenciaTest(_Base):
    def salvar(self, lista, ativa=True):
        return self.regras.salvar(lista, self.ativos, "adm", ativa)

    def test_grava_na_ordem_e_o_padrao_vai_para_o_fim(self):
        lista = self.salvar([regra("padrao", "", "bia"), regra("cliente", self.cliente["id"], "ana"), regra("captou")])
        self.assertEqual([r["tipo"] for r in lista], ["cliente", "captou", "padrao"])
        self.assertEqual([r["tipo"] for r in self.regras.listar()], ["cliente", "captou", "padrao"])

    def test_captou_ignora_valor_e_pessoa(self):
        self.salvar([regra("captou", "lixo", "ana")])
        self.assertEqual(self.regras.listar()[0], {"id": self.regras.listar()[0]["id"], "tipo": "captou", "valor": "", "responsavel": "", "ativo": True})

    def test_padrao_pode_ficar_sem_pessoa_e_e_so_um(self):
        self.salvar([regra("padrao", "", "")])
        self.assertEqual(self.regras.listar()[0]["responsavel"], "")
        with self.assertRaises(ValueError):
            self.salvar([regra("padrao", "", "ana"), regra("padrao", "", "bia")])

    def test_validacoes_e_tudo_ou_nada(self):
        self.salvar([regra("padrao", "", "bia")])
        invalidas = ([regra("nada")], [regra("classe", "", "ana")], [regra("classe", "x", "")], [regra("classe", "x", "fulano")],
                     [regra("classe", "x" * 201, "ana")], [regra("classe", "x", "ana", ativo="sim")], "lista", [1],
                     [regra("classe", "x", "ana")] * 51)
        for lista in invalidas:
            with self.assertRaises(ValueError, msg=str(lista)[:60]):
                self.salvar(lista)
        self.assertEqual([r["tipo"] for r in self.regras.listar()], ["padrao"])         # nada foi alterado

    def test_historico_so_quando_a_lista_muda(self):
        self.salvar([regra("padrao", "", "bia")])
        self.salvar([regra("padrao", "", "bia")])                                         # igual: não registra
        self.salvar([regra("padrao", "", "bia"), regra("classe", "x", "ana")])
        historico = [h for h in self.config.historico() if h["chave"] == "responsavel_regras"]
        self.assertEqual([(h["antes"]["regras"], h["depois"]["regras"]) for h in historico], [(1, 2), (0, 1)])


class AplicacaoTest(_Base):
    def regras_basicas(self):
        self.regras.salvar([regra("cliente", self.cliente["id"], "ana"), regra("padrao", "", "bia")], self.ativos, "adm", True)

    def test_definir_so_se_vazio_nunca_sobrescreve(self):
        sem, com = self.caso("Sem"), self.caso("Com", responsavel="caio")
        self.assertTrue(self.gestao.definir_responsavel_se_vazio(sem["id"], "ana"))
        self.assertFalse(self.gestao.definir_responsavel_se_vazio(sem["id"], "bia"))
        self.assertFalse(self.gestao.definir_responsavel_se_vazio(com["id"], "ana"))
        self.assertEqual((self.gestao.obter_caso(sem["id"])["responsavel"], self.gestao.obter_caso(com["id"])["responsavel"]), ("ana", "caio"))
        vazio = self.caso("Espaços", responsavel="   ")
        self.assertTrue(self.gestao.definir_responsavel_se_vazio(vazio["id"], "bia"))

    def test_sem_responsavel_considera_vazio_nulo_e_espacos(self):
        self.caso("A"), self.caso("B", responsavel=""), self.caso("C", responsavel="  "), self.caso("D", responsavel="ana")
        self.assertEqual(sorted(c["titulo"] for c in rr.sem_responsavel(self.gestao)), ["A", "B", "C"])

    def test_simular_nao_grava_nada(self):
        self.regras_basicas()
        caso = self.caso("Sem")
        itens = rr.simular(self.gestao, self.registro_mon, self.regras.listar(), self.ativos)
        self.assertEqual([(i["caso_id"], i["responsavel"], i["motivo"]) for i in itens], [(caso["id"], "ana", "Cliente Maria Teste")])
        self.assertIsNone(self.gestao.obter_caso(caso["id"])["responsavel"])
        self.assertIsNone(self.regras.aplicacao(caso["id"]))

    def test_aplicar_grava_audita_e_avisa_so_no_sino(self):
        self.regras_basicas()
        caso, outro = self.caso("Sem"), self.caso("Com", responsavel="caio")
        resultado = rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm", self.agora())
        self.assertEqual(resultado, {"aplicados": 1, "sem_regra": 0})
        self.assertEqual(self.gestao.obter_caso(caso["id"])["responsavel"], "ana")
        self.assertEqual(self.gestao.obter_caso(outro["id"])["responsavel"], "caio")              # nunca sobrescreve
        auditoria = self.regras.aplicacao(caso["id"])
        self.assertEqual((auditoria["responsavel"], auditoria["tipo"], auditoria["motivo"]), ("ana", "cliente", "Cliente Maria Teste"))
        feed = notificacoes.Repositorio(self.caminho, agora=self.agora).listar("ana")["notificacoes"]
        item = next(n for n in feed if n["tipo"] == "processo_atribuido")
        self.assertEqual((item["titulo"], item["destino"]), ("Processo atribuído a você", {"tipo": "processo", "caso_id": caso["id"]}))
        self.assertEqual(notificacoes.Repositorio(self.caminho, agora=self.agora).destino("ana", item["id"]),
                         {"tipo": "processo", "caso_id": caso["id"]})

    def test_aplicar_duas_vezes_e_sem_regra_que_case(self):
        self.regras.salvar([regra("classe", "inexistente", "ana")], self.ativos, "adm", True)
        self.caso("Sem")
        self.assertEqual(rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm"), {"aplicados": 0, "sem_regra": 1})
        self.regras_basicas()
        self.assertEqual(rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm")["aplicados"], 1)
        self.assertEqual(rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm"), {"aplicados": 0, "sem_regra": 0})

    def test_contexto_do_caso_usa_capa_clientes_e_quem_captou(self):
        numero = cnj_valido(5)
        caso = self.caso("Ação", numero=numero)
        self.gestao.salvar_capa_processo(caso["id"], numero, agora=self.agora, tribunal="TJSP", classe="Execução de Título",
                                         assuntos=["Dívida"], orgao_julgador="2ª Vara Cível")
        mid = self.monitorar("bia")
        self.publicacoes.registrar("h1", mid, "Nome", numero, {"x": 1}, "nao_tratada", caso["id"], self.agora)
        ctx = rr.contexto_do_caso(self.gestao, self.registro_mon, self.gestao.listar_casos()[0], {self.cliente["id"]: "Maria Teste"})
        self.assertEqual((ctx["captou"], ctx["classe"], ctx["tribunal"], ctx["orgao"], ctx["assunto"]),
                         ("bia", "Execução de Título", "TJSP", "2ª Vara Cível", "Dívida"))
        self.assertEqual(ctx["cliente_ids"], [self.cliente["id"]])

    def test_captou_vale_para_processo_existente_pela_publicacao_vinculada(self):
        numero = cnj_valido(6)
        caso = self.caso("Ação", numero=numero)
        mid = self.monitorar("caio")
        self.publicacoes.registrar("h2", mid, "Nome", numero, {"x": 1}, "nao_tratada", caso["id"], self.agora)
        self.regras.salvar([regra("captou")], self.ativos, "adm", True)
        rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm")
        self.assertEqual(self.gestao.obter_caso(caso["id"])["responsavel"], "caio")


class CriacaoTest(_Base):
    def criar(self, **extra):
        dados = {"cliente_id": self.cliente["id"], "titulo": "Nova", "numeros_processo": [], **extra.pop("dados", {})}
        return server._criar_caso_validado(self.gestao, dados, None, **extra)

    def setUp(self):
        super().setUp()
        self.regras.salvar([regra("cliente", self.cliente["id"], "ana"), regra("padrao", "", "bia")], self.ativos, "adm", True)

    def test_sem_ninguem_criando_e_com_a_rotina_ligada_vale_a_regra(self):
        self.config.definir("responsavel_regras", "adm", ativo=True)
        caso, erro = self.criar(contexto_regras={})
        self.assertIsNone(erro)
        self.assertEqual(caso["responsavel"], "ana")
        self.assertEqual(self.regras.aplicacao(caso["id"])["motivo"], "Cliente Maria Teste")

    def test_responsavel_escolhido_ou_quem_esta_criando_vence_a_regra(self):
        self.config.definir("responsavel_regras", "adm", ativo=True)
        self.assertEqual(self.criar(dados={"responsavel": "caio"}, contexto_regras={})[0]["responsavel"], "caio")
        caso, _ = self.criar(usuario_padrao="bia", contexto_regras={})
        self.assertEqual(caso["responsavel"], "bia")
        self.assertIsNone(self.regras.aplicacao(caso["id"]))

    def test_rotina_desligada_ou_sem_contexto_nao_aplica_regras(self):
        caso, _ = self.criar(contexto_regras={})                    # rotina desligada (padrão)
        self.assertIsNone(caso["responsavel"])
        self.config.definir("responsavel_regras", "adm", ativo=True)
        caso, _ = self.criar()                                      # chamada comum: sem contexto, como sempre foi
        self.assertIsNone(caso["responsavel"])


class RotasTest(_Base):
    async def chamar(self, path, token, metodo="GET", corpo=None, **app_extra):
        app = SimpleNamespace(registro=self.usuarios, admin_token="x", falhas=None, oauth=None, gestao=self.gestao,
                              registro_monitoramentos=self.registro_mon, **app_extra)
        scope = {"path": path, "method": metodo, "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1)}
        eventos = []

        async def send(e):
            eventos.append(e)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo).encode(), "more_body": False}

        await u.tratar(app, scope, receive, send, server)
        return eventos[0]["status"], json.loads(eventos[1]["body"])

    def setUp(self):
        super().setUp()
        self.admin = u.alterar(self.usuarios, dict(login="chefe", nome_completo="Chefe", email="chefe@teste.com",
                                                   nivel_acesso="administrador"), "bootstrap")["token"]
        self.comum = u.alterar(self.usuarios, dict(login="rui", nome_completo="Rui", email="rui@teste.com"), "bootstrap")["token"]

    def run_(self, *a, **k):
        return asyncio.run(self.chamar(*a, **k))

    def test_so_administrador(self):
        for caminho, metodo in (("/admin/automacoes/responsavel/regras", "GET"), ("/admin/automacoes/responsavel/regras", "PUT"),
                                ("/admin/automacoes/responsavel/simular", "POST"), ("/admin/automacoes/responsavel/aplicar", "POST")):
            self.assertEqual(self.run_(caminho, self.comum, metodo, {"regras": []})[0], 403, caminho)

    def test_ler_gravar_simular_e_aplicar(self):
        base = "/admin/automacoes/responsavel/"
        status, corpo = self.run_(base + "regras", self.admin)
        self.assertEqual((status, corpo["regras"], corpo["ativa"], corpo["sem_responsavel"]), (200, [], False, 0))
        caso = self.caso("Sem")
        status, corpo = self.run_(base + "regras", self.admin, "PUT", {"regras": [
            {"tipo": "cliente", "valor": self.cliente["id"], "responsavel": "ana"}, {"tipo": "padrao", "responsavel": "bia"}]})
        self.assertEqual((status, [r["tipo"] for r in corpo["regras"]], corpo["sem_responsavel"]), (200, ["cliente", "padrao"], 1))
        status, corpo = self.run_(base + "simular", self.admin, "POST")
        self.assertEqual((status, corpo["total"], corpo["itens"][0]["responsavel"]), (200, 1, "ana"))
        self.assertIsNone(self.gestao.obter_caso(caso["id"])["responsavel"])                    # simular não grava
        status, corpo = self.run_(base + "aplicar", self.admin, "POST")
        self.assertEqual((status, corpo), (200, {"aplicados": 1, "sem_regra": 0}))
        self.assertEqual(self.gestao.obter_caso(caso["id"])["responsavel"], "ana")

    def test_regra_com_pessoa_que_saiu_aparece_como_invalida(self):
        self.run_("/admin/automacoes/responsavel/regras", self.admin, "PUT", {"regras": [{"tipo": "classe", "valor": "x", "responsavel": "caio"}]})
        u.alterar(self.usuarios, {"status": "bloqueado"}, "bootstrap", "caio")
        _, corpo = self.run_("/admin/automacoes/responsavel/regras", self.admin)
        self.assertEqual([r["invalida"] for r in corpo["regras"]], [True])

    def test_pedido_invalido(self):
        self.assertEqual(self.run_("/admin/automacoes/responsavel/regras", self.admin, "PUT", {"regras": [{"tipo": "classe"}]})[0], 400)
        self.assertEqual(self.run_("/admin/automacoes/responsavel/regras", self.admin, "PUT", [1])[0], 400)
        self.assertEqual(self.run_("/admin/automacoes/responsavel/nada", self.admin)[0], 405)

    def test_historico_da_tela_conta_a_mudanca_de_regras(self):
        self.run_("/admin/automacoes/responsavel/regras", self.admin, "PUT", {"regras": [{"tipo": "padrao", "responsavel": "bia"}]})
        _, lista = self.run_("/admin/automacoes/api", self.admin)
        self.assertEqual(lista["historico"][0]["chave"], "responsavel_regras")


class SugestaoEDetalheTest(_Base):
    def chamar(self, caminho, token):
        app = server._AutenticacaoBearer(None, self.usuarios, gestao=self.gestao, publicacoes=self.publicacoes,
                                         registro_monitoramentos=self.registro_mon)
        saida = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(e):
            saida.append(e)

        path, _, consulta = caminho.partition("?")
        scope = {"type": "http", "path": path, "query_string": consulta.encode(), "method": "GET",
                 "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1)}
        asyncio.run(app(scope, receive, send))
        bruto = b"".join(e.get("body", b"") for e in saida[1:])
        try:
            return saida[0]["status"], json.loads(bruto or b"{}")
        except ValueError:
            return saida[0]["status"], bruto.decode()

    def setUp(self):
        super().setUp()
        _, _, self.token = server._criar_usuario_core(self.usuarios, "tiago@teste.com")
        self.regras.salvar([regra("captou"), regra("cliente", self.cliente["id"], "ana"), regra("padrao", "", "bia")], self.ativos, "adm", True)

    def test_rotina_desligada_nao_sugere(self):
        self.assertEqual(self.chamar("/responsaveis/sugestao?cliente_id=" + self.cliente["id"], self.token), (200, {}))

    def test_sugere_pelo_cliente_e_por_quem_captou(self):
        self.config.definir("responsavel_regras", "adm", ativo=True)
        status, corpo = self.chamar("/responsaveis/sugestao?cliente_id=" + self.cliente["id"], self.token)
        self.assertEqual((status, corpo), (200, {"responsavel": "ana", "motivo": "Cliente Maria Teste"}))
        mid = self.monitorar("caio")
        numero = cnj_valido(9)
        self.publicacoes.registrar("hp", mid, "Nome", numero, {"nomeClasse": "Execução"}, "nao_tratada", None, self.agora)
        _, corpo = self.chamar(f"/responsaveis/sugestao?publicacao=hp&cliente_id={self.cliente['id']}", self.token)
        self.assertEqual((corpo["responsavel"], corpo["motivo"]), ("caio", "Quem captou a publicação"))     # "captou" está primeiro
        self.assertEqual(self.chamar("/responsaveis/sugestao", self.token)[1]["responsavel"], "bia")          # só o padrão
        self.assertEqual(self.chamar("/responsaveis/sugestao", "invalido")[0], 401)

    def test_detalhe_do_processo_mostra_de_onde_veio_o_responsavel(self):
        caso = self.caso("Sem")
        self.assertIsNone(self.chamar(f"/casos/{caso['id']}", self.token)[1]["responsavel_regra"])
        rr.aplicar(self.gestao, self.registro_mon, self.regras.listar(), self.ativos, "adm")
        corpo = self.chamar(f"/casos/{caso['id']}", self.token)[1]
        self.assertEqual((corpo["responsavel"], corpo["responsavel_regra"]["motivo"]), ("ana", "Cliente Maria Teste"))
        self.gestao.atualizar_caso(caso["id"], "Sem", "caio", None, None, None, None, None)           # alguém trocou à mão
        self.assertIsNone(self.chamar(f"/casos/{caso['id']}", self.token)[1]["responsavel_regra"])


if __name__ == "__main__":
    unittest.main()
