"""Resumo diário de publicações: modos, retenção do e-mail normal, uma vez por dia e nunca sem e-mail."""
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import automacoes
import cnj
import db
import monitoramento_runtime
import server
import usuarios_admin as u


def instante(dia, hora=11):  # 11h UTC = 08h em Brasília
    return datetime.fromisoformat(f"{dia}T{hora:02d}:00:00+00:00")


def cnj_valido(sequencial: int) -> str:
    base = f"{sequencial:07d}" + "2026" + "826" + "0100"
    return base[:7] + cnj.calcular_dv(base[:7] + "00" + base[7:]) + base[7:]


def mascara(numero: str) -> str:
    return f"{numero[:7]}-{numero[7:9]}.{numero[9:13]}.{numero[13]}.{numero[14:16]}.{numero[16:]}"


def pub(n, numero=None, **extra):
    numero = numero or cnj_valido(n)
    return {"hash": f"h{n}", "data_disponibilizacao": "2026-11-17", "siglaTribunal": "TJSP", "nomeOrgao": "1ª Vara Cível",
            "nomeClasse": "Procedimento Comum", "tipoComunicacao": "Intimação", "numeroprocessocommascara": mascara(numero),
            "texto": "TEXTO CONFIDENCIAL DA PUBLICAÇÃO", **extra}


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.usuarios = db.RegistroUsuarios(self.caminho)
        u.alterar(self.usuarios, dict(login="ana", nome_completo="Ana", email="ana@teste.com"), "bootstrap")
        u.alterar(self.usuarios, dict(login="bia", nome_completo="Bia", email="bia@teste.com"), "bootstrap")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.registro = db.RegistroMonitoramentos(self.caminho)
        self.entregas = monitoramento_runtime.Repositorio(self.caminho)
        self.config = automacoes.Repositorio(self.caminho)
        self.config.definir("resumo_publicacoes", "teste", ativo=True)
        self.enviados = []

    def monitorar(self, usuario="ana", mid="m1"):
        def gravar(dados):
            dados[mid] = {"usuario": usuario, "criterio": {"numero_oab": "123456", "uf_oab": "SP"},
                          "expira_em": "2027-06-01T00:00:00+00:00"}
        self.registro.atualizar(gravar)
        return mid

    def preferencia(self, usuario, modo):
        u.atualizar_perfil(self.usuarios, usuario, {"avisos_publicacao": modo})

    def chegar(self, mid, itens, dia="2026-11-17", hora=3, aguarda=True):
        self.entregas.ingerir(mid, itens, instante(dia, hora), aguarda_resumo=aguarda)

    def rodar(self, dia="2026-11-18", hora=11, falhar=False):
        async def enviar(destino, assunto, corpo, html):
            if falhar:
                raise RuntimeError("smtp fora do ar")
            self.enviados.append((destino, assunto, corpo, html))
        return asyncio.run(automacoes.enviar_resumos_publicacoes(
            self.registro, self.gestao, agora=lambda: instante(dia, hora), enviar_email=enviar, base_url="https://exemplo.org"))


class ModoETextoTest(_Base):
    def test_padrao_e_os_dois_e_a_rotina_desligada_volta_ao_imediato(self):
        self.assertEqual(automacoes.preferencia_avisos_publicacao({}), "ambos")
        self.assertEqual(automacoes.preferencia_avisos_publicacao({"avisos_publicacao": "lixo"}), "ambos")
        self.assertEqual(automacoes.modo_avisos_publicacao(self.caminho, "ana"), "ambos")
        self.preferencia("ana", "resumo")
        self.assertEqual(automacoes.modo_avisos_publicacao(self.caminho, "ana"), "resumo")
        self.config.definir("resumo_publicacoes", "teste", ativo=False)
        self.assertEqual(automacoes.modo_avisos_publicacao(self.caminho, "ana"), "imediato")   # rotina desligada
        self.assertEqual(automacoes.modo_avisos_publicacao(self.caminho, None), "imediato")

    def test_perfil_aceita_so_as_tres_opcoes(self):
        for modo in ("imediato", "resumo", "ambos"):
            self.assertEqual(u.atualizar_perfil(self.usuarios, "ana", {"avisos_publicacao": modo})["avisos_publicacao"], modo)
        for invalido in ("nunca", "", None, 1):
            with self.assertRaises(ValueError):
                u.atualizar_perfil(self.usuarios, "ana", {"avisos_publicacao": invalido})
        self.assertEqual(automacoes.preferencia_avisos_publicacao(self.usuarios.carregar()["ana"]), "ambos")


