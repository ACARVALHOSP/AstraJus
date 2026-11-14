"""Jurimetria na ficha do processo: casamento da capa com as árvores do CJPG e limites do e-SAJ.

Árvores pequenas, no mesmo formato das reais (conferidas no e-SAJ em 13/11/2026): comarca e foro dividem o
id, a mesma vara aparece com nomes diferentes e há assuntos homônimos em ramos diferentes."""
import asyncio
import unittest
from unittest import mock

from modulos.jurimetria import resolver, servico

VARA = [
    {"id": "100", "pai": None, "nome": "Cabreúva", "busca": "cabreuva", "folha": False},
    {"id": "100", "pai": None, "nome": "Foro Central Cível", "busca": "sao paulo foro central civel", "folha": False},
    {"id": "100-12", "pai": "100", "nome": "12ª Vara Cível", "busca": "", "folha": True},
    {"id": "100-3651", "pai": "100", "nome": "12ª. Vara Cível", "busca": "", "folha": True},
    {"id": "100-1718", "pai": "100", "nome": "12ª V.CÍVEL", "busca": "", "folha": True},
    {"id": "100-1475", "pai": "100", "nome": "12ª VC", "busca": "", "folha": True},
    {"id": "100-2", "pai": "100", "nome": "2ª Vara Cível", "busca": "", "folha": True},
    {"id": "100-1720", "pai": "100", "nome": "12ª Vara Criminal", "busca": "", "folha": True},
    {"id": "100-1518", "pai": "100", "nome": "10ª V Faz Pública", "busca": "", "folha": True},
    {"id": "100-1519", "pai": "100", "nome": "11ª V Faz Pública", "busca": "", "folha": True},
    {"id": "318", "pai": None, "nome": "Leme", "busca": "leme", "folha": False},
    {"id": "318", "pai": None, "nome": "Foro de Leme", "busca": "leme foro de leme", "folha": False},
    {"id": "318-2", "pai": "318", "nome": "1ª Vara Cível", "busca": "", "folha": True},
    {"id": "318-4939", "pai": "318", "nome": "1.VARA JUDICIAL", "busca": "", "folha": True},
]
CLASSE = [
    {"id": "8501", "pai": None, "nome": "Procedimento Comum Cível", "busca": "1107-procedimento de conhecimento||7-procedimento comum civel", "folha": True},
    {"id": "8655", "pai": None, "nome": "Procedimento Comum", "busca": "1-x||8655-procedimento comum", "folha": True},
    {"id": "5706", "pai": None, "nome": "Execução de Título Extrajudicial", "busca": "1-execucao|5706-execucao de titulo extrajudicial", "folha": True},
    {"id": "6603", "pai": None, "nome": "Execução de Título Extrajudicial", "busca": "2-fazenda|6603-execucao de titulo extrajudicial", "folha": True},
]
ASSUNTO = [
    {"id": "10433", "pai": None, "nome": "Indenização por Dano Moral", "busca": "899-direito civil|10431-responsabilidade civil|10433-indenizacao por dano moral", "folha": True},
    {"id": "7779", "pai": None, "nome": "Indenização por Dano Moral", "busca": "1156-direito do consumidor|6220-responsabilidade do fornecedor|7779-indenizacao por dano moral", "folha": True},
    {"id": "7681", "pai": None, "nome": "Obrigações", "busca": "899-direito civil|7681-obrigacoes", "folha": True},
]
MAGISTRADO = [
    {"codigo": "7753", "nome": "Abelardo de Azevedo Silveira"},
    {"codigo": "36471", "nome": "Aben Athar de Paiva Coutinho"},
    {"codigo": "900", "nome": "Maria da Silva"},
    {"codigo": "901", "nome": "Maria Souza da Silva"},
]
ARVORES = {"vara": VARA, "classe": CLASSE, "assunto": ASSUNTO, "magistrado": MAGISTRADO}
CNJ_SP = "1003325-11.2025.8.26.0100"
CNJ_LEME = "1003325-11.2025.8.26.0318"


