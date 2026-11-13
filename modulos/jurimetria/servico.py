"""Módulo Jurimetria: julgados de 1º grau do TJSP (CJPG), árvores de referência e perfil decisório."""
import asyncio
import hashlib
import json
import os
import re
import sqlite3
import statistics
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from modulos.contrato import ferramenta
from modulos.nucleo import nucleo

# --- CJPG: julgados de 1º grau do TJSP e árvores de referência ---------------
#
# O CJPG (https://esaj.tjsp.jus.br/cjpg/) não tem API oficial: é scraping do formulário HTML
# de busca do e-SAJ. É best-effort, por natureza - qualquer mudança de layout do e-SAJ quebra o
# parser sem aviso, e não há contrato estável como o DataJud/DJEN. Diferente do CJSG (2º grau),
# o CJPG não exige reCAPTCHA na busca.
#
# "Árvores de referência" = as listas de Vara/Classe/Assunto/Magistrado que o próprio formulário
# do e-SAJ usa (acessíveis pela lupa ao lado de cada campo). Selecionar Vara/Classe/Assunto no
# formulário real exige o código interno do e-SAJ (não o nome em texto livre), então essas listas
# são baixadas uma vez, processadas e guardadas em disco; o autocomplete do /app consulta esse
# cache, não o e-SAJ diretamente.

CJPG_BASE_URL = "https://esaj.tjsp.jus.br/cjpg"
CJPG_TIMEOUT_S = 60.0
CJPG_HEADERS = {
    # UA genérico leva a bloqueio brando: o e-SAJ devolve o formulário vazio em vez dos resultados.
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "Referer": f"{CJPG_BASE_URL}/",
}
CJPG_CAMPOS_RESULTADO = ["Classe", "Assunto", "Magistrado", "Comarca", "Foro", "Vara", "Data de Disponibilização"]
CJPG_PAGINAS_MAX = 15
# Campo que o formulário do e-SAJ realmente usa para filtrar por magistrado (conferido capturando a
# requisição do navegador). Os nomes antigos "cdAgente"/"agenteSelectedEntitiesList" não filtravam:
# sem termo a busca voltava vazia e com termo trazia decisões de outros juízes.
CJPG_CAMPO_MAGISTRADO = "dadosConsulta.agentes[0].cdAgente"

# URLs dos endpoints de árvore do e-SAJ (mapeados manualmente em sessão de exploração; os parâmetros
# extras do magistrado são necessários - sem eles o servidor devolve um resumo vazio em vez da grade).
_CJPG_ARVORE_URLS = {
    "vara": f"{CJPG_BASE_URL}/varasTreeSelect.do?campoId=varas&mostrarBotoesSelecaoRapida=true&conversationId=",
    "classe": f"{CJPG_BASE_URL}/classeTreeSelect.do?campoId=classe&mostrarBotoesSelecaoRapida=true&conversationId=",
    "assunto": f"{CJPG_BASE_URL}/assuntoTreeSelect.do?campoId=assunto&mostrarBotoesSelecaoRapida=true&conversationId=",
    # Atenção: os "&&&" (ampersands triplos) abaixo são exatamente como o próprio e-SAJ gera o
    # link - com menos "&" o servidor devolve só a casca do popup, sem a grade de 5 mil registros.
    "magistrado": (
        f"{CJPG_BASE_URL}/jsp/search/searchAgente.jsp?cdAgente=&reference=cdAgente&cdAgente=&"
        "&idObjRetorno=agente&multiselection=true&height=282&inputSelectId=agente"
        "&CurrentMultSelecaoId=agente&multSelecaoProperty=dadosConsulta.agentes&gotInputParam=false"
        "&bind_cdAgente=cdAgente&bind_nmAgente=nmAgente&useAction=false"
        "&requesterUrl=jsp/search/searchAgente.jsp?cdAgente=&reference=cdAgente&cdAgente=&"
        "&&SpwInputSelectRequestOrigin=InputSelectSearchGrid&desabilitarSelecionados=false"
        "&contador=0&contadorMaior=0&multiselectinputselect=true&gotInputParam=false"
    ),
}

_RE_NO_ARVORE = re.compile(
    r'<span id="[a-z]+_tree_node_(?P<id>[^"]+)" class="node[^"]*"\s+value="(?P<value>[^"]*)"'
    r'(?:\s+searchId="[^"]*")?\s+searchValue="(?P<busca>[^"]*)"[^>]*>(?P<nome>[^<]*)</span>',
    re.IGNORECASE,
)
_RE_LINHA_MAGISTRADO = re.compile(
    r'reference="cdAgente"[^>]*beanvalue="(?P<codigo>-?\d+)"[^>]*>.*?'
    r'reference="nmAgente"[^>]*>(?P<nome>[^<]*)</td>',
    re.IGNORECASE | re.DOTALL,
)


def _dir_arvores_cjpg() -> Path:
    caminho = Path(os.environ.get("CNJ_MCP_ARVORES_CJPG_DIR", "arvores_cjpg"))
    caminho.mkdir(parents=True, exist_ok=True)
    return caminho