class EnvioTest(_Base):
    def test_doze_publicacoes_geram_um_email_com_as_doze(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(i) for i in range(1, 13)])
        self.assertTrue(self.rodar())
        self.assertEqual(len(self.enviados), 1)
        destino, assunto, corpo, html = self.enviados[0]
        self.assertEqual(destino, "ana@teste.com")
        self.assertIn("12 publicação(ões) nova(s) (18/11)", assunto)
        self.assertEqual(corpo.count("  - "), 12)
        self.assertIn("https://exemplo.org/radix/#/publicacoes-oab", corpo)
        self.assertEqual(self.entregas.pendentes(mid, "resumo"), [])

    def test_nao_leva_o_texto_da_publicacao(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1)])
        self.rodar()
        _, _, corpo, html = self.enviados[0]
        self.assertNotIn("CONFIDENCIAL", corpo + html)

    def test_dia_sem_publicacao_nao_envia(self):
        self.monitorar()
        self.assertTrue(self.rodar())
        self.assertEqual(self.enviados, [])

    def test_antes_da_hora_configurada_espera(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1)])
        self.rodar(hora=10)        # 07h em Brasília, antes das 08h
        self.assertEqual(self.enviados, [])
        self.rodar(hora=11)
        self.assertEqual(len(self.enviados), 1)
        self.config.definir("resumo_publicacoes", "teste", parametros={"hora": 14})
        self.chegar(mid, [pub(2)], dia="2026-11-18", hora=12)
        self.rodar(dia="2026-11-19", hora=15)                 # 12h em Brasília: antes das 14h
        self.assertEqual(len(self.enviados), 1)
        self.rodar(dia="2026-11-19", hora=17)                 # 14h
        self.assertEqual(len(self.enviados), 2)

    def test_uma_vez_por_dia_e_o_que_chega_depois_vai_no_dia_seguinte(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1)])
        self.rodar()
        self.rodar(hora=14)                                   # mesma data: nada novo
        self.chegar(mid, [pub(2)], dia="2026-11-18", hora=15)  # chega depois do envio
        self.rodar(hora=20)
        self.assertEqual(len(self.enviados), 1)
        self.rodar(dia="2026-11-19")
        self.assertEqual(len(self.enviados), 2)
        self.assertIn("1 publicação(ões)", self.enviados[1][1])

    def test_rodar_duas_vezes_nao_duplica_publicacoes(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1), pub(2)])
        self.rodar()
        self.rodar(dia="2026-11-19")
        self.assertEqual(len(self.enviados), 1)

    def test_falha_de_envio_tenta_de_novo_e_o_assunto_indica_o_periodo(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1)], dia="2026-11-15")
        self.assertFalse(self.rodar(falhar=True))
        self.assertEqual(len(self.entregas.pendentes(mid, "resumo")), 1)       # nada se perdeu
        self.assertTrue(self.rodar(dia="2026-11-18", hora=12))
        self.assertEqual(len(self.enviados), 1)
        self.assertIn("(desde 15/11)", self.enviados[0][1])                      # passou mais de um dia