class NumeroCnjTest(unittest.TestCase):
    def test_partes_e_tribunal(self):
        self.assertEqual(resolver.partes_cnj(CNJ_SP)["origem"], "0100")
        self.assertTrue(resolver.eh_tjsp(CNJ_SP))
        self.assertTrue(resolver.eh_tjsp("10033251120258260100"))      # só dígitos
        self.assertFalse(resolver.eh_tjsp("0000001-00.2020.5.02.0001"))  # TRT
        self.assertFalse(resolver.eh_tjsp("1234"))
        self.assertIsNone(resolver.partes_cnj(""))

    def test_foro_vem_do_numero_e_vale_o_no_do_foro_nao_o_da_comarca(self):
        self.assertEqual(resolver.foro_do_numero(CNJ_SP, VARA)["nome"], "Foro Central Cível")
        self.assertEqual(resolver.foro_do_numero(CNJ_LEME, VARA)["nome"], "Foro de Leme")
        self.assertIsNone(resolver.foro_do_numero("1003325-11.2025.8.26.9999", VARA))


class VaraTest(unittest.TestCase):
    def vara(self, texto, cnj=CNJ_SP):
        return resolver.resolver(cnj, texto, "", "", ARVORES)["vara"]

    def test_variantes_da_mesma_vara_viram_um_candidato_com_o_nome_limpo(self):
        r = self.vara("12ª Vara Cível")
        self.assertEqual(r["escolhido"]["id"], "100-12")
        self.assertEqual(sorted(r["escolhido"]["variantes"]), ["100-1475", "100-1718", "100-3651"])
        self.assertEqual(r["escolhido"]["caminho"], "Foro Central Cível > 12ª Vara Cível")

    def test_escritas_diferentes_da_capa(self):
        for texto in ("12ª VARA CÍVEL", "12a vara civel", "12º Vara Cível", "12ª VC", "12ª Vara Cível do Foro Central Cível"):
            self.assertEqual(self.vara(texto)["escolhido"]["id"], "100-12", texto)

    def test_numero_diferente_nao_casa(self):
        r = self.vara("2ª Vara Cível")
        self.assertEqual(r["escolhido"]["id"], "100-2")
        self.assertNotIn("100-12", [c["id"] for c in r["candidatos"] if c["confianca"] >= 0.99])

    def test_tipo_de_vara_diferente_fica_abaixo(self):
        r = self.vara("12ª Vara Cível")
        criminal = next(c for c in r["candidatos"] if c["id"] == "100-1720")
        self.assertLess(criminal["confianca"], 0.99)

    def test_sem_numero_na_capa_nao_escolhe_sozinho(self):
        r = self.vara("Vara da Fazenda Pública")
        self.assertIsNone(r["escolhido"])
        self.assertTrue(r["candidatos"])

    def test_duas_varas_possiveis_no_interior_pedem_confirmacao(self):
        r = self.vara("1ª Vara", CNJ_LEME)
        self.assertIsNone(r["escolhido"])
        self.assertEqual({c["id"] for c in r["candidatos"]}, {"318-2", "318-4939"})

    def test_orgao_com_varias_varas_nao_escolhe_sozinho(self):
        r = self.vara("UPJ da 12ª a 14ª Varas Cíveis do Foro Central Cível")
        self.assertIsNone(r["escolhido"])
        self.assertTrue(r["varias_varas"])
        self.assertNotIn("varias_varas", self.vara("12ª Vara Cível"))

    def test_sem_texto_ou_sem_foro(self):
        self.assertIsNone(self.vara("")["escolhido"])
        self.assertEqual(resolver.resolver("1003325-11.2025.8.26.9999", "1ª Vara", "", "", ARVORES)["vara"]["candidatos"], [])


