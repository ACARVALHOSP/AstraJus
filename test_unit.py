"""Testes unitários offline do servidor cnj-processual.

Não acessam a rede: as respostas HTTP são simuladas com httpx.MockTransport. Usa apenas
a stdlib (unittest), então não exige dependências extras.

Uso:
    python -m unittest test_unit -v
"""

import asyncio
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

import httpx

# sem atraso artificial nos testes; o tempo mínimo do cadastro tem teste próprio
os.environ.setdefault("CNJ_CADASTRO_TEMPO_MINIMO_S", "0")
import asaas_integracao
import db
import server


def _rodar(coro):
    return asyncio.run(coro)


class _Simulado:
    """Prepara o transporte HTTP simulado e zera os backoffs para os testes rodarem rápido."""

    def setUp(self):
        self._transporte_original = server._TRANSPORTE_HTTP
        self._patches = [
            mock.patch.object(server, "DATAJUD_BACKOFF_S", 0),
            mock.patch.object(server, "DJEN_BACKOFF_S", 0),
        ]
        for p in self._patches:
            p.start()
        self.chamadas: list[httpx.Request] = []

    def tearDown(self):
        server._TRANSPORTE_HTTP = self._transporte_original
        for p in self._patches:
            p.stop()

    def responder(self, *respostas):
        """Cada chamada HTTP consome a próxima resposta da lista. Exceções são lançadas."""
        fila = list(respostas)

        def handler(request: httpx.Request) -> httpx.Response:
            self.chamadas.append(request)
            item = fila.pop(0) if len(fila) > 1 else fila[0]
            if isinstance(item, Exception):
                raise item
            return item

        server._TRANSPORTE_HTTP = httpx.MockTransport(handler)


def _json(status: int, corpo) -> httpx.Response:
    return httpx.Response(status, json=corpo)


DATAJUD_OK = {
    "hits": {
        "total": {"value": 1, "relation": "eq"},
        "hits": [
            {
                "_source": {
                    "numeroProcesso": "10063142720238260005",
                    "tribunal": "TJSP",
                    "grau": "G1",
                    "classe": {"nome": "EMBARGOS DE TERCEIRO CÍVEL"},
                    "dataAjuizamento": "20230101000000",
                    "orgaoJulgador": {"nome": "1ª Vara Cível"},
                    "movimentos": [
                        {"codigo": 1, "nome": "Distribuição", "dataHora": "2023-01-01T00:00:00"},
                        {
                            "codigo": 2,
                            "nome": "Conclusos",
                            "dataHora": "2023-02-01T00:00:00",
                            "complementosTabelados": [{"nome": "Despacho"}],
                        },
                    ],
                }
            }
        ],
    }
}

DJEN_OK = {
    "count": 1,
    "items": [
        {
            "data_disponibilizacao": "2026-08-20",
            "siglaTribunal": "TJSP",
            "nomeOrgao": "1ª Vara",
            "tipoComunicacao": "Intimação",
            "tipoDocumento": "DESPACHO",
            "nomeClasse": "CLASSE",
            "numeroprocessocommascara": "1006314-27.2023.8.26.0005",
            "hash": "abc123",
            "link": "https://exemplo.test/x",
            "destinatarios": [{"nome": "FULANO", "polo": "A"}],
            "destinatarioadvogados": [
                {"advogado": {"nome": "ADV", "numero_oab": "330659", "uf_oab": "SP"}}
            ],
            "texto": "<p>Pra&ccedil;a &aacute; <b>negrito</b></p><script>x=1</script>",
        }
    ],
}


class UtilitariosTest(unittest.TestCase):
    def test_so_digitos_remove_mascara(self):
        self.assertEqual(server._so_digitos("1006314-27.2023.8.26.0005"), "10063142720238260005")
        self.assertEqual(server._so_digitos(None), "")

    def test_html_para_texto_decodifica_e_remove_tags_e_script(self):
        texto = server._html_para_texto("<p>Pra&ccedil;a &aacute; <b>negrito</b></p><script>x=1</script>")
        self.assertEqual(texto, "Praça á negrito")

    def test_total_hits_aceita_dict_e_inteiro(self):
        self.assertEqual(server._total_hits({"total": {"value": 7}}), 7)
        self.assertEqual(server._total_hits({"total": 3}), 3)
        self.assertEqual(server._total_hits({}), 0)
        self.assertEqual(server._total_hits({"total": "x"}), 0)

    def test_validar_data(self):
        self.assertIsNone(server._validar_data("x", "2026-08-01"))
        self.assertIsNone(server._validar_data("x", None))
        self.assertIsNotNone(server._validar_data("x", "01/08/2026"))


