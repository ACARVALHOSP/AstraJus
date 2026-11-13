"""Módulo Jurisprudência: busca de acórdãos e ementas do TJSP (e-SAJ)."""
import re
from datetime import datetime
from html import escape as _escapar
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from modulos.contrato import ferramenta
from modulos.nucleo import nucleo


JURISPRUDENCIA_TJSP_BASE_URL = "https://esaj.tjsp.jus.br"
JURISPRUDENCIA_TJSP_TIMEOUT_S = 30.0
JURISPRUDENCIA_TJSP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    "Referer": f"{JURISPRUDENCIA_TJSP_BASE_URL}/gcn-frontend-vue/jurisprudencia-selecionada/consulta",
}
JURISPRUDENCIA_TJSP_TAMANHO_PAGINA = 10
JURISPRUDENCIA_TJSP_TZ = ZoneInfo("America/Sao_Paulo")
# "dtjulgamento desc"/"asc" e "derelevancia" são os valores literais que o próprio e-SAJ usa (ver
# campo "ordenacoes" na resposta) - não são um enum nosso.
JURISPRUDENCIA_TJSP_ORDENACAO = {
    "recente": "dtjulgamento desc",
    "antiga": "dtjulgamento asc",
    "relevancia": "derelevancia",
}
# O e-SAJ não tem filtro de texto livre por relator/classe/comarca/órgão julgador: todos são
# seleção exata de um valor devolvido pela faceta da própria busca (campo "subfiltros" da
# resposta, chave "subFilter" no próximo request) - não há correspondência parcial no servidor.
_RE_JURISPRUDENCIA_TJSP_HIGHLIGHT = re.compile(r'<span id="highlighter">(.*?)</span>', re.DOTALL)
_RE_JURISPRUDENCIA_TJSP_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
# O e-SAJ aceita aspas na sintaxe (inclusive no próprio site oficial), mas não as usa para frase
# exata de verdade - confirmado comparando com a busca real do TJSP (as aspas mal reduzem o total
# de resultados). Por isso filtramos aqui usando a ementa completa, que é o único texto integral
# que recebemos do item.
_RE_JURISPRUDENCIA_TJSP_FRASE = re.compile(r'"([^"]+)"')


def _jurisprudencia_tjsp_contem_frases(texto: str | None, frases: list[str]) -> bool:
    if not texto:
        return False
    alvo = texto.lower()
    return all(frase.lower() in alvo for frase in frases)


def _jurisprudencia_tjsp_epoch_ms(data_ddmmaaaa: str, fim_do_dia: bool = False) -> int | None:
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", nucleo._data_tjsp(data_ddmmaaaa))
    if not m:
        return None
    dia, mes, ano = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hora_min_seg = (23, 59, 59) if fim_do_dia else (0, 0, 0)
    dt = datetime(ano, mes, dia, *hora_min_seg, tzinfo=JURISPRUDENCIA_TJSP_TZ)
    return int(dt.timestamp() * 1000)


def _jurisprudencia_tjsp_trecho_destacado(bruto: str | None) -> str | None:
    """Escapa o HTML devolvido pelo e-SAJ, preservando só o destaque de termo buscado (que o
    próprio servidor marca com <span id="highlighter">) como <mark> - nunca repassa HTML arbitrário
    do tribunal direto para o navegador do usuário."""
    if not bruto:
        return None
    bruto = _RE_JURISPRUDENCIA_TJSP_BR.sub(" ", bruto)
    partes: list[str] = []
    pos = 0
    for m in _RE_JURISPRUDENCIA_TJSP_HIGHLIGHT.finditer(bruto):
        partes.append(_escapar(bruto[pos : m.start()]))
        partes.append(f"<mark>{_escapar(m.group(1))}</mark>")
        pos = m.end()
    partes.append(_escapar(bruto[pos:]))
    return "".join(partes)


def _jurisprudencia_tjsp_termos_destacados(bruto: str | None) -> list[str]:
    """Extrai os termos que o e-SAJ marcou como encontrados (dentro de <span id="highlighter">),
    para reaplicá-los sobre a ementa completa."""
    if not bruto:
        return []
    termos: list[str] = []
    for m in _RE_JURISPRUDENCIA_TJSP_HIGHLIGHT.finditer(bruto):
        termo = m.group(1).strip()
        if termo and termo not in termos:
            termos.append(termo)
    return termos