def _parsear_arvore_cjpg(html: str) -> list[dict]:
    """Parseia a árvore (vara/classe/assunto) do e-SAJ: cada nó vira um registro plano com
    id, pai (deduzido da estrutura do id, ex. "711-9" tem pai "711"), nome e texto de busca.

    "folha" (sem filhos) só pode ser determinado depois de ver todos os nós - não dá pra
    inferir da própria formatação do id (ex. comarca e foro às vezes compartilham o mesmo id).
    """
    nos = []
    for m in _RE_NO_ARVORE.finditer(html):
        id_no = m.group("id")
        pai = id_no.rsplit("-", 1)[0] if "-" in id_no else None
        nos.append({
            "id": id_no,
            "pai": pai,
            "nome": nucleo._html_para_texto(m.group("nome")).strip(),
            "busca": m.group("busca").strip().lower(),
        })
    ids_com_filhos = {n["pai"] for n in nos if n["pai"] is not None}
    for n in nos:
        n["folha"] = n["id"] not in ids_com_filhos
    return nos


def _parsear_magistrados_cjpg(html: str) -> list[dict]:
    registros = []
    for m in _RE_LINHA_MAGISTRADO.finditer(html):
        codigo = m.group("codigo")
        nome = nucleo._html_para_texto(m.group("nome")).strip()
        if codigo and codigo != "-1" and nome:
            registros.append({"codigo": codigo, "nome": nome})
    return registros


async def _baixar_arvore_cjpg(campo: str) -> list[dict]:
    url = _CJPG_ARVORE_URLS[campo]
    async with nucleo._cliente(CJPG_TIMEOUT_S, headers=CJPG_HEADERS, follow_redirects=True) as cliente:
        await cliente.get(f"{CJPG_BASE_URL}/")  # cookie de sessão
        resp = await cliente.get(url)
        resp.raise_for_status()
        html = resp.text
    if campo == "magistrado":
        return _parsear_magistrados_cjpg(html)
    return _parsear_arvore_cjpg(html)


async def atualizar_arvores_cjpg() -> dict:
    """Baixa e salva as 4 árvores de referência do CJPG. Usado pelo comando --atualizar-arvores-cjpg.

    Um campo que voltar vazio não sobrescreve o arquivo que já existe (ex.: a lista de magistrados,
    que o e-SAJ só entrega a um navegador, não é baixável por HTTP simples)."""
    destino = _dir_arvores_cjpg()
    resumo = {}
    for campo in ("vara", "classe", "assunto", "magistrado"):
        registros = await _baixar_arvore_cjpg(campo)
        resumo[campo] = len(registros)
        if registros:
            _gravar_arvore_cjpg(destino / f"{campo}.json", registros)
    (destino / "atualizado_em.txt").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    _CACHE_ARVORES_CJPG.clear()
    return resumo


def _gravar_arvore_cjpg(arquivo: Path, registros: list[dict]) -> None:
    temporario = arquivo.with_suffix(".json.tmp")  # troca atômica: nunca deixa um arquivo pela metade
    temporario.write_text(json.dumps(registros, ensure_ascii=False), encoding="utf-8")
    temporario.replace(arquivo)


_CACHE_ARVORES_CJPG: dict[str, list[dict]] = {}
# Lista de magistrados que acompanha o código: o e-SAJ só a entrega a um navegador (a grade é montada
# por JavaScript), então o download HTTP devolve 0 registros. Gerada por scripts/coletar_magistrados_cjpg.js.
_SEMENTE_MAGISTRADOS_CJPG = Path(__file__).parent / "dados" / "magistrado.json"


def _ler_lista_json(arquivo: Path) -> list[dict]:
    try:
        dados = json.loads(arquivo.read_text(encoding="utf-8")) if arquivo.is_file() else []
    except (OSError, ValueError):
        nucleo.log.exception("Árvore do CJPG ilegível: %s", arquivo)
        return []
    return dados if isinstance(dados, list) else []


def _carregar_arvore_cjpg(campo: str) -> list[dict]:
    if _CACHE_ARVORES_CJPG.get(campo):
        return _CACHE_ARVORES_CJPG[campo]
    registros = _ler_lista_json(_dir_arvores_cjpg() / f"{campo}.json")
    if not registros and campo == "magistrado":
        registros = _ler_lista_json(_SEMENTE_MAGISTRADOS_CJPG)
    if registros:  # lista vazia não fica em cache: assim o download automático é percebido logo
        _CACHE_ARVORES_CJPG[campo] = registros
    return registros


_TRAVA_ARVORES_CJPG = asyncio.Lock()


async def _garantir_arvore_cjpg(campo: str) -> None:
    """Baixa a árvore (vara/classe/assunto) se ainda não existir neste servidor, em vez de devolver
    sempre vazio até alguém rodar --atualizar-arvores-cjpg (o cache se perde se o container for recriado)."""
    if _carregar_arvore_cjpg(campo):
        return
    async with _TRAVA_ARVORES_CJPG:
        if _carregar_arvore_cjpg(campo):  # outra requisição já baixou enquanto esperávamos
            return
        try:
            registros = await _baixar_arvore_cjpg(campo)
        except Exception:
            nucleo.log.exception("Falha ao baixar a árvore '%s' do CJPG (seguindo sem ela)", campo)
            return
        if registros:
            _gravar_arvore_cjpg(_dir_arvores_cjpg() / f"{campo}.json", registros)
            _CACHE_ARVORES_CJPG.pop(campo, None)


def _filhos_arvore_cjpg(campo: str, no_pai: str | None) -> list[dict]:
    nos = _carregar_arvore_cjpg(campo)
    return [n for n in nos if n["pai"] == no_pai]


