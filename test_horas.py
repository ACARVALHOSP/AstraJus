"""Horas por processo: lançamento, tarifa, cronômetro, relatório e faturamento."""
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import db
import horas
from horas import ConflitoHoras, ProibidoHoras

# 15h UTC = meio-dia em Brasília
agora = lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc)


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.repo = horas.Repositorio(self.caminho)
        self.cliente = self.gestao.criar_cliente("Maria", None, None, agora)
        self.caso = self.gestao.criar_caso(self.cliente["id"], "Silva x Banco", "ana", [], agora)
        self.outro = self.gestao.criar_caso(self.cliente["id"], "Souza x Seguradora", "ana", [], agora)

    def lancar(self, minutos=60, data="2026-11-10", usuario="ana", caso=None, **kw):
        return self.repo.criar(caso_id=(caso or self.caso)["id"], usuario=usuario, data=data, minutos=minutos, agora=agora, **kw)


class LancamentoTest(_Base):
    def test_criar_com_tarifa_da_pessoa_gravada_no_momento(self):
        self.assertEqual(self.repo.definir_tarifa("ana", 300, agora), 300)
        h = self.lancar(90, descricao="  Reunião   com o cliente ")
        self.assertEqual((h["minutos"], h["valor_hora"], h["valor"], h["descricao"]), (90, 300.0, 450.0, "Reunião com o cliente"))
        self.assertEqual((h["caso_titulo"], h["cliente_id"], h["faturado"]), ("Silva x Banco", self.cliente["id"], False))
        self.repo.definir_tarifa("ana", 500, agora)                       # mudar a tarifa não altera o que já foi lançado
        self.assertEqual(self.repo.obter(h["id"])["valor"], 450.0)
        self.assertEqual(self.lancar(60)["valor"], 500.0)

    def test_sem_tarifa_nao_tem_valor_e_valor_informado_vale(self):
        self.assertIsNone(self.lancar()["valor"])
        self.assertEqual(self.lancar(30, valor_hora=400)["valor"], 200.0)
        self.assertEqual(self.lancar(60, valor_hora=99.99)["valor"], 99.99)
        self.assertEqual(self.lancar(7, valor_hora=100)["valor"], 11.67)   # 7/60 h de R$ 100 = 11,666… arredonda para cima

    def test_nao_faturavel_nao_tem_valor(self):
        self.repo.definir_tarifa("ana", 300, agora)
        h = self.lancar(60, faturavel=False)
        self.assertEqual((h["faturavel"], h["valor"]), (False, None))

    def test_validacoes(self):
        ruins = [dict(minutos=0), dict(minutos=1441), dict(minutos=True), dict(minutos="60"), dict(minutos=1.5),
                 dict(data="2026-13-01"), dict(data="12/11/2026"), dict(data="2026-11-13"),      # futura
                 dict(descricao="x" * 301), dict(valor_hora=0), dict(valor_hora=-5), dict(valor_hora=True),
                 dict(valor_hora=100001), dict(faturavel="sim")]
        for kw in ruins:
            with self.assertRaises(ValueError, msg=str(kw)):
                self.lancar(**{"minutos": 60, **kw})
        with self.assertRaises(LookupError):
            self.repo.criar(caso_id="nao-existe", usuario="ana", data="2026-11-10", minutos=60, agora=agora)
        self.assertEqual(self.lancar(minutos=1440)["minutos"], 1440)
        self.assertEqual(self.lancar(data="2026-11-12")["data"], "2026-11-12")           # hoje pode

    def test_atualizar_e_excluir_so_pelo_dono_ou_administrador(self):
        h = self.lancar(60)
        novo = self.repo.atualizar(h["id"], {"minutos": 90, "descricao": "ajuste", "caso_id": self.outro["id"]}, "ana", agora=agora)
        self.assertEqual((novo["minutos"], novo["descricao"], novo["caso_id"]), (90, "ajuste", self.outro["id"]))
        with self.assertRaises(ProibidoHoras):
            self.repo.atualizar(h["id"], {"minutos": 10}, "bia", agora=agora)
        with self.assertRaises(ProibidoHoras):
            self.repo.excluir(h["id"], "bia")
        self.assertEqual(self.repo.atualizar(h["id"], {"minutos": 10}, "bia", administrador=True, agora=agora)["minutos"], 10)
        with self.assertRaises(ValueError):
            self.repo.atualizar(h["id"], {"minutos": 0}, "ana", agora=agora)
        with self.assertRaises(LookupError):
            self.repo.atualizar(999, {"minutos": 10}, "ana", agora=agora)
        self.repo.excluir(h["id"], "ana")
        self.assertIsNone(self.repo.obter(h["id"]))

    def test_atualizar_valor_hora_none_volta_para_a_tarifa_atual(self):
        h = self.lancar(60, valor_hora=400)
        self.repo.definir_tarifa("ana", 250, agora)
        self.assertEqual(self.repo.atualizar(h["id"], {"valor_hora": None}, "ana", agora=agora)["valor_hora"], 250.0)
        self.assertEqual(self.repo.atualizar(h["id"], {"valor_hora": 300}, "ana", agora=agora)["valor_hora"], 300.0)
        self.assertEqual(self.repo.atualizar(h["id"], {"minutos": 30}, "ana", agora=agora)["valor_hora"], 300.0)   # sem a chave: mantém

    def test_tarifa(self):
        self.assertEqual(self.repo.listar_tarifas(), {})
        self.repo.definir_tarifa("ana", 300, agora); self.repo.definir_tarifa("bia", 150.5, agora)
        self.assertEqual(self.repo.listar_tarifas(), {"ana": 300.0, "bia": 150.5})
        self.assertIsNone(self.repo.definir_tarifa("ana", None, agora))
        self.assertEqual(self.repo.listar_tarifas(), {"bia": 150.5})
        for ruim in (0, -1, True, "10", 100001):
            with self.assertRaises(ValueError):
                self.repo.definir_tarifa("ana", ruim, agora)