def _jurisprudencia_tjsp_marcar_termos(texto: str, termos: list[str]) -> str:
    """Escapa `texto` e marca (<mark>, estilizado via token Carbon - ver .juris-trecho no SCSS) as
    ocorrências de `termos`, para destacar o termo buscado sem truncar a ementa completa."""
    if not termos:
        return _escapar(texto)
    padrao = re.compile(
        "|".join(re.escape(t) for t in sorted(set(termos), key=len, reverse=True)),
        re.IGNORECASE,
    )
    partes: list[str] = []
    pos = 0
    for m in padrao.finditer(texto):
        partes.append(_escapar(texto[pos : m.start()]))
        partes.append(f"<mark>{_escapar(m.group(0))}</mark>")
        pos = m.end()
    partes.append(_escapar(texto[pos:]))
    return "".join(partes)


def _extrair_lista_strings(valores: Any) -> list[str]:
    if not valores or not isinstance(valores, list):
        return []
    resultado: list[str] = []
    for v in valores:
        if isinstance(v, str) and v.strip():
            resultado.append(v.strip())
        elif isinstance(v, dict):
            nome = v.get("nmProlator") or v.get("deProlator") or v.get("deBoletim") or v.get("descricao") or v.get("nome")
            if nome and str(nome).strip():
                resultado.append(str(nome).strip())
    return resultado


def _jurisprudencia_tjsp_campos_resultado(item: dict) -> dict:
    ementa = (item.get("deEmentaJuris") or "").strip()
    termos = _jurisprudencia_tjsp_termos_destacados(item.get("highlightedDesc"))
    # Mostra sempre a ementa completa; quando o termo buscado bate nela, marca-o (<mark>) em vez de
    # trocar a ementa pelo trecho truncado que o e-SAJ devolve em "highlightedDesc". Se não houver
    # ementa cadastrada, cai para esse trecho truncado como única informação disponível.
    ementa_html = (
        _jurisprudencia_tjsp_marcar_termos(ementa, termos)
        if ementa
        else _jurisprudencia_tjsp_trecho_destacado(item.get("highlightedDesc"))
    )
    return {
        "cdJurisprudencia": item.get("cdJurisprudencia"),
        "cdAcordao": item.get("cdAcordao"),
        "classe": item.get("deClasse"),
        "relator": item.get("deRelator"),
        "comarca": item.get("nmComarca"),
        "orgao_julgador": item.get("nmOrgaoJulgador"),
        "data_julgamento": item.get("dtJulgamento"),
        "ementa": ementa or None,
        "ementa_html": ementa_html,
        "nu_processo_origem": item.get("nuProcOrigem"),
        "votacao": item.get("deVotacao"),
        "voto": item.get("deVoto"),
        "prolatores": _extrair_lista_strings(item.get("prolatores")),
        "boletins": _extrair_lista_strings(item.get("boletimList")),
        "ativo": item.get("flAtivo") != "N",
        "segredo_justica": item.get("flSegredoJustica") == "S",
        "pdf_url": (
            f"{JURISPRUDENCIA_TJSP_BASE_URL}/mat-report/publico/gcn/api/v1.0/jurisprudencia"
            f"?cdJurisprudenciaList={item.get('cdJurisprudencia')}&formato=S"
            if item.get("flSegredoJustica") != "S" and item.get("cdJurisprudencia")
            else None
        ),
    }