def _buscar_arvore_cjpg(campo: str, termo: str, limite: int = 50) -> list[dict]:
    termo_norm = nucleo._sem_acento_cjpg(termo)
    nos = _carregar_arvore_cjpg(campo)
    resultado = [n for n in nos if n["folha"] and termo_norm in nucleo._sem_acento_cjpg(n["busca"])]
    return resultado[:limite]


# --- CJPG: endpoints HTTP de apoio ao autocomplete das árvores ---------------
#
# Puramente suporte de interface (navegação/busca na árvore pelo usuário clicando/digitando no
# /app) - por isso são endpoints HTTP simples, não tools MCP. Exigem o mesmo token Bearer do
# resto do app (checado no middleware antes de chegar aqui), mas não contam no limite de uso
# nem aparecem nos tools MCP por bom motivo: não fazem nenhuma chamada ao e-SAJ, só leem o cache
# local já baixado por --atualizar-arvores-cjpg.

_CAMPOS_ARVORE_CJPG = {"vara", "classe", "assunto"}


async def _arvore_filhos_http(scope, send) -> None:
    query = dict(nucleo._query(scope))
    campo = query.get("campo", "")
    if campo not in _CAMPOS_ARVORE_CJPG:
        await nucleo._json(send, 400, {"erro": f"campo inválido: use um entre {sorted(_CAMPOS_ARVORE_CJPG)}."})
        return
    no_pai = query.get("no") or None
    await _garantir_arvore_cjpg(campo)
    await nucleo._json(send, 200, {"filhos": _filhos_arvore_cjpg(campo, no_pai)})


async def _arvore_buscar_http(scope, send) -> None:
    query = dict(nucleo._query(scope))
    campo = query.get("campo", "")
    if campo not in _CAMPOS_ARVORE_CJPG:
        await nucleo._json(send, 400, {"erro": f"campo inválido: use um entre {sorted(_CAMPOS_ARVORE_CJPG)}."})
        return
    termo = (query.get("q") or "").strip()
    if len(termo) < 2:
        await nucleo._json(send, 400, {"erro": "informe ao menos 2 caracteres em q."})
        return
    await _garantir_arvore_cjpg(campo)
    await nucleo._json(send, 200, {"resultados": _buscar_arvore_cjpg(campo, termo)})


async def _arvore_magistrados_http(send) -> None:
    # lista plana (não é árvore) - servida inteira de uma vez, autocomplete filtra no navegador
    await nucleo._json(send, 200, {"magistrados": _carregar_arvore_cjpg("magistrado")})

# --- CJPG: busca e heurísticas de jurimetria ----------------------------------

# --- Estatística da amostra ------------------------------------------------------
# Distância máxima (em caracteres) entre o valor em R$ e a palavra "moral/morais" no dispositivo.
CJPG_DISTANCIA_MAX_VALOR = 600
CJPG_AMOSTRA_MINIMA = 30  # abaixo disso, taxas e percentis são pouco confiáveis
CJPG_AVISO_VIES = (
    "A amostra são as sentenças mais recentes da busca (ordem decrescente de data), não uma "
    "amostra aleatória: use o período (data inicial/final) para estudar épocas específicas."
)


def _intervalo_wilson(sucessos: int, total: int, z: float = 1.96) -> tuple[float, float] | None:
    """Intervalo de confiança de Wilson (95%) para uma proporção; None se total == 0."""
    if total <= 0:
        return None
    p = sucessos / total
    denom = 1 + z * z / total
    centro = (p + z * z / (2 * total)) / denom
    margem = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5) / denom
    return max(0.0, centro - margem), min(1.0, centro + margem)


def _resumo_valores(valores: list[float]) -> dict[str, Any]:
    """Mediana, quartis (interpolados), mín/máx e contagem de outliers (critério de Tukey, 1,5xIQR)."""
    ordenados = sorted(valores)
    resumo: dict[str, Any] = {"mediana": statistics.median(ordenados), "min": ordenados[0], "max": ordenados[-1]}
    if len(ordenados) >= 2:
        q1, _, q3 = statistics.quantiles(ordenados, n=4, method="inclusive")
    else:
        q1 = q3 = ordenados[0]
    resumo["p25"], resumo["p75"] = q1, q3
    iqr = q3 - q1
    limite_sup, limite_inf = q3 + 1.5 * iqr, q1 - 1.5 * iqr
    resumo["outliers"] = sum(1 for v in ordenados if v > limite_sup or v < limite_inf)
    return resumo


def _avisos_amostra(n: int, rotulo: str) -> list[str]:
    avisos = []
    if n < 5:
        avisos.append(f"Amostra muito pequena (menos de 5 {rotulo}) - interprete com muita cautela.")
    elif n < CJPG_AMOSTRA_MINIMA:
        avisos.append(
            f"Amostra pequena (menos de {CJPG_AMOSTRA_MINIMA} {rotulo}) - os números são indicativos, "
            "não conclusivos."
        )
    return avisos