class ListagemTest(_Base):
    def setUp(self):
        super().setUp()
        self.repo.definir_tarifa("ana", 300, agora); self.repo.definir_tarifa("bia", 200, agora)
        self.a = self.lancar(60, "2026-11-02", "ana")
        self.b = self.lancar(120, "2026-11-05", "bia", self.outro)
        self.c = self.lancar(30, "2026-11-09", "ana", faturavel=False)

    def ids(self, **f):
        return [h["id"] for h in self.repo.listar(**f)]

    def test_filtros_e_ordem(self):
        self.assertEqual(self.ids(), [self.c["id"], self.b["id"], self.a["id"]])              # mais recentes primeiro
        self.assertEqual(self.ids(de="2026-11-05", ate="2026-11-08"), [self.b["id"]])
        self.assertEqual(self.ids(usuario="ana"), [self.c["id"], self.a["id"]])
        self.assertEqual(self.ids(caso_id=self.outro["id"]), [self.b["id"]])
        self.assertEqual(self.ids(cliente_id=self.cliente["id"]), [self.c["id"], self.b["id"], self.a["id"]])
        self.assertEqual(self.ids(faturavel=False), [self.c["id"]])
        self.assertEqual(self.ids(faturado=True), [])
        with self.assertRaises(ValueError):
            self.repo.listar(de="amanhã")

    def test_totais_e_relatorio(self):
        r = self.repo.relatorio()
        self.assertEqual(r["totais"], {"minutos": 210, "minutos_faturaveis": 180, "valor": 700.0, "a_faturar": 700.0, "faturado": 0.0, "sem_valor_hora": 0})
        self.assertEqual([(u["usuario"], u["minutos"], u["a_faturar"]) for u in r["por_usuario"]], [("ana", 90, 300.0), ("bia", 120, 400.0)])
        self.assertEqual([(p["caso_titulo"], p["minutos"]) for p in r["por_processo"]], [("Souza x Seguradora", 120), ("Silva x Banco", 90)])
        self.assertEqual(self.repo.relatorio(usuario="zeca")["totais"]["minutos"], 0)

    def test_horas_sem_valor_hora_sao_contadas_a_parte(self):
        self.repo.definir_tarifa("ana", None, agora)
        sem = self.lancar(60, "2026-11-10", "ana")
        self.assertEqual(self.repo.relatorio(usuario="ana", de="2026-11-10")["totais"]["sem_valor_hora"], 1)
        self.assertIsNone(sem["valor"])