class DataJudTest(_Simulado, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.processo = "1006314-27.2023.8.26.0005"

    def consultar(self, tribunal="tjsp", numero=None):
        return _rodar(server.consultar_processo_datajud(tribunal=tribunal, numero_processo=numero or self.processo))

    def test_entrada_invalida_nao_faz_chamada_de_rede(self):
        self.responder(_json(200, DATAJUD_OK))
        self.assertTrue(self.consultar(tribunal="tj sp")["erro"])
        self.assertTrue(self.consultar(numero="123")["erro"])
        self.assertEqual(self.chamadas, [])

    def test_sucesso_extrai_campos_sem_partes(self):
        self.responder(_json(200, DATAJUD_OK))
        r = self.consultar()
        self.assertTrue(r["encontrado"])
        self.assertEqual(r["total"], 1)
        proc = r["processos"][0]
        self.assertEqual(proc["classe"], "EMBARGOS DE TERCEIRO CÍVEL")
        self.assertEqual(proc["orgaoJulgador"], "1ª Vara Cível")
        self.assertEqual(proc["totalMovimentos"], 2)
        self.assertEqual(proc["grau"], "G1")
        self.assertEqual(proc["grau_descricao"], "1º grau (primeira instância)")
        self.assertEqual(proc["movimentos"][1]["complementosTabelados"], [{"nome": "Despacho"}])
        self.assertNotIn("partes", proc)

    def test_requisicao_usa_url_header_e_corpo_corretos(self):
        self.responder(_json(200, DATAJUD_OK))
        self.consultar()
        req = self.chamadas[0]
        self.assertEqual(str(req.url), f"{server.DATAJUD_BASE_URL}/api_publica_tjsp/_search")
        self.assertTrue(req.headers["Authorization"].startswith("APIKey "))
        self.assertEqual(json.loads(req.content), {"_source": True, "size": 100, "query": {"match": {"numeroProcesso": "10063142720238260005"}}})

    def test_chave_pode_ser_sobrescrita_por_ambiente(self):
        self.responder(_json(200, DATAJUD_OK))
        with mock.patch.dict(os.environ, {"DATAJUD_API_KEY": "minha-chave"}):
            self.consultar()
        self.assertEqual(self.chamadas[0].headers["Authorization"], "APIKey minha-chave")

    def test_nao_encontrado_nao_e_erro(self):
        self.responder(_json(200, {"hits": {"total": {"value": 0}, "hits": []}}))
        r = self.consultar()
        self.assertFalse(r["encontrado"])
        self.assertNotIn("erro", r)

    def test_timeout_seguido_de_sucesso(self):
        import httpx as h
        self.responder(h.ReadTimeout("lento"), _json(200, DATAJUD_OK))
        r = self.consultar()
        self.assertTrue(r["encontrado"])
        self.assertEqual(len(self.chamadas), 2)

    def test_timeout_nas_duas_tentativas_vira_erro_estruturado(self):
        self.responder(httpx.ReadTimeout("lento"), httpx.ReadTimeout("lento"))
        r = self.consultar()
        self.assertTrue(r["erro"])
        self.assertIn("timeout", r["mensagem"])
        self.assertEqual(len(self.chamadas), server.DATAJUD_TENTATIVAS)

    def test_503_seguido_de_sucesso(self):
        self.responder(httpx.Response(503), _json(200, DATAJUD_OK))
        self.assertTrue(self.consultar()["encontrado"])

    def test_401_nao_e_repetido(self):
        self.responder(httpx.Response(401, text="no"))
        r = self.consultar()
        self.assertTrue(r["erro"])
        self.assertIn("DATAJUD_API_KEY", r["mensagem"])
        self.assertEqual(len(self.chamadas), 1)

    def test_corpo_nao_json_vira_erro(self):
        self.responder(httpx.Response(200, text="<html>oops</html>"))
        r = self.consultar()
        self.assertTrue(r["erro"])
        self.assertIn("não é JSON", r["mensagem"])

    def test_corpo_sem_hits_vira_erro(self):
        self.responder(_json(200, {"error": "algo"}))
        self.assertTrue(self.consultar()["erro"])

    def test_total_como_inteiro_funciona(self):
        corpo = json.loads(json.dumps(DATAJUD_OK))
        corpo["hits"]["total"] = 1
        self.responder(_json(200, corpo))
        self.assertEqual(self.consultar()["total"], 1)


class DjenTest(_Simulado, unittest.TestCase):
    def test_extracao_preserva_campos_adicionais_para_colunas(self):
        bruto = {"id": 123, "meio": "D", "ativo": False,
                 "destinatarios": [{"nome": "MARIA SILVA", "polo": "A", "id": 7}],
                 "destinatarioadvogados": [{"id": 8, "advogado": {"nome": "JOÃO", "numero_oab": "123", "uf_oab": "SP", "id": 9}}],
                 "texto": "<p>Texto original</p>"}
        extraido = server._extrair_publicacao_djen(bruto)
        self.assertEqual(extraido["id"], 123)
        self.assertEqual(extraido["meio"], "D")
        self.assertIs(extraido["ativo"], False)
        self.assertEqual(extraido["destinatarios"][0]["id"], 7)
        self.assertEqual(extraido["destinatarioadvogados"][0]["id"], 8)
        self.assertEqual(extraido["destinatarioadvogados"][0]["advogado"]["id"], 9)
        self.assertEqual(extraido["texto"], "Texto original")


    def consultar(self, **kwargs):
        return _rodar(server.consultar_publicacoes_djen(**kwargs))

    def test_exige_processo_ou_oab(self):
        self.responder(_json(200, DJEN_OK))
        self.assertTrue(self.consultar()["erro"])
        self.assertEqual(self.chamadas, [])

    def test_valida_processo_uf_e_datas(self):
        self.responder(_json(200, DJEN_OK))
        self.assertTrue(self.consultar(numero_processo="123")["erro"])
        self.assertTrue(self.consultar(numero_oab="1", uf_oab="SPP")["erro"])
        self.assertTrue(self.consultar(numero_oab="1", data_disponibilizacao_inicio="20/08/2026")["erro"])
        self.assertEqual(self.chamadas, [])

    def test_intervalo_invertido_e_rejeitado(self):
        self.responder(_json(200, DJEN_OK))
        r = self.consultar(numero_oab="1", data_disponibilizacao_inicio="2026-08-31", data_disponibilizacao_fim="2026-08-01")
        self.assertTrue(r["erro"])
        self.assertEqual(self.chamadas, [])

    def test_parametros_vao_na_query_com_nomes_da_api(self):
        self.responder(_json(200, DJEN_OK))
        self.consultar(numero_processo="1006314-27.2023.8.26.0005", sigla_tribunal="tjsp", itens_por_pagina=5)
        query = dict(self.chamadas[0].url.params)
        self.assertEqual(query["numeroProcesso"], "10063142720238260005")
        self.assertEqual(query["siglaTribunal"], "TJSP")
        self.assertEqual(query["itensPorPagina"], "5")
        self.assertEqual(query["pagina"], "1")
        self.assertNotIn("numeroOab", query)

    def test_sucesso_limpa_html_do_texto(self):
        self.responder(_json(200, DJEN_OK))
        r = self.consultar(numero_oab="330659")
        item = r["itens"][0]
        self.assertEqual(r["total"], 1)
        self.assertEqual(item["texto"], "Praça á negrito")
        self.assertEqual(item["destinatarioadvogados"][0]["numero_oab"], "330659")
        self.assertEqual(item["hash"], "abc123")

    def test_403_e_geobloqueio_sem_repetir(self):
        self.responder(httpx.Response(403))
        r = self.consultar(numero_oab="1")
        self.assertIn("geo-bloqueio", r["mensagem"])
        self.assertEqual(len(self.chamadas), 1)

    def test_500_seguido_de_sucesso(self):
        self.responder(httpx.Response(500), _json(200, DJEN_OK))
        self.assertEqual(self.consultar(numero_oab="1")["total"], 1)
        self.assertEqual(len(self.chamadas), 2)

    def test_502_persistente_vira_erro_apos_duas_tentativas(self):
        self.responder(httpx.Response(502), httpx.Response(502))
        r = self.consultar(numero_oab="1")
        self.assertTrue(r["erro"])
        self.assertEqual(len(self.chamadas), server.DJEN_TENTATIVAS)

    def test_404_nao_e_repetido(self):
        self.responder(httpx.Response(404, text="nada"))
        self.assertTrue(self.consultar(numero_oab="1")["erro"])
        self.assertEqual(len(self.chamadas), 1)

    def test_timeout_seguido_de_sucesso(self):
        self.responder(httpx.ConnectTimeout("x"), _json(200, DJEN_OK))
        self.assertEqual(self.consultar(numero_oab="1")["total"], 1)


class ProcessoUnificadoTest(unittest.TestCase):
    def consultar(self):
        return _rodar(server.consultar_processo_unificado(tribunal="tjsp", numero_processo="1006314-27.2023.8.26.0005"))

    def test_combina_datajud_e_djen_sem_duplicar_partes(self):
        datajud_ok = {
            "encontrado": True,
            "processos": [{"classe": "EMBARGOS DE TERCEIRO CÍVEL", "movimentos": []}],
        }
        djen_ok = {
            "itens": [
                {
                    "destinatarios": [{"nome": "FULANO", "polo": "A"}],
                    "destinatarioadvogados": [{"nome": "ADV", "numero_oab": "330659", "uf_oab": "SP"}],
                    "hash": "abc123",
                    "texto": "sigiloso, não deve aparecer",
                },
                {
                    "destinatarios": [{"nome": "fulano", "polo": "A"}],  # mesma pessoa, caixa diferente
                    "destinatarioadvogados": [{"nome": "ADV", "numero_oab": "330659", "uf_oab": "SP"}],
                    "hash": "def456",
                    "texto": "outra publicação",
                },
            ]
        }
        with mock.patch.object(server, "consultar_processo_datajud", return_value=datajud_ok), \
             mock.patch.object(server, "consultar_publicacoes_djen", return_value=djen_ok):
            r = self.consultar()

        self.assertTrue(r["encontrado_datajud"])
        self.assertEqual(len(r["partes"]), 1)  # deduplicado por nome
        self.assertEqual(len(r["advogados"]), 1)  # deduplicado por OAB
        self.assertNotIn("publicacoes", r)

    def test_erro_em_qualquer_fonte_interrompe_a_combinacao(self):
        with mock.patch.object(server, "consultar_processo_datajud", return_value=server._erro("falhou")), \
             mock.patch.object(server, "consultar_publicacoes_djen", return_value={"itens": []}):
            self.assertTrue(self.consultar()["erro"])


class CertidaoTest(_Simulado, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self._dir_temp = tempfile.TemporaryDirectory()
        self._dir_patch = mock.patch.object(server, "CERTIDAO_DIR", Path(self._dir_temp.name))
        self._dir_patch.start()

    def tearDown(self):
        self._dir_patch.stop()
        self._dir_temp.cleanup()
        super().tearDown()

    def baixar(self, hash_="abc123"):
        return _rodar(server.baixar_certidao_djen(hash=hash_))

    def test_hash_invalido_nao_faz_chamada(self):
        self.responder(httpx.Response(200, content=b"%PDF-1.4"))
        self.assertTrue(self.baixar("../etc/passwd")["erro"])
        self.assertEqual(self.chamadas, [])

    def test_resposta_que_nao_e_pdf_vira_erro(self):
        self.responder(httpx.Response(200, content=b"<html>"))
        self.assertTrue(self.baixar()["erro"])
        self.assertFalse(any(Path(self._dir_temp.name).iterdir()))

    def test_sucesso_salva_pdf(self):
        self.responder(httpx.Response(200, content=b"%PDF-1.4 conteudo"))
        r = self.baixar()
        self.assertEqual(r["bytes"], len(b"%PDF-1.4 conteudo"))
        self.assertEqual((Path(self._dir_temp.name) / "certidao_abc123.pdf").read_bytes(), b"%PDF-1.4 conteudo")
        self.assertNotIn("arquivo", r)  # o caminho no servidor não é devolvido
        self.assertEqual(r["nome_arquivo"], "certidao_abc123.pdf")
        self.assertNotIn("conteudo_base64", r)
        self.assertEqual(self.chamadas[0].url.path.rsplit("/", 2)[-2:], ["abc123", "certidao"])

    def test_sem_url_publica_avisa_que_nao_ha_link(self):
        self.responder(httpx.Response(200, content=b"%PDF-1.4 x"))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CNJ_MCP_URL_PUBLICA", None)
            r = self.baixar()
        self.assertIsNone(r["link_download"])
        self.assertIn("aviso", r)

    def test_link_assinado_baixa_o_pdf(self):
        self.responder(httpx.Response(200, content=b"%PDF-1.4 conteudo-link"))
        with mock.patch.dict(os.environ, {"CNJ_MCP_URL_PUBLICA": "https://exemplo.test/"}):
            r = self.baixar()
        from urllib.parse import urlsplit
        partes = urlsplit(r["link_download"])
        self.assertEqual(partes.path, "/certidoes/certidao_abc123.pdf")
        mw = server._AutenticacaoBearer(None, server.RegistroUsuarios(Path(self._dir_temp.name) / "u.json"))
        scope = {"type": "http", "method": "GET", "path": partes.path,
                 "query_string": partes.query.encode(), "headers": []}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(mw(scope, None, send))
        self.assertEqual(respostas[0]["status"], 200)
        self.assertEqual(b"".join(m.get("body", b"") for m in respostas[1:]), b"%PDF-1.4 conteudo-link")

    def test_link_adulterado_ou_expirado_e_recusado(self):
        self.responder(httpx.Response(200, content=b"%PDF-1.4 x"))
        with mock.patch.dict(os.environ, {"CNJ_MCP_URL_PUBLICA": "https://exemplo.test"}):
            r = self.baixar()
        from urllib.parse import urlsplit
        partes = urlsplit(r["link_download"])
        mw = server._AutenticacaoBearer(None, server.RegistroUsuarios(Path(self._dir_temp.name) / "u.json"))

        def tentar(query):
            respostas = []

            async def send(m):
                respostas.append(m)

            scope = {"type": "http", "method": "GET", "path": partes.path,
                     "query_string": query.encode(), "headers": []}
            _rodar(mw(scope, None, send))
            return respostas[0]["status"]

        self.assertEqual(tentar(partes.query.replace("sig=", "sig=00")), 403)
        expirado = partes.query.split("&")[0].replace("exp=", "")
        exp_passado = int(expirado) - server.CERTIDAO_LINK_VALIDADE_S - 60
        sig = server._assinatura_certidao("certidao_abc123.pdf", exp_passado)
        self.assertEqual(tentar(f"exp={exp_passado}&sig={sig}"), 403)
        self.assertEqual(tentar("exp=abc&sig=x"), 403)

    def test_nome_fora_do_padrao_nao_e_servido(self):
        self.assertFalse(server._verificar_link_certidao("../segredo.pdf", "9999999999", "x"))

    def test_remove_certidoes_mais_antigas_que_a_retencao(self):
        antiga = Path(self._dir_temp.name) / "certidao_antiga.pdf"
        antiga.write_bytes(b"%PDF")
        velha = time.time() - (server.CERTIDAO_RETENCAO_DIAS + 1) * 86400
        os.utime(antiga, (velha, velha))
        recente = Path(self._dir_temp.name) / "certidao_recente.pdf"
        recente.write_bytes(b"%PDF")

        self.responder(httpx.Response(200, content=b"%PDF-1.4 novo"))
        self.baixar()

        self.assertFalse(antiga.exists())
        self.assertTrue(recente.exists())


class _RegistroTemporario(unittest.TestCase):
    """Base: cria um registro de usuários em arquivo temporário e um usuário 'ana'."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroUsuarios(Path(self._dir.name) / "usuarios.json")
        self.token_ana = self._criar("ana")

    def tearDown(self):
        self._dir.cleanup()

    def _criar(self, nome):
        """Cria um usuário pela mesma função da CLI e devolve o token impresso."""
        import io
        from contextlib import redirect_stdout

        saida = io.StringIO()
        with redirect_stdout(saida):
            self.assertEqual(server._criar_usuario(self.registro, nome), 0)
        return saida.getvalue().strip().splitlines()[-1]


class AutenticacaoHttpTest(_RegistroTemporario):
    """Middleware ASGI com usuários reais, em arquivo temporário. Sem subir o servidor."""

    def chamar(self, token=None, path="/mcp"):
        estado = {"app_chamado": False}

        async def app(scope, receive, send):
            estado["app_chamado"] = True
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        respostas = []

        async def send(mensagem):
            respostas.append(mensagem)

        headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
        scope = {"type": "http", "method": "POST", "path": path, "headers": headers}
        _rodar(server._AutenticacaoBearer(app, self.registro)(scope, None, send))
        return respostas[0]["status"], estado["app_chamado"]

    def test_sem_cabecalho_retorna_401(self):
        self.assertEqual(self.chamar(), (401, False))

    def test_token_errado_retorna_401(self):
        self.assertEqual(self.chamar("outro-token"), (401, False))

    def test_token_valido_passa(self):
        self.assertEqual(self.chamar(self.token_ana), (200, True))

    def test_healthz_nao_exige_token(self):
        self.assertEqual(self.chamar(path="/healthz"), (200, False))

    def test_revogacao_vale_sem_reiniciar(self):
        self.assertEqual(self.chamar(self.token_ana), (200, True))
        server._revogar_usuario(self.registro, "ana")
        self.assertEqual(self.chamar(self.token_ana), (401, False))

    def test_um_token_nao_autentica_outro_usuario(self):
        token_bia = self._criar("bia")
        self.assertNotEqual(self.token_ana, token_bia)
        self.assertEqual(self.registro.identificar(token_bia), "bia")
        self.assertEqual(self.registro.identificar(self.token_ana), "ana")

    def test_arquivo_guarda_so_o_hash(self):
        # banco SQLite agora, não arquivo JSON texto: lê em bytes.
        conteudo = self.registro.caminho.read_bytes()
        self.assertNotIn(self.token_ana.encode("utf-8"), conteudo)
        self.assertIn(server._hash_token(self.token_ana).encode("utf-8"), conteudo)


class AdministracaoUsuariosTest(_RegistroTemporario):
    def test_nome_duplicado_ativo_e_recusado(self):
        import io
        from contextlib import redirect_stdout

        with redirect_stdout(io.StringIO()):
            self.assertEqual(server._criar_usuario(self.registro, "ana"), 1)

    def test_nome_revogado_pode_ser_recriado_com_novo_token(self):
        import io
        from contextlib import redirect_stdout

        with redirect_stdout(io.StringIO()):
            server._revogar_usuario(self.registro, "ana")
            self.assertEqual(server._criar_usuario(self.registro, "ana"), 0)
        novo = self.registro.identificar(self.token_ana)
        self.assertIsNone(novo)  # o token antigo não vale mais

    def test_nome_invalido_e_recusado(self):
        import io
        from contextlib import redirect_stdout

        with redirect_stdout(io.StringIO()):
            self.assertEqual(server._criar_usuario(self.registro, "../x"), 1)
            self.assertEqual(server._criar_usuario(self.registro, "a"), 1)

    def test_revogar_inexistente_falha(self):
        import io
        from contextlib import redirect_stdout

        with redirect_stdout(io.StringIO()):
            self.assertEqual(server._revogar_usuario(self.registro, "fulano"), 1)

    def test_listagem_nao_mostra_hash_nem_token(self):
        import io
        from contextlib import redirect_stdout

        saida = io.StringIO()
        with redirect_stdout(saida):
            server._listar_usuarios(self.registro)
        texto = saida.getvalue()
        self.assertIn("ana", texto)
        self.assertNotIn(server._hash_token(self.token_ana), texto)
        self.assertNotIn(self.token_ana, texto)


def _chamar_asgi(middleware, metodo, caminho, headers=(), corpo=b""):
    """Executa o middleware com uma requisição simulada. Devolve (status, corpo, cabecalhos)."""
    respostas = []
    entregue = {"feito": False}

    async def receive():
        if entregue["feito"]:
            return {"type": "http.disconnect"}
        entregue["feito"] = True
        return {"type": "http.request", "body": corpo, "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok-mcp"})

    scope = {"type": "http", "method": metodo, "path": caminho, "headers": list(headers)}
    _rodar(middleware(scope, receive, send))
    inicio = respostas[0]
    corpo_resp = b"".join(m.get("body", b"") for m in respostas[1:])
    return inicio["status"], corpo_resp, dict(inicio["headers"])


class _Relogio:
    def __init__(self):
        # meio-dia local: os testes de limite diário não cruzam a meia-noite
        self.t = datetime(2026, 10, 4, 12, 0).timestamp()

    def __call__(self):
        return self.t


class LimiteDeUsoTest(_RegistroTemporario):
    def setUp(self):
        super().setUp()
        self.relogio = _Relogio()
        self.limitador = server.LimitadorUso(por_minuto=3, por_dia=5, agora=self.relogio)
        self.mw = server._AutenticacaoBearer(None, self.registro, self.limitador)
        # o app interno é trocado por um simples que responde 200
        self.mw.app = self._app

    async def _app(self, scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    def post(self, token=None):
        headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
        return _chamar_asgi(self.mw, "POST", "/mcp", headers)

    def test_limite_por_minuto_bloqueia_e_libera_depois_da_janela(self):
        for _ in range(3):
            self.assertEqual(self.post(self.token_ana)[0], 200)
        status, _, cabecalhos = self.post(self.token_ana)
        self.assertEqual(status, 429)
        self.assertIn(b"retry-after", cabecalhos)
        self.relogio.t += 61
        self.assertEqual(self.post(self.token_ana)[0], 200)

    def test_limite_e_por_usuario(self):
        token_bia = self._criar("bia")
        for _ in range(3):
            self.post(self.token_ana)
        self.assertEqual(self.post(self.token_ana)[0], 429)
        self.assertEqual(self.post(token_bia)[0], 200)

    def test_limite_diario_bloqueia_mesmo_espaçando_as_chamadas(self):
        for _ in range(5):
            self.assertTrue(self.limitador.verificar("ana")[0])
            self.relogio.t += 120  # passa a janela de minuto a cada chamada
        permitido, espera, motivo = self.limitador.verificar("ana")
        self.assertFalse(permitido)
        self.assertIn("por dia", motivo)
        self.assertGreater(espera, 0)

    def test_limite_zero_desliga(self):
        limitador = server.LimitadorUso(por_minuto=0, por_dia=0, agora=self.relogio)
        for _ in range(50):
            self.assertTrue(limitador.verificar("ana")[0])

    def test_healthz_nao_conta_no_limite(self):
        for _ in range(10):
            _chamar_asgi(self.mw, "GET", "/healthz")
        self.assertTrue(self.limitador.verificar("ana")[0])


class PaginaAdministrativaTest(_RegistroTemporario):
    TOKEN_ADMIN = "admin-" + "x" * 30

    def setUp(self):
        super().setUp()
        self.mw = server._AutenticacaoBearer(None, self.registro, None, self.TOKEN_ADMIN)
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})
        self.mw.app = app

    def form(self, **campos):
        from urllib.parse import urlencode
        return urlencode(campos).encode()

    def test_sem_admin_token_configurado_a_pagina_nao_existe(self):
        registro_vazio = db.RegistroUsuarios(self.registro.caminho.with_name('sem-admin.db'))
        mw = server._AutenticacaoBearer(self.mw.app, registro_vazio, None, None)
        self.assertEqual(_chamar_asgi(mw, "GET", "/admin")[0], 404)

    def test_hash_persistido_habilita_pagina_sem_variavel(self):
        mw = server._AutenticacaoBearer(self.mw.app, self.registro, None, None)
        self.assertEqual(_chamar_asgi(mw, "GET", "/admin")[0], 200)

    def test_get_admin_sem_token_nao_lista_usuarios(self):
        status, corpo, _ = _chamar_asgi(self.mw, "GET", "/admin")
        self.assertEqual(status, 200)
        texto = corpo.decode("utf-8")
        self.assertNotIn(">ana</td>", texto)
        self.assertNotIn(self.token_ana, texto)

    def test_token_admin_errado_tambem_nao_vaza_lista(self):
        corpo = self.form(acao="criar", nome="bia", token_admin="errado")
        _, resposta, _ = _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertNotIn(b">ana</td>", resposta)

    def test_acao_autorizada_mostra_lista(self):
        corpo = self.form(acao="criar", nome="bia", token_admin=self.TOKEN_ADMIN)
        _, resposta, _ = _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertIn(b">ana</td>", resposta)

    def test_criar_com_token_admin_certo_mostra_token_novo_uma_vez(self):
        corpo = self.form(acao="criar", nome="bia", token_admin=self.TOKEN_ADMIN)
        status, resposta, _ = _chamar_asgi(
            self.mw, "POST", "/admin/acao",
            [(b"content-type", b"application/x-www-form-urlencoded")], corpo,
        )
        self.assertEqual(status, 200)
        token_novo = self.registro.carregar()["bia"]
        self.assertIn("bia", self.registro.ativos())
        # o token exibido é o que autentica
        self.assertEqual(self.registro.identificar(
            resposta.decode("utf-8").split("<pre class='token-valor'>")[1].split("</pre>")[0]), "bia")
        self.assertIsNotNone(token_novo)

    def test_token_admin_errado_nao_cria_nem_revoga(self):
        corpo = self.form(acao="criar", nome="bia", token_admin="errado")
        status, _, _ = _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertEqual(status, 401)
        self.assertNotIn("bia", self.registro.carregar())
        corpo = self.form(acao="revogar", nome="ana", token_admin="errado")
        _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertIn("ana", self.registro.ativos())

    def test_revogar_pela_pagina_invalida_o_token(self):
        corpo = self.form(acao="revogar", nome="ana", token_admin=self.TOKEN_ADMIN)
        status, _, _ = _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertEqual(status, 200)
        self.assertIsNone(self.registro.identificar(self.token_ana))

    def test_formulario_grande_demais_e_recusado(self):
        corpo = self.form(acao="criar", nome="x" * 5000, token_admin=self.TOKEN_ADMIN)
        status, _, _ = _chamar_asgi(self.mw, "POST", "/admin/acao", [], corpo)
        self.assertEqual(status, 413)

    def test_nome_com_html_e_escapado_na_pagina(self):
        self.registro.salvar({"<script>x</script>": {"hash": "h", "criado_em": "?", "revogado": False}})
        # ação autorizada devolve a página com a lista (revogar um nome inexistente só informa)
        _, corpo, _ = _chamar_asgi(
            self.mw, "POST", "/admin/acao", [],
            self.form(acao="revogar", nome="x", token_admin=self.TOKEN_ADMIN),
        )
        self.assertNotIn(b"<script>x</script>", corpo)
        self.assertIn(b"&lt;script&gt;", corpo)


class CadastroPublicoTest(_RegistroTemporario):
    """Cadastro pelo e-mail: o token vai ao e-mail informado e nunca aparece na página."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroUsuarios(Path(self._dir.name) / "usuarios.json")
        self.enviados: list[tuple[str, str]] = []
        self.falhar_envio = False
        self.cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        self.cadastro = server.CadastroPublico(
            self.registro, self.cfg,
            limitador_ip=server.LimitadorUso(por_minuto=0, por_dia=0),
            limitador_email=server.LimitadorUso(por_minuto=1, por_dia=5),
            enviar=self._enviar,
        )
        self.mw = server._AutenticacaoBearer(None, self.registro, None, None, self.cadastro)
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})
        self.mw.app = app

    def tearDown(self):
        self._dir.cleanup()

    def _enviar(self, destino, token):
        if self.falhar_envio:
            raise OSError("SMTP fora do ar")
        self.enviados.append((destino, token))

    def pedir(self, email, ip="203.0.113.7"):
        return _rodar(self.cadastro.solicitar(email, ip, True))

    def test_sem_aceite_dos_termos_nao_envia_nem_grava(self):
        msg = _rodar(self.cadastro.solicitar("ana@exemplo.com", "1.2.3.4", False))
        self.assertEqual(msg, server.MENSAGEM_TERMOS_NECESSARIOS)
        self.assertEqual(self.enviados, [])
        self.assertEqual(self.registro.ativos(), [])

    def test_aceite_fica_registrado_com_a_versao(self):
        self.pedir("ana@exemplo.com")
        termos = self.registro.carregar()["ana@exemplo.com"]["termos"]
        self.assertEqual(termos["versao"], server.TERMOS_VERSAO)
        self.assertTrue(termos["aceito_em"])

    def test_post_sem_aceite_volta_para_os_termos(self):
        status, corpo, _ = _chamar_asgi(self.mw, "POST", "/cadastro", [], b"email=ana%40exemplo.com")
        self.assertEqual(status, 200)
        self.assertNotIn(b'name="email"', corpo)
        self.assertEqual(self.enviados, [])

    def test_token_vai_para_o_email_e_autentica(self):
        msg = self.pedir("Ana@Exemplo.com.br")
        self.assertEqual(msg, server.MENSAGEM_CADASTRO_OK)
        destino, token = self.enviados[0]
        self.assertEqual(destino, "ana@exemplo.com.br")
        self.assertEqual(self.registro.identificar(token), "ana@exemplo.com.br")

    def test_pagina_nunca_mostra_o_token(self):
        status, corpo, _ = _chamar_asgi(self.mw, "POST", "/cadastro", [], b"email=ana%40exemplo.com.br&aceite=sim")
        self.assertEqual(status, 200)
        _, token = self.enviados[-1]  # o token foi enviado por e-mail nesta chamada
        self.assertEqual(len(self.enviados), 1)
        self.assertNotIn(token.encode(), corpo)

    def test_resposta_igual_para_email_existente_ou_novo(self):
        r1 = self.pedir("ana@exemplo.com")  # e-mail novo
        self.limitar_zerar()
        r2 = self.pedir("ana@exemplo.com")  # e-mail que já tem token
        self.assertEqual(r1, server.MENSAGEM_CADASTRO_OK)
        self.assertEqual(r2, server.MENSAGEM_CADASTRO_OK)

    def test_pedir_de_novo_invalida_o_token_anterior(self):
        self.pedir("ana@exemplo.com")
        primeiro = self.enviados[0][1]
        self.limitar_zerar()
        self.pedir("ana@exemplo.com")
        segundo = self.enviados[1][1]
        self.assertIsNone(self.registro.identificar(primeiro))
        self.assertEqual(self.registro.identificar(segundo), "ana@exemplo.com")

    def limitar_zerar(self):
        # o limite por e-mail é de 1 por minuto; avança o relógio para o teste pedir de novo
        self.cadastro.limitador_email._janela.clear()

    def test_email_invalido_nao_envia_nada(self):
        self.assertEqual(self.pedir("nao-e-email"), "Informe um e-mail válido.")
        self.assertEqual(self.enviados, [])
        self.assertEqual(self.registro.ativos(), [])

    def test_limite_por_email_impede_spam(self):
        self.pedir("ana@exemplo.com")
        self.assertEqual(self.pedir("ana@exemplo.com"), server.MENSAGEM_CADASTRO_LIMITADO)
        self.assertEqual(len(self.enviados), 1)

    def test_falha_de_envio_nao_altera_usuario_nem_revela_nada(self):
        self.pedir("ana@exemplo.com")
        antigo = self.enviados[0][1]
        self.limitar_zerar()
        self.falhar_envio = True
        self.assertEqual(self.pedir("ana@exemplo.com"), server.MENSAGEM_CADASTRO_FALHA)
        self.assertEqual(self.registro.identificar(antigo), "ana@exemplo.com")

    def test_usuario_revogado_pelo_admin_nao_recebe_token(self):
        self.pedir("ana@exemplo.com")
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            server._revogar_usuario(self.registro, "ana@exemplo.com")
        self.limitar_zerar()
        resposta = self.pedir("ana@exemplo.com")
        self.assertEqual(resposta, server.MENSAGEM_CADASTRO_OK)  # mesma resposta
        self.assertEqual(len(self.enviados), 1)  # nenhum e-mail novo
        self.assertEqual(self.registro.ativos(), [])

    def test_revogado_pelo_proprio_usuario_pode_pedir_de_novo(self):
        # só o administrador bloqueia; um token revogado por outro caminho não bloqueia o cadastro
        self.pedir("ana@exemplo.com")
        dados = self.registro.carregar()
        dados["ana@exemplo.com"]["revogado"] = True
        self.registro.salvar(dados)
        self.limitar_zerar()
        self.pedir("ana@exemplo.com")
        self.assertEqual(len(self.enviados), 2)

    def test_cadastro_desligado_sem_smtp_retorna_404(self):
        mw = server._AutenticacaoBearer(self.mw.app, self.registro, None, None, None)
        self.assertEqual(_chamar_asgi(mw, "GET", "/cadastro")[0], 404)
        self.assertEqual(_chamar_asgi(mw, "POST", "/cadastro", [], b"email=a%40b.co")[0], 404)

    def test_get_cadastro_abre_primeiro_os_termos(self):
        status, corpo, _ = _chamar_asgi(self.mw, "GET", "/cadastro")
        self.assertEqual(status, 200)
        self.assertIn("Termos de uso".encode(), corpo)
        self.assertNotIn(b'name="email"', corpo)  # o e-mail ainda não aparece

    def test_etapa_email_so_abre_com_aceite(self):
        _, corpo, _ = _chamar_asgi(self.mw, "GET", "/cadastro", [], b"")
        self.assertNotIn(b'name="email"', corpo)
        scope_sem = {"type": "http", "method": "GET", "path": "/cadastro",
                     "query_string": b"etapa=email", "headers": []}
        scope_com = dict(scope_sem, query_string=b"etapa=email&aceite=sim")
        for scope, esperado_form in ((scope_sem, False), (scope_com, True)):
            respostas = []

            async def send(m, respostas=respostas):
                respostas.append(m)

            _rodar(self.mw(scope, None, send))
            corpo = b"".join(m.get("body", b"") for m in respostas[1:])
            self.assertEqual(b'name="email"' in corpo, esperado_form)

    def test_termos_tem_as_clausulas_principais(self):
        _, corpo, _ = _chamar_asgi(self.mw, "GET", "/cadastro")
        self.assertIn("experimental".encode(), corpo)
        self.assertIn("isenção de responsabilidade".encode(), corpo.lower())
        self.assertIn("responsabilidade do usuário".encode(), corpo.lower())

    def test_ip_vem_do_ultimo_x_forwarded_for(self):
        scope = {"headers": [(b"x-forwarded-for", b"1.1.1.1, 203.0.113.9")], "client": ("127.0.0.1", 1)}
        self.assertEqual(server._ip_cliente(scope), "203.0.113.9")
        self.assertEqual(server._ip_cliente({"headers": [], "client": ("10.0.0.5", 1)}), "10.0.0.5")

    def test_envio_smtp_usa_starttls_e_login(self):
        from unittest import mock as m
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "usuario", "senha", "noreply@teste")
        with m.patch.object(server.smtplib, "SMTP") as smtp:
            servidor = smtp.return_value.__enter__.return_value
            server._enviar_token_por_email(cfg, "ana@exemplo.com", "TOKEN-XYZ")
        smtp.assert_called_once_with("smtp.teste", 587, timeout=30)
        servidor.starttls.assert_called_once()
        servidor.login.assert_called_once_with("usuario", "senha")
        mensagem = servidor.send_message.call_args[0][0]
        self.assertEqual(mensagem["To"], "ana@exemplo.com")
        self.assertIn("TOKEN-XYZ", mensagem.get_content())