CJPG_MARCADORES_DISPOSITIVO = [
    "ante o exposto", "diante do exposto", "posto isso", "isto posto", "pelo exposto", "do exposto",
]
# Ordem importa só no empate de posição (vence a primeira da lista): "julgo procedente em parte" casa
# com parcial e com procedente na mesma posição e deve ser parcial; "homologo a desistência" é extinção,
# não acordo. Fora o empate, vence a expressão que aparece primeiro no dispositivo.
CJPG_PALAVRAS_DESFECHO = [
    ("parcial", r"julgo\s+(?:parcialmente\s+procedentes?|procedentes?\s+em\s+parte)"),
    ("parcial", r"acolho\s+em\s+parte"),
    ("procedente", r"julgo\s+procedentes?"),
    ("improcedente", r"julgo\s+improcedentes?"),
    ("improcedente", r"rejeito\s+(?:os\s+|o\s+)?pedidos?"),
    ("extinto", r"homologo\s+(?:o\s+pedido\s+de\s+|a\s+)?(?:desist|ren[uú]nc)"),
    ("acordo", r"homologo"),
    ("extinto", r"(?:julgo|declaro)\s+extint[ao]s?"),
    ("extinto", r"extingo\s+(?:o\s+|a\s+)?(?:processo|feito|execu[cç][aã]o|cumprimento|a[cç][aã]o)"),
]


def _cjpg_achar_inicio_dispositivo(texto_lower: str) -> int:
    posicoes = [texto_lower.rfind(m) for m in CJPG_MARCADORES_DISPOSITIVO]
    posicoes = [p for p in posicoes if p != -1]
    return max(posicoes) if posicoes else -1


def _cjpg_classificar_desfecho(inteiro_teor: str | None) -> str | None:
    if not inteiro_teor:
        return None
    texto_lower = inteiro_teor.lower()
    inicio = _cjpg_achar_inicio_dispositivo(texto_lower)
    regiao = texto_lower[inicio:] if inicio != -1 else texto_lower[-3000:]
    melhor_categoria, melhor_pos = None, len(regiao) + 1
    for categoria, padrao in CJPG_PALAVRAS_DESFECHO:
        m = re.search(padrao, regiao)
        if m and m.start() < melhor_pos:
            melhor_categoria, melhor_pos = categoria, m.start()
    return melhor_categoria


# Valor em reais: "R$ 5.000,00", "R$ 5.000", "R$5000", "R$ 10 mil", "R$ 1,5 milhão".
_RE_VALOR_REAIS = re.compile(
    r"R\$\s*(?P<inteiro>\d{1,3}(?:\.\d{3})+|\d+)(?:,(?P<dec>\d{1,2}))?"
    r"(?:\s*(?P<mult>mil\b|milh(?:ão|ões|ao|oes)\b))?",
    re.IGNORECASE,
)


def _cjpg_valor_do_match(m: re.Match) -> float:
    valor = float(m.group("inteiro").replace(".", "") + ("." + m.group("dec") if m.group("dec") else ""))
    mult = (m.group("mult") or "").lower()
    if mult == "mil":
        valor *= 1_000
    elif mult:
        valor *= 1_000_000
    return valor


def _cjpg_extrair_valor_condenacao(inteiro_teor: str | None) -> float | None:
    """Extrai o valor de condenação por dano moral do dispositivo. Heurística: pega o valor em
    R$ mais próximo textualmente de "moral"/"morais" (plural irregular - não é só sufixo "s"),
    dentro de CJPG_DISTANCIA_MAX_VALOR caracteres, pra não pegar valor de honorários/custas/dano material.
    """
    if not inteiro_teor:
        return None
    texto_lower = inteiro_teor.lower()
    inicio = _cjpg_achar_inicio_dispositivo(texto_lower)
    regiao = inteiro_teor[inicio:] if inicio != -1 else inteiro_teor[-3000:]
    regiao_lower = regiao.lower()

    melhor_valor, melhor_dist = None, None
    for m in _RE_VALOR_REAIS.finditer(regiao):
        pos_valor = m.start()
        dists = [abs(mm.start() - pos_valor) for mm in re.finditer(r"mora(?:l|is)", regiao_lower)]
        if not dists:
            continue
        dist = min(dists)
        if dist > CJPG_DISTANCIA_MAX_VALOR:
            continue
        if melhor_dist is None or dist < melhor_dist:
            melhor_valor, melhor_dist = _cjpg_valor_do_match(m), dist
    return melhor_valor


def _cjpg_parsear_resultados(html: str) -> list[dict]:
    blocos = re.split(r'<tr class="fundocinza1">', html)[1:]
    resultados = []
    for bloco in blocos:
        numero_m = re.search(r'<span class="fonteNegrito">\s*(.*?)\s*</span>', bloco, re.DOTALL)
        campos = {}
        for nome in CJPG_CAMPOS_RESULTADO:
            m = re.search(rf"<strong>\s*{re.escape(nome)}:\s*</strong>\s*(.*?)</td>", bloco, flags=re.DOTALL)
            campos[nome] = nucleo._html_para_texto(m.group(1)).strip() if m else None
        # a tag <img> de mostrar/ocultar fica entre o </span> e o </div> - por isso não exigimos </div>
        trecho_m = re.search(r'<div align="justify">\s*<span>(.*?)</span>', bloco, flags=re.DOTALL)
        teor_m = re.search(
            r'<div align="justify" style="display: none;">\s*<span>(.*?)</span>', bloco, flags=re.DOTALL
        )
        teor = nucleo._html_para_texto(teor_m.group(1)).strip() if teor_m else None
        resultados.append({
            "numero_processo": nucleo._html_para_texto(numero_m.group(1)).strip() if numero_m else None,
            "classe": campos["Classe"],
            "assunto": campos["Assunto"],
            "magistrado": campos["Magistrado"],
            "comarca": campos["Comarca"],
            "foro": campos["Foro"],
            "vara": campos["Vara"],
            "data_disponibilizacao": campos["Data de Disponibilização"],
            "trecho": nucleo._html_para_texto(trecho_m.group(1)).strip() if trecho_m else None,
            "desfecho": _cjpg_classificar_desfecho(teor),
            "valor_condenacao": _cjpg_extrair_valor_condenacao(teor),
        })
    return resultados