class ClasseEAssuntoTest(unittest.TestCase):
    def resolver(self, classe="", assunto=""):
        return resolver.resolver(CNJ_SP, "", classe, assunto, ARVORES)

    def test_classe_exata_e_escolhida(self):
        r = self.resolver(classe="Procedimento Comum Cível")["classe"]
        self.assertEqual((r["escolhido"]["id"], r["ambiguo"]), ("8501", False))
        self.assertEqual(r["candidatos"][1]["id"], "8655")  # parecida, mas abaixo

    def test_nome_repetido_em_ramos_diferentes_e_ambiguo(self):
        r = self.resolver(assunto="Indenização por Dano Moral")["assunto"]
        self.assertTrue(r["ambiguo"])
        self.assertIsNone(r["escolhido"])
        self.assertEqual({c["id"] for c in r["candidatos"]}, {"10433", "7779"})
        caminhos = {c["id"]: c["caminho"] for c in r["candidatos"]}
        self.assertEqual(caminhos["10433"], "Direito civil > Responsabilidade civil > Indenização por Dano Moral")
        self.assertEqual(caminhos["7779"], "Direito do consumidor > Responsabilidade do fornecedor > Indenização por Dano Moral")

    def test_classe_com_nome_repetido_tambem_e_ambigua(self):
        r = self.resolver(classe="Execução de Título Extrajudicial")["classe"]
        self.assertTrue(r["ambiguo"])
        self.assertIsNone(r["escolhido"])

    def test_assunto_unico_e_escolhido_e_texto_vazio_nao_gera_candidato(self):
        self.assertEqual(self.resolver(assunto="Obrigações")["assunto"]["escolhido"]["id"], "7681")
        vazio = self.resolver()["assunto"]
        self.assertEqual((vazio["candidatos"], vazio["escolhido"]), ([], None))

    def test_fora_do_tjsp(self):
        self.assertEqual(resolver.resolver("0000001-00.2020.5.02.0001", "1ª Vara", "x", "y", ARVORES), {"tjsp": False})


