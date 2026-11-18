"""Autocadastro de processos como rascunho."""
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import autocadastro
import automacoes
import cnj
import db
import notificacoes
import regras_responsavel as rr
import server
import usuarios_admin as u


def cnj_valido(n: int) -> str:
    base = f"{n:07d}2026826" + "0100"
    return base[:7] + cnj.calcular_dv(base[:7] + "00" + base[7:]) + base[7:]


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "t.db"
        self.usuarios = db.RegistroUsuarios(self.caminho)
        for login in ("ana", "bia"):
            u.alterar(self.usuarios, dict(login=login, nome_completo=login.title(), email=f"{login}@teste.com"), "bootstrap")
        self.admin = u.alterar(self.usuarios, dict(login="chefe", nome_completo="Chefe", email="chefe@teste.com", nivel_acesso="administrador"), "bootstrap")["token"]
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.mon = db.RegistroMonitoramentos(self.caminho)
        self.pubs = db.RegistroPublicacoesOAB(self.caminho)
        self.auto = autocadastro.Autocadastro(self.caminho)
        self.agora = datetime(2026, 11, 18, 15, tzinfo=timezone.utc)
        self.cliente = self.gestao.criar_cliente("Maria Teste", None, None, lambda: self.agora)
        self.mon.atualizar(lambda d: d.__setitem__("m1", {"usuario": "ana", "criterio": {"numero_oab": "1", "uf_oab": "SP"}, "expira_em": "2027-06-01T00:00:00+00:00"}))
        self.n = 0

    def publicar(self, nome="MARIA TESTE", numero=None, mid="m1", extra=None, polo="A"):
        self.n += 1
        numero = numero or cnj_valido(100 + self.n)
        dados = {"destinatarios": [{"nome": nome, "polo": polo}, {"nome": "BANCO X S/A", "polo": "P"}], "nomeClasse": "EXECUÇÃO", "nomeOrgao": "1ª Vara",
                 "siglaTribunal": "TJSP", **(extra or {})}
        self.pubs.registrar(f"h{self.n}", mid, nome, numero, dados, "nao_tratada", None, lambda: self.agora)
        return f"h{self.n}", numero

    def criar(self):
        return lambda pub, cid: server._criar_caso_de_publicacao(
            self.gestao, self.pubs, pub, {"cliente_id": cid}, None, rascunho=True,
            contexto_regras=rr.contexto_da_publicacao(self.mon, pub, None, [cid]))

    def rodar(self, limite=20):
        return self.auto.executar(self.gestao, self.pubs, self.mon, self.criar(), limite, self.agora)


class CandidatasTest(_Base):
    def achar(self):
        return self.auto.candidatas(self.gestao, self.pubs, self.mon)

    def test_cliente_unico_reconhecido(self):
        h, n = self.publicar()
        a = self.achar()
        self.assertEqual([(x["publicacao"]["hash"], x["numero"], x["cliente"], x["motivo"]) for x in a], [(h, n, "Maria Teste", "nome igual")])

    def test_por_cpf_o_motivo_e_cpf(self):
        self.gestao.atualizar_cliente(self.cliente["id"], "Maria Teste", "123.456.789-09", None)
        self.n += 1
        numero = cnj_valido(300)
        self.pubs.registrar("hc", "m1", "X", numero, {"destinatarios": [{"nome": "OUTRO NOME", "cpf_cnpj": "12345678909", "polo": "A"}]}, "nao_tratada", None, lambda: self.agora)
        self.assertEqual(self.achar()[0]["motivo"], "CPF/CNPJ igual")

    def test_nao_cria_sem_reconhecer_ou_ambiguo(self):
        self.publicar(nome="FULANO DESCONHECIDO")
        self.assertEqual(self.achar(), [])
        self.gestao.criar_cliente("Maria Teste", None, None, lambda: self.agora)          # homônimo: dois cadastros
        self.publicar()
        self.assertEqual(self.achar(), [])

    def test_dois_clientes_diferentes_na_mesma_publicacao_nao_cria(self):
        self.gestao.criar_cliente("Joao Teste", None, None, lambda: self.agora)
        self.n += 1
        self.pubs.registrar("hd", "m1", "X", cnj_valido(400), {"destinatarios": [{"nome": "MARIA TESTE", "polo": "A"}, {"nome": "JOAO TESTE", "polo": "A"}]},
                            "nao_tratada", None, lambda: self.agora)
        self.assertEqual(self.achar(), [])

    def test_condicoes_da_publicacao(self):
        self.publicar(numero="123")                                   # número inválido
        h_mon, _ = self.publicar(mid="outro")                          # monitoramento que não é de OAB
        h_caso, n_caso = self.publicar()
        self.gestao.criar_caso(self.cliente["id"], "Já cadastrado", None, [n_caso], lambda: self.agora)   # processo já cadastrado
        h_vinc, _ = self.publicar()
        outro = self.gestao.criar_caso(self.cliente["id"], "Outro", None, [], lambda: self.agora)
        self.pubs.vincular_caso(h_vinc, outro["id"])                   # já vinculada
        h_arq, _ = self.publicar()
        self.pubs.atualizar_status([h_arq], "arquivada")                # silenciada/arquivada
        achadas = {x["publicacao"]["hash"] for x in self.achar()}
        self.assertNotIn(h_mon, achadas)
        self.assertNotIn(h_caso, achadas)
        self.assertNotIn(h_vinc, achadas)
        self.assertNotIn(h_arq, achadas)

    def test_dois_publicacoes_do_mesmo_processo_geram_um_candidato(self):
        n = cnj_valido(500)
        self.publicar(numero=n)
        self.publicar(numero=n)
        self.assertEqual(len(self.achar()), 1)