class CronometroTest(_Base):
    def test_iniciar_parar_gera_horas_arredondadas_para_cima(self):
        self.repo.definir_tarifa("ana", 300, agora)
        inicio = datetime(2026, 11, 12, 13, 0, tzinfo=timezone.utc)
        c = self.repo.iniciar_cronometro("ana", self.caso["id"], " Minuta da réplica ", lambda: inicio)
        self.assertEqual((c["caso_id"], c["descricao"], c["caso_titulo"]), (self.caso["id"], "Minuta da réplica", "Silva x Banco"))
        self.assertEqual(self.repo.cronometro("ana")["inicio"], "2026-11-12T13:00:00+00:00")
        self.assertIsNone(self.repo.cronometro("bia"))
        h = self.repo.parar_cronometro("ana", agora=lambda: inicio + timedelta(minutes=47, seconds=5))
        self.assertEqual((h["minutos"], h["data"], h["descricao"], h["valor_hora"], h["limitado"]), (48, "2026-11-12", "Minuta da réplica", 300.0, False))
        self.assertIsNone(self.repo.cronometro("ana"))

    def test_so_um_cronometro_por_pessoa_e_parar_sem_ligar(self):
        self.repo.iniciar_cronometro("ana", self.caso["id"], None, agora)
        with self.assertRaises(ConflitoHoras):
            self.repo.iniciar_cronometro("ana", self.outro["id"], None, agora)
        self.repo.iniciar_cronometro("bia", self.caso["id"], None, agora)         # outra pessoa pode
        with self.assertRaises(LookupError):
            self.repo.parar_cronometro("zeca", agora=agora)
        with self.assertRaises(LookupError):
            self.repo.iniciar_cronometro("zeca", "nao-existe", None, agora)

    def test_menos_de_um_minuto_conta_um_e_mais_de_24h_e_limitado(self):
        t0 = datetime(2026, 11, 12, 14, 0, tzinfo=timezone.utc)
        self.repo.iniciar_cronometro("ana", self.caso["id"], None, lambda: t0)
        self.assertEqual(self.repo.parar_cronometro("ana", agora=lambda: t0 + timedelta(seconds=3))["minutos"], 1)
        t1 = datetime(2026, 11, 10, 14, 0, tzinfo=timezone.utc)
        self.repo.iniciar_cronometro("ana", self.caso["id"], None, lambda: t1)
        esquecido = self.repo.parar_cronometro("ana", agora=lambda: t1 + timedelta(days=2))
        self.assertEqual((esquecido["minutos"], esquecido["limitado"], esquecido["data"]), (1440, True, "2026-11-10"))

    def test_data_das_horas_e_a_do_inicio_em_brasilia(self):
        inicio = datetime(2026, 11, 12, 1, 30, tzinfo=timezone.utc)                # 22h30 do dia 11 em Brasília
        self.repo.iniciar_cronometro("ana", self.caso["id"], None, lambda: inicio)
        self.assertEqual(self.repo.parar_cronometro("ana", agora=lambda: inicio + timedelta(hours=2))["data"], "2026-11-11")

    def test_descartar(self):
        self.assertFalse(self.repo.descartar_cronometro("ana"))
        self.repo.iniciar_cronometro("ana", self.caso["id"], None, agora)
        self.assertTrue(self.repo.descartar_cronometro("ana"))
        self.assertEqual(self.repo.listar(), [])


