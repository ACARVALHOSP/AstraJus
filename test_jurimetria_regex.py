"""Jurimetria: heurísticas de regex (desfecho, valor de condenação, parsers do CJPG) e estatística.

Não importa o `server` (não precisa do MCP): se o núcleo ainda não estiver vinculado, usa um
substituto mínimo de `_html_para_texto`/`_sem_acento_cjpg`, que é só o que o parser usa.
Casos marcados com `expectedFailure` documentam limitações conhecidas das regex: ao corrigir a
heurística, o teste passa a "passar inesperadamente" e a marca deve ser removida.
"""
import asyncio
import html
import json
import os
import re
import statistics
import tempfile
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

from modulos.jurimetria import servico
from modulos.nucleo import nucleo


class _NucleoFalso:
    log = mock.MagicMock()

    @staticmethod
    def _html_para_texto(conteudo):
        return html.unescape(re.sub(r"<[^>]+>", "", conteudo or ""))

    @staticmethod
    def _sem_acento_cjpg(texto):
        nfkd = unicodedata.normalize("NFD", texto or "")
        return "".join(c for c in nfkd if unicodedata.category(c) != "Mn").lower()


def setUpModule():
    if nucleo._alvo is None:
        nucleo.vincular(_NucleoFalso)


def tearDownModule():
    if nucleo._alvo is _NucleoFalso:
        nucleo._alvo = None


def sentenca(dispositivo: str, preambulo: str = "Vistos. Relatório dispensado. Fundamento e decido. ") -> str:
    return preambulo + dispositivo


class ClassificarDesfecho(unittest.TestCase):
    def classificar(self, texto):
        return servico._cjpg_classificar_desfecho(texto)

    def test_vazio_ou_none(self):
        self.assertIsNone(self.classificar(None))
        self.assertIsNone(self.classificar(""))

    def test_categorias_basicas(self):
        casos = {
            "procedente": "Ante o exposto, JULGO PROCEDENTE o pedido.",
            "improcedente": "Diante do exposto, julgo improcedente a ação.",
            "parcial": "Posto isso, julgo parcialmente procedente o pedido.",
            "acordo": "Isto posto, homologo o acordo celebrado entre as partes.",
            "extinto": "Pelo exposto, julgo extinto o processo, sem resolução do mérito.",
        }
        for esperado, dispositivo in casos.items():
            with self.subTest(esperado):
                self.assertEqual(self.classificar(sentenca(dispositivo)), esperado)

    def test_plural_e_maiusculas(self):
        self.assertEqual(self.classificar(sentenca("Ante o exposto, JULGO PROCEDENTES os pedidos.")), "procedente")
        self.assertEqual(self.classificar(sentenca("Ante o exposto, JULGO IMPROCEDENTES os pedidos.")), "improcedente")
        self.assertEqual(self.classificar(sentenca("Ante o exposto, julgo extintos os autos.")), "extinto")

    def test_espacos_e_quebras_de_linha_entre_palavras(self):
        self.assertEqual(self.classificar(sentenca("Ante o exposto, julgo\n  parcialmente   procedente o pedido.")), "parcial")
        self.assertEqual(self.classificar(sentenca("Ante o exposto, julgo\timprocedente a ação.")), "improcedente")

    def test_parcial_nao_vira_procedente(self):
        # "parcialmente procedente" contém "procedente", mas vem antes na região: deve ser parcial
        self.assertEqual(self.classificar(sentenca("Ante o exposto, julgo parcialmente procedente.")), "parcial")

    def test_usa_o_ultimo_marcador_de_dispositivo(self):
        # "julgo procedente" na fundamentação (citação) não pode prevalecer sobre o dispositivo final
        texto = (
            "O autor pede que se julgo procedente... Diante do exposto, a tese não se sustenta. "
            "Ante o exposto, julgo improcedente o pedido."
        )
        self.assertEqual(self.classificar(texto), "improcedente")

    def test_sem_marcador_usa_os_ultimos_3000_caracteres(self):
        # a menção no começo de um texto longo e sem marcador fica fora da janela
        texto = "julgo procedente " + ("x" * 4000) + " julgo improcedente"
        self.assertEqual(self.classificar(texto), "improcedente")

    def test_primeira_ocorrencia_na_regiao_vence(self):
        texto = sentenca("Ante o exposto, julgo procedente o pedido principal e julgo improcedente a reconvenção.")
        self.assertEqual(self.classificar(texto), "procedente")

    def test_sem_nenhuma_expressao_devolve_none(self):
        self.assertIsNone(self.classificar(sentenca("Ante o exposto, determino a remessa ao arquivo.")))

    @unittest.expectedFailure
    def test_limitacao_procedente_em_parte(self):
        self.assertEqual(self.classificar(sentenca("Ante o exposto, julgo procedente em parte o pedido.")), "parcial")

    @unittest.expectedFailure
    def test_limitacao_extingo_o_processo(self):
        self.assertEqual(self.classificar(sentenca("Ante o exposto, extingo o processo sem resolução do mérito.")), "extinto")

    @unittest.expectedFailure
    def test_limitacao_homologo_desistencia_nao_e_acordo(self):
        self.assertEqual(self.classificar(sentenca("Ante o exposto, homologo a desistência e julgo extinto o processo.")), "extinto")