class ModosDeEntregaTest(_Base):
    def test_cada_publicacao_nao_recebe_resumo_e_nada_acumula(self):
        mid = self.monitorar()
        self.preferencia("ana", "imediato")
        self.chegar(mid, [pub(1)])
        self.rodar()
        self.assertEqual(self.enviados, [])
        self.assertEqual(self.entregas.pendentes(mid, "resumo"), [])

    def test_so_resumo_inclui_o_que_nao_foi_enviado_e_marca_o_email_como_entregue(self):
        mid = self.monitorar()
        self.preferencia("ana", "resumo")
        self.chegar(mid, [pub(1), pub(2)])
        self.rodar()
        self.assertEqual(len(self.enviados), 1)
        self.assertEqual(self.entregas.pendentes(mid, "email"), [])            # não vai sair de novo pelo e-mail normal

    def test_so_resumo_ignora_o_que_a_rede_de_seguranca_ja_enviou(self):
        mid = self.monitorar()
        self.preferencia("ana", "resumo")
        self.chegar(mid, [pub(1), pub(2)])
        self.entregas.confirmar(mid, "email", ["h1"])                          # h1 já saiu pelo e-mail normal
        self.rodar()
        self.assertEqual(self.enviados[0][2].count("  - "), 1)

    def test_os_dois_leva_tudo_mesmo_o_que_ja_foi_enviado_imediatamente(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1), pub(2)])
        self.entregas.confirmar(mid, "email", ["h1", "h2"])
        self.rodar()
        self.assertEqual(self.enviados[0][2].count("  - "), 2)

    def test_pessoa_sem_email_ou_revogada_nao_acumula(self):
        mid_ana, mid_bia = self.monitorar("ana", "m1"), self.monitorar("bia", "m2")
        self.usuarios.atualizar(lambda d: d["ana"].update(email=None))
        self.usuarios.atualizar(lambda d: d["bia"].update(revogado=True, status="revogado"))
        self.chegar(mid_ana, [pub(1)])
        self.chegar(mid_bia, [pub(2)])
        self.assertTrue(self.rodar())
        self.assertEqual(self.enviados, [])
        self.assertEqual((self.entregas.pendentes(mid_ana, "resumo"), self.entregas.pendentes(mid_bia, "resumo")), ([], []))

    def test_cada_pessoa_recebe_so_o_dela(self):
        a, b = self.monitorar("ana", "m1"), self.monitorar("bia", "m2")
        self.chegar(a, [pub(1)])
        self.chegar(b, [pub(2), pub(3)])
        self.rodar()
        por_destino = {d: c.count("  - ") for d, _, c, _ in self.enviados}
        self.assertEqual(por_destino, {"ana@teste.com": 1, "bia@teste.com": 2})

    def test_varios_monitoramentos_da_mesma_pessoa_viram_um_so_email(self):
        a, b = self.monitorar("ana", "m1"), self.monitorar("ana", "m2")
        self.chegar(a, [pub(1)])
        self.chegar(b, [pub(2)])
        self.rodar()
        self.assertEqual(len(self.enviados), 1)
        self.assertEqual(self.enviados[0][2].count("  - "), 2)


class ConteudoTest(_Base):
    def test_cadastrados_primeiro_e_titulo_do_caso(self):
        mid = self.monitorar()
        cliente = self.gestao.criar_cliente("Maria", None, None, lambda: instante("2026-11-01"))
        numero = cnj_valido(7)
        self.gestao.criar_caso(cliente["id"], "Maria X Banco", "ana", [numero], lambda: instante("2026-11-01"))
        self.chegar(mid, [pub(1), pub(7, numero=numero)])        # h1: sem cadastro; h7: cadastrado
        self.rodar()
        corpo = self.enviados[0][2]
        self.assertLess(corpo.index("PROCESSOS CADASTRADOS"), corpo.index("SEM PROCESSO CADASTRADO"))
        self.assertIn("Maria X Banco", corpo)

    def test_sugestao_da_triagem_so_com_confianca(self):
        mid = self.monitorar()
        numero = cnj_valido(1)
        self.chegar(mid, [pub(1, numero=numero), pub(2)])
        triagem = {"tipo": {"valor": "sentenca_ou_decisao", "confianca": 0.95}, "gera_prazo": {"valor": True, "confianca": 0.9},
                   "prazo_padrao": {"valor": "apelacao", "confianca": 0.92}, "urgencia": {"nota": 8.0, "confianca": 0.9}}
        baixa = {"tipo": {"valor": "ciencia", "confianca": 0.3}, "gera_prazo": {"valor": False, "confianca": 0.9},
                 "prazo_padrao": {"valor": "nenhum", "confianca": 0.9}, "urgencia": {"nota": 1.0, "confianca": 0.9}}
        publicacoes = db.RegistroPublicacoesOAB(self.caminho)
        publicacoes.salvar_triagem("h1", triagem, lambda: instante("2026-11-17"))
        publicacoes.salvar_triagem("h2", baixa, lambda: instante("2026-11-17"))
        self.rodar()
        corpo = self.enviados[0][2]
        self.assertIn("Sentença ou decisão (sugestão)", corpo)
        self.assertIn("Prazo para apresentar apelação (sugestão)", corpo)
        self.assertNotIn("Ciência", corpo)

    def test_limite_de_itens_com_aviso_de_quantos_faltam(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(i) for i in range(1, 46)])
        self.rodar()
        destino, assunto, corpo, html = self.enviados[0]
        self.assertIn("45 publicação(ões)", assunto)
        self.assertEqual(corpo.count("  - "), automacoes.LIMITE_ITENS_RESUMO)
        self.assertIn("Mostrando 40 de 45", html)


