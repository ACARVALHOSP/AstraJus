"""Rotina "Processo parado": quem entra, quem fica de fora, quando repete e quem recebe."""
import asyncio
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import automacoes
import cnj
import db
import notificacoes
import server
import usuarios_admin as u

def cnj_valido(sequencial: int) -> str:
    """Número CNJ de 20 dígitos com dígito verificador correto (TJSP, 2026, foro 0100)."""
    base = f"{sequencial:07d}" + "2026" + "826" + "0100"
    return base[:7] + cnj.calcular_dv(base[:7] + "00" + base[7:]) + base[7:]


NUMERO = cnj_valido(1)
NUMERO_2, NUMERO_3 = cnj_valido(2), cnj_valido(3)


def instante(dia, hora=15):  # 15h UTC = meio-dia em Brasília
    return datetime.fromisoformat(f"{dia}T{hora:02d}:00:00+00:00")


class _Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.caminho = Path(tmp.name) / "teste.db"
        self.registro = db.RegistroUsuarios(self.caminho)
        for login in ("ana", "bia"):
            u.alterar(self.registro, dict(login=login, nome_completo=login.title(), email=f"{login}@teste.com"), "bootstrap")
        u.alterar(self.registro, dict(login="adm", nome_completo="Adm", email="adm@teste.com", nivel_acesso="administrador"), "bootstrap")
        self.gestao = db.RegistroClientesCasos(self.caminho)
        self.agora = lambda: instante("2026-11-17")
        self.cliente = self.gestao.criar_cliente("Maria", None, None, self.agora)
        self.config = automacoes.Repositorio(self.caminho)

    def caso(self, titulo="Ação A", responsavel="ana", numeros=(NUMERO,), ultimo=None):
        caso = self.gestao.criar_caso(self.cliente["id"], titulo, responsavel, list(numeros), self.agora)
        if ultimo:
            self.gestao.salvar_capa_processo(caso["id"], numeros[0], agora=self.agora, tribunal="TJSP", movimentos=[
                {"codigo": 1, "nome": "Distribuição", "dataHora": "2025-01-10T10:00:00"},
                {"codigo": 2, "nome": "Último", "dataHora": f"{ultimo}T10:00:00"}])
        return caso

    def parados(self, dias=60, silenciados=(), hoje=date(2026, 11, 17)):
        return automacoes.processos_parados(self.gestao, dias, set(silenciados), hoje)


class SelecaoTest(_Base):
    def test_entra_quando_chega_ao_limite_e_nao_antes(self):
        antes = self.caso("59 dias", numeros=(NUMERO_2,), ultimo="2026-09-19")   # 59 dias
        limite = self.caso("60 dias", numeros=(NUMERO_3,), ultimo="2026-09-18")  # 60 dias
        achados = self.parados()
        self.assertEqual([a["caso_id"] for a in achados], [limite["id"]])
        self.assertEqual((achados[0]["dias_parado"], achados[0]["ultima"]), (60, "2026-09-18"))
        self.assertEqual({a["caso_id"] for a in self.parados(dias=59)}, {antes["id"], limite["id"]})

    def test_sem_movimentacao_conhecida_nao_avisa(self):
        self.caso("Sem nada", numeros=())
        self.caso("Só número", ultimo=None)
        self.assertEqual(self.parados(), [])

    def test_publicacao_recente_conta_como_movimentacao(self):
        caso = self.caso(ultimo="2026-06-01")
        self.assertEqual(len(self.parados()), 1)
        self.gestao.registrar_evento(NUMERO, "publicacao", {"data_disponibilizacao": "2026-11-10", "tipoComunicacao": "Intimação"}, self.agora)
        self.assertEqual(self.parados(), [], caso["titulo"])

    def test_silenciado_e_caso_inativo_ficam_de_fora(self):
        caso = self.caso(ultimo="2026-06-01")
        self.assertEqual(self.parados(silenciados={caso["id"]}), [])
        self.assertEqual(len(self.parados()), 1)

    def test_processo_baixado_ou_arquivado_fica_de_fora(self):
        caso = self.caso(ultimo="2026-06-01")
        self.gestao.salvar_capa_processo(caso["id"], NUMERO, agora=self.agora, fase="Arquivado definitivamente")
        self.assertEqual(self.parados(), [])
        outro = self.caso("Outro", numeros=(NUMERO_2,), ultimo="2026-06-01")
        self.gestao.salvar_capa_processo(outro["id"], NUMERO_2, agora=self.agora, status_processo="Baixado")
        self.assertEqual(self.parados(), [])

    def test_rodada_avanca_a_cada_novo_periodo(self):
        self.caso(ultimo="2026-09-18")  # 60 dias
        self.assertEqual(self.parados()[0]["rodada"], 0)
        self.assertEqual(self.parados(hoje=date(2026, 12, 16))[0]["rodada"], 0)   # 89 dias
        self.assertEqual(self.parados(hoje=date(2027, 1, 16))[0]["rodada"], 1)    # 120 dias
        self.assertEqual(self.parados(hoje=date(2027, 3, 17))[0]["rodada"], 2)    # 180 dias


