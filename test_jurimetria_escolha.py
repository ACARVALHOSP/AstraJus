"""Jurimetria na ficha do processo (fase 2): escolha de filtros guardada por processo e rota de nomes por id."""
import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from modulos.jurimetria import servico
from modulos.registro import modulos as registro_modulos
from test_jurimetria_resolver import ARVORES

ESCOLHA = {
    "vara": {"id": "100-12", "nome": "12ª Vara Cível", "caminho": "Foro Central Cível > 12ª Vara Cível"},
    "classe": {"id": "8501", "nome": "Procedimento Comum Cível", "caminho": "Procedimento de conhecimento > Procedimento Comum Cível"},
    "assunto": {"id": "10433", "nome": "Indenização por Dano Moral", "caminho": "Direito civil > Indenização por Dano Moral"},
    "magistrado": {"id": "7753", "nome": "Abelardo de Azevedo Silveira", "caminho": "Abelardo de Azevedo Silveira"},
}


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.banco = str(Path(tmp.name) / "t.db")
        con = sqlite3.connect(self.banco)
        con.execute("CREATE TABLE casos (id TEXT PRIMARY KEY)")
        con.execute("CREATE TABLE caso_processo_capa (caso_id TEXT, numero_processo TEXT, id_orgao TEXT)")
        con.execute("INSERT INTO caso_processo_capa VALUES ('c1', '40164316020268260477', '109638'), ('c2', '10018401920265020072', NULL)")
        con.executemany("INSERT INTO casos VALUES (?)", [("c1",), ("c2",)])
        con.commit()
        servico.migrar(con)
        con.commit()
        con.close()
        self.addCleanup(setattr, servico, "_BANCO_CAMINHO", servico._BANCO_CAMINHO)
        self.enviados = []

        async def json_(send, status, corpo):
            self.enviados.append((status, corpo))

        async def ler_corpo(receive, limite=0):
            return receive.corpo if len(receive.corpo) <= limite else None

        p = mock.patch.object(servico, "nucleo", mock.MagicMock())
        self.nucleo = p.start()
        self.addCleanup(p.stop)
        self.nucleo._json = json_
        self.nucleo._ler_corpo = ler_corpo

    def chamar(self, metodo, caminho, corpo=None, usuario="ana"):
        receive = mock.MagicMock()
        receive.corpo = json.dumps(corpo).encode() if corpo is not None and not isinstance(corpo, bytes) else (corpo or b"")
        self.enviados.clear()
        tratou = asyncio.run(servico.http_com_corpo({"method": metodo, "usuario": usuario}, receive, None, caminho))
        self.assertTrue(tratou)
        return self.enviados[0]


class EscolhaPorProcessoTest(_Base):
    def test_migrar_cria_a_tabela_e_limpa_escolhas_de_processo_excluido(self):
        con = sqlite3.connect(self.banco)
        con.execute("INSERT INTO jurimetria_caso VALUES ('fantasma', '{}', 1, 'x')")
        con.commit()
        servico.migrar(con)
        con.commit()
        self.assertEqual(con.execute("SELECT count(*) FROM jurimetria_caso").fetchone()[0], 0)
        con.close()

    def test_sem_escolha_guardada(self):
        self.assertEqual(self.chamar("GET", "/jurimetria/caso/c1"), (200, {"escolha": None}))

    def test_grava_e_le_com_quem_e_quando(self):
        status, corpo = self.chamar("PUT", "/jurimetria/caso/c1", ESCOLHA, usuario="ana")
        self.assertEqual(status, 200)
        guardada = corpo["escolha"]
        self.assertEqual(guardada["vara"]["id"], "100-12")
        self.assertEqual((guardada["atualizado_por"], guardada["magistrado"]["id"]), ("ana", "7753"))
        self.assertGreater(guardada["atualizado_em"], 0)
        self.assertEqual(self.chamar("GET", "/jurimetria/caso/c1")[1]["escolha"]["classe"]["id"], "8501")
        self.assertIsNone(self.chamar("GET", "/jurimetria/caso/c2")[1]["escolha"])  # outro processo não é afetado

    def test_sobrescreve_e_campo_nulo_fica_nulo(self):
        self.chamar("PUT", "/jurimetria/caso/c1", ESCOLHA)
        novo = {**ESCOLHA, "vara": None, "magistrado": None}
        guardada = self.chamar("PUT", "/jurimetria/caso/c1", novo, usuario="bia")[1]["escolha"]
        self.assertEqual((guardada["vara"], guardada["magistrado"], guardada["atualizado_por"]), (None, None, "bia"))
        self.assertEqual(guardada["classe"]["id"], "8501")

    def test_tudo_nulo_ou_delete_apaga_a_linha(self):
        self.chamar("PUT", "/jurimetria/caso/c1", ESCOLHA)
        self.assertEqual(self.chamar("PUT", "/jurimetria/caso/c1", dict.fromkeys(ESCOLHA))[1], {"escolha": None})
        self.chamar("PUT", "/jurimetria/caso/c1", ESCOLHA)
        self.assertEqual(self.chamar("DELETE", "/jurimetria/caso/c1"), (200, {"escolha": None}))
        self.assertEqual(self.chamar("GET", "/jurimetria/caso/c1")[1], {"escolha": None})

    def test_validacao(self):
        ruins = [
            [1, 2], {"vara": "100-12"}, {"extra": None}, {"vara": {"id": "../x", "nome": "n"}}, {"vara": {"id": "1", "nome": ""}},
            {"vara": {"id": "1", "nome": "n" * 201}}, {"vara": {"id": 1, "nome": "n"}}, {"classe": {"id": "1", "nome": "n", "caminho": "c" * 401}},
        ]
        for corpo in ruins:
            self.assertEqual(self.chamar("PUT", "/jurimetria/caso/c1", corpo)[0], 400, corpo)
        self.assertEqual(self.chamar("PUT", "/jurimetria/caso/c1", b"{nao e json")[0], 400)
        self.assertIsNone(self.chamar("GET", "/jurimetria/caso/c1")[1]["escolha"])  # nada foi gravado

    def test_corpo_grande_id_ruim_e_metodo(self):
        self.assertEqual(self.chamar("PUT", "/jurimetria/caso/c1", b"x" * 9000)[0], 413)
        self.assertEqual(self.chamar("GET", "/jurimetria/caso/a b")[0], 400)
        self.assertEqual(self.chamar("PATCH", "/jurimetria/caso/c1")[0], 405)

    def test_sem_banco_pronto(self):
        servico._BANCO_CAMINHO = None
        self.assertEqual(self.chamar("GET", "/jurimetria/caso/c1")[0], 503)

    def test_rotas_antigas_seguem_em_http(self):
        with mock.patch.object(servico, "http", new=mock.AsyncMock(return_value=True)) as http:
            asyncio.run(servico.http_com_corpo({"method": "GET"}, None, None, "/cjpg-arvore/buscar"))
        http.assert_awaited_once()