class ExtrairValorCondenacao(unittest.TestCase):
    def valor(self, texto):
        return servico._cjpg_extrair_valor_condenacao(texto)

    def test_vazio_ou_none(self):
        self.assertIsNone(self.valor(None))
        self.assertIsNone(self.valor(""))

    def test_valor_simples(self):
        texto = sentenca("Ante o exposto, condeno a ré ao pagamento de R$ 5.000,00 a título de danos morais.")
        self.assertEqual(self.valor(texto), 5000.0)

    def test_milhar_e_centavos(self):
        texto = sentenca("Ante o exposto, condeno a ré ao pagamento de indenização por dano moral no valor de R$ 12.345,67.")
        self.assertEqual(self.valor(texto), 12345.67)

    def test_sem_espaco_apos_cifrao(self):
        texto = sentenca("Ante o exposto, condeno a ré a pagar R$8.000,00 por danos morais.")
        self.assertEqual(self.valor(texto), 8000.0)

    def test_moral_no_singular_e_plural(self):
        self.assertEqual(self.valor(sentenca("Ante o exposto, dano moral de R$ 3.000,00.")), 3000.0)
        self.assertEqual(self.valor(sentenca("Ante o exposto, danos morais de R$ 4.000,00.")), 4000.0)

    def test_escolhe_o_valor_mais_proximo_de_moral(self):
        texto = sentenca(
            "Ante o exposto, condeno a ré a restituir R$ 900,00 de dano material e, "
            "ainda, ao pagamento de danos morais no valor de R$ 6.000,00."
        )
        self.assertEqual(self.valor(texto), 6000.0)

    def test_ignora_valor_sem_a_palavra_moral(self):
        texto = sentenca("Ante o exposto, condeno a ré à restituição de R$ 1.500,00 em dobro.")
        self.assertIsNone(self.valor(texto))

    def test_ignora_valor_fora_da_distancia_maxima(self):
        distante = " " + ("x" * (servico.CJPG_DISTANCIA_MAX_VALOR + 50)) + " "
        texto = sentenca("Ante o exposto, danos morais" + distante + "no valor de R$ 7.000,00.")
        self.assertIsNone(self.valor(texto))

    def test_aceita_valor_dentro_da_distancia_maxima(self):
        meio = " " + ("x" * (servico.CJPG_DISTANCIA_MAX_VALOR - 100)) + " "
        texto = sentenca("Ante o exposto, danos morais" + meio + "no valor de R$ 7.000,00.")
        self.assertEqual(self.valor(texto), 7000.0)

    def test_so_olha_o_dispositivo_quando_ha_marcador(self):
        texto = (
            "Na inicial, o autor pediu danos morais de R$ 50.000,00. Fundamentação extensa. "
            "Ante o exposto, julgo improcedente o pedido de danos morais."
        )
        self.assertIsNone(self.valor(texto))

    def test_sem_marcador_olha_os_ultimos_3000_caracteres(self):
        texto = "danos morais R$ 9.999,00 " + ("x" * 4000) + " fim"
        self.assertIsNone(self.valor(texto))

    @unittest.expectedFailure
    def test_limitacao_valor_sem_centavos(self):
        self.assertEqual(self.valor(sentenca("Ante o exposto, danos morais de R$ 5.000.")), 5000.0)

    @unittest.expectedFailure
    def test_limitacao_valor_por_extenso_com_mil(self):
        self.assertEqual(self.valor(sentenca("Ante o exposto, danos morais de R$ 10 mil.")), 10000.0)