class ExecucaoTest(_Base):
    def test_cria_rascunho_fora_das_listas_e_publicacao_segue_na_fila(self):
        h, n = self.publicar()
        r = self.rodar()
        self.assertEqual(r, {"criados": 1, "falhas": 0})
        caso = self.gestao.listar_casos("rascunhos")[0]
        self.assertEqual((caso["status"], caso["cliente_id"], caso["processos"]), ("rascunho", self.cliente["id"], [n]))
        self.assertEqual(self.gestao.listar_casos(), [])                                   # fora de Processos, parado, regras
        self.assertEqual(len(self.gestao.listar_casos("todos")), 1)
        pub = next(p for p in self.pubs.listar(status="nao_tratada") if p["hash"] == h)    # continua na fila, vinculada
        self.assertEqual(pub["caso_id"], caso["id"])
        self.assertEqual(caso["titulo"], "Maria Teste X Banco X S/A")                      # normalizado

    def test_rodar_de_novo_nao_duplica(self):
        self.publicar()
        self.rodar()
        self.assertEqual(self.rodar(), {"criados": 0, "falhas": 0})
        self.assertEqual(len(self.gestao.listar_casos("rascunhos")), 1)

    def test_reserva_impede_duplicar_em_execucoes_simultaneas(self):
        h, n = self.publicar()
        with self.auto._abrir() as c:                                   # outra execução já reservou esta publicação
            c.execute("INSERT INTO autocadastro_publicacoes (hash, numero, estado, criado_em) VALUES (?,?,?,?)", (h, n, "criado", self.agora.isoformat()))
        self.assertEqual(self.rodar(), {"criados": 0, "falhas": 0})

    def test_teto_diario_e_por_rodada(self):
        for _ in range(3):
            self.publicar()
        self.assertEqual(self.rodar(limite=2)["criados"], 2)
        self.assertEqual(self.rodar(limite=2)["criados"], 0)               # já bateu o teto hoje
        self.assertEqual(self.rodar(limite=3)["criados"], 1)
        s = self.auto.simular(self.gestao, self.pubs, self.mon, 3, self.agora)
        self.assertEqual((s["total"], s["criaria"], s["restante_hoje"]), (0, 0, 0))

    def test_responsavel_pelas_regras_e_aviso_so_no_sino(self):
        config = automacoes.Repositorio(self.caminho)
        config.definir("responsavel_regras", "adm", ativo=True)
        rr.Regras(self.caminho).salvar([{"tipo": "cliente", "valor": self.cliente["id"], "responsavel": "bia", "ativo": True}], {"ana", "bia"}, "adm", True)
        self.publicar()
        self.rodar()
        caso = self.gestao.listar_casos("rascunhos")[0]
        self.assertEqual(caso["responsavel"], "bia")
        feed = notificacoes.Repositorio(self.caminho, agora=lambda: self.agora).listar("bia")["notificacoes"]
        item = next(x for x in feed if x["tipo"] == "processo_rascunho")
        self.assertEqual((item["titulo"], item["destino"]), ("Novo processo a confirmar", {"tipo": "processos_a_confirmar"}))
        self.assertEqual(notificacoes.Repositorio(self.caminho, agora=lambda: self.agora).destino("bia", item["id"]), {"tipo": "processos_a_confirmar"})

    def test_sem_responsavel_avisa_os_administradores(self):
        self.publicar()
        self.rodar()
        feed = notificacoes.Repositorio(self.caminho, agora=lambda: self.agora).listar("chefe")["notificacoes"]
        self.assertTrue(any(x["tipo"] == "processo_rascunho" for x in feed))

    def test_falha_no_meio_nao_deixa_rascunho_pela_metade_e_tenta_depois(self):
        h, n = self.publicar()

        def quebra(pub, cid):
            caso, _ = self.criar()(pub, cid)
            raise RuntimeError("falhou depois de criar")
        r = self.auto.executar(self.gestao, self.pubs, self.mon, quebra, 20, self.agora)
        self.assertEqual(r, {"criados": 0, "falhas": 1})
        self.assertEqual(self.gestao.listar_casos("todos"), [])
        self.assertEqual(self.rodar()["criados"], 1)                      # a publicação ficou livre para a próxima rodada

    def test_confirmar_torna_ativo(self):
        self.publicar()
        self.rodar()
        caso = self.gestao.listar_casos("rascunhos")[0]
        self.assertTrue(self.auto.confirmar(self.gestao, caso["id"]))
        self.assertEqual((self.gestao.listar_casos("rascunhos"), [c["id"] for c in self.gestao.listar_casos()]), ([], [caso["id"]]))
        self.assertFalse(self.auto.confirmar(self.gestao, caso["id"]))      # só rascunho
        self.assertEqual(self.rodar()["criados"], 0)

    def test_descartar_devolve_a_fila_e_nao_recria(self):
        h, n = self.publicar()
        self.rodar()
        caso = self.gestao.listar_casos("rascunhos")[0]
        self.assertTrue(self.auto.descartar(self.gestao, caso["id"]))
        self.assertEqual(self.gestao.listar_casos("todos"), [])
        pub = next(p for p in self.pubs.listar(status="nao_tratada") if p["hash"] == h)
        self.assertIsNone(pub["caso_id"])                                   # voltou à fila, sem vínculo
        self.publicar(numero=n)                                             # outra publicação do mesmo processo
        self.assertEqual(self.rodar()["criados"], 0)                        # descartado: a rotina não recria
        ativo = self.gestao.criar_caso(self.cliente["id"], "Ativo", None, [], lambda: self.agora)
        self.assertFalse(self.auto.descartar(self.gestao, ativo["id"]))     # não descarta processo ativo

    def test_rascunho_nao_dispara_processo_parado(self):
        import automacoes as a
        self.publicar()
        self.rodar()
        achados = a.processos_parados(self.gestao, 15, set(), datetime(2027, 6, 1, tzinfo=timezone.utc).date())
        self.assertEqual(achados, [])