class OAuthTest(_RegistroTemporario):
    """Fluxo OAuth 2.1 + PKCE usado pelo conector personalizado do Claude."""

    REDIRECT = "https://claude.ai/api/mcp/auth_callback"
    VERIFICADOR = "verificador-de-teste-com-tamanho-suficiente-1234567890"

    def setUp(self):
        super().setUp()
        self.relogio = _Relogio()
        self.oauth = server.ServidorOAuth(self.registro, Path(self._dir.name) / "oauth.json", agora=self.relogio)

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})

        self.mw = server._AutenticacaoBearer(app, self.registro, None, None, None, self.oauth)
        self.cliente = self._registrar()

    def _registrar(self):
        corpo = json.dumps({"redirect_uris": [self.REDIRECT], "client_name": "Claude"}).encode()
        status, resposta, _ = _chamar_asgi(self.mw, "POST", "/oauth/register", [], corpo)
        self.assertEqual(status, 201)
        return json.loads(resposta)["client_id"]

    def _params(self, **extra):
        base = {
            "response_type": "code", "client_id": self.cliente, "redirect_uri": self.REDIRECT,
            "code_challenge": server._s256(self.VERIFICADOR), "code_challenge_method": "S256", "state": "xyz",
        }
        base.update(extra)
        return base

    def _autorizar(self, token, **extra):
        from urllib.parse import urlencode
        corpo = urlencode(dict(self._params(**extra), token=token)).encode()
        return _chamar_asgi(self.mw, "POST", "/oauth/authorize", [], corpo)

    def _obter_codigo(self, token=None):
        from urllib.parse import urlsplit, parse_qs as pq
        status, _, cab = self._autorizar(token or self.token_ana)
        self.assertEqual(status, 302)
        destino = dict(cab)[b"location"].decode()
        return pq(urlsplit(destino).query)["code"][0]

    def _trocar(self, codigo, verificador=None, client_id=None):
        from urllib.parse import urlencode
        corpo = urlencode({
            "grant_type": "authorization_code", "code": codigo, "client_id": client_id or self.cliente,
            "redirect_uri": self.REDIRECT, "code_verifier": verificador or self.VERIFICADOR,
        }).encode()
        return _chamar_asgi(self.mw, "POST", "/oauth/token", [], corpo)

    def test_metadados_de_descoberta(self):
        status, corpo, _ = _chamar_asgi(self.mw, "GET", "/.well-known/oauth-protected-resource")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(corpo)["resource"].endswith("/mcp"))
        status, corpo, _ = _chamar_asgi(self.mw, "GET", "/.well-known/oauth-authorization-server")
        meta = json.loads(corpo)
        self.assertEqual(meta["code_challenge_methods_supported"], ["S256"])
        self.assertTrue(meta["token_endpoint"].endswith("/oauth/token"))

    def test_registro_recusa_redirect_de_outro_dominio(self):
        corpo = json.dumps({"redirect_uris": ["https://evil.example/callback"]}).encode()
        status, _, _ = _chamar_asgi(self.mw, "POST", "/oauth/register", [], corpo)
        self.assertEqual(status, 400)

    def test_registro_aceita_localhost_para_claude_code(self):
        corpo = json.dumps({"redirect_uris": ["http://localhost:33418/callback"]}).encode()
        status, _, _ = _chamar_asgi(self.mw, "POST", "/oauth/register", [], corpo)
        self.assertEqual(status, 201)

    def test_autorizacao_com_redirect_nao_registrado_nao_redireciona(self):
        from urllib.parse import urlencode
        query = urlencode(self._params(redirect_uri="https://evil.example/x")).encode()
        scope = {"type": "http", "method": "GET", "path": "/oauth/authorize", "headers": [],
                 "query_string": query}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(self.mw(scope, None, send))
        self.assertEqual(respostas[0]["status"], 400)

    def test_autorizacao_sem_pkce_e_recusada(self):
        scope = {"type": "http", "method": "GET", "path": "/oauth/authorize", "headers": [],
                 "query_string": b"response_type=code"}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(self.mw(scope, None, send))
        self.assertEqual(respostas[0]["status"], 400)

    def test_token_correto_gera_access_token_que_autentica_o_mcp(self):
        codigo = self._obter_codigo()
        status, corpo, _ = self._trocar(codigo)
        self.assertEqual(status, 200)
        access = json.loads(corpo)["access_token"]
        status, _, _ = _chamar_asgi(self.mw, "POST", "/mcp",
                                    [(b"authorization", f"Bearer {access}".encode())], b"")
        self.assertEqual(status, 200)

    def test_verificador_errado_nao_gera_token(self):
        codigo = self._obter_codigo()
        status, corpo, _ = self._trocar(codigo, verificador="errado-" + "x" * 40)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(corpo)["error"], "invalid_grant")

    def test_codigo_so_pode_ser_usado_uma_vez(self):
        codigo = self._obter_codigo()
        self.assertEqual(self._trocar(codigo)[0], 200)
        self.assertEqual(self._trocar(codigo)[0], 400)

    def test_codigo_expira(self):
        codigo = self._obter_codigo()
        self.relogio.t += server.ServidorOAuth.CODIGO_VALIDADE_S + 1
        self.assertEqual(self._trocar(codigo)[0], 400)

    def test_token_errado_na_autorizacao_nao_emite_codigo(self):
        status, _, cab = self._autorizar("token-falso")
        self.assertEqual(status, 401)
        self.assertNotIn(b"location", cab)

    def test_revogar_usuario_invalida_access_token(self):
        access = json.loads(self._trocar(self._obter_codigo())[1])["access_token"]
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            server._revogar_usuario(self.registro, "ana")
        status, _, _ = _chamar_asgi(self.mw, "POST", "/mcp",
                                    [(b"authorization", f"Bearer {access}".encode())], b"")
        self.assertEqual(status, 401)

    def test_access_token_expira(self):
        access = json.loads(self._trocar(self._obter_codigo())[1])["access_token"]
        self.relogio.t += server.ServidorOAuth.TOKEN_VALIDADE_S + 1
        status, _, _ = _chamar_asgi(self.mw, "POST", "/mcp",
                                    [(b"authorization", f"Bearer {access}".encode())], b"")
        self.assertEqual(status, 401)

    def test_401_anuncia_resource_metadata(self):
        status, _, cab = _chamar_asgi(self.mw, "POST", "/mcp", [(b"host", b"exemplo.sslip.io")], b"")
        self.assertEqual(status, 401)
        self.assertIn(b"resource_metadata=", cab[b"www-authenticate"])
        self.assertIn(b"https://exemplo.sslip.io/.well-known/oauth-protected-resource", cab[b"www-authenticate"])

    def test_token_direto_de_usuario_continua_valendo(self):
        status, _, _ = _chamar_asgi(self.mw, "POST", "/mcp",
                                    [(b"authorization", f"Bearer {self.token_ana}".encode())], b"")
        self.assertEqual(status, 200)


class CorridaRevogacaoTest(_RegistroTemporario):
    """Revogação feita pelo administrador enquanto o cadastro envia o e-mail não pode ser desfeita."""

    def test_revogacao_de_outro_usuario_durante_o_envio_e_preservada(self):
        self._criar("bia")
        self._criar("ana2")

        def enviar_e_revogar_bia(destino, token):
            # o administrador revoga "bia" enquanto o e-mail do cadastro ainda está sendo enviado
            import io
            from contextlib import redirect_stdout
            with redirect_stdout(io.StringIO()):
                server._revogar_usuario(self.registro, "bia")

        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                          server.LimitadorUso(0, 0), enviar=enviar_e_revogar_bia)
        _rodar(cadastro.solicitar("carla@exemplo.com", "1.2.3.4", True))

        dados = self.registro.carregar()
        self.assertTrue(dados["bia"]["revogado"], "a revogação de bia foi desfeita pelo cadastro")
        self.assertIn("carla@exemplo.com", dados)

    def test_revogacao_do_proprio_email_durante_o_envio_nao_reativa(self):
        def enviar_e_revogar_carla(destino, token):
            import io
            from contextlib import redirect_stdout
            with redirect_stdout(io.StringIO()):
                server._revogar_usuario(self.registro, "carla@exemplo.com")

        # carla já existe e está ativa: o pedido de novo token começa, e o admin revoga no meio
        self._criar("carla@exemplo.com")
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                          server.LimitadorUso(0, 0), enviar=enviar_e_revogar_carla)
        _rodar(cadastro.solicitar("carla@exemplo.com", "1.2.3.4", True))

        dados = self.registro.carregar()
        self.assertTrue(dados["carla@exemplo.com"]["revogado"])
        self.assertEqual(dados["carla@exemplo.com"]["revogado_por"], "admin")