def bloco_resultado(numero="1001234-56.2024.8.26.0100", teor_oculto="", **campos):
    padrao = {
        "Classe": "Procedimento Comum Cível", "Assunto": "Indenização por Dano Moral",
        "Magistrado": "Fulana de Tal", "Comarca": "São Paulo", "Foro": "Foro Central Cível",
        "Vara": "1ª Vara Cível", "Data de Disponibilização": "10/03/2024",
    }
    padrao.update(campos)
    linhas = "".join(
        f'<tr><td><strong>{nome}: </strong>{valor}</td></tr>' for nome, valor in padrao.items() if valor is not None
    )
    return (
        '<tr class="fundocinza1"><td><table>'
        f'<span class="fonteNegrito"> {numero} </span>{linhas}'
        '<tr><td><div align="justify"><span>Trecho da <b>sentença</b> &amp; resumo</span><img src="x"></div>'
        f'<div align="justify" style="display: none;"><span>{teor_oculto}</span></div></td></tr>'
        '</table></td></tr>'
    )


class ParserResultados(unittest.TestCase):
    def test_extrai_campos_e_classifica(self):
        teor = "Ante o exposto, julgo procedente o pedido e condeno a ré a pagar R$ 5.000,00 de danos morais."
        itens = servico._cjpg_parsear_resultados("<html>" + bloco_resultado(teor_oculto=teor) + "</html>")
        self.assertEqual(len(itens), 1)
        item = itens[0]
        self.assertEqual(item["numero_processo"], "1001234-56.2024.8.26.0100")
        self.assertEqual(item["classe"], "Procedimento Comum Cível")
        self.assertEqual(item["magistrado"], "Fulana de Tal")
        self.assertEqual(item["data_disponibilizacao"], "10/03/2024")
        self.assertEqual(item["trecho"], "Trecho da sentença & resumo")
        self.assertEqual(item["desfecho"], "procedente")
        self.assertEqual(item["valor_condenacao"], 5000.0)

    def test_varios_blocos(self):
        html_pagina = bloco_resultado(numero="1") + bloco_resultado(numero="2") + bloco_resultado(numero="3")
        self.assertEqual([i["numero_processo"] for i in servico._cjpg_parsear_resultados(html_pagina)], ["1", "2", "3"])

    def test_campo_ausente_vira_none_e_sem_teor_nao_classifica(self):
        itens = servico._cjpg_parsear_resultados(bloco_resultado(Foro=None))
        self.assertIsNone(itens[0]["foro"])
        self.assertIsNone(itens[0]["desfecho"])
        self.assertIsNone(itens[0]["valor_condenacao"])

    def test_pagina_sem_resultados(self):
        self.assertEqual(servico._cjpg_parsear_resultados("<html>Parâmetros de Consulta</html>"), [])


class TotalEBloqueio(unittest.TestCase):
    def test_total_resultados(self):
        self.assertEqual(servico._cjpg_total_resultados("Resultados <strong>1 a 10</strong> de 1.234"), 1234)
        self.assertEqual(servico._cjpg_total_resultados("Resultados <strong> 11 a 20 </strong> de 87"), 87)
        self.assertIsNone(servico._cjpg_total_resultados("<html>nada aqui</html>"))

    def test_bloqueio(self):
        self.assertTrue(servico._cjpg_bloqueado("<html>formulário vazio</html>"))
        self.assertFalse(servico._cjpg_bloqueado('<tr class="fundocinza1">'))
        self.assertFalse(servico._cjpg_bloqueado("Parâmetros de Consulta"))