class EntregaNormalTest(_Base):
    """O e-mail de cada lote (server._entregar_monitoramento) respeita o modo da pessoa."""

    def entregar(self, mid, dia="2026-11-17", hora=12):
        enviados = []
        mon = self.registro.carregar()[mid]
        ok = asyncio.run(server._entregar_monitoramento(self.entregas, self.registro, mid, mon, None,
                                                        lambda destino, criterio, itens: enviados.append((destino, len(itens))),
                                                        instante(dia, hora)))
        return ok, enviados

    def test_cada_publicacao_e_os_dois_enviam_como_antes(self):
        for modo in ("imediato", "ambos"):
            with self.subTest(modo=modo):
                mid = self.monitorar("ana", f"m-{modo}")
                self.preferencia("ana", modo)
                self.chegar(mid, [pub(1 if modo == "imediato" else 2)], aguarda=modo == "ambos")
                _, enviados = self.entregar(mid)
                self.assertEqual(enviados, [("ana@teste.com", 1)])

    def test_so_resumo_retem_o_email_normal(self):
        mid = self.monitorar()
        self.preferencia("ana", "resumo")
        self.chegar(mid, [pub(1)])
        ok, enviados = self.entregar(mid)
        self.assertEqual((ok, enviados), (True, []))
        self.assertEqual(len(self.entregas.pendentes(mid, "email")), 1)           # fica esperando o resumo
        self.assertEqual(self.entregas.estado(mid + ":djen")["emails_pendentes"], 0)  # e não conta como pendência de envio

    def test_rede_de_seguranca_envia_o_que_o_resumo_nao_levou_em_36_horas(self):
        mid = self.monitorar()
        self.preferencia("ana", "resumo")
        self.chegar(mid, [pub(1)], dia="2026-11-15", hora=3)
        _, enviados = self.entregar(mid, dia="2026-11-17", hora=12)               # ~57 h depois
        self.assertEqual(enviados, [("ana@teste.com", 1)])

    def test_rotina_desligada_volta_a_enviar_o_email_normal(self):
        mid = self.monitorar()
        self.preferencia("ana", "resumo")
        self.chegar(mid, [pub(1)])
        self.config.definir("resumo_publicacoes", "teste", ativo=False)
        _, enviados = self.entregar(mid)
        self.assertEqual(enviados, [("ana@teste.com", 1)])

    def test_conteudo_so_e_apagado_quando_os_tres_canais_terminam(self):
        mid = self.monitorar()
        self.chegar(mid, [pub(1)])
        self.entregas.confirmar(mid, "email", ["h1"])
        self.entregas.confirmar(mid, "local", ["h1"])
        self.assertEqual(len(self.entregas.pendentes(mid, "resumo")), 1)
        self.assertEqual(self.entregas.pendentes_detalhe(mid, "resumo")[0]["dados"]["hash"], "h1")  # ainda tem conteúdo
        self.entregas.confirmar(mid, "resumo", ["h1"])
        with self.entregas.abrir() as c:
            self.assertEqual(c.execute("SELECT dados FROM monitoramento_entregas WHERE hash='h1'").fetchone()[0], "{}")

    def test_tabela_antiga_ganha_a_coluna_sem_perder_itens(self):
        import sqlite3
        caminho = self.caminho.with_name("antigo.db")
        with sqlite3.connect(caminho) as c:
            c.execute("CREATE TABLE monitoramento_entregas (monitoramento_id TEXT NOT NULL, hash TEXT NOT NULL, dados TEXT NOT NULL, "
                      "criado_em TEXT NOT NULL, email INTEGER NOT NULL DEFAULT 0, local INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(monitoramento_id, hash))")
            c.execute("INSERT INTO monitoramento_entregas VALUES ('m','h','{}','2026-11-01T00:00:00+00:00',0,0)")
        repo = monitoramento_runtime.Repositorio(caminho)
        self.assertEqual(repo.pendentes_detalhe("m", "email")[0]["resumo"], 1)    # item antigo: nada aguarda o resumo
        self.assertEqual(repo.pendentes("m", "resumo"), [])


if __name__ == "__main__":
    unittest.main()