def _cjpg_total_resultados(html: str) -> int | None:
    m = re.search(r"Resultados\s*<strong>\s*\d+\s*a\s*\d+\s*</strong>\s*de\s*([\d.]+)", html, re.DOTALL)
    return int(m.group(1).replace(".", "")) if m else None


def _cjpg_bloqueado(html: str) -> bool:
    return "fundocinza1" not in html and "Parâmetros de Consulta" not in html


async def _cjpg_buscar_no_esaj(params: dict, paginas: int) -> tuple[int | None, list[dict], list[str]]:
    """Executa a busca paginada no CJPG (sessão + pesquisar.do + trocarDePagina.do) e devolve
    (total_servidor, resultados_parseados, avisos). Best-effort: se uma página falhar no meio,
    para ali e devolve o que já foi buscado, em vez de descartar tudo.
    """
    avisos: list[str] = []
    async with nucleo._cliente(CJPG_TIMEOUT_S, headers=CJPG_HEADERS, follow_redirects=True) as cliente:
        await cliente.get(f"{CJPG_BASE_URL}/")
        resp = await cliente.get(f"{CJPG_BASE_URL}/pesquisar.do", params=params)
        resp.raise_for_status()
        html = resp.text
        if _cjpg_bloqueado(html):
            raise ValueError("CJPG: resposta sem resultados nem formulário reconhecível (possível bloqueio ou mudança de layout).")

        total_servidor = _cjpg_total_resultados(html)
        todos = _cjpg_parsear_resultados(html)
        for p in range(2, paginas + 1):
            await asyncio.sleep(0.5)  # educado: não martelar o servidor
            try:
                resp = await cliente.get(f"{CJPG_BASE_URL}/trocarDePagina.do", params={"pagina": p, "conversationId": ""})
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                avisos.append(f"Página {p} falhou ({exc}); parando aqui, resultado parcial.")
                break
            html_pagina = resp.text
            if _cjpg_bloqueado(html_pagina):
                avisos.append(f"Página {p} bloqueada/vazia; parando aqui.")
                break
            pagina_resultados = _cjpg_parsear_resultados(html_pagina)
            if not pagina_resultados:
                break
            todos.extend(pagina_resultados)
    return total_servidor, todos, avisos


# --- Cache das consultas ao CJPG (banco do escritório) ---------------------------
#
# Cada consulta refaz o scraping no e-SAJ (lento e frágil). O resultado bruto (já parseado e
# classificado) fica numa tabela própria por CJPG_CACHE_TTL_S; só entram no cache buscas completas
# (sem avisos de página falha/bloqueada), para nunca servir por 7 dias um resultado parcial.

CJPG_CACHE_TTL_S = 7 * 24 * 3600
_BANCO_CAMINHO: str | None = None


def migrar(conexao) -> None:
    """Chamada na partida pelo registro de módulos: cria a tabela do cache e guarda o caminho do banco."""
    global _BANCO_CAMINHO
    conexao.execute(
        "CREATE TABLE IF NOT EXISTS jurimetria_cache ("
        "chave TEXT PRIMARY KEY, criado_em REAL NOT NULL, dados TEXT NOT NULL)")
    arquivo = next((linha[2] for linha in conexao.execute("PRAGMA database_list") if linha[1] == "main"), "")
    _BANCO_CAMINHO = arquivo or None