class ParserArvores(unittest.TestCase):
    def no(self, id_, nome, busca=None):
        return (
            f'<span id="vara_tree_node_{id_}" class="node folha" value="{id_}" '
            f'searchValue="{busca or nome}">{nome}</span>'
        )

    def test_hierarquia_pai_e_folha(self):
        pagina = self.no("711", "Comarca A") + self.no("711-9", "Foro A") + self.no("711-9-3", "1ª Vara")
        nos = {n["id"]: n for n in servico._parsear_arvore_cjpg(pagina)}
        self.assertIsNone(nos["711"]["pai"])
        self.assertEqual(nos["711-9"]["pai"], "711")
        self.assertEqual(nos["711-9-3"]["pai"], "711-9")
        self.assertFalse(nos["711"]["folha"])
        self.assertFalse(nos["711-9"]["folha"])
        self.assertTrue(nos["711-9-3"]["folha"])

    def test_nome_com_entidade_e_busca_em_minusculas(self):
        nos = servico._parsear_arvore_cjpg(self.no("1", "Cível &amp; Fam&iacute;lia", busca="CÍVEL Família"))
        self.assertEqual(nos[0]["nome"], "Cível & Família")
        self.assertEqual(nos[0]["busca"], "cível família")

    def test_magistrados(self):
        linha = (
            '<tr><td reference="cdAgente" beanvalue="{cod}">x</td>'
            '<td reference="nmAgente">{nome}</td></tr>'
        )
        pagina = (
            linha.format(cod="123", nome="Fulano de Tal") + linha.format(cod="-1", nome="Placeholder")
            + linha.format(cod="456", nome="   ")
        )
        self.assertEqual(servico._parsear_magistrados_cjpg(pagina), [{"codigo": "123", "nome": "Fulano de Tal"}])


class EstatisticaDaAmostra(unittest.TestCase):
    def test_wilson(self):
        self.assertIsNone(servico._intervalo_wilson(0, 0))
        baixo, alto = servico._intervalo_wilson(7, 10)
        self.assertAlmostEqual(baixo, 0.3968, places=3)
        self.assertAlmostEqual(alto, 0.8922, places=3)
        baixo, alto = servico._intervalo_wilson(0, 20)
        self.assertEqual(baixo, 0.0)
        self.assertGreater(alto, 0.0)
        baixo, alto = servico._intervalo_wilson(20, 20)
        self.assertEqual(alto, 1.0)
        self.assertLess(baixo, 1.0)

    def test_resumo_valores_mediana_quartis_e_outlier(self):
        resumo = servico._resumo_valores([1000, 2000, 3000, 4000, 50000])
        self.assertEqual(resumo["mediana"], 3000)
        self.assertEqual((resumo["p25"], resumo["p75"]), (2000, 4000))
        self.assertEqual((resumo["min"], resumo["max"]), (1000, 50000))
        self.assertEqual(resumo["outliers"], 1)

    def test_resumo_valores_um_so_valor(self):
        resumo = servico._resumo_valores([5000])
        self.assertEqual((resumo["mediana"], resumo["p25"], resumo["p75"], resumo["outliers"]), (5000, 5000, 5000, 0))

    def test_resumo_valores_nao_depende_da_ordem(self):
        self.assertEqual(servico._resumo_valores([4, 1, 3, 2]), servico._resumo_valores([1, 2, 3, 4]))
        self.assertEqual(servico._resumo_valores([1, 2, 3, 4])["mediana"], statistics.median([1, 2, 3, 4]))

    def test_avisos_de_amostra(self):
        self.assertIn("muito pequena", servico._avisos_amostra(3, "casos")[0])
        self.assertIn("pequena", servico._avisos_amostra(12, "casos")[0])
        self.assertNotIn("muito", servico._avisos_amostra(12, "casos")[0])
        self.assertEqual(servico._avisos_amostra(servico.CJPG_AMOSTRA_MINIMA, "casos"), [])