class SegurancaMediaTest(_RegistroTemporario):
    """Achados 4 a 7: logs sem e-mail completo, limite de falhas, limite e limpeza do OAuth."""

    ADMIN = "admin-" + "x" * 30

    def _mw(self, falhas=None, oauth=None, admin=None):
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})
        return server._AutenticacaoBearer(app, self.registro, None, admin, None, oauth, None, None, falhas=falhas)

    def _ip(self, ip):
        return [(b"x-forwarded-for", ip.encode())]

    # achado 4
    def test_rotulo_mascara_email_e_mantem_nome(self):
        self.assertEqual(server._rotulo_usuario("ana.souza@gmail.com"), "a***@gmail.com")
        self.assertEqual(server._rotulo_usuario("ana"), "ana")

    def test_log_de_requisicao_nao_traz_email_completo(self):
        mw = self._mw()
        with self.assertLogs("cnj-processual", level="INFO") as cm:
            _chamar_asgi(mw, "POST", "/mcp", [(b"authorization", f"Bearer {self.token_ana}".encode())], b"")
        texto = "\n".join(cm.output)
        self.assertIn("ana", texto)
        self.assertNotIn("ana@", texto)  # o nome 'ana' é simples, então aparece; e-mails não

    def test_log_com_email_e_mascarado(self):
        token = self._criar("bia.lima@exemplo.com")
        mw = self._mw()
        with self.assertLogs("cnj-processual", level="INFO") as cm:
            _chamar_asgi(mw, "POST", "/mcp", [(b"authorization", f"Bearer {token}".encode())], b"")
        texto = "\n".join(cm.output)
        self.assertNotIn("bia.lima@exemplo.com", texto)
        self.assertIn("b***@exemplo.com", texto)

    # achado 5
    def test_ocupado_nao_registra_tentativa(self):
        limitador = server.LimitadorUso(por_minuto=2, por_dia=100)
        for _ in range(5):
            limitador.ocupado("ip")
        self.assertFalse(limitador.ocupado("ip")[0])

    def test_falhas_de_token_bloqueiam_o_ip(self):
        mw = self._mw(falhas=server.LimitadorUso(por_minuto=10, por_dia=300))
        for _ in range(10):
            _chamar_asgi(mw, "POST", "/mcp", self._ip("9.9.9.9") + [(b"authorization", b"Bearer errado")], b"")
        status, _, cab = _chamar_asgi(mw, "POST", "/mcp",
                                      self._ip("9.9.9.9") + [(b"authorization", f"Bearer {self.token_ana}".encode())], b"")
        self.assertEqual(status, 429)  # mesmo com token válido, o IP está bloqueado
        self.assertIn(b"retry-after", cab)

    def test_bloqueio_nao_atinge_outro_ip(self):
        mw = self._mw(falhas=server.LimitadorUso(por_minuto=10, por_dia=300))
        for _ in range(10):
            _chamar_asgi(mw, "POST", "/mcp", self._ip("9.9.9.9") + [(b"authorization", b"Bearer errado")], b"")
        status, _, _ = _chamar_asgi(mw, "POST", "/mcp",
                                    self._ip("8.8.8.8") + [(b"authorization", f"Bearer {self.token_ana}".encode())], b"")
        self.assertEqual(status, 200)

    def test_admin_bloqueia_apos_tentativas_erradas(self):
        mw = self._mw(falhas=server.LimitadorUso(por_minuto=10, por_dia=300), admin=self.ADMIN)
        corpo = b"acao=criar&nome=x&token_admin=errado"
        for _ in range(10):
            _chamar_asgi(mw, "POST", "/admin/acao", self._ip("7.7.7.7") +
                         [(b"content-type", b"application/x-www-form-urlencoded")], corpo)
        status, _, cab = _chamar_asgi(mw, "POST", "/admin/acao", self._ip("7.7.7.7") +
                                      [(b"content-type", b"application/x-www-form-urlencoded")],
                                      b"acao=criar&nome=x&token_admin=" + self.ADMIN.encode())
        self.assertEqual(status, 429)
        self.assertNotIn("x", self.registro.carregar())  # nenhuma conta foi criada

    # achado 7
    def _oauth(self, **kw):
        return server.ServidorOAuth(self.registro, Path(self._dir.name) / "oauth.json", **kw)

    def test_registro_oauth_tem_limite_por_ip(self):
        oauth = self._oauth(limitador_registro=server.LimitadorUso(por_minuto=5, por_dia=50))
        mw = self._mw(oauth=oauth)
        corpo = json.dumps({"redirect_uris": ["https://claude.ai/cb"]}).encode()
        codigos = [_chamar_asgi(mw, "POST", "/oauth/register", self._ip("6.6.6.6"), corpo)[0] for _ in range(6)]
        self.assertEqual(codigos[:5], [201] * 5)
        self.assertEqual(codigos[5], 429)

    def test_registro_oauth_respeita_o_teto_de_clientes(self):
        oauth = self._oauth()
        oauth.MAX_CLIENTES = 3
        for _ in range(3):
            self.assertIsNotNone(oauth.registrar_cliente(["https://claude.ai/cb"], "x"))
        self.assertIsNone(oauth.registrar_cliente(["https://claude.ai/cb"], "x"))

    def test_limpeza_remove_cliente_antigo_sem_uso(self):
        agora = [time.time()]
        oauth = self._oauth(agora=lambda: agora[0])
        antigo = oauth.registrar_cliente(["https://claude.ai/cb"], "antigo")
        agora[0] += oauth.PRAZO_CLIENTE_NAO_USADO_S + 10
        oauth.registrar_cliente(["https://claude.ai/cb"], "novo")
        self.assertNotIn(antigo, oauth._carregar()["clientes"])

    def test_cliente_que_gerou_token_nao_e_removido(self):
        agora = [time.time()]
        oauth = self._oauth(agora=lambda: agora[0])
        cid = oauth.registrar_cliente(["https://claude.ai/cb"], "usado")
        codigo = oauth.emitir_codigo(cid, "https://claude.ai/cb", server._s256("v" * 50), "ana")
        self.assertIsNotNone(oauth.trocar_codigo(codigo, cid, "https://claude.ai/cb", "v" * 50))
        agora[0] += oauth.PRAZO_CLIENTE_NAO_USADO_S + 10
        oauth.registrar_cliente(["https://claude.ai/cb"], "outro")
        self.assertIn(cid, oauth._carregar()["clientes"])


class SegurancaBaixaTest(_RegistroTemporario):
    """Achados 8 a 12: tempo de resposta fixo, domínio do reCAPTCHA, certidão sem caminho."""

    def test_cadastro_responde_so_depois_do_tempo_minimo(self):
        import time as _t
        antigo = server.CADASTRO_TEMPO_MINIMO_S
        server.CADASTRO_TEMPO_MINIMO_S = 0.4
        try:
            async def app(scope, receive, send):
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"x"})
            cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "n@t")
            cad = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                         server.LimitadorUso(0, 0), enviar=lambda d, t: None)
            mw = server._AutenticacaoBearer(app, self.registro, None, None, cad)
            inicio = _t.monotonic()
            status, _, _ = _chamar_asgi(mw, "POST", "/cadastro", [], b"email=a%40b.co")  # sem aceite: resposta rápida
            self.assertGreaterEqual(_t.monotonic() - inicio, 0.4)
            self.assertEqual(status, 200)
        finally:
            server.CADASTRO_TEMPO_MINIMO_S = antigo

    def test_recaptcha_recusa_resposta_de_outro_dominio(self):
        def resposta(hostname):
            def handler(request):
                return httpx.Response(200, json={"success": True, "hostname": hostname})
            return handler

        anterior = server._TRANSPORTE_HTTP
        try:
            server._TRANSPORTE_HTTP = httpx.MockTransport(resposta("outro.exemplo.com"))
            self.assertFalse(_rodar(server.VerificadorRecaptcha("S", "exemplo.sslip.io").validar("t", "1.1.1.1")))
            server._TRANSPORTE_HTTP = httpx.MockTransport(resposta("exemplo.sslip.io"))
            self.assertTrue(_rodar(server.VerificadorRecaptcha("S", "exemplo.sslip.io").validar("t", "1.1.1.1")))
        finally:
            server._TRANSPORTE_HTTP = anterior


class _CaptchaFalso:
    def __init__(self, aprovado: bool):
        self.aprovado = aprovado
        self.chamadas = 0

    async def validar(self, resposta, ip):
        self.chamadas += 1
        return self.aprovado


class CaptchaTest(_RegistroTemporario):
    """reCAPTCHA: validação no servidor e fluxo do cadastro com e sem verificação."""

    def setUp(self):
        super().setUp()
        self.enviados = []
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        self.cadastro = server.CadastroPublico(
            self.registro, cfg,
            limitador_ip=server.LimitadorUso(por_minuto=0, por_dia=0),
            limitador_email=server.LimitadorUso(por_minuto=0, por_dia=0),
            enviar=lambda destino, token: self.enviados.append(destino),
        )

    def _mw(self, captcha, site_key="CHAVE-SITE"):
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})
        return server._AutenticacaoBearer(app, self.registro, None, None, self.cadastro, None, captcha, site_key)

    def _verificar(self, respostas_google):
        """Roda VerificadorRecaptcha com um Google simulado. Devolve (resultado, chamadas_feitas)."""
        chamadas = []

        def handler(request):
            chamadas.append(request)
            return httpx.Response(200, json=respostas_google)

        anterior = server._TRANSPORTE_HTTP
        server._TRANSPORTE_HTTP = httpx.MockTransport(handler)
        try:
            return _rodar(server.VerificadorRecaptcha("SEGREDO").validar("token-do-widget", "1.2.3.4")), chamadas
        finally:
            server._TRANSPORTE_HTTP = anterior

    def test_verificador_aceita_quando_google_confirma(self):
        resultado, chamadas = self._verificar({"success": True})
        self.assertTrue(resultado)
        self.assertIn(b"secret=SEGREDO", chamadas[0].content)

    def test_verificador_recusa_quando_google_nega(self):
        resultado, _ = self._verificar({"success": False})
        self.assertFalse(resultado)

    def test_verificador_recusa_resposta_vazia_sem_chamar_google(self):
        self.assertFalse(_rodar(server.VerificadorRecaptcha("SEGREDO").validar("", "1.2.3.4")))

    def test_verificador_recusa_quando_rede_falha(self):
        def handler(request):
            raise httpx.ConnectError("sem rede", request=request)
        anterior = server._TRANSPORTE_HTTP
        server._TRANSPORTE_HTTP = httpx.MockTransport(handler)
        try:
            self.assertFalse(_rodar(server.VerificadorRecaptcha("SEGREDO").validar("x", "1.2.3.4")))
        finally:
            server._TRANSPORTE_HTTP = anterior

    def test_captcha_reprovado_nao_envia_token(self):
        captcha = _CaptchaFalso(aprovado=False)
        status, corpo, _ = _chamar_asgi(self._mw(captcha), "POST", "/cadastro", [],
                                        b"email=ana%40exemplo.com&aceite=sim")
        self.assertEqual(status, 200)
        self.assertIn(server.MENSAGEM_CAPTCHA_FALHA.encode(), corpo)
        self.assertEqual(self.enviados, [])
        self.assertEqual(captcha.chamadas, 1)

    def test_captcha_aprovado_envia_token(self):
        captcha = _CaptchaFalso(aprovado=True)
        _chamar_asgi(self._mw(captcha), "POST", "/cadastro", [],
                     b"email=ana%40exemplo.com&aceite=sim&g-recaptcha-response=ok")
        self.assertEqual(self.enviados, ["ana@exemplo.com"])

    def test_pagina_de_email_mostra_widget_so_com_chave_configurada(self):
        mw_com = self._mw(_CaptchaFalso(True), site_key="CHAVE-SITE")
        mw_sem = self._mw(None, site_key=None)
        scope = {"type": "http", "method": "GET", "path": "/cadastro",
                 "query_string": b"etapa=email&aceite=sim", "headers": []}
        for mw, esperado in ((mw_com, True), (mw_sem, False)):
            respostas = []

            async def send(m, respostas=respostas):
                respostas.append(m)

            _rodar(mw(scope, None, send))
            corpo = b"".join(m.get("body", b"") for m in respostas[1:])
            self.assertEqual(b'class="g-recaptcha"' in corpo, esperado)
            self.assertEqual(b'data-sitekey="CHAVE-SITE"' in corpo, esperado)

    def test_aviso_de_anotar_token_na_pagina_e_no_email(self):
        scope = {"type": "http", "method": "GET", "path": "/cadastro",
                 "query_string": b"etapa=email&aceite=sim", "headers": []}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(self._mw(None, None)(scope, None, send))
        corpo = b"".join(m.get("body", b"") for m in respostas[1:]).decode("utf-8")
        self.assertIn("Anote o seu token", corpo)
        self.assertIn("não será mostrado novamente", corpo)

    def test_email_do_token_traz_o_aviso(self):
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        from unittest import mock as m
        with m.patch.object(server.smtplib, "SMTP") as smtp:
            servidor = smtp.return_value.__enter__.return_value
            server._enviar_token_por_email(cfg, "ana@exemplo.com", "TOKEN-XYZ")
        texto = servidor.send_message.call_args[0][0].get_content()
        self.assertIn("não será mostrado novamente", texto)


class FeedbackEnvioTest(_RegistroTemporario):
    """Oportunidade 1: a página de cadastro usa um script externo e mostra a barra de envio."""

    def setUp(self):
        super().setUp()
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                          server.LimitadorUso(0, 0), enviar=lambda d, t: None)

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})

        self.mw = server._AutenticacaoBearer(app, self.registro, None, None, cadastro)

    def _pagina_email(self):
        scope = {"type": "http", "method": "GET", "path": "/cadastro",
                 "query_string": b"etapa=email&aceite=sim", "headers": []}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(self.mw(scope, None, send))
        return b"".join(m.get("body", b"") for m in respostas[1:])

    def test_pagina_carrega_script_externo_e_barra(self):
        corpo = self._pagina_email()
        self.assertIn(b'<script src="/static/cadastro.js" defer></script>', corpo)
        self.assertIn(b'src="/static/ui-controls.js"', corpo)
        self.assertIn(b'src="/static/carbon/ui-controls.min.js"', corpo)

    def test_nao_ha_script_inline_na_pagina(self):
        corpo = self._pagina_email()
        # a CSP do Caddy bloqueia script inline: o único <script> aceito tem src externo
        for trecho in corpo.split(b"<script")[1:]:
            self.assertIn(b"src=", trecho.split(b">", 1)[0])

    def test_rota_do_script_responde_javascript(self):
        status, corpo, cab = _chamar_asgi(self.mw, "GET", "/static/cadastro.js")
        self.assertEqual(status, 200)
        self.assertIn(b"javascript", cab[b"content-type"])
        self.assertIn(b"mostrarEnvio", corpo)

    def test_script_nao_e_servido_para_metodos_inseguros(self):
        self.assertEqual(_chamar_asgi(self.mw, "POST", "/static/cadastro.js", [], b"")[0], 401)


class PainelWebTest(_RegistroTemporario):
    """Painel web em /app: fala MCP direto do navegador com o token da própria pessoa."""

    def setUp(self):
        super().setUp()
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})
        self.mw = server._AutenticacaoBearer(app, self.registro)

    def test_pagina_e_publica_e_carrega_script_e_carbon(self):
        status, corpo, cab = _chamar_asgi(self.mw, "GET", "/app")
        self.assertEqual(status, 200)
        self.assertIn(b"text/html", cab[b"content-type"])
        self.assertIn(b'src="/static/app.js"', corpo)
        self.assertIn(b'href="/static/carbon/styles.min.css"', corpo)
        self.assertIn(b'src="/static/carbon/oab-components.min.js"', corpo)
        self.assertLess(corpo.index(b'/static/carbon/oab-components.min.js'), corpo.index(b'/static/app.js'))
        self.assertIn(b'id="form-processo"', corpo)
        self.assertIn(b'id="form-publicacoes"', corpo)

    def test_pagina_nao_tem_script_inline(self):
        _, corpo, _ = _chamar_asgi(self.mw, "GET", "/app")
        for trecho in corpo.split(b"<script")[1:]:
            self.assertIn(b"src=", trecho.split(b">", 1)[0])

    def test_app_so_aceita_get(self):
        self.assertEqual(_chamar_asgi(self.mw, "POST", "/app", [], b"")[0], 401)

    def test_script_do_painel_e_servido(self):
        status, corpo, cab = _chamar_asgi(self.mw, "GET", "/static/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"javascript", cab[b"content-type"])
        self.assertIn(b"class ClienteMCP", corpo)
        self.assertIn(b"tools/call", corpo)
        self.assertIn(b"consultar_processo_datajud", corpo)
        self.assertIn(b"consultar_publicacoes_djen", corpo)
        self.assertIn(b"baixar_certidao_djen", corpo)
        status, bundle, cab = _chamar_asgi(self.mw, "GET", "/static/carbon/oab-components.min.js")
        self.assertEqual(status, 200)
        self.assertIn(b"javascript", cab[b"content-type"])
        for componente in (b"cds-table", b"cds-toggletip", b"cds-tag", b"cds-icon-button"):
            self.assertIn(componente, bundle)

    def test_script_do_painel_so_aceita_get(self):
        self.assertEqual(_chamar_asgi(self.mw, "POST", "/static/app.js", [], b"")[0], 401)

    def test_tema_assets_publicos_sem_cache(self):
        for caminho, tipo in (("/static/theme.js", b"javascript"),
                              ("/static/theme.css", b"text/css"),
                              ("/static/carbon/theme-components.min.js", b"javascript")):
            with self.subTest(caminho=caminho):
                status, corpo, cab = _chamar_asgi(self.mw, "GET", caminho)
                self.assertEqual(status, 200)
                self.assertTrue(corpo)
                self.assertIn(tipo, cab[b"content-type"])
                self.assertEqual(cab[b"cache-control"], b"no-store")
                self.assertEqual(_chamar_asgi(self.mw, "POST", caminho, [], b"")[0], 401)

    def test_search_carbon_assets_publicos_sem_cache(self):
        for caminho, tipo in (("/static/search-fields.js", b"javascript"),
                              ("/static/notificacoes.js", b"javascript"),
                              ("/static/search-fields.css", b"text/css"),
                              ("/static/carbon/search-components.min.js", b"javascript"),
                              ("/static/ui-controls.js", b"javascript"),
                              ("/static/ui-controls.css", b"text/css"),
                              ("/static/carbon/ui-controls.min.js", b"javascript")):
            with self.subTest(caminho=caminho):
                status, corpo, cab = _chamar_asgi(self.mw, "GET", caminho)
                self.assertEqual(status, 200)
                self.assertTrue(corpo)
                self.assertIn(tipo, cab[b"content-type"])
                self.assertEqual(cab[b"cache-control"], b"no-store")
                self.assertEqual(_chamar_asgi(self.mw, "POST", caminho, [], b"")[0], 401)


class GuiaUsuarioTest(_RegistroTemporario):
    """Guia público em /guia e links para ele nas páginas de cadastro."""

    def setUp(self):
        super().setUp()
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                          server.LimitadorUso(0, 0), enviar=lambda d, t: None)

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"mcp"})

        self.mw = server._AutenticacaoBearer(app, self.registro, None, None, cadastro)

    def test_guia_e_publico_sem_token(self):
        status, corpo, cab = _chamar_asgi(self.mw, "GET", "/guia")
        self.assertEqual(status, 200)
        self.assertIn("Como usar".encode(), corpo)
        self.assertIn(b"text/html", cab[b"content-type"])

    def test_guia_so_aceita_get(self):
        self.assertEqual(_chamar_asgi(self.mw, "POST", "/guia", [], b"")[0], 401)

    def test_paginas_de_cadastro_linkam_o_guia(self):
        _, termos, _ = _chamar_asgi(self.mw, "GET", "/cadastro")
        self.assertIn(b'href="/guia"', termos)
        scope = {"type": "http", "method": "GET", "path": "/cadastro",
                 "query_string": b"etapa=email&aceite=sim", "headers": []}
        respostas = []

        async def send(m):
            respostas.append(m)

        _rodar(self.mw(scope, None, send))
        email = b"".join(m.get("body", b"") for m in respostas[1:])
        self.assertIn(b'href="/guia"', email)