@ferramenta
async def consultar_jurisprudencia_tjsp(
    termo: str,
    buscar_em: str = "ementa",
    data_julgamento_inicio: str | None = None,
    data_julgamento_fim: str | None = None,
    relator: str | None = None,
    relatores: list[str] | None = None,
    classe: str | None = None,
    classes: list[str] | None = None,
    comarcas: list[str] | None = None,
    orgao_julgador: str | None = None,
    orgaos_julgadores: list[str] | None = None,
    ordenacao: str = "recente",
    pagina: int = 1,
) -> dict:
    """Busca acórdãos na base "Jurisprudência Selecionada" do TJSP (e-SAJ/GCN - API interna não
    documentada publicamente, obtida por engenharia reversa; sem SLA de estabilidade).

    Parâmetros:
    - termo: pesquisa por termos (obrigatório). Aceita os operadores que o próprio e-SAJ reconhece:
      OU, NÃO, "frase exata", * e ? (wildcards). Frase entre aspas: o e-SAJ não implementa busca de
      frase exata de verdade (confirmado contra o site oficial), então filtramos aqui usando a
      ementa completa do acórdão - um item sem ementa cadastrada não tem como ser verificado e é
      mantido pelo benefício da dúvida; "total_servidor" não reflete esse filtro.
    - buscar_em: "ementa" (padrão), "inteiro_teor" ou "ambos" - define em quais campos o termo é
      buscado.
    - data_julgamento_inicio / data_julgamento_fim: formato dd/mm/aaaa.
    - relator / classe / orgao_julgador: seleção exata de um valor de faceta do e-SAJ (sem busca
      parcial - um valor que não exista exatamente na base devolve zero resultados).
    - comarcas: lista de comarcas (seleção múltipla, mesma regra de correspondência exata; combinam
      em OU entre si).
    - ordenacao: "recente" (padrão, julgamento mais recente primeiro), "antiga" (julgamento mais
      antigo primeiro) ou "relevancia".
    - pagina: página de 10 resultados (1-indexada).

    Cada resultado já traz a ementa pronta (campo "ementa") quando o acórdão tiver uma cadastrada -
    não há geração automática de ementa pelo TJSP, só exibição da que foi redigida pelo tribunal.
    "ementa_html" traz essa mesma ementa completa (ou, na ausência dela, o trecho do inteiro teor
    devolvido pelo e-SAJ) com os termos buscados marcados em <mark> (HTML já escapado, seguro para
    renderizar). Resultados com "segredo_justica": true não têm PDF de
    acórdão disponível.
    """
    try:
        if not termo or not termo.strip():
            return nucleo._erro("Informe o termo de pesquisa.")
        if pagina < 1:
            return nucleo._erro("pagina deve ser >= 1.")
        if ordenacao not in JURISPRUDENCIA_TJSP_ORDENACAO:
            return nucleo._erro(f"ordenacao deve ser uma de: {', '.join(JURISPRUDENCIA_TJSP_ORDENACAO)}.")

        sub_filter: dict[str, list[str]] = {}

        def _combinar_lista(singular: str | None, plural: list[str] | None) -> list[str]:
            res: list[str] = []
            if plural and isinstance(plural, list):
                for x in plural:
                    if x and str(x).strip():
                        s = str(x).strip()
                        if s not in res:
                            res.append(s)
            if singular and str(singular).strip():
                s = str(singular).strip()
                if s not in res:
                    res.append(s)
            return res

        comarcas_limpas = _combinar_lista(None, comarcas)
        if comarcas_limpas:
            sub_filter["comarcas"] = comarcas_limpas

        relatores_limpos = _combinar_lista(relator, relatores)
        if relatores_limpos:
            sub_filter["relatores"] = relatores_limpos

        classes_limpas = _combinar_lista(classe, classes)
        if classes_limpas:
            sub_filter["classes"] = classes_limpas

        orgaos_limpos = _combinar_lista(orgao_julgador, orgaos_julgadores)
        if orgaos_limpos:
            sub_filter["orgaosJulgadores"] = orgaos_limpos

        corpo: dict[str, Any] = {
            "dePesquisaTermos": termo.strip(),
            "flEmenta": buscar_em in ("ementa", "ambos"),
            "flInteiroTeor": buscar_em in ("inteiro_teor", "ambos"),
            "relatorSelected": [],
            "tipoCartorioSelected": [],
            "varaSelected": [],
            "comarcaSelected": [],
            "classeSelected": [],
            "tipoBoletimSelected": [],
            "numPag": pagina - 1,
            "ordenacao": JURISPRUDENCIA_TJSP_ORDENACAO[ordenacao],
            "flPesquisaPlurais": "N",
            "legislativasNormativas": [
                {"tipoNorma": {}, "nuNorma": "", "deArtigo": "", "deParagrafo": "", "deInciso": "", "deAlinea": "", "deNumero": ""}
            ],
            "subFilter": sub_filter,
        }
        if data_julgamento_inicio and data_julgamento_inicio.strip():
            epoch = _jurisprudencia_tjsp_epoch_ms(data_julgamento_inicio)
            if epoch is None:
                return nucleo._erro("data_julgamento_inicio deve estar no formato dd/mm/aaaa.")
            corpo["dtJulgamentoInicio"] = epoch
        if data_julgamento_fim and data_julgamento_fim.strip():
            epoch = _jurisprudencia_tjsp_epoch_ms(data_julgamento_fim, fim_do_dia=True)
            if epoch is None:
                return nucleo._erro("data_julgamento_fim deve estar no formato dd/mm/aaaa.")
            corpo["dtJulgamentoFim"] = epoch

        async with nucleo._cliente(JURISPRUDENCIA_TJSP_TIMEOUT_S, headers=JURISPRUDENCIA_TJSP_HEADERS) as cliente:
            resp = await cliente.post(
                f"{JURISPRUDENCIA_TJSP_BASE_URL}/gcn-services/api/publico/jurisprudencia/find/jurisprudencias",
                json=corpo,
            )

        # O TJSP retorna HTTP 400 com "Consulta sem resultado." quando a busca não encontra acórdãos
        if resp.status_code == 400:
            try:
                dados_erro = resp.json()
                msg = dados_erro.get("message") or dados_erro.get("debugMessage") or ""
                if "sem resultado" in msg.lower():
                    return {
                        "total_servidor": 0,
                        "pagina": pagina,
                        "tamanho_pagina": JURISPRUDENCIA_TJSP_TAMANHO_PAGINA,
                        "resultados": [],
                        "comarcas_disponiveis": [],
                        "relatores_disponiveis": [],
                        "classes_disponiveis": [],
                        "orgaos_disponiveis": [],
                    }
                if msg:
                    return nucleo._erro(f"TJSP: {msg}")
            except Exception:
                pass

        resp.raise_for_status()
        try:
            dados = resp.json()
        except ValueError:
            # Sintaxe de busca que o e-SAJ não reconhece (ex.: "PROX") faz o TJSP devolver uma
            # resposta não-JSON em vez de um erro estruturado - sem isso, o usuário veria a
            # exceção crua de parsing.
            return nucleo._erro("Não foi possível processar essa busca - revise a sintaxe dos termos e tente novamente.")

        itens = dados.get("jurisprudencias") or []
        subfiltros = dados.get("subfiltros") or []

        def _extrair_facetas(nome_subfiltro: str, campo_item: str, chave_retorno: str) -> list[dict]:
            encontrados = next(
                (f.get("valoresSubFiltroResponseDTO") for f in subfiltros if f.get("campo") == nome_subfiltro),
                None,
            )
            if encontrados:
                return [
                    {chave_retorno: f.get("descricao"), "quantidade": str(f.get("quantidade", ""))}
                    for f in encontrados
                    if f.get("descricao")
                ]
            contagem: dict[str, int] = {}
            for item in itens:
                val = item.get(campo_item)
                if val and str(val).strip():
                    val_str = str(val).strip()
                    contagem[val_str] = contagem.get(val_str, 0) + 1
            return [
                {chave_retorno: val, "quantidade": str(qtd)}
                for val, qtd in sorted(contagem.items(), key=lambda x: x[0].lower())
            ]

        comarcas_disponiveis = _extrair_facetas("comarcas", "nmComarca", "comarca")
        relatores_disponiveis = _extrair_facetas("relatores", "deRelator", "relator")
        classes_disponiveis = _extrair_facetas("classes", "deClasse", "classe")
        orgaos_disponiveis = _extrair_facetas("orgaosJulgadores", "nmOrgaoJulgador", "orgao_julgador")

        resultados = [_jurisprudencia_tjsp_campos_resultado(item) for item in itens]
        frases = _RE_JURISPRUDENCIA_TJSP_FRASE.findall(termo)
        if frases:
            # Item sem ementa cadastrada não tem como ser verificado (não recebemos o inteiro teor
            # completo) - mantemos pelo benefício da dúvida em vez de descartar um possível acerto.
            # shortcut: total_servidor abaixo continua sendo a contagem bruta do TJSP, sem esse
            # filtro - pode ficar maior que len(resultados) nesta página.
            resultados = [
                r for r in resultados if not r.get("ementa") or _jurisprudencia_tjsp_contem_frases(r["ementa"], frases)
            ]

        return {
            "total_servidor": dados.get("totalHits"),
            "pagina": pagina,
            "tamanho_pagina": JURISPRUDENCIA_TJSP_TAMANHO_PAGINA,
            "resultados": resultados,
            "comarcas_disponiveis": comarcas_disponiveis,
            "relatores_disponiveis": relatores_disponiveis,
            "classes_disponiveis": classes_disponiveis,
            "orgaos_disponiveis": orgaos_disponiveis,
        }

    except httpx.HTTPStatusError as exc:
        try:
            corpo_erro = exc.response.json()
            msg = corpo_erro.get("message") or corpo_erro.get("debugMessage")
            if msg:
                if "sem resultado" in str(msg).lower():
                    return {
                        "total_servidor": 0,
                        "pagina": pagina,
                        "tamanho_pagina": JURISPRUDENCIA_TJSP_TAMANHO_PAGINA,
                        "resultados": [],
                        "comarcas_disponiveis": [],
                        "relatores_disponiveis": [],
                        "classes_disponiveis": [],
                        "orgaos_disponiveis": [],
                    }
                return nucleo._erro(f"TJSP: {msg}")
        except Exception:
            pass
        return nucleo._erro(f"Erro ao consultar a jurisprudência do TJSP (HTTP {exc.response.status_code}).")
    except httpx.HTTPError as exc:
        return nucleo._erro(f"Erro de rede ao consultar a jurisprudência do TJSP: {exc}")
    except Exception as exc:
        nucleo.log.exception("Falha inesperada em consultar_jurisprudencia_tjsp")
        return nucleo._erro(f"Erro inesperado ao consultar a jurisprudência do TJSP: {exc}")