class FaturamentoTest(_Base):
    def setUp(self):
        super().setUp()
        self.repo.definir_tarifa("ana", 300, agora)
        self.a = self.lancar(60, "2026-11-02")
        self.b = self.lancar(90, "2026-11-05")

    def faturar(self, ids=None, **kw):
        return self.repo.faturar(ids if ids is not None else [self.a["id"], self.b["id"]], "ana", self.gestao, kw.pop("vencimento", "2026-11-30"), agora=agora, **kw)

    def test_gera_um_lancamento_de_honorario_e_trava_as_horas(self):
        r = self.faturar()
        lanc = r["lancamento"]
        self.assertEqual((r["horas"], r["minutos"], r["valor"]), (2, 150, 750.0))
        self.assertEqual((lanc["tipo"], lanc["valor"], lanc["vencimento"], lanc["caso_id"], lanc["cliente_id"], lanc["direcao"]),
                         ("HONORARIO", 750.0, "2026-11-30", self.caso["id"], self.cliente["id"], "RECEITA"))
        self.assertIn("2h30min", lanc["descricao"])
        self.assertIn("Silva x Banco", lanc["descricao"])
        self.assertIn("2026-11-02 a 2026-11-05", lanc["descricao"])
        for h in self.repo.listar():
            self.assertEqual((h["faturado"], h["lancamento_id"]), (True, lanc["id"]))
        self.assertEqual(self.repo.relatorio()["totais"]["a_faturar"], 0.0)
        self.assertEqual(self.repo.relatorio()["totais"]["faturado"], 750.0)

    def test_horas_faturadas_nao_se_alteram_nem_se_faturam_de_novo(self):
        self.faturar()
        with self.assertRaises(ConflitoHoras):
            self.repo.atualizar(self.a["id"], {"minutos": 5}, "ana", agora=agora)
        with self.assertRaises(ConflitoHoras):
            self.repo.excluir(self.a["id"], "ana")
        with self.assertRaises(ConflitoHoras):
            self.faturar([self.a["id"]])
        self.assertEqual(len(self.gestao.listar_lancamentos()), 1)

    def test_excluir_o_lancamento_libera_as_horas(self):
        lanc = self.faturar()["lancamento"]
        self.gestao.excluir_lancamento(lanc["id"])
        self.assertEqual([h["faturado"] for h in self.repo.listar()], [False, False])
        self.assertEqual(self.faturar()["valor"], 750.0)                                 # pode faturar de novo

    def test_recusas_sem_criar_lancamento_nem_reservar(self):
        nao_fat = self.lancar(30, faturavel=False)
        sem_valor = self.repo.criar(caso_id=self.caso["id"], usuario="bia", data="2026-11-03", minutos=30, agora=agora)
        outro = self.lancar(30, caso=self.outro)
        casos = [([nao_fat["id"]], ValueError, "não faturáveis"), ([sem_valor["id"]], ValueError, "sem valor por hora"),
                 ([self.a["id"], outro["id"]], ValueError, "processos diferentes"), ([999], LookupError, "não foi encontrada"),
                 ([], ValueError, "Escolha"), ("x", ValueError, "Escolha"), ([True], ValueError, "Escolha"),
                 (list(range(1, 502)), ValueError, "Escolha")]
        for ids, erro, trecho in casos:
            with self.assertRaisesRegex(erro, trecho):
                self.faturar(ids)
        with self.assertRaises(ValueError):
            self.faturar(vencimento="30/11/2026")
        self.assertEqual(self.gestao.listar_lancamentos(), [])
        self.assertEqual([h["faturado"] for h in self.repo.listar()], [False] * 5)
        self.assertEqual(self.faturar()["valor"], 750.0)                                 # nada ficou reservado

    def test_falha_ao_criar_o_lancamento_desfaz_a_reserva(self):
        with mock.patch.object(self.gestao, "criar_lancamento", side_effect=RuntimeError("banco indisponível")):
            with self.assertRaises(RuntimeError):
                self.faturar()
        with sqlite3.connect(self.caminho) as c:
            self.assertEqual(c.execute("SELECT count(*) FROM horas_lancamentos WHERE lancamento_id IS NOT NULL").fetchone()[0], 0)
        self.assertEqual(self.faturar()["valor"], 750.0)

    def test_reserva_ativa_bloqueia_outro_faturamento_e_a_abandonada_expira(self):
        # outra pessoa está faturando agora (reserva recente)
        with sqlite3.connect(self.caminho) as c:
            c.execute("UPDATE horas_lancamentos SET lancamento_id = ?", (f"pendente:{int(time.time())}",))
        with self.assertRaisesRegex(ConflitoHoras, "neste momento"):
            self.faturar()
        # reserva abandonada (processo caiu há mais de 10 minutos): pode faturar
        with sqlite3.connect(self.caminho) as c:
            c.execute("UPDATE horas_lancamentos SET lancamento_id = ?", (f"pendente:{int(time.time()) - 3600}",))
        self.assertEqual(self.faturar()["horas"], 2)

    def test_processo_sem_cliente_nao_fatura_e_libera(self):
        with mock.patch.object(self.gestao, "obter_caso", return_value={"titulo": "X", "cliente_id": None}):
            with self.assertRaisesRegex(ValueError, "cliente"):
                self.faturar()
        self.assertEqual(self.faturar()["horas"], 2)

    def test_descricao_informada_substitui_a_padrao(self):
        self.assertEqual(self.faturar(descricao="Honorários de novembro")["lancamento"]["descricao"], "Honorários de novembro")

    def test_valor_usa_o_valor_hora_gravado_em_cada_lancamento(self):
        self.repo.definir_tarifa("ana", 999, agora)                                      # tarifa nova não afeta as horas antigas
        extra = self.lancar(60, valor_hora=100)
        self.assertEqual(self.faturar([self.a["id"], extra["id"]])["valor"], 400.0)      # 300 + 100

    def test_duas_pessoas_faturando_as_mesmas_horas_ao_mesmo_tempo_cobram_uma_vez_so(self):
        for _ in range(5):                       # várias rodadas, para dar chance a uma corrida de verdade
            a, b = self.lancar(60, "2026-11-03"), self.lancar(30, "2026-11-04")
            barreira, resultados = threading.Barrier(2), []

            def tentar(quem):
                barreira.wait()
                try:
                    resultados.append(("ok", horas.Repositorio(self.caminho).faturar([a["id"], b["id"]], quem, self.gestao, "2026-11-30", agora=agora)))
                except ValueError as erro:        # ConflitoHoras é ValueError
                    resultados.append(("recusado", erro))

            fios = [threading.Thread(target=tentar, args=(q,)) for q in ("ana", "bia")]
            [f.start() for f in fios]; [f.join(timeout=60) for f in fios]
            self.assertEqual(sorted(r[0] for r in resultados), ["ok", "recusado"], resultados)
        faturados = [l for l in self.gestao.listar_lancamentos() if l["tipo"] == "HONORARIO"]
        self.assertEqual(len(faturados), 5)      # um lançamento por rodada, nunca dois


if __name__ == "__main__":
    unittest.main()