class SegurancaDeTransporteTest(unittest.TestCase):
    """O domínio público precisa entrar tanto em Host quanto em Origin (bug real: painel web
    quebrava com "Invalid Origin header", porque só Host estava liberado)."""

    def test_sem_variavel_desliga_a_checagem_extra(self):
        self.assertIsNone(server._seguranca_de_transporte(""))

    def test_dominio_entra_em_host_e_em_origin_https_e_http(self):
        seg = server._seguranca_de_transporte("exemplo.sslip.io")
        self.assertIn("exemplo.sslip.io", seg.allowed_hosts)
        self.assertIn("https://exemplo.sslip.io", seg.allowed_origins)
        self.assertIn("http://exemplo.sslip.io", seg.allowed_origins)

    def test_localhost_continua_liberado(self):
        seg = server._seguranca_de_transporte("exemplo.com.br")
        self.assertIn("http://localhost:*", seg.allowed_origins)
        self.assertIn("localhost:*", seg.allowed_hosts)

    def test_varios_dominios_separados_por_virgula(self):
        seg = server._seguranca_de_transporte("a.exemplo.com, b.exemplo.com")
        self.assertIn("a.exemplo.com", seg.allowed_hosts)
        self.assertIn("b.exemplo.com", seg.allowed_hosts)
        self.assertIn("https://a.exemplo.com", seg.allowed_origins)
        self.assertIn("https://b.exemplo.com", seg.allowed_origins)


class MonitoramentoRegistroTest(unittest.TestCase):
    """RegistroMonitoramentos: mesmo padrão de leitura/escrita atômica que RegistroUsuarios."""

    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroMonitoramentos(Path(self._dir.name) / "monitoramentos.json")

    def tearDown(self):
        self._dir.cleanup()

    def test_arquivo_inexistente_comeca_vazio(self):
        self.assertEqual(self.registro.carregar(), {})

    def test_atualizar_grava_e_pode_ser_relido_de_outra_instancia(self):
        self.registro.atualizar(lambda d: d.update({"x1": {"usuario": "a@a.com"}}))
        outro = server.RegistroMonitoramentos(self.registro.caminho)
        self.assertEqual(outro.carregar(), {"x1": {"usuario": "a@a.com"}})

    def test_do_usuario_filtra_por_usuario(self):
        self.registro.atualizar(lambda d: d.update({
            "x1": {"usuario": "a@a.com"}, "x2": {"usuario": "b@b.com"},
        }))
        self.assertEqual(set(self.registro.do_usuario("a@a.com")), {"x1"})


class _RelogioMonitoramento:
    """Relógio injetável para os testes de Monitoramento: devolve um datetime fixo, avançável."""

    def __init__(self, inicio):
        self.t = inicio

    def __call__(self):
        return self.t


class MonitoramentoCriacaoTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroMonitoramentos(Path(self._dir.name) / "monitoramentos.json")
        self.relogio = _RelogioMonitoramento(datetime(2026, 10, 7, 12, 0))

    def tearDown(self):
        self._dir.cleanup()

    def criar(self, usuario="ana@exemplo.com", numero_processo=None, sigla_tribunal=None,
              numero_oab=None, uf_oab=None):
        return server._criar_monitoramento(self.registro, usuario, numero_processo, sigla_tribunal,
                                            numero_oab, uf_oab, self.relogio)

    def test_usuario_sem_email_e_recusado(self):
        r = self.criar(usuario="ana", numero_oab="330659")
        self.assertTrue(r["erro"])
        self.assertEqual(self.registro.carregar(), {})

    def test_sem_processo_nem_oab_e_recusado(self):
        r = self.criar()
        self.assertTrue(r["erro"])
        self.assertEqual(self.registro.carregar(), {})

    def test_sucesso_grava_criterio_normalizado_e_expiracao(self):
        r = self.criar(numero_oab="330659", uf_oab="sp")
        self.assertNotIn("erro", r)
        self.assertEqual(r["criterio"], {"numero_oab": "330659", "uf_oab": "SP"})
        self.assertEqual(r["expira_em"], (server.monitoramento_runtime.utc(self.relogio.t) + timedelta(days=180)).isoformat())
        self.assertEqual(len(self.registro.carregar()), 1)

    def test_numero_processo_tem_mascara_removida(self):
        r = self.criar(numero_processo="1006314-27.2023.8.26.0005")
        self.assertEqual(r["criterio"]["numero_processo"], "10063142720238260005")

    def test_limite_de_cinco_por_usuario_e_respeitado(self):
        for i in range(5):
            r = self.criar(numero_oab=str(i))
            self.assertNotIn("erro", r)
        r = self.criar(numero_oab="999")
        self.assertTrue(r["erro"])
        self.assertIn("5", r["mensagem"])

    def test_limite_e_por_usuario_nao_global(self):
        for i in range(5):
            self.criar(usuario="ana@exemplo.com", numero_oab=str(i))
        r = self.criar(usuario="bia@exemplo.com", numero_oab="1")
        self.assertNotIn("erro", r)


class MonitoramentoListagemRemocaoTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroMonitoramentos(Path(self._dir.name) / "monitoramentos.json")
        self.relogio = _RelogioMonitoramento(datetime(2026, 10, 7, 12, 0))
        self.criado = server._criar_monitoramento(
            self.registro, "ana@exemplo.com", None, None, "330659", "SP", self.relogio
        )

    def tearDown(self):
        self._dir.cleanup()

    def test_lista_so_do_proprio_usuario(self):
        server._criar_monitoramento(self.registro, "bia@exemplo.com", None, None, "1", "SP", self.relogio)
        r = server._listar_monitoramentos(self.registro, "ana@exemplo.com")
        self.assertEqual(len(r["monitoramentos"]), 1)
        self.assertEqual(r["monitoramentos"][0]["id"], self.criado["id"])

    def test_lista_nao_expoe_hashes_notificados(self):
        r = server._listar_monitoramentos(self.registro, "ana@exemplo.com")
        self.assertNotIn("hashes_notificados", r["monitoramentos"][0])

    def test_remover_apaga_do_arquivo(self):
        r = server._remover_monitoramento(self.registro, "ana@exemplo.com", self.criado["id"])
        self.assertEqual(r, {"removido": True})
        self.assertEqual(self.registro.carregar(), {})

    def test_remover_de_outro_usuario_e_recusado(self):
        r = server._remover_monitoramento(self.registro, "bia@exemplo.com", self.criado["id"])
        self.assertTrue(r["erro"])
        self.assertEqual(len(self.registro.carregar()), 1)

    def test_remover_inexistente_e_recusado(self):
        r = server._remover_monitoramento(self.registro, "ana@exemplo.com", "nao-existe")
        self.assertTrue(r["erro"])


class MonitoramentoVerificacaoTest(_Simulado, unittest.TestCase):
    """_verificar_monitoramentos_pendentes: usa o mesmo transporte HTTP simulado do DJEN e um
    'enviar' injetado no lugar do SMTP real (mesmo padrão de CadastroPublico)."""

    def setUp(self):
        super().setUp()
        self.tempo = 1000.0
        self.circuito = server.CircuitBreaker("DJEN", agora=lambda: self.tempo)
        for nome, valor in (
            ("_CIRCUIT_DJEN", self.circuito),
            ("_FALHAS_MONITORAMENTO", {}),
            ("_PROXIMA_TENTATIVA_MONITORAMENTO", {}),
        ):
            patch = mock.patch.object(server, nome, valor)
            patch.start()
            self.addCleanup(patch.stop)
        self._dir = tempfile.TemporaryDirectory()
        self.registro = server.RegistroMonitoramentos(Path(self._dir.name) / "monitoramentos.json")
        self.relogio = _RelogioMonitoramento(datetime(2026, 10, 7, 12, 0))
        self.smtp = server.ConfiguracaoSMTP(host="smtp.test", porta=587, usuario="u", senha="s", remetente="from@test")
        self.avisos = []
        self.criado = server._criar_monitoramento(
            self.registro, "ana@exemplo.com", None, None, "330659", "SP", self.relogio
        )

    def tearDown(self):
        self._dir.cleanup()
        super().tearDown()

    def _enviar_fake(self, destino, criterio, itens):
        self.avisos.append((destino, criterio, itens))

    def verificar(self, enviar=None):
        return server._verificar_monitoramentos_pendentes(
            self.registro, self.smtp, agora=self.relogio, enviar=enviar or self._enviar_fake
        )

    def test_sem_smtp_coleta_e_preserva_entrega_pendente(self):
        self.responder(_json(200, DJEN_OK))
        _rodar(server._verificar_monitoramentos_pendentes(self.registro, None, agora=self.relogio))
        self.assertEqual(len(self.chamadas), 2)
        repo = server.monitoramento_runtime.Repositorio(self.registro.caminho)
        self.assertEqual(len(repo.pendentes(self.criado['id'], 'email')), 1)

    def test_publicacao_nova_dispara_aviso_e_atualiza_hashes(self):
        self.responder(_json(200, DJEN_OK))
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)
        destino, _criterio, itens = self.avisos[0]
        self.assertEqual(destino, "ana@exemplo.com")
        self.assertEqual(itens[0]["hash"], "abc123")
        atual = self.registro.carregar()[self.criado["id"]]
        self.assertEqual(atual["hashes_notificados"], ["abc123"])
        self.assertEqual(atual["expira_em"], (server.monitoramento_runtime.utc(self.relogio.t) + timedelta(days=180)).isoformat())

    def test_mesma_publicacao_nao_avisa_duas_vezes(self):
        self.responder(_json(200, DJEN_OK))
        _rodar(self.verificar())
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)

    def test_monitoramento_expirado_sem_novidade_e_removido(self):
        self.responder(_json(200, {"count": 0, "items": []}))
        self.relogio.t = datetime.fromisoformat(self.criado["expira_em"])
        _rodar(self.verificar())
        self.assertEqual(self.registro.carregar(), {})

    def test_monitoramento_nao_expirado_sem_novidade_fica_intacto(self):
        self.responder(_json(200, {"count": 0, "items": []}))
        _rodar(self.verificar())
        self.assertEqual(len(self.registro.carregar()), 1)

    def test_falha_no_djen_nao_quebra_nem_expira(self):
        self.responder(httpx.Response(403))
        self.relogio.t = datetime.fromisoformat(self.criado["expira_em"])  # já venceria, mas a falha não deve expirar
        _rodar(self.verificar())
        self.assertEqual(len(self.registro.carregar()), 1)
        self.assertEqual(self.avisos, [])

    def test_falha_ao_enviar_email_nao_marca_como_notificado(self):
        self.responder(_json(200, DJEN_OK))

        def enviar_que_falha(destino, criterio, itens):
            raise RuntimeError("smtp fora do ar")

        _rodar(self.verificar(enviar=enviar_que_falha))
        atual = self.registro.carregar()[self.criado["id"]]
        self.assertEqual(atual.get("hashes_notificados"), [])

    def test_outro_monitoramento_continua_sendo_verificado_apos_falha(self):
        server._criar_monitoramento(self.registro, "bia@exemplo.com", None, None, "1", "SP", self.relogio)

        def responder(request):
            self.chamadas.append(request)
            if request.url.params.get("numeroOab") == "330659":
                return httpx.Response(403)
            return _json(200, DJEN_OK)  # sonda e consulta do outro monitoramento

        server._TRANSPORTE_HTTP = httpx.MockTransport(responder)
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)
        self.assertEqual(self.avisos[0][0], "bia@exemplo.com")
        atual = self.registro.carregar()[self.criado["id"]]
        self.assertEqual(atual.get("hashes_notificados", []), [])

    def test_sonda_retorna_apos_indisponibilidade_e_cooldown(self):
        antes = self.registro.carregar()
        self.responder(httpx.Response(503))
        for _ in range(self.circuito.falhas_para_abrir):
            _rodar(self.verificar())
        self.assertEqual(self.circuito.estado, server.CircuitBreaker.ABERTO)
        self.assertEqual(self.registro.carregar(), antes)
        self.assertEqual(self.avisos, [])
        self.assertEqual(len(self.chamadas), server.DJEN_TENTATIVAS * self.circuito.falhas_para_abrir)

        self.chamadas.clear()
        self.responder(_json(200, DJEN_OK))
        _rodar(self.verificar())
        self.assertEqual(self.chamadas, [])  # ainda no cooldown
        self.tempo += self.circuito.cooldown_s
        _rodar(self.verificar())
        self.assertEqual(self.circuito.estado, server.CircuitBreaker.FECHADO)
        self.assertEqual(len(self.avisos), 1)
        self.assertEqual(len(self.chamadas), 2)  # sonda e consulta
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)  # recuperação não duplica aviso

    def test_consulta_retorna_apos_backoff_e_limpa_contadores(self):
        mon_id = self.criado["id"]

        def responder(request):
            self.chamadas.append(request)
            if request.url.params.get("numeroOab"):
                return httpx.Response(503)
            return _json(200, DJEN_OK)

        server._TRANSPORTE_HTTP = httpx.MockTransport(responder)
        with mock.patch.object(server.time, "time", side_effect=lambda: self.tempo):
            _rodar(self.verificar())
            self.assertEqual(server._FALHAS_MONITORAMENTO[mon_id], 1)
            proxima = server._PROXIMA_TENTATIVA_MONITORAMENTO[mon_id]
            self.assertEqual(proxima, self.tempo + server.MONITORAMENTO_INTERVALO_HORAS * 3600)
            self.assertEqual(self.avisos, [])
            self.assertEqual(self.registro.carregar()[mon_id].get("hashes_notificados", []), [])

            self.chamadas.clear()
            self.responder(_json(200, DJEN_OK))
            _rodar(self.verificar())
            self.assertEqual(len(self.chamadas), 1)  # só a sonda durante o backoff
            self.assertEqual(self.avisos, [])
            self.tempo = proxima
            _rodar(self.verificar())
            self.assertEqual(len(self.avisos), 1)
            self.assertNotIn(mon_id, server._FALHAS_MONITORAMENTO)
            self.assertNotIn(mon_id, server._PROXIMA_TENTATIVA_MONITORAMENTO)
            self.assertEqual(self.registro.carregar()[mon_id]["hashes_notificados"], ["abc123"])
            _rodar(self.verificar())
            self.assertEqual(len(self.avisos), 1)

    def test_email_retorna_apos_falha_sem_perder_nem_duplicar_aviso(self):
        self.responder(_json(200, DJEN_OK))
        enviar = mock.Mock(side_effect=RuntimeError("smtp fora do ar"))
        _rodar(self.verificar(enviar=enviar))
        enviar.assert_called_once()
        self.assertEqual(self.registro.carregar()[self.criado["id"]].get("hashes_notificados", []), [])
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)
        self.assertEqual(self.registro.carregar()[self.criado["id"]]["hashes_notificados"], ["abc123"])
        _rodar(self.verificar())
        self.assertEqual(len(self.avisos), 1)


class IdentificacaoUsuarioNaToolTest(_RegistroTemporario):
    """_usuario_da_requisicao: simula só o que a função lê de ctx.request_context.request
    (headers), em vez de montar um Request Starlette real."""

    def setUp(self):
        super().setUp()
        self._estado_original = server._ESTADO_MONITORAMENTO
        monitoramentos = Path(self._dir.name) / "monitoramentos.json"
        server._ESTADO_MONITORAMENTO = server._EstadoMonitoramento(
            registro_usuarios=self.registro, oauth=None,
            registro_monitoramentos=server.RegistroMonitoramentos(monitoramentos),
            smtp=None,
        )

    def tearDown(self):
        server._ESTADO_MONITORAMENTO = self._estado_original
        super().tearDown()

    def _ctx(self, token=None):
        from types import SimpleNamespace
        headers = {"authorization": f"Bearer {token}"} if token else {}
        request = SimpleNamespace(headers=headers)
        return SimpleNamespace(request_context=SimpleNamespace(request=request))

    def test_sem_estado_devolve_none(self):
        server._ESTADO_MONITORAMENTO = None
        self.assertIsNone(server._usuario_da_requisicao(self._ctx(self.token_ana)))

    def test_sem_requisicao_http_devolve_none(self):
        from types import SimpleNamespace
        ctx = SimpleNamespace(request_context=SimpleNamespace(request=None))
        self.assertIsNone(server._usuario_da_requisicao(ctx))

    def test_token_valido_identifica_usuario(self):
        self.assertEqual(server._usuario_da_requisicao(self._ctx(self.token_ana)), "ana")

    def test_token_invalido_devolve_none(self):
        self.assertIsNone(server._usuario_da_requisicao(self._ctx("token-errado")))

    def test_sem_token_devolve_none(self):
        self.assertIsNone(server._usuario_da_requisicao(self._ctx()))


