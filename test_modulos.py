"""Módulos plugáveis: manifestos, liga/desliga por escritório, dependências e proteção das ferramentas."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import server  # noqa: F401  (vincula o núcleo aos módulos)
import usuarios_admin
from modulos.registro import ConflitoModulo, RegistroModulos, modulos


def _manifesto(id_, dependencias=()):
    return {"id": id_, "nome": id_.title(), "versao": "1.0.0", "area_permissao": "pesquisa",
            "aba": {"id": id_, "rotulo": id_, "grupo": "pesquisa", "icone": "BookOpen"},
            "dependencias": list(dependencias)}


def _raiz(*manifestos):
    raiz = Path(tempfile.mkdtemp())
    for m in manifestos:
        (raiz / m["id"]).mkdir()
        (raiz / m["id"] / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    return raiz


class ManifestosTest(unittest.TestCase):
    def test_modulos_embutidos_descobertos(self):
        self.assertEqual(set(modulos.manifestos), {"jurimetria", "jurisprudencia"})
        self.assertEqual(modulos.manifestos["jurimetria"]["aba"]["grupo"], "pesquisa")

    def test_ferramentas_do_manifesto_estao_no_servidor_mcp(self):
        registradas = {t.name for t in asyncio.run(server.mcp.list_tools())}
        for m in modulos.manifestos.values():
            self.assertTrue(set(m["ferramentas"]) <= registradas, m["id"])

    def test_manifesto_invalido_e_recusado(self):
        raiz = Path(tempfile.mkdtemp())
        (raiz / "x").mkdir()
        (raiz / "x" / "manifest.json").write_text('{"id": "x"}', encoding="utf-8")
        with self.assertRaises(ValueError):
            RegistroModulos(raiz)

    def test_id_precisa_igualar_a_pasta(self):
        raiz = _raiz(_manifesto("a"))
        (raiz / "a").rename(raiz / "b")
        with self.assertRaises(ValueError):
            RegistroModulos(raiz)

    def test_dependencia_inexistente_e_ciclo_sao_recusados(self):
        with self.assertRaises(ValueError):
            RegistroModulos(_raiz(_manifesto("a", ["nao_existe"])))
        with self.assertRaises(ValueError):
            RegistroModulos(_raiz(_manifesto("a", ["b"]), _manifesto("b", ["a"])))


class EstadoTest(unittest.TestCase):
    def setUp(self):
        self.banco = Path(tempfile.mkdtemp()) / "t.db"
        self.reg = RegistroModulos(_raiz(_manifesto("base"), _manifesto("extra", ["base"])))

    def test_padrao_ativo_e_persistencia(self):
        self.reg.configurar(self.banco)
        self.assertTrue(self.reg.ativo("extra"))
        self.reg.definir_ativo("extra", False, "ana")
        self.assertFalse(self.reg.ativo("extra"))
        outro = RegistroModulos(_raiz(_manifesto("base"), _manifesto("extra", ["base"])))
        outro.configurar(self.banco)
        self.assertFalse(outro.ativo("extra"))
        self.assertTrue(outro.ativo("base"))

    def test_dependencias_bloqueiam_ligar_e_desligar(self):
        self.reg.configurar(self.banco)
        with self.assertRaises(ConflitoModulo):
            self.reg.definir_ativo("base", False)  # "extra" depende dela e está ativo
        self.reg.definir_ativo("extra", False)
        self.reg.definir_ativo("base", False)
        with self.assertRaises(ConflitoModulo):
            self.reg.definir_ativo("extra", True)  # "base" desligada
        with self.assertRaises(LookupError):
            self.reg.definir_ativo("nada", True)


class ProtecaoTest(unittest.TestCase):
    def tearDown(self):
        modulos._estado.clear()

    def test_ferramenta_de_modulo_desligado_devolve_erro(self):
        modulos._estado["jurimetria"] = False
        resultado = asyncio.run(server.mcp.call_tool("perfil_decisorio_magistrado", {"magistrado_nome": "X"}))
        texto = json.dumps(resultado, default=str)
        self.assertIn("desativado", texto)

    def test_rota_do_modulo_desligado_responde_404(self):
        modulos._estado["jurimetria"] = False
        enviados = []

        async def send(msg):
            enviados.append(msg)
        tratou = asyncio.run(modulos.despachar_http({"method": "GET"}, send, "/cjpg-arvore/filhos"))
        self.assertTrue(tratou)
        self.assertEqual(enviados[0]["status"], 404)

    def test_rota_fora_dos_modulos_nao_e_tratada(self):
        self.assertFalse(asyncio.run(modulos.despachar_http({"method": "GET"}, None, "/casos")))

    def test_permissao_da_rota_vem_do_manifesto(self):
        perfil = {"nivel_acesso": "operador", "permissoes": {"pesquisa": "nenhum"}}
        self.assertIn("não tem acesso", usuarios_admin.liberar_rota(perfil, "/cjpg-arvore/filhos", "GET"))
        self.assertIsNone(usuarios_admin.liberar_rota({"nivel_acesso": "operador"}, "/cjpg-arvore/filhos", "GET"))

    def test_consulta_pode_chamar_ferramentas_declaradas_nos_manifestos(self):
        chamada = {"method": "tools/call", "params": {"name": "consultar_jurimetria_cjpg"}}
        self.assertTrue(usuarios_admin.mcp_consulta_permitido(chamada))


class GerenciadorHttpTest(unittest.TestCase):
    def _chamar(self, metodo, caminho, corpo=b"", nivel="administrador"):
        enviados = []

        async def send(msg):
            enviados.append(msg)

        async def receive():
            return {"type": "http.request", "body": corpo, "more_body": False}
        asyncio.run(modulos.gerenciador_http({"method": metodo, "nivel_acesso": nivel}, receive, send, caminho, "ana"))
        status = enviados[0]["status"]
        dados = json.loads(enviados[1]["body"]) if len(enviados) > 1 else None
        return status, dados

    def tearDown(self):
        modulos._estado.clear()

    def test_lista_e_alterna(self):
        status, dados = self._chamar("GET", "/modulos", nivel="consulta")
        self.assertEqual(status, 200)
        self.assertEqual({m["id"] for m in dados["modulos"]}, {"jurimetria", "jurisprudencia"})
        status, dados = self._chamar("PATCH", "/modulos/jurimetria", b'{"ativo": false}')
        self.assertEqual(status, 200)
        self.assertFalse(dados["modulo"]["ativo"])

    def test_so_administrador_altera(self):
        status, _ = self._chamar("PATCH", "/modulos/jurimetria", b'{"ativo": false}', nivel="operador")
        self.assertEqual(status, 403)
        self.assertTrue(modulos.ativo("jurimetria"))

    def test_validacoes(self):
        self.assertEqual(self._chamar("PATCH", "/modulos/jurimetria", b'{"ativo": "sim"}')[0], 400)
        self.assertEqual(self._chamar("PATCH", "/modulos/jurimetria", b"nao-json")[0], 400)
        self.assertEqual(self._chamar("PATCH", "/modulos/nada", b'{"ativo": true}')[0], 404)


if __name__ == "__main__":
    unittest.main()