class RotinaTest(_Base):
    def rodar(self, dia="2026-11-17", enviados=None, falhar=False):
        async def enviar(destino, assunto, corpo, html):
            if falhar:
                raise RuntimeError("smtp fora do ar")
            if enviados is not None:
                enviados.append((destino, assunto, corpo, html))
        return asyncio.run(automacoes.avisar_processos_parados(
            self.gestao, agora=lambda: instante(dia), enviar_email=enviar, base_url="https://exemplo.org"))

    def avisos(self, usuario):
        itens = notificacoes.Repositorio(self.caminho, agora=lambda: instante("2026-11-18")).listar(usuario)["notificacoes"]
        return [i for i in itens if i["tipo"] == "processo_parado"]

    def test_avisa_o_responsavel_por_sino_e_email_uma_vez(self):
        self.caso("Ação Parada", ultimo="2026-06-01")
        enviados = []
        self.assertTrue(self.rodar(enviados=enviados))
        self.assertEqual(len(self.avisos("ana")), 1)
        self.assertEqual(self.avisos("bia"), [])
        self.assertEqual([e[0] for e in enviados], ["ana@teste.com"])
        self.assertIn("Ação Parada", enviados[0][1])
        self.assertIn("https://exemplo.org/radix/#/casos?id=", enviados[0][2])
        # mesma rodada no mesmo dia (ou no dia seguinte): nada de novo
        self.rodar(enviados=enviados)
        self.rodar(dia="2026-11-18", enviados=enviados)
        self.assertEqual(len(self.avisos("ana")), 1)
        self.assertEqual(len(enviados), 1)

    def test_sem_responsavel_vai_para_os_administradores(self):
        self.caso(responsavel=None, ultimo="2026-06-01")
        self.rodar()
        self.assertEqual(len(self.avisos("adm")), 1)
        self.assertEqual(self.avisos("ana"), [])

    def test_movimento_novo_zera_e_novo_periodo_avisa_de_novo(self):
        caso = self.caso(ultimo="2026-06-01")
        self.rodar()
        self.assertEqual(len(self.avisos("ana")), 1)
        # ficou mais 60 dias parado (rodada seguinte): novo aviso
        self.rodar(dia="2027-01-30")
        self.assertEqual(len(self.avisos("ana")), 2)
        # andamento novo em dezembro: com a data nova e 60 dias depois, avisa pelo novo período
        self.gestao.salvar_capa_processo(caso["id"], NUMERO, agora=self.agora, movimentos=[
            {"codigo": 3, "nome": "Sentença", "dataHora": "2027-02-01T10:00:00"}])
        self.rodar(dia="2027-02-10")
        self.assertEqual(len(self.avisos("ana")), 2)
        self.rodar(dia="2027-04-05")
        self.assertEqual(len(self.avisos("ana")), 3)

    def test_parametro_dias_vem_da_configuracao(self):
        self.caso(ultimo="2026-10-20")  # 28 dias
        self.rodar()
        self.assertEqual(self.avisos("ana"), [])
        self.config.definir("processo_parado", "bootstrap", parametros={"dias": 15})
        self.rodar()
        self.assertEqual(len(self.avisos("ana")), 1)

    def test_texto_do_aviso_e_destino(self):
        self.caso("Ação Parada", ultimo="2026-06-01")
        self.rodar()
        item = self.avisos("ana")[0]
        self.assertEqual(item["titulo"], "Processo sem movimentação")
        self.assertIn("Ação Parada", item["mensagem"])
        self.assertIn("01/06/2026", item["mensagem"])
        self.assertEqual(item["destino"]["tipo"], "movimentos_processo")

    def test_abrir_o_aviso_leva_as_movimentacoes_do_processo(self):
        caso = self.caso(ultimo="2026-06-01")
        self.rodar()
        repo = notificacoes.Repositorio(self.caminho, agora=lambda: instante("2026-11-18"))
        item = self.avisos("ana")[0]
        self.assertEqual(repo.destino("ana", item["id"]), {"tipo": "movimentos_processo", "caso_id": caso["id"]})
        self.assertIsNone(repo.destino("bia", item["id"]))  # aviso de outra pessoa
        self.assertEqual(repo.marcar_lida("ana", item["id"])["id"], item["id"])

    def test_falha_de_email_conta_como_falha_mas_o_sino_fica(self):
        self.caso(ultimo="2026-06-01")
        self.assertFalse(self.rodar(falhar=True))
        self.assertEqual(len(self.avisos("ana")), 1)

    def test_sem_email_cadastrado_so_o_sino(self):
        self.caso(ultimo="2026-06-01")
        self.registro.atualizar(lambda d: d["ana"].update(email=None))
        enviados = []
        self.assertTrue(self.rodar(enviados=enviados))
        self.assertEqual((len(self.avisos("ana")), enviados), (1, []))

    def test_sem_nada_parado_nao_faz_nada(self):
        self.caso(ultimo="2026-11-10")
        self.assertTrue(self.rodar())
        self.assertEqual(self.avisos("ana"), [])