class RotasTest(_Base):
    def chamar(self, path, token, metodo="GET", corpo=None):
        app = server._AutenticacaoBearer(None, self.usuarios, gestao=self.gestao, publicacoes=self.pubs, registro_monitoramentos=self.mon)
        saida = []

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo or {}).encode(), "more_body": False}

        async def send(e):
            saida.append(e)

        scope = {"type": "http", "path": path, "query_string": b"", "method": metodo,
                 "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1)}
        asyncio.run(app(scope, receive, send))
        bruto = b"".join(e.get("body", b"") for e in saida[1:])
        try:
            return saida[0]["status"], json.loads(bruto or b"{}")
        except ValueError:
            return saida[0]["status"], bruto.decode()

    def setUp(self):
        super().setUp()
        self.comum = u.alterar(self.usuarios, dict(login="rui", nome_completo="Rui", email="rui@teste.com"), "bootstrap")["token"]

    def test_toda_a_equipe_ve_confirma_e_descarta(self):
        self.publicar()
        self.rodar()
        status, corpo = self.chamar("/rascunhos", self.comum)
        self.assertEqual((status, corpo["total"]), (200, 1))
        self.assertEqual((corpo["rascunhos"][0]["cliente"], corpo["rascunhos"][0]["motivo"]), ("Maria Teste", "nome igual"))
        cid = corpo["rascunhos"][0]["id"]
        self.assertEqual(self.chamar(f"/rascunhos/{cid}/confirmar", self.comum, "POST")[0], 200)
        self.assertEqual(self.chamar(f"/rascunhos/{cid}/confirmar", self.comum, "POST")[0], 404)
        self.assertEqual(self.chamar("/rascunhos", "invalido")[0], 401)
        self.assertEqual(self.chamar("/rascunhos/x/apagar", self.comum, "POST")[0], 404)

    def test_descartar_pela_rota(self):
        self.publicar()
        self.rodar()
        cid = self.gestao.listar_casos("rascunhos")[0]["id"]
        self.assertEqual(self.chamar(f"/rascunhos/{cid}/descartar", self.comum, "POST")[0], 200)
        self.assertEqual(self.chamar("/rascunhos", self.comum)[1]["total"], 0)

    def test_simulacao_obrigatoria_antes_de_ligar(self):
        self.publicar()
        self.assertEqual(self.chamar("/admin/automacoes/api/autocadastro_rascunho", self.admin, "PUT", {"ativo": True})[0], 400)
        self.assertEqual(self.chamar("/admin/automacoes/autocadastro/estado", self.comum)[0], 403)
        status, corpo = self.chamar("/admin/automacoes/autocadastro/simular", self.admin, "POST")
        self.assertEqual((status, corpo["total"], corpo["criaria"], corpo["itens"][0]["cliente"]), (200, 1, 1, "Maria Teste"))
        self.assertEqual(self.gestao.listar_casos("todos"), [])                   # simular não grava
        self.assertIsNotNone(self.chamar("/admin/automacoes/autocadastro/estado", self.admin)[1]["simulou_em"])
        self.assertEqual(self.chamar("/admin/automacoes/api/autocadastro_rascunho", self.admin, "PUT", {"ativo": True})[0], 200)
        self.assertEqual(self.chamar("/admin/automacoes/api/autocadastro_rascunho", self.admin, "PUT", {"ativo": False})[0], 200)   # desligar nunca exige


if __name__ == "__main__":
    unittest.main()
