"""I03: contratos reais de migração, API autenticada e desvinculação, sem rede."""
import asyncio
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path

import db
import server


class OrigemDjenTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        self.agora = lambda: datetime(2026, 10, 26)
        cliente = self.gestao.criar_cliente("Cliente fictício", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Processo A", "ana", [], self.agora)
        self.outro = self.gestao.criar_caso(cliente["id"], "Processo B", "bia", [], self.agora)
        self.publicacoes.registrar("pub-A", None, None, None, {"texto": "Conteúdo A"}, "nao_tratada", self.caso["id"], self.agora)
        self.publicacoes.registrar("pub-B", None, None, None, {"texto": "Conteúdo B"}, "nao_tratada", self.outro["id"], self.agora)
        self.registro = db.RegistroUsuarios(self.caminho)
        _, _, self.token = server._criar_usuario_core(self.registro, "ana")
        self.mw = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao, publicacoes=self.publicacoes)

    def chamar(self, metodo, rota, dados=None, autenticado=True):
        async def executar():
            mensagens = []
            async def send(mensagem):
                mensagens.append(mensagem)
            async def receive():
                return {"type": "http.request", "body": json.dumps(dados).encode() if dados is not None else b"{}", "more_body": False}
            scope = {"type": "http", "method": metodo, "path": rota, "query_string": b"",
                     "headers": [(b"authorization", f"Bearer {self.token}".encode())] if autenticado else []}
            await self.mw(scope, receive, send)
            status = next(m["status"] for m in mensagens if m["type"] == "http.response.start")
            corpo = b"".join(m.get("body", b"") for m in mensagens if m["type"] == "http.response.body")
            return status, json.loads(corpo) if corpo.startswith(b"{") else corpo
        return asyncio.run(executar())

    @property
    def rota(self):
        return f"/casos/{self.caso['id']}/atividades"

    def criar(self, **campos):
        status, atividade = self.chamar("POST", self.rota, {"titulo": "Conferir publicação", **campos})
        self.assertEqual(status, 201, atividade)
        return atividade

    def test_cria_referencia_estruturada_sem_copiar_conteudo_ou_tratar_publicacao(self):
        atividade = self.criar(origem_djen_hash="pub-A", observacoes="Nota livre")
        self.assertEqual(atividade["origem_djen_hash"], "pub-A")
        self.assertEqual(atividade["observacoes"], "Nota livre")
        status, dados = self.chamar("GET", self.rota)
        self.assertEqual(status, 200)
        self.assertTrue(dados["origem_djen_estruturada"])
        self.assertNotIn("Conteúdo A", json.dumps(dados, ensure_ascii=False))
        self.assertEqual(self.publicacoes.obter("pub-A")["status"], "nao_tratada")

    def test_cliente_antigo_cria_por_marcador(self):
        texto = "Nota livre\nPublicação de origem (DJEN): pub-A"
        atividade = self.criar(observacoes=texto)
        self.assertEqual(atividade["origem_djen_hash"], "pub-A")
        self.assertEqual(atividade["observacoes"], texto)

    def test_patch_antigo_preserva_origem_e_null_nao_ressuscita(self):
        atividade = self.criar(observacoes="Publicação de origem (DJEN): pub-A")
        rota = f"{self.rota}/{atividade['id']}"
        status, editada = self.chamar("PATCH", rota, {"observacoes": "Publicação de origem (DJEN): pub-B"})
        self.assertEqual(status, 200)
        self.assertEqual(editada["origem_djen_hash"], "pub-A")
        status, removida = self.chamar("PATCH", rota, {"origem_djen_hash": None})
        self.assertEqual(status, 200)
        self.assertIsNone(removida["origem_djen_hash"])
        self.chamar("PATCH", rota, {"titulo": "Outro título"})
        self.assertIsNone(self.gestao.listar_atividades(self.caso["id"])[0]["origem_djen_hash"])

    def test_recusa_origem_de_outro_processo_com_mesma_resposta_de_ausente(self):
        respostas = [self.chamar("POST", self.rota, {"titulo": "Teste", "origem_djen_hash": h}) for h in ("pub-B", "ausente")]
        self.assertEqual(respostas[0], respostas[1])
        self.assertEqual(respostas[0][0], 404)
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])

    def test_recusa_troca_inacessivel_sem_alterar_outros_campos(self):
        atividade = self.criar(origem_djen_hash="pub-A")
        status, _ = self.chamar("PATCH", f"{self.rota}/{atividade['id']}", {"titulo": "Não gravar", "origem_djen_hash": "pub-B"})
        self.assertEqual(status, 404)
        persistida = self.gestao.listar_atividades(self.caso["id"])[0]
        self.assertEqual(persistida["titulo"], atividade["titulo"])
        self.assertEqual(persistida["origem_djen_hash"], "pub-A")

    def test_recusa_marcadores_ambiguos_invalidos_e_conflito(self):
        pedidos = [
            {"observacoes": "Publicação de origem (DJEN): pub-A\nPublicação de origem (DJEN): pub-A"},
            {"observacoes": "Publicação de origem (DJEN): ../invalida"},
            {"origem_djen_hash": "pub-A", "observacoes": "Publicação de origem (DJEN): pub-B"},
            {"origem_djen_hash": None, "observacoes": "Publicação de origem (DJEN): pub-A"},
        ]
        for pedido in pedidos:
            with self.subTest(pedido=pedido):
                self.assertEqual(self.chamar("POST", self.rota, {"titulo": "Teste", **pedido})[0], 400)
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"]), [])

    def test_valida_tipo_formato_tamanho_e_json(self):
        for valor in ("", " pub-A", "pub/A", "a\nb", "a" * 513, 42, [], {}):
            with self.subTest(valor=valor):
                self.assertEqual(self.chamar("POST", self.rota, {"titulo": "Teste", "origem_djen_hash": valor})[0], 400)
        for metodo, rota in (("POST", self.rota), ("PATCH", self.rota + "/1")):
            self.assertEqual(self.chamar(metodo, rota, ["objeto inválido"])[0], 400)

    def test_desvinculacao_condicionada_preserva_origem_sem_conteudo(self):
        atividade = self.criar(origem_djen_hash="pub-A")
        errada = f"/casos/{self.outro['id']}/publicacoes/pub-A"
        self.assertEqual(self.chamar("DELETE", errada)[0], 404)
        self.assertEqual(self.publicacoes.obter("pub-A")["caso_id"], self.caso["id"])
        correta = f"/casos/{self.caso['id']}/publicacoes/pub-A"
        self.assertEqual(self.chamar("DELETE", correta)[0], 200)
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"])[0]["origem_djen_hash"], "pub-A")
        status, dados = self.chamar("GET", f"/casos/{self.caso['id']}/publicacoes")
        self.assertEqual(status, 200)
        self.assertEqual(dados, {"publicacoes": []})
        # Editar uma referência já registrada continua possível após o desvínculo.
        self.assertEqual(self.chamar("PATCH", f"{self.rota}/{atividade['id']}", {"origem_djen_hash": "pub-A", "titulo": "Revisar"})[0], 200)
        self.publicacoes.vincular_caso("pub-A", self.caso["id"])
        self.assertEqual(len(self.chamar("GET", f"/casos/{self.caso['id']}/publicacoes")[1]["publicacoes"]), 1)

    def test_publicacao_movida_nao_pode_ser_desvinculada_pela_rota_antiga(self):
        self.publicacoes.vincular_caso("pub-A", self.outro["id"])
        self.assertFalse(self.publicacoes.desvincular_do_caso("pub-A", self.caso["id"]))
        self.assertEqual(self.publicacoes.obter("pub-A")["caso_id"], self.outro["id"])

    def test_origem_nao_e_credencial_para_rotas_protegidas(self):
        for metodo, rota, corpo in (("GET", self.rota, None), ("POST", self.rota, {"titulo": "Teste", "origem_djen_hash": "pub-A"}),
                                    ("GET", f"/casos/{self.caso['id']}/publicacoes", None)):
            self.assertEqual(self.chamar(metodo, rota, corpo, autenticado=False)[0], 401)

    def test_referencia_sobrevive_a_exclusao_da_publicacao(self):
        self.criar(origem_djen_hash="pub-A")
        with closing(db.conectar(self.caminho)) as conexao, conexao:
            conexao.execute("DELETE FROM publicacoes_capturadas WHERE hash = 'pub-A'")
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"])[0]["origem_djen_hash"], "pub-A")

    def test_migracao_de_tabela_antiga_idempotente_relata_ambiguidades(self):
        # Banco legado isolado: schema da atividade anterior às colunas de origem.
        antigo = self.caminho.parent / "antigo.db"
        observacoes = ["Texto livre\r\nPublicação de origem (DJEN): antiga-1", "Sem origem",
                       "Publicação de origem (DJEN): a\nPublicação de origem (DJEN): b",
                       "Publicação de origem (DJEN): ../invalida"]
        with closing(sqlite3.connect(antigo)) as conexao, conexao:
            conexao.execute("CREATE TABLE caso_atividades (id INTEGER PRIMARY KEY, caso_id TEXT, tipo TEXT, titulo TEXT, data TEXT, hora TEXT, status TEXT, observacoes TEXT, criado_em TEXT)")
            for i, texto in enumerate(observacoes, 1):
                conexao.execute("INSERT INTO caso_atividades VALUES (?, 'legado', 'tarefa', 'Título', NULL, NULL, 'pendente', ?, '2026-01-01')", (i, texto))
        for _ in range(2):
            with closing(db.conectar(antigo)) as conexao:
                linhas = conexao.execute("SELECT origem_djen_hash, origem_djen_versao, observacoes FROM caso_atividades ORDER BY id").fetchall()
                self.assertEqual([r[0] for r in linhas], ["antiga-1", None, None, None])
                self.assertEqual([r[1] for r in linhas], [1, 1, 1, 1])
                self.assertEqual([r[2] for r in linhas], observacoes)
                self.assertEqual(conexao.execute("SELECT * FROM origem_djen_migracao_pendencias ORDER BY atividade_id").fetchall(),
                                 [(3, "marcadores_multiplos"), (4, "marcador_invalido")])


if __name__ == "__main__":
    unittest.main()