def _cjpg_chave_cache(params: dict, paginas: int) -> str:
    bruto = json.dumps({"p": params, "n": paginas}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(bruto.encode("utf-8")).hexdigest()


def _cjpg_cache_ler(chave: str) -> tuple[float, dict] | None:
    if not _BANCO_CAMINHO:
        return None
    try:
        with sqlite3.connect(_BANCO_CAMINHO) as con:
            linha = con.execute("SELECT criado_em, dados FROM jurimetria_cache WHERE chave = ?", (chave,)).fetchone()
        con.close()
        if linha and time.time() - linha[0] < CJPG_CACHE_TTL_S:
            return linha[0], json.loads(linha[1])
    except (sqlite3.Error, ValueError):
        nucleo.log.exception("Falha ao ler o cache da Jurimetria (seguindo sem cache)")
    return None


def _cjpg_cache_gravar(chave: str, total_servidor: int | None, todos: list[dict]) -> None:
    if not _BANCO_CAMINHO:
        return
    try:
        agora = time.time()
        with sqlite3.connect(_BANCO_CAMINHO) as con:
            con.execute("DELETE FROM jurimetria_cache WHERE criado_em < ?", (agora - CJPG_CACHE_TTL_S,))
            con.execute(
                "INSERT OR REPLACE INTO jurimetria_cache (chave, criado_em, dados) VALUES (?, ?, ?)",
                (chave, agora, json.dumps({"total_servidor": total_servidor, "resultados": todos}, ensure_ascii=False)),
            )
        con.close()
    except sqlite3.Error:
        nucleo.log.exception("Falha ao gravar o cache da Jurimetria (seguindo sem cache)")


async def _cjpg_executar_busca(
    params: dict, paginas: int, ignorar_cache: bool = False
) -> tuple[int | None, list[dict], list[str]]:
    """Como _cjpg_buscar_no_esaj, mas consulta/alimenta o cache. Devolve (total, resultados, avisos)."""
    chave = _cjpg_chave_cache(params, paginas)
    if not ignorar_cache:
        em_cache = _cjpg_cache_ler(chave)
        if em_cache:
            criado_em, dados = em_cache
            quando = datetime.fromtimestamp(criado_em, timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
            aviso = (
                f"Resultado de uma consulta idêntica feita em {quando} (guardada por 7 dias para não "
                "sobrecarregar o e-SAJ); sentenças publicadas depois não aparecem."
            )
            return dados["total_servidor"], dados["resultados"], [aviso]
    total_servidor, todos, avisos = await _cjpg_buscar_no_esaj(params, paginas)
    if not avisos and todos:
        _cjpg_cache_gravar(chave, total_servidor, todos)
    return total_servidor, todos, avisos


@ferramenta
async def consultar_jurimetria_cjpg(
    termo: str | None = None,
    classe_codigo: str | None = None,
    classe_nome: str | None = None,
    assunto_codigo: str | None = None,
    assunto_nome: str | None = None,
    vara_codigo: str | None = None,
    magistrado_codigo: str | None = None,
    magistrado_nome: str | None = None,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    paginas: int = 1,
    ignorar_cache: bool = False,
) -> dict:
    """Busca julgados de 1º grau do TJSP (CJPG, scraping - sem API oficial, best-effort) e aplica
    heurísticas de jurimetria: classifica o desfecho de cada decisão e extrai o valor de condenação
    por dano moral quando houver. Se termo/assunto_codigo/assunto_nome for informado, agrega os valores
    das decisões procedentes/parciais em mediana e percentis 25/75 (serve de referência de pedido
    ou proposta de acordo).

    Parâmetros:
    - termo: pesquisa livre (texto completo das decisões). Se magistrado_nome for informado, o
      nome entra automaticamente entre aspas aqui, pois busca local por vara/magistrado/classe/
      assunto sem um termo forte é muito ineficiente (poucos resultados relevantes por página).
    - classe_codigo / assunto_codigo / vara_codigo: código interno do e-SAJ (resolvido via as
      árvores de referência - ver endpoints /cjpg-arvore/* do painel web). Filtram de verdade no
      servidor do CJPG.
    - classe_nome / assunto_nome / magistrado_nome: nome em texto, usado para exibição e (no caso
      de magistrado_nome) para compor o termo de busca.
    - magistrado_codigo: código do magistrado (cdAgente) da lista do e-SAJ; filtra de verdade no servidor (e dispensa o nome).
    - data_inicio / data_fim: formato dd/mm/aaaa.
    - paginas: quantas páginas de 10 resultados buscar (padrão 1, teto 15). A busca é best-effort:
      se uma página falhar no meio, o resultado parcial já buscado é devolvido com um aviso, em
      vez de descartado.
    - ignorar_cache: True força nova busca no e-SAJ. Por padrão, uma consulta idêntica feita nos
      últimos 7 dias é respondida do cache (com um aviso informando a data da consulta original).

    Limitações conhecidas:
    - O CJPG tem um teto de ~10.000 resultados por consulta (limite do índice de busca do TJSP);
      consultas muito amplas devem ser fatiadas por data.
    - A classificação de desfecho e a extração de valor são heurísticas de regex sobre o texto da
      decisão, não garantidas: funcionam bem para redação "padrão", erram em casos atípicos.
    """
    try:
        if paginas < 1 or paginas > CJPG_PAGINAS_MAX:
            return nucleo._erro(f"paginas deve ser entre 1 e {CJPG_PAGINAS_MAX}.")

        termo_busca = (termo or "").strip()
        if magistrado_nome and not magistrado_codigo:  # com o código o filtro é exato; o nome não precisa ir no texto
            termo_busca = f'{termo_busca} "{magistrado_nome.strip()}"'.strip()

        params = {
            "conversationId": "",
            "dadosConsulta.pesquisaLivre": termo_busca,
            "tipoNumero": "UNIFICADO",
            "dadosConsulta.dtInicio": nucleo._data_tjsp(data_inicio),
            "dadosConsulta.dtFim": nucleo._data_tjsp(data_fim),
            "dadosConsulta.ordenacao": "DESC",
        }
        if classe_codigo:
            params["classeTreeSelection.values"] = classe_codigo
        if assunto_codigo:
            params["assuntoTreeSelection.values"] = assunto_codigo
        if vara_codigo:
            params["varasTreeSelection.values"] = vara_codigo
        if magistrado_codigo:
            params[CJPG_CAMPO_MAGISTRADO] = magistrado_codigo

        try:
            total_servidor, todos, avisos = await _cjpg_executar_busca(params, paginas, ignorar_cache)
        except ValueError as exc:
            return nucleo._erro(str(exc))

        resposta: dict[str, Any] = {
            "total_servidor": total_servidor,
            "buscados": len(todos),
            "resultados": todos,
            "avisos": avisos,
        }

        # Agrega sempre que houver algum critério de busca (termo livre incluído): a tela envia só
        # o "termo", e antes disso o agregado (mediana/p25/p75) nunca era calculado.
        if assunto_codigo or assunto_nome or termo_busca:
            procedentes = [r for r in todos if r["desfecho"] in ("procedente", "parcial")]
            valores = sorted(r["valor_condenacao"] for r in procedentes if r["valor_condenacao"] is not None)
            agregado: dict[str, Any] = {
                "procedentes_ou_parciais": len(procedentes),
                "com_valor_extraido": len(valores),
            }
            avisos_agregado = _avisos_amostra(len(valores), "valores extraídos")
            if valores:
                agregado.update(_resumo_valores(valores))
                if agregado["outliers"]:
                    avisos_agregado.append(
                        f"{agregado['outliers']} valor(es) muito fora do padrão - a mediana e a faixa "
                        "(25%-75%) já os desconsideram, mas confira os extremos nos cartões."
                    )
            avisos_agregado.append(CJPG_AVISO_VIES)
            agregado["aviso"] = " ".join(avisos_agregado)
            resposta["agregado"] = agregado

        return resposta

    except httpx.HTTPError as exc:
        return nucleo._erro(f"Erro de rede ao consultar o CJPG: {exc}")
    except Exception as exc:
        nucleo.log.exception("Falha inesperada em consultar_jurimetria_cjpg")
        return nucleo._erro(f"Erro inesperado ao consultar o CJPG: {exc}")

CJPG_CATEGORIAS_DESFECHO = ["procedente", "parcial", "improcedente", "acordo", "extinto"]
CJPG_PAGINAS_UNIVERSO = 5  # a comparação não precisa da mesma amostra: limita o tempo extra da 2ª busca


def _perfil_de(resultados: list[dict]) -> dict[str, Any]:
    """Taxas de desfecho (com intervalo de Wilson) e valor típico de indenização de uma lista de decisões."""
    classificados = [r for r in resultados if r["desfecho"] is not None]
    contagens = Counter(r["desfecho"] for r in classificados)
    total_classificados = len(classificados)
    perfil: dict[str, Any] = {
        "total_classificados": total_classificados,
        "nao_classificados": len(resultados) - total_classificados,
    }
    for categoria in CJPG_CATEGORIAS_DESFECHO:
        quantos = contagens.get(categoria, 0)
        perfil[f"taxa_{categoria}"] = quantos / total_classificados if total_classificados else None
        ic = _intervalo_wilson(quantos, total_classificados)
        perfil[f"ic_{categoria}"] = list(ic) if ic else None
    valores = [
        r["valor_condenacao"] for r in classificados
        if r["desfecho"] in ("procedente", "parcial") and r["valor_condenacao"] is not None
    ]
    perfil["com_valor_extraido"] = len(valores)
    # mediana (robusta a outliers) é a medida principal; a média fica por compatibilidade
    perfil["valor_mediano_indenizacao"] = statistics.median(valores) if valores else None
    perfil["valor_medio_indenizacao"] = statistics.mean(valores) if valores else None
    return perfil


async def _perfil_do_universo(params_base: dict, paginas: int, ignorar_cache: bool) -> dict[str, Any]:
    """Perfil de TODOS os juízes com os mesmos filtros (sem o magistrado), para servir de referência.
    Nunca derruba a consulta principal: se a 2ª busca falhar, devolve {"indisponivel": motivo}."""
    try:
        _, todos, avisos = await _cjpg_executar_busca(params_base, min(paginas, CJPG_PAGINAS_UNIVERSO), ignorar_cache)
    except (ValueError, httpx.HTTPError) as exc:
        return {"indisponivel": f"Não foi possível buscar o universo para comparação: {exc}"}
    universo = _perfil_de(todos)
    universo["buscados"] = len(todos)
    universo["escopo"] = (
        "Decisões de todos os juízes do TJSP com o mesmo termo, classe, assunto, vara e período "
        "(as mais recentes da busca)."
    )
    aviso = _avisos_amostra(universo["total_classificados"], "decisões classificadas")
    if avisos:
        aviso += avisos
    if aviso:
        universo["aviso"] = " ".join(aviso)
    return universo


@ferramenta
async def perfil_decisorio_magistrado(
    magistrado_codigo: str | None = None,
    magistrado_nome: str | None = None,
    termo: str | None = None,
    classe_codigo: str | None = None,
    assunto_codigo: str | None = None,
    vara_codigo: str | None = None,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    paginas: int = 1,
    ignorar_cache: bool = False,
    comparar_com_universo: bool = True,
) -> dict:
    """Busca julgados de 1º grau do TJSP (CJPG, scraping - sem API oficial, best-effort) de um
    magistrado específico e monta um perfil decisório: taxa de procedência/improcedência/parcial,
    proporção de acordos homologados e valor médio de indenização por dano moral, no período
    informado. Aceita os mesmos filtros estruturados de classe/assunto/vara de
    `consultar_jurimetria_cjpg` para refinar o universo de decisões analisadas (ex.: perfil do
    magistrado só nas ações de indenização por dano moral) - mas, ao contrário daquela tool, não
    calcula mediana/percentis de valor (isso é objetivo do benchmark de valor, não deste perfil).

    Parâmetros:
    - magistrado_codigo: código do magistrado (cdAgente) da lista do e-SAJ; filtra de verdade no servidor (e dispensa o nome). Resolvido
      via autocomplete (endpoint /cjpg-arvore/magistrados do painel web).
    - magistrado_nome: nome em texto. Obrigatório ao menos um entre magistrado_codigo/
      magistrado_nome. Quando informado, entra automaticamente entre aspas no termo de busca.
    - termo: pesquisa livre adicional (texto completo das decisões), opcional.
    - classe_codigo / assunto_codigo / vara_codigo: código interno do e-SAJ (resolvido via as
      árvores de referência - ver endpoints /cjpg-arvore/* do painel web), opcionais. Filtram de
      verdade no servidor do CJPG.
    - data_inicio / data_fim: formato dd/mm/aaaa.
    - paginas: quantas páginas de 10 resultados buscar (padrão 1, teto 15). A busca é best-effort:
      se uma página falhar no meio, o resultado parcial já buscado é devolvido com um aviso, em
      vez de descartado.
    - ignorar_cache: True força nova busca no e-SAJ. Por padrão, uma consulta idêntica feita nos
      últimos 7 dias é respondida do cache (com um aviso informando a data da consulta original).
    - comparar_com_universo: True (padrão) faz uma 2ª busca, sem o magistrado e com no máximo 5
      páginas, e devolve em `perfil.baseline` as taxas de todos os juízes com os mesmos filtros, para
      dar referência ao perfil. Só roda se houver termo, classe, assunto ou vara informados.

    Limitações conhecidas:
    - O CJPG tem um teto de ~10.000 resultados por consulta (limite do índice de busca do TJSP);
      consultas muito amplas devem ser fatiadas por data.
    - A classificação de desfecho e a extração de valor são heurísticas de regex sobre o texto da
      decisão, não garantidas: funcionam bem para redação "padrão", erram em casos atípicos.
    - O perfil reflete apenas as decisões publicadas no CJPG que o scraping conseguiu buscar
      (até `paginas` x 10), não necessariamente toda a produção do magistrado no período.
    """
    try:
        if not magistrado_codigo and not magistrado_nome:
            return nucleo._erro("Informe magistrado_codigo ou magistrado_nome.")
        if paginas < 1 or paginas > CJPG_PAGINAS_MAX:
            return nucleo._erro(f"paginas deve ser entre 1 e {CJPG_PAGINAS_MAX}.")

        termo_busca = (termo or "").strip()
        if magistrado_nome and not magistrado_codigo:  # com o código o filtro é exato; o nome não precisa ir no texto
            termo_busca = f'{termo_busca} "{magistrado_nome.strip()}"'.strip()

        params = {
            "conversationId": "",
            "dadosConsulta.pesquisaLivre": termo_busca,
            "tipoNumero": "UNIFICADO",
            "dadosConsulta.dtInicio": nucleo._data_tjsp(data_inicio),
            "dadosConsulta.dtFim": nucleo._data_tjsp(data_fim),
            "dadosConsulta.ordenacao": "DESC",
        }
        if classe_codigo:
            params["classeTreeSelection.values"] = classe_codigo
        if assunto_codigo:
            params["assuntoTreeSelection.values"] = assunto_codigo
        if vara_codigo:
            params["varasTreeSelection.values"] = vara_codigo
        if magistrado_codigo:
            params[CJPG_CAMPO_MAGISTRADO] = magistrado_codigo

        try:
            total_servidor, todos, avisos = await _cjpg_executar_busca(params, paginas, ignorar_cache)
        except ValueError as exc:
            return nucleo._erro(str(exc))

        perfil = _perfil_de(todos)
        avisos_perfil = _avisos_amostra(perfil["total_classificados"], "decisões classificadas")
        avisos_perfil.append(CJPG_AVISO_VIES)
        perfil["aviso"] = " ".join(avisos_perfil)

        if comparar_com_universo:
            if not ((termo or "").strip() or classe_codigo or assunto_codigo or vara_codigo):
                perfil["baseline"] = {
                    "indisponivel": "Para comparar com a média, informe um assunto/termo, uma classe ou uma vara.",
                }
            else:
                params_universo = {
                    chave: valor for chave, valor in params.items()
                    if chave != CJPG_CAMPO_MAGISTRADO
                }
                params_universo["dadosConsulta.pesquisaLivre"] = (termo or "").strip()
                perfil["baseline"] = await _perfil_do_universo(params_universo, paginas, ignorar_cache)

        return {
            "total_servidor": total_servidor,
            "buscados": len(todos),
            "resultados": todos,
            "avisos": avisos,
            "perfil": perfil,
        }

    except httpx.HTTPError as exc:
        return nucleo._erro(f"Erro de rede ao consultar o CJPG: {exc}")
    except Exception as exc:
        nucleo.log.exception("Falha inesperada em perfil_decisorio_magistrado")
        return nucleo._erro(f"Erro inesperado ao consultar o CJPG: {exc}")


async def http(scope, send, caminho: str) -> bool:
    """Rotas HTTP do módulo (autocomplete das árvores do CJPG). True se tratou a requisição."""
    if scope.get("method") != "GET":
        return False
    if caminho == "/cjpg-arvore/filhos":
        await _arvore_filhos_http(scope, send)
    elif caminho == "/cjpg-arvore/buscar":
        await _arvore_buscar_http(scope, send)
    elif caminho == "/cjpg-arvore/magistrados":
        await _arvore_magistrados_http(send)
    else:
        return False
    return True