class PeriodoEAtencaoTest(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(servico, "nucleo", mock.MagicMock())
        self.nucleo = p.start()
        self.addCleanup(p.stop)
        self.nucleo._data_tjsp.side_effect = lambda v: (v or "").strip()
        self.nucleo._html_para_texto.side_effect = lambda h: __import__("re").sub(r"<[^>]+>", " ", h)

    def test_periodo(self):
        v = servico._validar_periodo_cjpg
        self.assertIsNone(v(None, None))
        self.assertIsNone(v("14/11/2025", "13/11/2026"))      # 364 dias: o e-SAJ aceita
        self.assertIsNone(v("01/01/2025", "31/12/2025"))
        self.assertIn("até 1 ano", v("13/11/2025", "13/11/2026"))  # 365 dias: o e-SAJ recusa
        self.assertIn("até 1 ano", v("01/01/2025", "01/01/2026"))
        self.assertIn("duas datas", v("01/11/2025", None))
        self.assertIn("duas datas", v(None, "01/11/2025"))
        self.assertIn("inválidas", v("31/02/2025", "01/03/2025"))
        self.assertIn("anterior", v("01/05/2026", "01/04/2026"))

    def test_mensagem_de_atencao_do_esaj(self):
        html = "<div>Atenção  O período entre a data de início e fim da pesquisa deve ser de no máximo 1 ano.  Orientações  Para detalhes</div>"
        self.assertIn("no máximo 1 ano", servico._cjpg_mensagem_atencao(html))
        self.assertIsNone(servico._cjpg_mensagem_atencao('<tr class="fundocinza1">Atenção  texto da decisão  Orientações</tr>'))
        self.assertIsNone(servico._cjpg_mensagem_atencao("<html>Parâmetros de Consulta</html>"))

    def test_ferramentas_recusam_periodo_ruim_sem_ir_ao_esaj(self):
        self.nucleo._erro.side_effect = lambda m: {"erro": m}
        with mock.patch.object(servico, "_cjpg_executar_busca", side_effect=AssertionError("não devia consultar")):
            r = asyncio.run(servico.consultar_jurimetria_cjpg(termo="x", data_inicio="01/01/2025", data_fim="01/01/2026"))
            self.assertIn("até 1 ano", r["erro"])
            r = asyncio.run(servico.perfil_decisorio_magistrado(magistrado_nome="Fulano", data_inicio="01/01/2025"))
            self.assertIn("duas datas", r["erro"])


class RotaResolverTest(unittest.TestCase):
    def chamar(self, query):
        enviados = []

        async def json_(send, status, corpo):
            enviados.append((status, corpo))

        with mock.patch.object(servico, "nucleo", mock.MagicMock()) as nucleo, \
                mock.patch.object(servico, "_garantir_arvore_cjpg", new=mock.AsyncMock()), \
                mock.patch.object(servico, "_carregar_arvore_cjpg", side_effect=lambda campo: ARVORES[campo]):
            nucleo._query.return_value = list(query.items())
            nucleo._json = json_
            asyncio.run(servico._arvore_resolver_http({}, None))
        return enviados[0]

    def test_resolve_pela_rota(self):
        status, corpo = self.chamar({"numero": CNJ_SP, "vara": "12ª Vara Cível", "classe": "Procedimento Comum Cível", "assunto": "Obrigações"})
        self.assertEqual(status, 200)
        self.assertEqual(corpo["vara"]["escolhido"]["id"], "100-12")
        self.assertEqual(corpo["classe"]["escolhido"]["id"], "8501")
        self.assertEqual(corpo["assunto"]["escolhido"]["id"], "7681")

    def test_numero_obrigatorio(self):
        self.assertEqual(self.chamar({"vara": "x"})[0], 400)
        self.assertEqual(self.chamar({"numero": "123"})[0], 400)


class MagistradoETest(unittest.TestCase):
    def test_nome_inteiro_e_unico_e_escolhido_mesmo_com_caixa_e_tratamento(self):
        for texto in ("ABELARDO AZEVEDO SILVEIRA", "Dr. Abelardo de Azevedo Silveira", "Juiz de Direito Abelardo de Azevedo Silveira"):
            r = resolver.resolver_magistrado(texto, MAGISTRADO)
            self.assertEqual(r["escolhido"]["id"], "7753", texto)

    def test_nome_parcial_nao_escolhe_sozinho(self):
        r = resolver.resolver_magistrado("Maria Souza", MAGISTRADO)  # só 2 de 3 palavras de "Maria Souza da Silva"
        self.assertIsNone(r["escolhido"])
        self.assertEqual([c["id"] for c in r["candidatos"]], ["901"])

    def test_homonimos_pedem_confirmacao(self):
        lista = [*MAGISTRADO, {"codigo": "902", "nome": "Maria da Silva"}]
        r = resolver.resolver_magistrado("Maria da Silva", lista)
        self.assertIsNone(r["escolhido"])
        self.assertTrue(r["ambiguo"])
        self.assertEqual({c["id"] for c in r["candidatos"] if c["confianca"] == 1.0}, {"900", "902"})

    def test_sem_texto_ou_sem_parecido(self):
        self.assertEqual(resolver.resolver_magistrado("", MAGISTRADO)["candidatos"], [])
        self.assertEqual(resolver.resolver_magistrado("Fulano Beltrano", MAGISTRADO)["candidatos"], [])

    def test_resolver_inclui_o_magistrado(self):
        r = resolver.resolver(CNJ_SP, "", "", "", ARVORES, "Aben Athar de Paiva Coutinho")
        self.assertEqual(r["magistrado"]["escolhido"]["id"], "36471")
        self.assertEqual(resolver.resolver(CNJ_SP, "", "", "", ARVORES)["magistrado"]["candidatos"], [])


class DescreverNoTest(unittest.TestCase):
    def test_cada_campo(self):
        self.assertEqual(resolver.descrever_no("vara", "100-12", ARVORES),
                         {"id": "100-12", "nome": "12ª Vara Cível", "caminho": "Foro Central Cível > 12ª Vara Cível"})
        self.assertEqual(resolver.descrever_no("classe", "8501", ARVORES)["caminho"], "Procedimento de conhecimento > Procedimento Comum Cível")
        self.assertEqual(resolver.descrever_no("assunto", "7779", ARVORES)["nome"], "Indenização por Dano Moral")
        self.assertEqual(resolver.descrever_no("magistrado", "7753", ARVORES)["nome"], "Abelardo de Azevedo Silveira")

    def test_id_inexistente_e_raiz_de_vara_nao_valem(self):
        self.assertIsNone(resolver.descrever_no("vara", "999-1", ARVORES))
        self.assertIsNone(resolver.descrever_no("vara", "100", ARVORES))  # raiz (foro/comarca), não é vara
        self.assertIsNone(resolver.descrever_no("magistrado", "0", ARVORES))


if __name__ == "__main__":
    unittest.main()