class ArvoresEmDisco(unittest.TestCase):
    """Cache das árvores (vara/classe/assunto/magistrado): leitura, lista embutida, download sob demanda."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        patcher = mock.patch.dict(os.environ, {"CNJ_MCP_ARVORES_CJPG_DIR": self.dir})
        patcher.start()
        self.addCleanup(patcher.stop)
        servico._CACHE_ARVORES_CJPG.clear()
        self.addCleanup(servico._CACHE_ARVORES_CJPG.clear)

    def arquivo(self, campo):
        return Path(self.dir) / f"{campo}.json"

    def test_magistrado_usa_a_lista_embutida_quando_nao_ha_cache(self):
        lista = servico._carregar_arvore_cjpg("magistrado")
        self.assertGreater(len(lista), 1000)
        self.assertEqual(set(lista[0]), {"codigo", "nome"})
        self.assertTrue(all(m["codigo"] and m["nome"].strip() not in ("", ".") for m in lista))
        self.assertEqual(len({m["codigo"] for m in lista}), len(lista))  # sem códigos repetidos

    def test_cache_do_servidor_tem_prioridade_sobre_a_lista_embutida(self):
        self.arquivo("magistrado").write_text(json.dumps([{"codigo": "1", "nome": "Fulano"}]), encoding="utf-8")
        self.assertEqual(servico._carregar_arvore_cjpg("magistrado"), [{"codigo": "1", "nome": "Fulano"}])

    def test_arquivo_vazio_ou_corrompido_cai_na_lista_embutida(self):
        for conteudo in ("[]", "{nao e json", '{"objeto": 1}'):
            with self.subTest(conteudo):
                servico._CACHE_ARVORES_CJPG.clear()
                self.arquivo("magistrado").write_text(conteudo, encoding="utf-8")
                self.assertGreater(len(servico._carregar_arvore_cjpg("magistrado")), 1000)

    def test_arvore_sem_arquivo_fica_vazia_e_nao_entra_no_cache(self):
        self.assertEqual(servico._carregar_arvore_cjpg("vara"), [])
        self.assertNotIn("vara", servico._CACHE_ARVORES_CJPG)

    def test_atualizar_nao_sobrescreve_arquivo_existente_com_lista_vazia(self):
        existente = [{"codigo": "9", "nome": "Beltrano"}]
        self.arquivo("magistrado").write_text(json.dumps(existente), encoding="utf-8")

        async def baixar(campo):
            return [] if campo == "magistrado" else [{"id": "1", "pai": None, "nome": campo, "busca": campo, "folha": True}]

        with mock.patch.object(servico, "_baixar_arvore_cjpg", baixar):
            resumo = asyncio.run(servico.atualizar_arvores_cjpg())
        self.assertEqual(resumo, {"vara": 1, "classe": 1, "assunto": 1, "magistrado": 0})
        self.assertEqual(json.loads(self.arquivo("magistrado").read_text(encoding="utf-8")), existente)
        self.assertEqual(len(json.loads(self.arquivo("vara").read_text(encoding="utf-8"))), 1)
        self.assertFalse(list(Path(self.dir).glob("*.tmp")))  # nenhum temporário esquecido

    def test_garantir_baixa_uma_vez_quando_falta_e_nao_repete_quando_ja_existe(self):
        chamadas = []

        async def baixar(campo):
            chamadas.append(campo)
            return [{"id": "1", "pai": None, "nome": "1ª Vara Cível", "busca": "1ª vara cível", "folha": True}]

        async def duas_vezes():
            await asyncio.gather(servico._garantir_arvore_cjpg("vara"), servico._garantir_arvore_cjpg("vara"))
            await servico._garantir_arvore_cjpg("vara")

        with mock.patch.object(servico, "_baixar_arvore_cjpg", baixar):
            asyncio.run(duas_vezes())
        self.assertEqual(chamadas, ["vara"])
        self.assertEqual(servico._buscar_arvore_cjpg("vara", "VARA civel")[0]["id"], "1")

    def test_garantir_tolera_falha_do_download(self):
        async def baixar(campo):
            raise RuntimeError("e-SAJ fora do ar")

        with mock.patch.object(servico, "_baixar_arvore_cjpg", baixar):
            asyncio.run(servico._garantir_arvore_cjpg("classe"))  # não propaga
        self.assertEqual(servico._carregar_arvore_cjpg("classe"), [])
        self.assertFalse(self.arquivo("classe").exists())


if __name__ == "__main__":
    unittest.main()