class MonitoramentoToolSemServidorHospedadoTest(unittest.TestCase):
    """Em modo stdio (sem HTTP), _ESTADO_MONITORAMENTO nunca é montado: as tools devem recusar
    com uma mensagem clara, em vez de quebrar."""

    def setUp(self):
        self._estado_original = server._ESTADO_MONITORAMENTO
        server._ESTADO_MONITORAMENTO = None

    def tearDown(self):
        server._ESTADO_MONITORAMENTO = self._estado_original

    def _ctx_vazio(self):
        from types import SimpleNamespace
        return SimpleNamespace(request_context=SimpleNamespace(request=None))

    def test_monitorar_sem_servidor_hospedado_e_recusado(self):
        r = _rodar(server.monitorar_publicacoes(self._ctx_vazio(), numero_oab="1"))
        self.assertTrue(r["erro"])

    def test_listar_sem_servidor_hospedado_e_recusado(self):
        r = _rodar(server.listar_monitoramentos(self._ctx_vazio()))
        self.assertTrue(r["erro"])

    def test_remover_sem_servidor_hospedado_e_recusado(self):
        r = _rodar(server.remover_monitoramento(self._ctx_vazio(), id="x"))
        self.assertTrue(r["erro"])


class MonitoramentoToolIntegradoTest(_RegistroTemporario):
    """Fluxo completo criar/listar/remover passando pelas tools MCP (não pelas funções puras),
    com um token real emitido para um usuário cujo nome é um e-mail."""

    def setUp(self):
        super().setUp()
        self._estado_original = server._ESTADO_MONITORAMENTO
        self._dir_mon = tempfile.TemporaryDirectory()
        server._ESTADO_MONITORAMENTO = server._EstadoMonitoramento(
            registro_usuarios=self.registro, oauth=None,
            registro_monitoramentos=server.RegistroMonitoramentos(Path(self._dir_mon.name) / "monitoramentos.json"),
            smtp=server.ConfiguracaoSMTP(host="smtp.test", porta=587, usuario="u", senha="s", remetente="from@test"),
        )

    def tearDown(self):
        server._ESTADO_MONITORAMENTO = self._estado_original
        self._dir_mon.cleanup()
        super().tearDown()

    def _ctx(self, token):
        from types import SimpleNamespace
        request = SimpleNamespace(headers={"authorization": f"Bearer {token}"})
        return SimpleNamespace(request_context=SimpleNamespace(request=request))

    def test_fluxo_criar_listar_remover_via_tool(self):
        token_email = self._criar("ana@exemplo.com")
        ctx = self._ctx(token_email)

        criado = _rodar(server.monitorar_publicacoes(ctx, numero_oab="330659", uf_oab="SP"))
        self.assertNotIn("erro", criado)

        listado = _rodar(server.listar_monitoramentos(ctx))
        self.assertEqual(len(listado["monitoramentos"]), 1)

        removido = _rodar(server.remover_monitoramento(ctx, id=criado["id"]))
        self.assertEqual(removido, {"removido": True})

        listado_depois = _rodar(server.listar_monitoramentos(ctx))
        self.assertEqual(listado_depois["monitoramentos"], [])

    def test_token_invalido_e_recusado_pela_tool(self):
        r = _rodar(server.monitorar_publicacoes(self._ctx("token-errado"), numero_oab="1"))
        self.assertTrue(r["erro"])


class RegistroDeToolsTest(unittest.TestCase):
    def test_tools_registradas(self):
        nomes = {t.name for t in _rodar(server.mcp.list_tools())}
        self.assertEqual(nomes, {
            "consultar_processo_datajud", "consultar_publicacoes_djen", "baixar_certidao_djen",
            "monitorar_publicacoes", "listar_monitoramentos", "remover_monitoramento",
            "buscar_feriados_forenses", "consultar_jurimetria_cjpg",
            "perfil_decisorio_magistrado", "status_apis", "consultar_processo_unificado", "renovar_monitoramento",
        })


class AsaasIntegracaoTest(unittest.TestCase):
    """Testa asaas_integracao.py isolado do server.py - só precisa de um httpx.AsyncClient
    com transporte simulado, sem tocar na rede."""

    def _cliente(self, *respostas):
        fila = list(respostas)

        def handler(request: httpx.Request) -> httpx.Response:
            self.ultima_requisicao = request
            return fila.pop(0) if len(fila) > 1 else fila[0]

        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def test_listar_cobrancas_manda_filtros_na_query_e_devolve_a_lista(self):
        async def ir():
            async with self._cliente(_json(200, {
                "data": [{"id": "pay_1", "customer": "cus_1", "status": "PENDING"}],
                "totalCount": 1, "hasMore": False,
            })) as cliente:
                return await asaas_integracao.listar_cobrancas(
                    cliente, "https://api-sandbox.asaas.com/v3", "chave",
                    customer_id="cus_1", status="PENDING", offset=10,
                )
        resultado = _rodar(ir())
        self.assertEqual(resultado["data"][0]["id"], "pay_1")
        query = dict(self.ultima_requisicao.url.params)
        self.assertEqual(query["customer"], "cus_1")
        self.assertEqual(query["status"], "PENDING")
        self.assertEqual(query["offset"], "10")

    def test_criar_cobranca_pix_manda_billing_type_correto(self):
        async def ir():
            async with self._cliente(_json(200, {"id": "pay_2", "billingType": "PIX"})) as cliente:
                return await asaas_integracao.criar_cobranca(
                    cliente, "https://api-sandbox.asaas.com/v3", "chave", "cus_1",
                    "2026-11-01", billing_type="PIX", valor=150.0,
                )
        resultado = _rodar(ir())
        self.assertEqual(resultado["billingType"], "PIX")
        self.assertEqual(json.loads(self.ultima_requisicao.content)["billingType"], "PIX")

    def test_criar_cobranca_parcelada_manda_installment_count_e_total_value_sem_value(self):
        async def ir():
            async with self._cliente(_json(200, {"id": "pay_4", "installment": "inst_1", "installmentNumber": 1})) as cliente:
                return await asaas_integracao.criar_cobranca(
                    cliente, "https://api-sandbox.asaas.com/v3", "chave", "cus_1", "2026-11-01",
                    parcelas=3, valor_total=300.0,
                )
        resultado = _rodar(ir())
        self.assertEqual(resultado["installment"], "inst_1")
        corpo = json.loads(self.ultima_requisicao.content)
        self.assertEqual(corpo["installmentCount"], 3)
        self.assertEqual(corpo["totalValue"], 300.0)
        self.assertNotIn("value", corpo)

    def test_excluir_cobranca_chama_delete_no_id(self):
        async def ir():
            async with self._cliente(_json(200, {"deleted": True, "id": "pay_3"})) as cliente:
                return await asaas_integracao.excluir_cobranca(
                    cliente, "https://api-sandbox.asaas.com/v3", "chave", "pay_3",
                )
        resultado = _rodar(ir())
        self.assertTrue(resultado["deleted"])
        self.assertEqual(self.ultima_requisicao.method, "DELETE")
        self.assertTrue(self.ultima_requisicao.url.path.endswith("/payments/pay_3"))

    def test_erro_http_vira_erro_asaas(self):
        async def ir():
            async with self._cliente(httpx.Response(400, json={"errors": [{"description": "Cliente inválido"}]})) as cliente:
                return await asaas_integracao.criar_cobranca(
                    cliente, "https://api-sandbox.asaas.com/v3", "chave", "cus_invalido", "2026-11-01", valor=10.0,
                )
        with self.assertRaises(asaas_integracao.ErroAsaas):
            _rodar(ir())

    def test_falha_de_rede_vira_erro_asaas_em_vez_de_derrubar_a_requisicao(self):
        """Timeout/conexão recusada não podem propagar crus - antes só erro HTTP >=400 virava
        ErroAsaas, uma falha de rede ia sem tratamento e derrubava a requisição ASGI (o que o
        usuário via como "HTTP 502" sem explicação)."""
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("tempo esgotado", request=request)

        async def ir():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as cliente:
                return await asaas_integracao.listar_cobrancas(cliente, "https://api-sandbox.asaas.com/v3", "chave")
        with self.assertRaises(asaas_integracao.ErroAsaas):
            _rodar(ir())


class CobrancaLancamentoHttpTest(_Simulado, unittest.TestCase):
    """POST /lancamentos/<id>/cobranca: emite o boleto direto no Asaas, com os dados do
    lançamento, e guarda o id da cobrança para não emitir uma segunda."""

    def setUp(self):
        super().setUp()
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.gestao = db.RegistroClientesCasos(Path(self._dir.name) / "teste.db")
        self.agora = lambda: datetime(2026, 1, 1)
        self.cliente = self.gestao.criar_cliente("Cliente Teste", "12345678909", None, self.agora)
        self.caso = self.gestao.criar_caso(self.cliente["id"], "Caso Teste", None, [], self.agora)
        self.lancamento = self._criar_lancamento(self.cliente["id"])
        self.mw = server._AutenticacaoBearer(app=None, registro=None, gestao=self.gestao)
        config = mock.patch.object(
            server, "_asaas_config", return_value=(asaas_integracao.URL_BASE_SANDBOX, "chave-teste"),
        )
        config.start()
        self.addCleanup(config.stop)

    def _criar_lancamento(self, cliente_id):
        return self.gestao.criar_lancamento(
            tipo="HONORARIO", vencimento="2026-02-10", valor=1500.0, descricao="Honorários iniciais",
            recorrente=False, caso_id=self.caso["id"], cliente_id=cliente_id, responsavel="ana",
            agora=self.agora,
        )

    def _chamar(self, metodo="POST", lancamento_id=None):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        _rodar(self.mw._lancamento_cobranca(
            {"method": metodo}, receive, send, lancamento_id or self.lancamento["id"],
        ))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_cria_cobranca_com_os_dados_do_lancamento_e_guarda_o_id(self):
        self.gestao.definir_asaas_customer_id(self.cliente["id"], "cus_123")
        self.responder(_json(200, {
            "id": "pay_123", "bankSlipUrl": "https://asaas.example/boleto/123",
            "invoiceUrl": "https://asaas.example/i/123",
        }))

        status, resultado = self._chamar()

        self.assertEqual(status, 201)
        self.assertEqual(resultado["id"], "pay_123")
        self.assertEqual(resultado["bankSlipUrl"], "https://asaas.example/boleto/123")
        enviado = json.loads(self.chamadas[0].content)
        self.assertEqual(enviado["customer"], "cus_123")
        self.assertEqual(enviado["billingType"], "BOLETO")
        self.assertEqual(enviado["dueDate"], "2026-02-10")
        self.assertEqual(enviado["value"], 1500.0)
        self.assertEqual(enviado["description"], "Honorários iniciais")
        self.assertEqual(
            self.gestao.obter_lancamento(self.lancamento["id"])["asaas_cobranca_id"], "pay_123",
        )

    def test_cliente_sem_cpf_cnpj_e_erro_400(self):
        sem_cpf = self.gestao.criar_cliente("Cliente sem CPF", None, None, self.agora)
        lancamento = self._criar_lancamento(sem_cpf["id"])

        status, resultado = self._chamar(lancamento_id=lancamento["id"])

        self.assertEqual(status, 400)
        self.assertIn("CPF/CNPJ", resultado["mensagem"])
        self.assertEqual(self.chamadas, [])

    def test_lancamento_com_cobranca_gerada_e_erro_409(self):
        self.gestao.definir_cobranca_lancamento(self.lancamento["id"], "pay_existente")

        status, resultado = self._chamar()

        self.assertEqual(status, 409)
        self.assertIn("já tem uma cobrança", resultado["mensagem"])
        self.assertEqual(self.chamadas, [])


class PublicacaoCadastroInlineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        caminho = Path(self.tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(caminho)
        self.publicacoes = db.RegistroPublicacoesOAB(caminho)
        self.agora = lambda: datetime(2026, 1, 1)
        self.cliente = self.gestao.criar_cliente("Cliente Árvore", None, None, self.agora)
        self.numero = "10063142720238260005"
        self.dados = {"siglaTribunal": "tjsp", "nomeClasse": "Procedimento Comum", "nomeOrgao": "Vara Cível",
            "destinatarios": [{"nome": "Maria Silva", "polo": "A"}, {"nome": "Banco Exemplo", "polo": "P"}],
            "destinatarioadvogados": [{"nome": "Ana", "numero_oab": "123", "uf_oab": "SP"}], "texto": "Texto ORIGINAL"}
        self.publicacoes.registrar("pub-inline", None, None, self.numero, self.dados, "nao_tratada", None, self.agora)

    def test_paginacao_deterministica_catalogo_e_status_parcial(self):
        for i in range(12):
            self.publicacoes.registrar(f"pagina-{i:02}", None, None, self.numero,
                {"campo_extra": i}, "nao_tratada", None, self.agora)
        paginas = [self.publicacoes.listar(None, 5, offset) for offset in (0, 5, 10)]
        hashes = [p["hash"] for pagina in paginas for p in pagina]
        self.assertEqual(len(hashes), 13)
        self.assertEqual(len(set(hashes)), 13)
        self.assertEqual(hashes, sorted(hashes, reverse=True))
        self.assertIn("campo_extra", self.publicacoes.campos_djen())
        resultado = self.publicacoes.atualizar_status_detalhado(["pagina-01", "ausente", "pagina-01"], "tratada")
        self.assertEqual(resultado, {"atualizadas": 1, "hashes_atualizados": ["pagina-01"], "hashes_falharam": ["ausente"]})
        self.assertEqual(self.publicacoes.contar("tratada"), 1)

    def test_endpoint_paginacao_valida_limites_e_ajusta_pagina_vazia(self):
        mw = server._AutenticacaoBearer(None, None, gestao=self.gestao, publicacoes=self.publicacoes)
        async def consultar(query):
            respostas = []
            async def send(mensagem):
                respostas.append(mensagem)
            await mw._publicacoes_oab({"method": "GET", "query_string": query.encode()}, send)
            return respostas[0]["status"], json.loads(respostas[1]["body"])
        for query in ("pagina=0", "tamanho=0", "tamanho=301", "pagina=abc"):
            self.assertEqual(_rodar(consultar(query))[0], 400)
        status, dados = _rodar(consultar("pagina=999&tamanho=5"))
        self.assertEqual(status, 200)
        self.assertEqual(dados["pagina"], 1)
        self.assertEqual(dados["total"], 1)
        self.assertIn("texto", dados["campos_djen"])
        self.assertEqual(dados["hashes_disponiveis"], ["pub-inline"])

    def test_calendario_filtra_antes_de_paginar_e_ordena_por_disponibilizacao(self):
        for hash_, dia, status in [("nova", "2026-10-28", "nao_tratada"),
                                   ("antiga", "2026-10-23", "tratada"),
                                   ("nova-2", "2026-10-28T12:00:00", "tratada")]:
            self.publicacoes.registrar(hash_, None, None, self.numero,
                {"data_disponibilizacao": dia}, status, None, self.agora)
        self.assertEqual([p["hash"] for p in self.publicacoes.listar(None, 2)], ["nova-2", "nova"])
        self.assertEqual(self.publicacoes.contar(data="2026-10-28"), 2)
        self.assertEqual(self.publicacoes.contar("tratada", "2026-10-28"), 1)
        self.assertEqual(self.publicacoes.listar(None, 1, 1, "2026-10-28")[0]["hash"], "nova")
        self.assertEqual(self.publicacoes.hashes_disponiveis("tratada", "2026-10-28"), ["nova-2"])
        self.assertEqual(self.publicacoes.datas_disponiveis(), {"2026-10-23": 1, "2026-10-28": 2})
        self.assertEqual(self.publicacoes.datas_disponiveis("tratada"), {"2026-10-23": 1, "2026-10-28": 1})
        mw = server._AutenticacaoBearer(None, None, gestao=self.gestao, publicacoes=self.publicacoes)
        async def consultar(query):
            respostas = []
            async def send(mensagem):
                respostas.append(mensagem)
            await mw._publicacoes_oab({"method": "GET", "query_string": query.encode()}, send)
            return respostas[0]["status"], json.loads(respostas[1]["body"])
        for data in ("2026-02-30", "28/10/2026", "2026-1-1", "2026-10-28' OR 1=1"):
            self.assertEqual(_rodar(consultar("data=" + data))[0], 400)
        status, resultado = _rodar(consultar("data=2026-10-28&tamanho=1&pagina=2"))
        self.assertEqual(status, 200)
        self.assertEqual(resultado["total"], 2)
        self.assertEqual(resultado["publicacoes"][0]["hash"], "nova")
        self.assertIn("2026-10-23", resultado["datas_disponiveis"])
        self.assertEqual(_rodar(consultar("data=2026-10-24"))[1]["total"], 0)

    def test_cadastro_preenche_dados_capa_e_vincula_publicacao(self):
        publicacao = self.publicacoes.obter("pub-inline")
        caso, erro = server._criar_caso_de_publicacao(self.gestao, self.publicacoes, publicacao,
            {"cliente_id": self.cliente["id"], "responsavel": "Ana"})
        self.assertIsNone(erro)
        self.assertEqual(caso["titulo"], "Maria Silva X Banco Exemplo")
        self.assertEqual(caso["cliente_id"], self.cliente["id"])
        self.assertEqual(caso["responsavel"], "Ana")
        self.assertEqual(caso["autor"], "Maria Silva")
        self.assertEqual(caso["reu"], "Banco Exemplo")
        self.assertEqual(caso["acao"], "Procedimento Comum")
        self.assertEqual(caso["foro"], "Vara Cível")
        capa = self.gestao.obter_capa_processo(caso["id"], self.numero)
        self.assertEqual(capa["tribunal"], "TJSP")
        self.assertEqual(capa["partes"], self.dados["destinatarios"])
        self.assertEqual(capa["advogados"], self.dados["destinatarioadvogados"])
        self.assertIsNone(capa["data_distribuicao"])
        pub = self.publicacoes.obter("pub-inline")
        self.assertEqual(pub["caso_id"], caso["id"])
        self.assertEqual(pub["status"], "nao_tratada")
        self.assertEqual(pub["dados"]["texto"], "Texto ORIGINAL")
        for termo in ("1006314-27.2023.8.26.0005", "Maria", "Banco", "arvore"):
            self.assertEqual(server._consultar_casos_para_vinculo(self.gestao, termo)[0]["id"], caso["id"])
        self.assertEqual(server._consultar_casos_para_vinculo(self.gestao, "inexistente"), [])
        self.gestao.salvar_capa_processo(caso["id"], self.numero, agora=self.agora,
            partes=[{"nome": "Parte Só Na Capa", "polo": "P"}])
        self.assertEqual(server._consultar_casos_para_vinculo(self.gestao, "so na capa")[0]["id"], caso["id"])

    def test_endpoint_cadastro_normaliza_numero_com_mascara_antes_de_salvar_capa(self):
        import io
        from contextlib import redirect_stdout
        registro = server.RegistroUsuarios(Path(self.tmp.name) / "usuarios.json")
        saida = io.StringIO()
        with redirect_stdout(saida):
            self.assertEqual(server._criar_usuario(registro, "ana"), 0)
        token = saida.getvalue().strip().splitlines()[-1]
        numero_com_mascara = "1006314-27.2023.8.26.0005"
        self.publicacoes.registrar("pub-mascarada", None, None, numero_com_mascara, self.dados,
                                  "nao_tratada", None, self.agora)
        mw = server._AutenticacaoBearer(None, registro, gestao=self.gestao, publicacoes=self.publicacoes)
        status, corpo, _ = _chamar_asgi(mw, "POST", "/publicacoes-oab/pub-mascarada/criar-caso",
            headers=[(b"authorization", ("Bearer " + token).encode())],
            corpo=json.dumps({"cliente_id": self.cliente["id"], "responsavel": "ana"}).encode())
        self.assertEqual(status, 201)
        caso = json.loads(corpo)
        self.assertEqual(caso["processos"], [self.numero])
        self.assertEqual(len(self.gestao.listar_casos()), 1)
        capa = self.gestao.obter_capa_processo(caso["id"], self.numero)
        self.assertEqual(capa["nome_processo"], "Maria Silva X Banco Exemplo")
        pub = self.publicacoes.obter("pub-mascarada")
        self.assertEqual(pub["caso_id"], caso["id"])
        self.assertEqual(pub["status"], "nao_tratada")

    def test_numero_invalido_nao_deixa_cadastro_parcial(self):
        pub = {**self.publicacoes.obter("pub-inline"), "numero_processo": "123"}
        caso, erro = server._criar_caso_de_publicacao(self.gestao, self.publicacoes, pub,
            {"cliente_id": self.cliente["id"], "responsavel": "ana"})
        self.assertIsNone(caso)
        self.assertTrue(erro["erro"])
        self.assertEqual(self.gestao.listar_casos(), [])

    def test_cliente_inexistente_nao_cria_processo(self):
        caso, erro = server._criar_caso_de_publicacao(self.gestao, self.publicacoes,
            self.publicacoes.obter("pub-inline"), {"cliente_id": "inexistente", "responsavel": "Ana"})
        self.assertIsNone(caso)
        self.assertTrue(erro["erro"])
        self.assertEqual(self.gestao.listar_casos(), [])


class CapaProcessoTest(unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, ["10063142720238260005"], self.agora)
        self.numero = "10063142720238260005"

    def test_sem_capa_salva_retorna_none(self):
        self.assertIsNone(self.gestao.obter_capa_processo(self.caso["id"], self.numero))

    def test_salvar_e_obter_campos_automaticos_e_manuais(self):
        self.gestao.salvar_capa_processo(
            self.caso["id"], self.numero, self.agora,
            tribunal="TJSP", classe="Cobrança", assuntos=["Dano Moral", "Dano Material"],
            grau="G1", nivel_sigilo=0,
        )
        capa = self.gestao.salvar_capa_processo(
            self.caso["id"], self.numero, self.agora, valor_causa=15000.50, fase="conhecimento",
        )
        self.assertEqual(capa["tribunal"], "TJSP")  # campo automático preservado no segundo upsert
        self.assertEqual(capa["assuntos"], ["Dano Moral", "Dano Material"])
        self.assertEqual(capa["valor_causa"], 15000.50)
        self.assertEqual(capa["fase"], "conhecimento")
        self.assertIsNone(capa["magistrado"])  # nunca setado, fica None

        lido = self.gestao.obter_capa_processo(self.caso["id"], self.numero)
        self.assertEqual(lido, capa)

    def test_salvar_caso_preserva_capa_dos_processos_mantidos(self):
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, fase="Conhecimento")
        self.gestao.atualizar_caso(
            self.caso["id"], "Novo título", None, None, None, None, None, None,
            numeros_processo=[self.numero],
        )
        self.assertEqual(self.gestao.obter_capa_processo(self.caso["id"], self.numero)["fase"], "Conhecimento")

    def test_campo_invalido_recusado(self):
        with self.assertRaises(ValueError):
            self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, comarca="SP")


class CapaProcessoHttpTest(unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, ["10063142720238260005"], self.agora)
        self.numero = "10063142720238260005"
        self.mw = server._AutenticacaoBearer(app=None, registro=None, gestao=self.gestao)

    def _chamar(self, metodo: str, acao: str | None, corpo: dict | None = None):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo or {}).encode("utf-8"), "more_body": False}

        scope = {"method": metodo}
        _rodar(self.mw._capa_do_processo(scope, receive, send, self.caso["id"], self.numero, acao))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_get_sem_capa_devolve_campos_vazios(self):
        status, resultado = self._chamar("GET", None)
        self.assertEqual(status, 200)
        self.assertIsNone(resultado["tribunal"])
        self.assertIsNone(resultado["valor_causa"])

    def test_patch_so_aceita_campos_manuais(self):
        status, resultado = self._chamar(
            "PATCH", None, {"valor_causa": 500.0, "tribunal": "TJSP"},  # tribunal não é manual, ignorado
        )
        self.assertEqual(status, 200)
        self.assertEqual(resultado["valor_causa"], 500.0)
        self.assertIsNone(resultado["tribunal"])

    def test_atualizar_sem_tribunal_e_erro(self):
        status, resultado = self._chamar("POST", "atualizar", {})
        self.assertEqual(status, 400)
        self.assertTrue(resultado["erro"])

    def test_atualizar_preenche_capa_a_partir_da_consulta_unificada(self):
        resultado_unificado = {
            "instancias": [{
                "tribunal": "TJSP", "classe": "Cobrança", "assuntos": ["Dano Moral"],
                "grau": "G1", "dataAjuizamento": "20230101000000", "nivel_sigilo": 0,
                "codigoMunicipioIBGE": 3550308,
                "movimentos": [{"nome": "Distribuição", "dataHora": "2023-01-01T12:00:00Z"}],
                "orgaoJulgador": "3ª Vara Cível",
            }],
            "partes": [{"nome": "FULANO", "polo": "A"}, {"nome": "SICRANO", "polo": "P"}],
            "advogados": [{"nome": "ADV", "numero_oab": "1", "uf_oab": "SP"}],
        }
        with mock.patch.object(server, "consultar_processo_unificado", return_value=resultado_unificado):
            status, resultado = self._chamar("POST", "atualizar", {"tribunal": "tjsp"})
        self.assertEqual(status, 200)
        self.assertEqual(resultado["tribunal"], "TJSP")
        self.assertEqual(resultado["nome_processo"], "FULANO x SICRANO")
        self.assertEqual(resultado["orgao_julgador"], "3ª Vara Cível")
        self.assertEqual(resultado["tipo_justica"], "Justiça Estadual")
        caso = self.gestao.obter_caso(self.caso["id"])
        self.assertEqual(caso["titulo"], "FULANO x SICRANO")
        self.assertEqual(caso["foro"], "3ª Vara Cível")
        self.assertEqual(resultado["partes"], resultado_unificado["partes"])
        self.assertEqual(resultado["advogados"], resultado_unificado["advogados"])
        self.assertEqual(resultado["cidade"], "São Paulo")
        self.assertEqual(resultado["uf"], "SP")
        self.assertEqual(resultado["movimentos"][0]["nome"], "Distribuição")
        status, reaberto = self._chamar("GET", None)
        self.assertEqual(status, 200)
        self.assertEqual(reaberto, resultado)

    def test_codigo_municipio_desconhecido_preserva_localidade_manual(self):
        self._chamar("PATCH", None, {"cidade": "Praia Grande", "uf": "SP"})
        with mock.patch.object(server, "consultar_processo_unificado", return_value={
            "instancias": [{"codigoMunicipioIBGE": "9999999"}],
        }):
            status, resultado = self._chamar("POST", "atualizar", {"tribunal": "tjsp"})
        self.assertEqual(status, 200)
        self.assertEqual(resultado["cidade"], "Praia Grande")
        self.assertEqual(resultado["uf"], "SP")

    def test_extracao_datajud_preserva_codigo_ibge(self):
        resultado = server._extrair_processo_datajud({"orgaoJulgador": {
            "nome": "Vara Cível", "codigoMunicipioIBGE": 3550308,
        }})
        self.assertEqual(resultado["codigoMunicipioIBGE"], 3550308)



class AtividadeResponsavelTest(unittest.TestCase):
    """Responsável/delegação de atividade (db.py): CRUD grava e atualiza o campo."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [], self.agora)

    def test_criar_atividade_grava_responsavel(self):
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora, responsavel="bia@teste.com",
        )
        self.assertEqual(atv["responsavel"], "bia@teste.com")

    def test_criar_atividade_sem_responsavel_fica_none(self):
        atv = self.gestao.criar_atividade(self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora)
        self.assertIsNone(atv["responsavel"])

    def test_atualizar_atividade_muda_responsavel(self):
        atv = self.gestao.criar_atividade(self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora)
        atualizada = self.gestao.atualizar_atividade(self.caso["id"], atv["id"], responsavel="bia@teste.com")
        self.assertEqual(atualizada["responsavel"], "bia@teste.com")

    def test_atualizar_sem_tocar_responsavel_preserva_valor(self):
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora, responsavel="bia@teste.com",
        )
        atualizada = self.gestao.atualizar_atividade(self.caso["id"], atv["id"], titulo="Peticionar (urgente)")
        self.assertEqual(atualizada["responsavel"], "bia@teste.com")


class AtividadeDelegacaoHttpTest(_RegistroTemporario):
    """PATCH /casos/<id>/atividades/<aid>: valida o responsável e avisa por e-mail quem foi delegado."""

    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [], self.agora)
        self.bia = "bia@teste.com"
        self._criar(self.bia)
        cfg = server.ConfiguracaoSMTP("smtp.teste", 587, "u", "s", "noreply@teste")
        cadastro = server.CadastroPublico(self.registro, cfg, server.LimitadorUso(0, 0),
                                          server.LimitadorUso(0, 0), enviar=lambda d, t: None)
        self.mw = server._AutenticacaoBearer(app=None, registro=self.registro, cadastro=cadastro, gestao=self.gestao)

    def _patch(self, aid, corpo, usuario="ana"):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo).encode("utf-8"), "more_body": False}

        scope = {"method": "PATCH", "usuario": usuario}
        _rodar(self.mw._atividades_do_caso(scope, receive, send, self.caso["id"], aid))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_delegar_para_usuario_valido_avisa_por_email(self):
        atv = self.gestao.criar_atividade(self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora)
        with mock.patch.object(server, "_enviar_aviso_atividade_delegada") as envio:
            status, resultado = self._patch(atv["id"], {"responsavel": self.bia})
        self.assertEqual(status, 200)
        self.assertEqual(resultado["responsavel"], self.bia)
        envio.assert_called_once()
        self.assertEqual(envio.call_args[0][1], self.bia)

    def test_delegar_para_usuario_invalido_e_recusado(self):
        atv = self.gestao.criar_atividade(self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora)
        status, resultado = self._patch(atv["id"], {"responsavel": "fantasma@teste.com"})
        self.assertEqual(status, 400)
        self.assertTrue(resultado["erro"])

    def test_nao_avisa_quando_responsavel_nao_muda(self):
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora, responsavel=self.bia,
        )
        with mock.patch.object(server, "_enviar_aviso_atividade_delegada") as envio:
            status, _ = self._patch(atv["id"], {"titulo": "Peticionar (urgente)"})
        self.assertEqual(status, 200)
        envio.assert_not_called()

    def test_nao_avisa_quando_delegado_para_si_mesmo(self):
        atv = self.gestao.criar_atividade(self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora)
        with mock.patch.object(server, "_enviar_aviso_atividade_delegada") as envio:
            status, _ = self._patch(atv["id"], {"responsavel": "ana"}, usuario="ana")
        self.assertEqual(status, 200)
        envio.assert_not_called()

    def test_eu_mesmo_reatribui_atividade_delegada_e_persiste(self):
        for valor in (None, "", "   "):
            with self.subTest(responsavel=valor):
                atv = self.gestao.criar_atividade(
                    self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
                    responsavel=self.bia,
                )
                with mock.patch.object(server, "_enviar_aviso_atividade_delegada") as envio:
                    status, resultado = self._patch(atv["id"], {"responsavel": valor})
                self.assertEqual(status, 200)
                self.assertEqual(resultado["responsavel"], "ana")
                persistida = next(a for a in self.gestao.listar_atividades(self.caso["id"]) if a["id"] == atv["id"])
                self.assertEqual(persistida["responsavel"], "ana")
                envio.assert_not_called()

    def test_patch_sem_responsavel_preserva_delegacao(self):
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
            responsavel=self.bia,
        )
        status, resultado = self._patch(atv["id"], {"status": "concluida"})
        self.assertEqual(status, 200)
        self.assertEqual(resultado["responsavel"], self.bia)
        self.assertEqual(resultado["status"], "concluida")

    def test_eu_mesmo_sem_registro_de_usuarios_resolve_identidade(self):
        self.mw.registro = None
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
            responsavel=self.bia,
        )
        status, resultado = self._patch(atv["id"], {"responsavel": None}, usuario="usuario-local")
        self.assertEqual(status, 200)
        self.assertEqual(resultado["responsavel"], "usuario-local")

    def test_eu_mesmo_sem_identidade_nao_simula_reatribuicao(self):
        atv = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
            responsavel=self.bia,
        )
        status, resultado = self._patch(atv["id"], {"responsavel": None}, usuario=None)
        self.assertEqual(status, 400)
        self.assertTrue(resultado["erro"])
        self.assertEqual(self.gestao.listar_atividades(self.caso["id"])[0]["responsavel"], self.bia)


if __name__ == "__main__":
    unittest.main()


class CasoPatchParcialTest(unittest.TestCase):
    def test_salvar_partes_preserva_cadastro(self):
        gestao = mock.Mock()
        gestao.obter_caso.return_value = {
            "titulo": "Caso existente", "responsavel": "Ana", "acao": "Cobrança",
            "foro": "São Paulo", "autor": "Autor", "reu": "Réu",
            "advogados": "Advogado", "desfecho": "acordo",
        }
        gestao.atualizar_caso.return_value = {"id": "caso-1"}
        app = server._AutenticacaoBearer(mock.Mock(), mock.Mock(), gestao=gestao)
        receive = mock.AsyncMock(return_value={"type": "http.request", "body": b'{"autor":"Novo autor"}', "more_body": False})
        asyncio.run(app._caso_detalhe({"method": "PATCH"}, receive, mock.AsyncMock(), "caso-1"))
        campos = gestao.atualizar_caso.call_args.kwargs
        self.assertEqual(campos["autor"], "Novo autor")
        for campo in ("titulo", "responsavel", "acao", "foro", "reu", "advogados", "desfecho"):
            self.assertEqual(campos[campo], gestao.obter_caso.return_value[campo])


class CasoPastaAcessoTest(unittest.TestCase):
    """Fase 4 do roadmap de buscas: pasta (organização livre) e acesso (equipe/público/privado)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        self.cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)

    def test_criar_caso_grava_pasta_e_acesso(self):
        caso = self.gestao.criar_caso(
            self.cliente["id"], "Caso", None, [], self.agora, pasta="Trabalhista 2026", acesso="privado",
        )
        self.assertEqual(caso["pasta"], "Trabalhista 2026")
        self.assertEqual(caso["acesso"], "privado")

    def test_acesso_padrao_e_equipe(self):
        caso = self.gestao.criar_caso(self.cliente["id"], "Caso", None, [], self.agora)
        self.assertEqual(caso["acesso"], "equipe")
        self.assertIsNone(caso["pasta"])

    def test_acesso_invalido_na_criacao_e_recusado(self):
        with self.assertRaises(ValueError):
            self.gestao.criar_caso(self.cliente["id"], "Caso", None, [], self.agora, acesso="admin")

    def test_atualizar_caso_muda_pasta_e_acesso(self):
        caso = self.gestao.criar_caso(self.cliente["id"], "Caso", None, [], self.agora)
        atualizado = self.gestao.atualizar_caso(
            caso["id"], "Caso", None, None, None, None, None, None,
            pasta="Nova pasta", acesso="publico",
        )
        self.assertEqual(atualizado["pasta"], "Nova pasta")
        self.assertEqual(atualizado["acesso"], "publico")

    def test_acesso_invalido_na_atualizacao_e_recusado(self):
        caso = self.gestao.criar_caso(self.cliente["id"], "Caso", None, [], self.agora)
        with self.assertRaises(ValueError):
            self.gestao.atualizar_caso(caso["id"], "Caso", None, None, None, None, None, None, acesso="admin")

    def test_listar_casos_inclui_pasta_e_acesso(self):
        self.gestao.criar_caso(self.cliente["id"], "Caso", None, [], self.agora, pasta="Civil", acesso="publico")
        [caso] = self.gestao.listar_casos()
        self.assertEqual(caso["pasta"], "Civil")
        self.assertEqual(caso["acesso"], "publico")