class RotaNosTest(_Base):
    def nos(self, query):
        self.nucleo._query.return_value = list(query.items())
        self.enviados.clear()
        with mock.patch.object(servico, "_garantir_arvore_cjpg", new=mock.AsyncMock()), \
                mock.patch.object(servico, "_carregar_arvore_cjpg", side_effect=lambda c: ARVORES[c]):
            asyncio.run(servico._arvore_nos_http({}, None))
        return self.enviados[0]

    def test_nome_e_caminho_por_id(self):
        status, corpo = self.nos({"campo": "vara", "ids": "100-12,100,999-1"})
        self.assertEqual(status, 200)
        self.assertEqual([n["id"] for n in corpo["nos"]], ["100-12"])  # raiz e inexistente ficam de fora
        self.assertEqual(corpo["nos"][0]["caminho"], "Foro Central Cível > 12ª Vara Cível")
        self.assertEqual(self.nos({"campo": "magistrado", "ids": "7753"})[1]["nos"][0]["nome"], "Abelardo de Azevedo Silveira")
        self.assertEqual(self.nos({"campo": "classe", "ids": "8501,6603"})[1]["nos"][0]["id"], "8501")

    def test_campo_invalido_e_ids_ruins(self):
        self.assertEqual(self.nos({"campo": "foro", "ids": "1"})[0], 400)
        self.assertEqual(self.nos({"campo": "classe", "ids": "../etc,%00,8501"})[1]["nos"][0]["id"], "8501")
        muitos = ",".join(["8501"] * 50)
        self.assertLessEqual(len(self.nos({"campo": "classe", "ids": muitos})[1]["nos"]), 20)


class ContratoDoModuloTest(unittest.TestCase):
    def test_manifesto_declara_a_rota_e_a_tabela(self):
        m = registro_modulos.manifestos["jurimetria"]
        self.assertIn("/jurimetria/", m["rotas_http"])
        self.assertIn("jurimetria_caso", m["tabelas"])
        self.assertEqual(registro_modulos.area_da_rota("/jurimetria/caso/c1"), "pesquisa")

    def test_despacho_prefere_http_com_corpo(self):
        async def rodar():
            fake = mock.MagicMock()
            fake.http_com_corpo = mock.AsyncMock(return_value=True)
            fake.http = mock.AsyncMock(return_value=True)
            with mock.patch.object(registro_modulos, "_servico", return_value=fake), mock.patch.object(registro_modulos, "ativo", return_value=True):
                await registro_modulos.despachar_http({}, None, "/jurimetria/caso/c1", receive="r")
                fake.http_com_corpo.assert_awaited_once()
                fake.http.assert_not_awaited()
                await registro_modulos.despachar_http({}, None, "/jurimetria/caso/c1")  # sem receive: cai em http()
                fake.http.assert_awaited_once()
        asyncio.run(rodar())


if __name__ == "__main__":
    unittest.main()


class VaraPorIdOrgaoTest(_Base):
    def resolver(self, id_orgao):
        self.nucleo._query.return_value = [("numero", "1003325-11.2025.8.26.0100"), ("vara", "UPJ da 1ª a 6ª Varas"), ("id_orgao", id_orgao)]
        self.enviados.clear()
        with mock.patch.object(servico, "_garantir_arvore_cjpg", new=mock.AsyncMock()), \
                mock.patch.object(servico, "_carregar_arvore_cjpg", side_effect=lambda c: ARVORES.get(c, [])):
            asyncio.run(servico._arvore_resolver_http({}, None))
        return self.enviados[0][1]

    def test_vara_confirmada_vale_para_os_outros_processos_do_mesmo_idorgao(self):
        self.assertIsNone(self.resolver("109638")["vara"]["escolhido"])  # ainda ninguém confirmou
        self.chamar("PUT", "/jurimetria/caso/c1", ESCOLHA)  # c1 tem idOrgao 109638
        vara = self.resolver("109638")["vara"]
        self.assertEqual((vara["escolhido"]["id"], vara["escolhido"]["origem"], vara["confianca"]), ("100-12", "idOrgao", 1.0))
        self.assertIsNone(self.resolver("999")["vara"]["escolhido"])  # outro órgão não é afetado

    def test_caso_sem_idorgao_nao_grava_associacao(self):
        self.chamar("PUT", "/jurimetria/caso/c2", ESCOLHA)
        self.assertIsNone(servico._vara_do_orgao_ler(""))
        self.assertIsNone(self.resolver("109638")["vara"]["escolhido"])