class SilenciarTest(_Base):
    def test_silenciar_e_reativar(self):
        caso = self.caso()
        self.assertEqual(self.config.silenciados("processo_parado"), set())
        self.config.silenciar("processo_parado", caso["id"], "ana")
        self.config.silenciar("processo_parado", caso["id"], "ana")  # idempotente
        self.assertEqual(self.config.silenciados("processo_parado"), {caso["id"]})
        self.config.silenciar("processo_parado", caso["id"], "ana", False)
        self.assertEqual(self.config.silenciados("processo_parado"), set())
        with self.assertRaises(LookupError):
            self.config.silenciar("inexistente", caso["id"], "ana")


class RotaSilenciarTest(_Base):
    def chamar(self, metodo, caso_id, corpo=None, token=None):
        token = token or self.token
        app = server._AutenticacaoBearer(None, self.registro, gestao=self.gestao)
        saida = []

        async def receive():
            return {"type": "http.request", "body": json.dumps(corpo).encode() if corpo is not None else b"", "more_body": False}

        async def send(e):
            saida.append(e)

        scope = {"type": "http", "path": f"/casos/{caso_id}/aviso-processo-parado", "method": metodo,
                 "headers": [(b"authorization", f"Bearer {token}".encode())], "client": ("127.0.0.1", 1)}
        asyncio.run(app(scope, receive, send))
        bruto = b"".join(e.get("body", b"") for e in saida[1:])
        try:
            return saida[0]["status"], json.loads(bruto or b"{}")
        except ValueError:
            return saida[0]["status"], bruto.decode()

    def setUp(self):
        super().setUp()
        _, _, self.token = server._criar_usuario_core(self.registro, "caio@teste.com")

    def test_get_put_e_validacoes(self):
        caso = self.caso()
        self.assertEqual(self.chamar("GET", caso["id"]), (200, {"silenciado": False, "rotina_ativa": False, "dias": 60}))
        status, corpo = self.chamar("PUT", caso["id"], {"silenciado": True})
        self.assertEqual((status, corpo["silenciado"]), (200, True))
        self.assertEqual(self.config.silenciados("processo_parado"), {caso["id"]})
        self.assertEqual(self.chamar("PUT", caso["id"], {"silenciado": False})[1]["silenciado"], False)
        self.assertEqual(self.chamar("PUT", caso["id"], {"silenciado": "sim"})[0], 400)
        self.assertEqual(self.chamar("PUT", caso["id"], {})[0], 400)
        self.assertEqual(self.chamar("GET", "inexistente")[0], 404)
        self.assertEqual(self.chamar("DELETE", caso["id"])[0], 405)

    def test_exige_autenticacao(self):
        caso = self.caso()
        self.assertEqual(self.chamar("GET", caso["id"], token="invalido")[0], 401)


if __name__ == "__main__":
    unittest.main()