class CriarCasoValidadoPastaAcessoTest(unittest.TestCase):
    """_criar_caso_validado (POST /casos): mesma validação de acesso, só que a partir do corpo HTTP."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        self.cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)

    def test_criar_com_pasta_e_acesso(self):
        caso, erro = server._criar_caso_validado(self.gestao, {
            "cliente_id": self.cliente["id"], "pasta": "Civil", "acesso": "privado",
        })
        self.assertIsNone(erro)
        self.assertEqual(caso["pasta"], "Civil")
        self.assertEqual(caso["acesso"], "privado")

    def test_acesso_invalido_e_recusado(self):
        caso, erro = server._criar_caso_validado(self.gestao, {
            "cliente_id": self.cliente["id"], "acesso": "admin",
        })
        self.assertIsNone(caso)
        self.assertTrue(erro["erro"])


class CapasVinculadasTest(unittest.TestCase):
    """Fase 1 do roadmap de buscas: candidatos ao job de atualização automática de movimentos."""

    def test_retorna_so_processos_com_tribunal_na_capa(self):
        tmp = Path(tempfile.mkdtemp()) / "teste.db"
        gestao = db.RegistroClientesCasos(tmp)
        agora = lambda: datetime(2026, 1, 1)
        cliente = gestao.criar_cliente("Cliente", None, None, agora)
        caso = gestao.criar_caso(cliente["id"], "Caso", None, ["10063142720238260005"], agora)
        outro_caso = gestao.criar_caso(cliente["id"], "Outro caso", None, ["20063142720238260006"], agora)
        gestao.salvar_capa_processo(caso["id"], "10063142720238260005", agora, tribunal="TJSP")
        self.assertEqual(gestao.capas_vinculadas(), [
            {"caso_id": caso["id"], "numero_processo": "10063142720238260005", "tribunal": "TJSP"},
        ])
        self.assertIsNone(gestao.obter_capa_processo(outro_caso["id"], "20063142720238260006"))


class AtualizarMovimentosProcessosTest(unittest.TestCase):
    """Job periódico (Fase 1): atualiza a capa de processos já vinculados a um tribunal e
    registra na linha do tempo do caso quando aparece movimento novo."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.numero = "10063142720238260005"
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [self.numero], self.agora)

    def test_sem_capa_vinculada_consulta_datajud(self):
        fonte = {"numeroProcesso": self.numero, "tribunal": "TJSP", "grau": "G1"}
        resultado = {"encontrado": True, "processos": [server._extrair_processo_datajud(fonte)]}
        with mock.patch.object(server, "consultar_processo_datajud", new=mock.AsyncMock(return_value=resultado)) as consulta:
            asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))
        consulta.assert_awaited_once_with("tjsp", self.numero)
        self.assertEqual(self.gestao.obter_datajud(self.numero, "TJSP")[0]["numeroProcesso"], self.numero)

    def test_movimento_novo_atualiza_capa_e_registra_evento(self):
        self.gestao.salvar_capa_processo(
            self.caso["id"], self.numero, self.agora, tribunal="TJSP",
            movimentos=[{"codigo": "1", "nome": "Distribuição", "dataHora": "2023-01-01T00:00:00Z"}],
        )
        resultado_unificado = {
            "instancias": [{"tribunal": "TJSP", "movimentos": [
                {"codigo": "1", "nome": "Distribuição", "dataHora": "2023-01-01T00:00:00Z"},
                {"codigo": "2", "nome": "Juntada", "dataHora": "2026-01-01T00:00:00Z"},
            ]}],
            "partes": [], "advogados": [],
        }
        with mock.patch.object(server, "consultar_processo_unificado", return_value=resultado_unificado):
            asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))
        capa = self.gestao.obter_capa_processo(self.caso["id"], self.numero)
        self.assertEqual(len(capa["movimentos"]), 2)
        eventos = self.gestao.eventos_do_caso(self.caso["id"])
        self.assertEqual(len(eventos), 1)
        self.assertEqual(eventos[0]["tipo"], "movimento_processual")
        self.assertEqual(eventos[0]["conteudo"]["quantidade"], 1)

    def test_sem_movimento_novo_nao_registra_evento(self):
        movimentos = [{"codigo": "1", "nome": "Distribuição", "dataHora": "2023-01-01T00:00:00Z"}]
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, tribunal="TJSP", movimentos=movimentos)
        resultado_unificado = {"instancias": [{"tribunal": "TJSP", "movimentos": movimentos}], "partes": [], "advogados": []}
        with mock.patch.object(server, "consultar_processo_unificado", return_value=resultado_unificado):
            asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))
        self.assertEqual(self.gestao.eventos_do_caso(self.caso["id"]), [])

    def test_erro_na_consulta_nao_interrompe_o_job(self):
        self.gestao.salvar_capa_processo(self.caso["id"], self.numero, self.agora, tribunal="TJSP")
        with mock.patch.object(server, "consultar_processo_unificado", return_value={"erro": True, "mensagem": "falhou"}):
            asyncio.run(server._atualizar_movimentos_processos(self.gestao, self.agora))  # não deve levantar


class CapaMonitorarHttpTest(unittest.TestCase):
    """Fase 2 do roadmap de buscas: monitorar/desvincular um processo específico direto na
    ficha, sem precisar da tool MCP monitorar_publicacoes."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.numero = "10063142720238260005"
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [self.numero], self.agora)
        self._dir = tempfile.TemporaryDirectory()
        self.registro_monitoramentos = server.RegistroMonitoramentos(Path(self._dir.name) / "monitoramentos.json")
        self.mw = server._AutenticacaoBearer(
            app=None, registro=None, gestao=self.gestao, registro_monitoramentos=self.registro_monitoramentos,
        )

    def tearDown(self):
        self._dir.cleanup()

    def _chamar(self, metodo: str, acao: str | None, usuario: str = "ana@exemplo.com"):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        scope = {"method": metodo, "usuario": usuario}
        _rodar(self.mw._capa_do_processo(scope, receive, send, self.caso["id"], self.numero, acao))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_get_sem_monitoramento_mostra_monitorando_falso(self):
        status, resultado = self._chamar("GET", None)
        self.assertEqual(status, 200)
        self.assertFalse(resultado["monitorando"])

    def test_criar_monitoramento_e_refletido_no_get(self):
        status, resultado = self._chamar("POST", "monitorar")
        self.assertEqual(status, 201)
        self.assertEqual(resultado["criterio"]["numero_processo"], self.numero)
        status, resultado = self._chamar("GET", None)
        self.assertEqual(status, 200)
        self.assertTrue(resultado["monitorando"])

    def test_desvincular_remove_monitoramento(self):
        self._chamar("POST", "monitorar")
        status, resultado = self._chamar("DELETE", "monitorar")
        self.assertEqual(status, 200)
        self.assertEqual(resultado, {"removido": True, "monitorando": False})
        status, resultado = self._chamar("GET", None)
        self.assertFalse(resultado["monitorando"])

    def test_desvincular_sem_monitoramento_e_404(self):
        status, resultado = self._chamar("DELETE", "monitorar")
        self.assertEqual(status, 404)

    def test_usuario_sem_email_e_recusado(self):
        status, resultado = self._chamar("POST", "monitorar", usuario="ana")
        self.assertEqual(status, 400)
        self.assertEqual(self.registro_monitoramentos.carregar(), {})

    def test_metodo_errado_e_recusado(self):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        scope = {"method": "PATCH", "usuario": "ana@exemplo.com"}
        _rodar(self.mw._capa_do_processo(scope, receive, send, self.caso["id"], self.numero, "monitorar"))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        self.assertEqual(inicio["status"], 405)


class ChecklistAtividadeTest(unittest.TestCase):
    """Checklist (subtarefas) de uma atividade (db.py): CRUD + progresso."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [], self.agora)
        self.atividade = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
        )

    def test_criar_item_e_listar(self):
        item = self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Juntar documentos", self.agora)
        self.assertEqual(item["texto"], "Juntar documentos")
        self.assertFalse(item["concluido"])
        self.assertEqual(self.gestao.listar_checklist(self.caso["id"], self.atividade["id"]), [item])

    def test_itens_mantem_ordem_de_criacao(self):
        self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Primeiro", self.agora)
        self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Segundo", self.agora)
        itens = self.gestao.listar_checklist(self.caso["id"], self.atividade["id"])
        self.assertEqual([i["texto"] for i in itens], ["Primeiro", "Segundo"])

    def test_atualizar_marca_concluido(self):
        item = self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Item", self.agora)
        atualizado = self.gestao.atualizar_item_checklist(self.caso["id"], self.atividade["id"], item["id"], concluido=True)
        self.assertTrue(atualizado["concluido"])
        self.assertEqual(atualizado["texto"], "Item")

    def test_excluir_item(self):
        item = self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Item", self.agora)
        self.assertTrue(self.gestao.excluir_item_checklist(self.caso["id"], self.atividade["id"], item["id"]))
        self.assertEqual(self.gestao.listar_checklist(self.caso["id"], self.atividade["id"]), [])

    def test_excluir_atividade_remove_itens_em_cascata(self):
        self.gestao.criar_item_checklist(self.caso["id"], self.atividade["id"], "Item", self.agora)
        self.gestao.excluir_atividade(self.caso["id"], self.atividade["id"])
        with db._abrir(self.tmp) as conexao:
            restantes = conexao.execute("SELECT COUNT(*) FROM atividade_checklist_itens").fetchone()[0]
        self.assertEqual(restantes, 0)

    def test_operacoes_em_atividade_de_outro_caso_falham(self):
        outro_cliente = self.gestao.criar_cliente("Outro Cliente", None, None, self.agora)
        outro_caso = self.gestao.criar_caso(outro_cliente["id"], "Outro Caso", None, [], self.agora)
        self.assertIsNone(self.gestao.listar_checklist(outro_caso["id"], self.atividade["id"]))
        self.assertIsNone(self.gestao.criar_item_checklist(outro_caso["id"], self.atividade["id"], "x", self.agora))


class ChecklistAtividadeHttpTest(unittest.TestCase):
    """GET/POST /casos/<id>/atividades/<aid>/checklist, PATCH/DELETE .../checklist/<item_id>."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [], self.agora)
        self.atividade = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
        )
        self.mw = server._AutenticacaoBearer(app=None, registro=None, gestao=self.gestao)

    def _chamar(self, metodo, item_id, corpo=None):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo or {}).encode("utf-8"), "more_body": False}

        scope = {"method": metodo}
        _rodar(self.mw._checklist_da_atividade(scope, receive, send, self.caso["id"], self.atividade["id"], item_id))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_post_sem_texto_e_erro(self):
        status, resultado = self._chamar("POST", None, {})
        self.assertEqual(status, 400)
        self.assertTrue(resultado["erro"])

    def test_post_cria_item_e_get_lista(self):
        status, item = self._chamar("POST", None, {"texto": "Juntar documentos"})
        self.assertEqual(status, 201)
        status, resultado = self._chamar("GET", None)
        self.assertEqual(status, 200)
        self.assertEqual(resultado["itens"], [item])

    def test_patch_marca_concluido(self):
        _, item = self._chamar("POST", None, {"texto": "Item"})
        status, atualizado = self._chamar("PATCH", item["id"], {"concluido": True})
        self.assertEqual(status, 200)
        self.assertTrue(atualizado["concluido"])

    def test_patch_item_inexistente_e_404(self):
        status, resultado = self._chamar("PATCH", 999, {"concluido": True})
        self.assertEqual(status, 404)

    def test_delete_remove_item(self):
        _, item = self._chamar("POST", None, {"texto": "Item"})
        status, resultado = self._chamar("DELETE", item["id"])
        self.assertEqual(status, 200)
        self.assertTrue(resultado["excluido"])

    def test_get_atividade_inexistente_e_404(self):
        mw = self.mw
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        scope = {"method": "GET"}
        _rodar(mw._checklist_da_atividade(scope, receive, send, self.caso["id"], 999, None))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        self.assertEqual(inicio["status"], 404)


class ChecklistRoteamentoTest(_RegistroTemporario):
    """Garante que /casos/<id>/atividades/<aid>/checklist... é roteado para o handler certo,
    sem atrapalhar o roteamento já existente de /casos/<id>/atividades/<aid>."""

    def setUp(self):
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp()) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.tmp)
        self.agora = lambda: datetime(2026, 1, 1)
        cliente = self.gestao.criar_cliente("Cliente Teste", None, None, self.agora)
        self.caso = self.gestao.criar_caso(cliente["id"], "Caso Teste", None, [], self.agora)
        self.atividade = self.gestao.criar_atividade(
            self.caso["id"], "tarefa", "Peticionar", None, None, None, self.agora,
        )
        self.mw = server._AutenticacaoBearer(app=None, registro=self.registro, gestao=self.gestao)

    def _chamar(self, metodo, caminho, corpo=None):
        enviados = []

        async def send(mensagem):
            enviados.append(mensagem)

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo or {}).encode("utf-8"), "more_body": False}

        headers = [(b"authorization", f"Bearer {self.token_ana}".encode())]
        scope = {"type": "http", "method": metodo, "path": caminho, "headers": headers}
        _rodar(self.mw(scope, receive, send))
        inicio = next(m for m in enviados if m["type"] == "http.response.start")
        corpo_bytes = b"".join(m.get("body", b"") for m in enviados if m["type"] == "http.response.body")
        return inicio["status"], json.loads(corpo_bytes or b"{}")

    def test_rota_checklist_da_atividade(self):
        status, resultado = self._chamar("GET", f"/casos/{self.caso['id']}/atividades/{self.atividade['id']}/checklist")
        self.assertEqual(status, 200)
        self.assertEqual(resultado["itens"], [])

    def test_rota_atividade_sem_checklist_continua_funcionando(self):
        status, resultado = self._chamar(
            "PATCH", f"/casos/{self.caso['id']}/atividades/{self.atividade['id']}", {"titulo": "Peticionar (revisado)"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(resultado["id"], self.atividade["id"])
        self.assertEqual(resultado["titulo"], "Peticionar (revisado)")

    def test_rota_lista_de_atividades_continua_funcionando(self):
        status, resultado = self._chamar("GET", f"/casos/{self.caso['id']}/atividades")
        self.assertEqual(status, 200)
        self.assertEqual(len(resultado["atividades"]), 1)
