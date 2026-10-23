"""Servidor MCP "cnj-processual": consulta processual judicial brasileira via APIs públicas do CNJ.

Tools expostas:
- consultar_processo_datajud: metadados e movimentações de processo (API Pública DataJud).
- consultar_publicacoes_djen: publicações/intimações no DJEN (API Comunica PJe).
- baixar_certidao_djen: baixa a certidão PDF de uma publicação e salva em arquivo temporário.
- buscar_feriados_forenses: feriados forenses por município/comarca, ano e tribunal (TJSP via API oficial; demais tribunais calculado por UF).

Transporte: stdio. Atenção: nada deve ser impresso em stdout (ele é o canal do protocolo);
logs vão para stderr.
"""

import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import statistics
import sys
import tempfile
import threading
import time
import unicodedata
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from html import escape as _escapar
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import asaas_integracao
import db as _db
import google_integracao
from _util import _hash_token
from db import (
    CacheDataJud, RegistroClientesCasos, RegistroIntegracaoGoogle, RegistroMonitoramentos,
    RegistroPublicacoesOAB, RegistroUsuarios,
)

import httpx
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("cnj-processual")

mcp = FastMCP("cnj-processual")

# --- Configuração -----------------------------------------------------------

DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br"
# Chave pública oficial divulgada pelo CNJ em https://datajud-wiki.cnj.jus.br/api-publica/.
# O CNJ pode rotacioná-la a qualquer momento: se as consultas começarem a retornar 401/403,
# verifique a wiki e defina a variável de ambiente DATAJUD_API_KEY com a chave atual.
DATAJUD_API_KEY_PADRAO = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="

DJEN_BASE_URL = "https://comunicaapi.pje.jus.br/api/v1/comunicacao"

# A API DataJud é frequentemente lenta (observado ~48s em teste real); timeouts curtos
# geram falso negativo, por isso o limite é alto e há uma nova tentativa.
DATAJUD_TIMEOUT_S = 70.0
DATAJUD_TENTATIVAS = 2
DATAJUD_BACKOFF_S = 3.0

DJEN_TIMEOUT_S = 30.0
DJEN_TENTATIVAS = 2  # 1 tentativa inicial + 1 retry para falhas transitórias
DJEN_BACKOFF_S = 2.0
DJEN_STATUS_TRANSITORIOS = {500, 502, 503, 504}

CERTIDAO_DIR = Path(tempfile.gettempdir()) / "cnj-processual" / "certidoes"
CERTIDAO_RETENCAO_DIAS = 7
# Links de download de certidão valem por este tempo. O segredo assina os links; sem
# CNJ_MCP_SEGREDO, um segredo aleatório é gerado a cada inicialização (os links antigos deixam de valer).
CERTIDAO_LINK_VALIDADE_S = 15 * 60
_SEGREDO_CERTIDAO = os.environ.get("CNJ_MCP_SEGREDO", "").strip() or secrets.token_hex(32)
_NOME_CERTIDAO = re.compile(r"certidao_[A-Za-z0-9]+\.pdf")

# Monitoramento: acompanhamento recorrente de um processo/OAB, com aviso por e-mail quando sai
# publicação nova. Só existe em modo HTTP (precisa de SMTP e de um usuário com e-mail como nome).
MONITORAMENTO_MAX_POR_USUARIO = 5
MONITORAMENTO_INTERVALO_HORAS = 6
MONITORAMENTO_EXPIRACAO_DIAS = 180
MONITORAMENTO_MAX_HASHES_LEMBRADOS = 50

DATAJUD_CACHE_TTL_S = 3600.0  # resultados do DataJud ficam em cache por 1 hora
MONITORAMENTO_AVISO_EXPIRACAO_DIAS = 30  # avisa por e-mail N dias antes de expirar
MONITORAMENTO_BACKOFF_MAX_HORAS = 48.0   # teto do backoff exponencial por monitoramento
MONITORAMENTO_MAX_CONCORRENTES = 3       # semáforo para o loop de verificação/captura

# Graus de jurisdição usados pelo DataJud no campo "grau".
_DESCRICAO_GRAU = {
    "G1": "1º grau (primeira instância)",
    "G2": "2º grau (recurso ao tribunal de justiça ou TRF)",
    "JE": "juizado especial",
    "TR": "turma recursal",
    "STJ": "Superior Tribunal de Justiça",
    "STF": "Supremo Tribunal Federal",
    "TST": "Tribunal Superior do Trabalho",
    "TSE": "Tribunal Superior Eleitoral",
    "STM": "Superior Tribunal Militar",
}

# Transporte HTTP injetável para testes (httpx.MockTransport). Em produção fica None,
# e o httpx usa a rede normalmente.
_TRANSPORTE_HTTP: httpx.AsyncBaseTransport | None = None


def _cliente(timeout: float, **kwargs) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout), transport=_TRANSPORTE_HTTP, **kwargs)


def _datajud_api_key() -> str:
    return os.environ.get("DATAJUD_API_KEY", "").strip() or DATAJUD_API_KEY_PADRAO


def _asaas_config() -> tuple[str, str] | None:
    """URL base + API key do Asaas para o ambiente configurado em ASAAS_AMBIENTE
    ('sandbox', padrão, ou 'producao'). None se a chave do ambiente atual não estiver definida
    no servidor (ASAAS_API_KEY_SANDBOX ou ASAAS_API_KEY)."""
    if (os.environ.get("ASAAS_AMBIENTE") or "sandbox").strip().lower() == "producao":
        chave = os.environ.get("ASAAS_API_KEY", "").strip()
        return (asaas_integracao.URL_BASE_PRODUCAO, chave) if chave else None
    chave = os.environ.get("ASAAS_API_KEY_SANDBOX", "").strip()
    return (asaas_integracao.URL_BASE_SANDBOX, chave) if chave else None


def _so_digitos(valor: str | None) -> str:
    """Remove máscara e qualquer caractere não numérico (ex: '1006314-27.2023.8.26.0005' -> '10063142720238260005')."""
    return re.sub(r"\D", "", valor or "")


def _erro(mensagem: str, **extra) -> dict:
    return {"erro": True, "mensagem": mensagem, **extra}


def _total_hits(hits: dict) -> int:
    """Lê o total do Elasticsearch, que pode vir como {"value": n} (ES 7+) ou como inteiro."""
    total = hits.get("total", 0)
    if isinstance(total, dict):
        total = total.get("value", 0)
    try:
        return int(total or 0)
    except (TypeError, ValueError):
        return 0


def _json_da_resposta(resp: httpx.Response) -> tuple[Any, dict | None]:
    """Devolve (dados, None) ou (None, erro) se o corpo não for JSON."""
    try:
        return resp.json(), None
    except ValueError:
        return None, _erro(f"Resposta não é JSON válido (HTTP {resp.status_code}): {resp.text[:300]}")


# --- Utilitários de texto (HTML do DJEN) -------------------------------------

class _ExtratorTexto(HTMLParser):
    """Extrai texto puro de HTML, ignorando o conteúdo de <style>, <script> e <head>."""

    _IGNORADAS = {"style", "script", "head"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._partes: list[str] = []
        self._ignorando = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._IGNORADAS:
            self._ignorando += 1
        elif tag in {"br", "p", "div", "tr", "li", "section", "article", "header", "table"}:
            self._partes.append("\n")
        elif tag in {"td", "th"}:
            self._partes.append(" ")

    def handle_endtag(self, tag):
        if tag in self._IGNORADAS and self._ignorando:
            self._ignorando -= 1
        elif tag in {"p", "div", "tr", "li", "section", "article", "table"}:
            self._partes.append("\n")

    def handle_data(self, data):
        if not self._ignorando:
            self._partes.append(data)

    def texto(self) -> str:
        bruto = "".join(self._partes)
        linhas = [re.sub(r"[ \t\xa0]+", " ", linha).strip() for linha in bruto.splitlines()]
        # Colapsa sequências de linhas vazias em no máximo uma.
        saida: list[str] = []
        for linha in linhas:
            if linha or (saida and saida[-1]):
                saida.append(linha)
        return "\n".join(saida).strip()


def _html_para_texto(conteudo: str | None) -> str:
    """Decodifica entidades HTML (ex: &aacute;) e remove tags, devolvendo texto legível."""
    if not conteudo:
        return ""
    extrator = _ExtratorTexto()  # convert_charrefs=True já decodifica entidades (&aacute; -> á)
    extrator.feed(conteudo)
    extrator.close()
    return extrator.texto()


# --- Circuit breaker (DJEN e DataJud) ----------------------------------------


class CircuitBreaker:
    """Evita chamadas a APIs com falha persistente: após N falhas consecutivas o circuito abre e
    permanece assim por cooldown_s segundos; depois vai a semi-aberto e uma única sonda confirma
    se a API voltou.

    Thread-safe via threading.Lock (asyncio + APScheduler podem correr em threads diferentes).
    """

    FECHADO = "fechado"
    ABERTO = "aberto"
    SEMI_ABERTO = "semi_aberto"

    def __init__(self, nome: str, falhas_para_abrir: int = 3, cooldown_s: float = 300.0, agora=time.time) -> None:
        self.nome = nome
        self.falhas_para_abrir = falhas_para_abrir
        self.cooldown_s = cooldown_s
        self._agora = agora
        self._estado = self.FECHADO
        self._falhas_consecutivas = 0
        self._aberto_em: float | None = None
        self._lock = threading.Lock()

    def pode_tentar(self) -> bool:
        """True se pode prosseguir. Circuito aberto retorna False até o cooldown expirar; então
        vai a semi-aberto e permite uma única tentativa de sonda."""
        with self._lock:
            if self._estado == self.FECHADO:
                return True
            if self._estado == self.ABERTO:
                if self._agora() - (self._aberto_em or 0) >= self.cooldown_s:
                    self._estado = self.SEMI_ABERTO
                    log.info("CircuitBreaker %s: semi-aberto — testando disponibilidade", self.nome)
                    return True
                return False
            return True  # SEMI_ABERTO: permite a sonda

    def registrar_sucesso(self) -> None:
        with self._lock:
            self._falhas_consecutivas = 0
            if self._estado != self.FECHADO:
                log.info("CircuitBreaker %s: fechado — API disponível novamente", self.nome)
            self._estado = self.FECHADO

    def registrar_falha(self) -> None:
        with self._lock:
            self._falhas_consecutivas += 1
            if self._estado == self.SEMI_ABERTO or self._falhas_consecutivas >= self.falhas_para_abrir:
                self._estado = self.ABERTO
                self._aberto_em = self._agora()
                log.warning(
                    "CircuitBreaker %s: aberto após %d falha(s) consecutiva(s) — próxima tentativa em %ds",
                    self.nome, self._falhas_consecutivas, int(self.cooldown_s),
                )

    @property
    def estado(self) -> str:
        with self._lock:
            return self._estado


# 3 falhas consecutivas abrem o circuito; DJEN reabre em 5 min, DataJud em 10 min
# (DataJud costuma ficar fora por mais tempo em horário de pico).
_CIRCUIT_DJEN = CircuitBreaker("DJEN", falhas_para_abrir=3, cooldown_s=300.0)
_CIRCUIT_DATAJUD = CircuitBreaker("DataJud", falhas_para_abrir=3, cooldown_s=600.0)

# Cache de resultados DataJud (inicializado em _principal quando o banco está disponível).
_CACHE_DATAJUD: "CacheDataJud | None" = None

# Semáforo: limita chamadas DJEN simultâneas nos ciclos de monitoramento/captura.
_SEM_MONITORAMENTO = asyncio.Semaphore(MONITORAMENTO_MAX_CONCORRENTES)

# Backoff por monitoramento: contadores em memória, não persistidos (resetam ao reiniciar o servidor).
# _FALHAS_MONITORAMENTO[id] = número de falhas consecutivas sem publicação acessível.
# _PROXIMA_TENTATIVA_MONITORAMENTO[id] = timestamp unix da próxima tentativa permitida.
_FALHAS_MONITORAMENTO: dict[str, int] = {}
_PROXIMA_TENTATIVA_MONITORAMENTO: dict[str, float] = {}

# Momento em que o processo subiu (usado para calcular uptime no /healthz).
_INICIO_SERVIDOR: float = time.time()


@mcp.tool()
async def status_apis() -> dict:
    """Retorna o estado atual dos circuit breakers do DataJud e do DJEN.

    Útil para diagnosticar lentidão ou indisponibilidade antes de acionar monitoramentos.
    Campos por API: estado (fechado / aberto / semi_aberto), falhas_consecutivas,
    cooldown_restante_s (segundos até próxima sonda; 0 se circuito fechado).
    """
    agora = time.time()

    def _info(cb: CircuitBreaker) -> dict:
        with cb._lock:
            estado = cb._estado
            falhas = cb._falhas_consecutivas
            if estado == CircuitBreaker.ABERTO and cb._aberto_em is not None:
                restante = max(0.0, cb.cooldown_s - (agora - cb._aberto_em))
            else:
                restante = 0.0
        return {"estado": estado, "falhas_consecutivas": falhas, "cooldown_restante_s": round(restante, 1)}

    return {
        "datajud": _info(_CIRCUIT_DATAJUD),
        "djen": _info(_CIRCUIT_DJEN),
    }


# --- Tool 1: DataJud ---------------------------------------------------------

@mcp.tool()
async def consultar_processo_datajud(tribunal: str, numero_processo: str) -> dict:
    """Consulta metadados de um processo judicial (classe, órgão julgador, data de ajuizamento,
    grau e lista de movimentações) na API Pública do DataJud (CNJ).

    Parâmetros:
    - tribunal: sigla minúscula do tribunal, como "tjsp", "trf1" ou "stj".
    - numero_processo: número do processo CNJ de 20 dígitos. Aceita com ou sem máscara
      (ex: "1006314-27.2023.8.26.0005" ou "10063142720238260005").

    Retorno: dicionário com "encontrado" (bool) e, quando encontrado, "processos", uma lista em
    que cada item traz classe, dataAjuizamento, orgaoJulgador, tribunal, grau, grau_descricao
    (ex.: "1º grau", "2º grau") e movimentos (codigo, nome, dataHora e, quando existir,
    complementosTabelados). Se o processo não existir nesse tribunal, retorna encontrado=False com
    mensagem explicativa (isso não é erro).

    Um mesmo número pode aparecer mais de uma vez na lista: cada item é um grau de jurisdição
    diferente (ex.: 1º grau e 2º grau). Ao apresentar o resultado, identifique o grau de cada item.

    Limitações:
    - A API DataJud NÃO expõe nomes de partes (política de proteção de dados), então o
      resultado nunca inclui partes, autores ou réus.
    - A API é lenta: esta tool usa timeout de 70s e uma nova tentativa automática em timeout,
      429 ou 502/503/504. Uma consulta com falhas pode levar mais de dois minutos.
    - Consulta apenas o tribunal informado; se não sabe o tribunal, deduza pelo número CNJ
      (segmento J.TR, ex: ".8.26." = TJSP) ou tente o tribunal superior correspondente.
    """
    try:
        tribunal_norm = (tribunal or "").strip().lower()
        if not re.fullmatch(r"[a-z0-9]+", tribunal_norm):
            return _erro("Tribunal inválido. Use a sigla minúscula, como 'tjsp', 'trf1' ou 'stj'.")

        numero = _so_digitos(numero_processo)
        if len(numero) != 20:
            return _erro(
                f"Número de processo inválido: esperados 20 dígitos, recebidos {len(numero)}. "
                "Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO."
            )

        chave_cache = f"{tribunal_norm}:{numero}"
        if _CACHE_DATAJUD is not None:
            resultado_cache = await asyncio.to_thread(_CACHE_DATAJUD.obter, chave_cache)
            if resultado_cache is not None:
                log.info("DataJud cache hit: %s/%s", tribunal_norm, numero)
                return resultado_cache

        url = f"{DATAJUD_BASE_URL}/api_publica_{tribunal_norm}/_search"
        headers = {
            "Authorization": f"APIKey {_datajud_api_key()}",
            "Content-Type": "application/json",
        }
        corpo = {"query": {"match": {"numeroProcesso": numero}}}

        resposta = await _datajud_post_com_retry(url, headers, corpo)
        if isinstance(resposta, dict):  # erro estruturado já montado
            return resposta

        dados, erro_json = _json_da_resposta(resposta)
        if erro_json:
            return erro_json
        if not isinstance(dados, dict) or not isinstance(dados.get("hits"), dict):
            # Corpo sem "hits" não é "processo inexistente": é uma resposta de erro disfarçada.
            return _erro(f"Resposta inesperada da API DataJud (sem 'hits'): {str(dados)[:300]}")

        hits = dados["hits"]
        total = _total_hits(hits)
        if total == 0:
            return {
                "encontrado": False,
                "mensagem": (
                    f"Processo {numero} não encontrado no tribunal '{tribunal_norm}'. "
                    "Confira o número e a sigla do tribunal; o processo pode estar em outro tribunal."
                ),
            }

        processos = [_extrair_processo_datajud(h.get("_source") or {}) for h in hits.get("hits") or []]
        resultado = {"encontrado": True, "total": total, "processos": processos}
        if _CACHE_DATAJUD is not None:
            await asyncio.to_thread(_CACHE_DATAJUD.gravar, chave_cache, resultado)
        return resultado

    except Exception as exc:  # nunca deixar exceção vazar para o protocolo MCP
        log.exception("Falha inesperada em consultar_processo_datajud")
        return _erro(f"Erro inesperado ao consultar o DataJud: {exc}")


async def _datajud_post_com_retry(url: str, headers: dict, corpo: dict):
    """Faz o POST com timeout de 70s. Retenta em timeout, em 502/503/504 (gateway lento) e em
    429 (Elasticsearch sobrecarregado, comum em horário de pico).

    Retorna a resposta httpx em caso de sucesso, ou um dicionário de erro já pronto.
    """
    ultimo_problema = "sem detalhes"
    async with _cliente(DATAJUD_TIMEOUT_S) as cliente:
        for tentativa in range(1, DATAJUD_TENTATIVAS + 1):
            try:
                resp = await cliente.post(url, headers=headers, json=corpo)
            except httpx.TimeoutException:
                ultimo_problema = f"timeout após {DATAJUD_TIMEOUT_S:.0f}s"
            except httpx.HTTPError as exc:
                ultimo_problema = f"erro de conexão: {exc}"
            else:
                if resp.status_code in (429, 502, 503, 504):
                    ultimo_problema = f"HTTP {resp.status_code} da API DataJud (sobrecarga ou gateway lento)"
                elif resp.status_code in (401, 403):
                    _CIRCUIT_DATAJUD.registrar_sucesso()  # API respondeu; erro é de autenticação
                    return _erro(
                        f"HTTP {resp.status_code} da API DataJud: chave de API rejeitada. "
                        "O CNJ pode ter rotacionado a chave pública; consulte "
                        "https://datajud-wiki.cnj.jus.br/api-publica/ e defina DATAJUD_API_KEY."
                    )
                elif resp.status_code == 404:
                    _CIRCUIT_DATAJUD.registrar_sucesso()  # API respondeu; tribunal inválido
                    return _erro("HTTP 404 da API DataJud: sigla de tribunal provavelmente inválida.")
                elif resp.status_code >= 400:
                    _CIRCUIT_DATAJUD.registrar_sucesso()  # API respondeu com erro de cliente
                    return _erro(f"HTTP {resp.status_code} da API DataJud: {resp.text[:300]}")
                else:
                    _CIRCUIT_DATAJUD.registrar_sucesso()
                    return resp

            log.warning("DataJud tentativa %d/%d falhou: %s", tentativa, DATAJUD_TENTATIVAS, ultimo_problema)
            if tentativa < DATAJUD_TENTATIVAS:
                await asyncio.sleep(DATAJUD_BACKOFF_S * tentativa)

    _CIRCUIT_DATAJUD.registrar_falha()
    return _erro(
        f"Falha ao consultar o DataJud após {DATAJUD_TENTATIVAS} tentativas ({ultimo_problema}). "
        "A API é instável em horários de pico; tente novamente em alguns minutos."
    )


def _extrair_processo_datajud(fonte: dict) -> dict:
    movimentos = []
    for mov in fonte.get("movimentos") or []:
        item = {"codigo": mov.get("codigo"), "nome": mov.get("nome"), "dataHora": mov.get("dataHora")}
        if mov.get("complementosTabelados"):
            item["complementosTabelados"] = mov["complementosTabelados"]
        movimentos.append(item)

    assuntos = [(a.get("nome") or "") for a in (fonte.get("assuntos") or []) if a.get("nome")]

    return {
        "numeroProcesso": fonte.get("numeroProcesso"),
        "tribunal": fonte.get("tribunal"),
        "grau": fonte.get("grau"),
        "grau_descricao": _DESCRICAO_GRAU.get(fonte.get("grau") or "", fonte.get("grau")),
        "classe": (fonte.get("classe") or {}).get("nome"),
        "assuntos": assuntos,
        "dataAjuizamento": fonte.get("dataAjuizamento"),
        "orgaoJulgador": (fonte.get("orgaoJulgador") or {}).get("nome"),
        "totalMovimentos": len(movimentos),
        "movimentos": movimentos,
    }


# --- Tool 2: DJEN ------------------------------------------------------------

_FORMATO_DATA = "%Y-%m-%d"


def _validar_data(nome: str, valor: str | None) -> str | None:
    """Retorna mensagem de erro se a data não estiver em YYYY-MM-DD; None se válida ou ausente."""
    if valor is None or valor == "":
        return None
    try:
        datetime.strptime(valor, _FORMATO_DATA)
    except ValueError:
        return f"{nome} inválida: use o formato YYYY-MM-DD (recebido '{valor}')."
    return None


@mcp.tool()
async def consultar_publicacoes_djen(
    numero_processo: str | None = None,
    sigla_tribunal: str | None = None,
    numero_oab: str | None = None,
    uf_oab: str | None = None,
    data_disponibilizacao_inicio: str | None = None,
    data_disponibilizacao_fim: str | None = None,
    pagina: int = 1,
    itens_por_pagina: int = 50,
) -> dict:
    """Consulta publicações e intimações no Diário de Justiça Eletrônico Nacional (DJEN), via
    API pública Comunica PJe. Não exige autenticação.

    Parâmetros (é obrigatório informar ao menos um entre numero_processo e numero_oab):
    - numero_processo: número CNJ de 20 dígitos; máscara é removida automaticamente.
    - sigla_tribunal: sigla do tribunal em maiúsculas, ex: "TJSP".
    - numero_oab: número da OAB do advogado, ex: "330659".
    - uf_oab: UF da OAB com 2 letras, ex: "SP".
    - data_disponibilizacao_inicio / data_disponibilizacao_fim: intervalo no formato YYYY-MM-DD
      (o início não pode ser posterior ao fim).
    - pagina: número da página (padrão 1).
    - itens_por_pagina: quantidade por página (padrão 50).

    Retorno: dicionário com "total" (quantidade informada pela API), "pagina" e "itens". Cada item
    traz data_disponibilizacao, siglaTribunal, nomeOrgao, tipoComunicacao, tipoDocumento,
    nomeClasse, numeroprocessocommascara, hash, link, destinatarios (nome e polo) e
    destinatarioadvogados (nome, numero_oab, uf_oab). O campo "texto" vem convertido de HTML
    para texto puro legível. O "hash" de cada item pode ser passado a baixar_certidao_djen.

    Limitações:
    - Busca por OAB: tribunais gravam a OAB com sufixos variados (ex: "123456", "123456-O",
      "123456-A"). A busca pode não encontrar tudo; não há tentativa automática com sufixos
      nesta versão.
    - Falhas transitórias (timeout, 500, 502, 503, 504) são repetidas uma vez antes de virar erro.
    - Se a API responder HTTP 403, o IP de saída está fora do Brasil (geo-bloqueio).
    """
    try:
        numero = _so_digitos(numero_processo) if numero_processo else None
        if numero_processo and len(numero) != 20:
            return _erro(
                f"Número de processo inválido: esperados 20 dígitos, recebidos {len(numero)}."
            )

        oab = (numero_oab or "").strip() or None
        if not numero and not oab:
            return _erro("Informe ao menos um entre numero_processo e numero_oab.")

        uf = (uf_oab or "").strip().upper() or None
        if uf and not re.fullmatch(r"[A-Z]{2}", uf):
            return _erro("uf_oab inválida: use 2 letras, ex: 'SP'.")

        for nome, valor in (
            ("data_disponibilizacao_inicio", data_disponibilizacao_inicio),
            ("data_disponibilizacao_fim", data_disponibilizacao_fim),
        ):
            erro_data = _validar_data(nome, valor)
            if erro_data:
                return _erro(erro_data)

        if data_disponibilizacao_inicio and data_disponibilizacao_fim:
            inicio = datetime.strptime(data_disponibilizacao_inicio, _FORMATO_DATA)
            fim = datetime.strptime(data_disponibilizacao_fim, _FORMATO_DATA)
            if inicio > fim:
                return _erro("data_disponibilizacao_inicio não pode ser posterior a data_disponibilizacao_fim.")

        if pagina < 1 or itens_por_pagina < 1:
            return _erro("pagina e itens_por_pagina devem ser inteiros maiores ou iguais a 1.")

        params = {
            "numeroProcesso": numero,
            "siglaTribunal": (sigla_tribunal or "").strip().upper() or None,
            "numeroOab": oab,
            "ufOab": uf,
            "dataDisponibilizacaoInicio": data_disponibilizacao_inicio or None,
            "dataDisponibilizacaoFim": data_disponibilizacao_fim or None,
            "pagina": pagina,
            "itensPorPagina": itens_por_pagina,
        }
        params = {k: v for k, v in params.items() if v is not None}

        resposta = await _djen_get_com_retry(DJEN_BASE_URL, params=params)
        if isinstance(resposta, dict):
            return resposta

        dados, erro_json = _json_da_resposta(resposta)
        if erro_json:
            return erro_json
        if not isinstance(dados, dict):
            return _erro("Resposta inesperada da API do DJEN (não é um objeto JSON).")
        return {
            "total": dados.get("count", 0),
            "pagina": pagina,
            "itens": [_extrair_publicacao_djen(item) for item in dados.get("items") or []],
        }

    except Exception as exc:
        log.exception("Falha inesperada em consultar_publicacoes_djen")
        return _erro(f"Erro inesperado ao consultar o DJEN: {exc}")


async def _djen_get_com_retry(url: str, params: dict | None = None):
    """GET no DJEN com timeout de 30s. Repete uma vez em timeout, erro de conexão ou HTTP
    500/502/503/504. HTTP 403 vira erro de geo-bloqueio.

    Retorna a resposta httpx em caso de sucesso, ou um dicionário de erro já pronto.
    """
    ultimo_problema = "sem detalhes"
    async with _cliente(DJEN_TIMEOUT_S, follow_redirects=True) as cliente:
        for tentativa in range(1, DJEN_TENTATIVAS + 1):
            try:
                resp = await cliente.get(url, params=params)
            except httpx.TimeoutException:
                ultimo_problema = f"timeout após {DJEN_TIMEOUT_S:.0f}s"
            except httpx.HTTPError as exc:
                ultimo_problema = f"erro de conexão: {exc}"
            else:
                if resp.status_code == 403:
                    _CIRCUIT_DJEN.registrar_sucesso()  # API respondeu; geo-bloqueio não é falha da API
                    return _erro(_mensagem_geobloqueio())
                if resp.status_code in DJEN_STATUS_TRANSITORIOS:
                    ultimo_problema = f"HTTP {resp.status_code}"
                elif resp.status_code >= 400:
                    _CIRCUIT_DJEN.registrar_sucesso()  # API respondeu com erro de cliente
                    return _erro(f"HTTP {resp.status_code} da API do DJEN: {resp.text[:300]}")
                else:
                    _CIRCUIT_DJEN.registrar_sucesso()
                    return resp

            log.warning("DJEN tentativa %d/%d falhou: %s", tentativa, DJEN_TENTATIVAS, ultimo_problema)
            if tentativa < DJEN_TENTATIVAS:
                await asyncio.sleep(DJEN_BACKOFF_S)

    _CIRCUIT_DJEN.registrar_falha()
    return _erro(f"Falha ao consultar o DJEN após {DJEN_TENTATIVAS} tentativas ({ultimo_problema}).")


def _mensagem_geobloqueio() -> str:
    return (
        "HTTP 403 da API do DJEN. A API Comunica PJe bloqueia requisições de IPs fora do Brasil "
        "(geo-bloqueio). Verifique se a conexão de saída deste ambiente está no Brasil."
    )


def _extrair_publicacao_djen(item: dict) -> dict:
    return {
        "data_disponibilizacao": item.get("data_disponibilizacao"),
        "siglaTribunal": item.get("siglaTribunal"),
        "nomeOrgao": item.get("nomeOrgao"),
        "tipoComunicacao": item.get("tipoComunicacao"),
        "tipoDocumento": item.get("tipoDocumento"),
        "nomeClasse": item.get("nomeClasse"),
        "numeroprocessocommascara": item.get("numeroprocessocommascara"),
        "hash": item.get("hash"),
        "link": item.get("link"),
        "destinatarios": [
            {"nome": d.get("nome"), "polo": d.get("polo")} for d in item.get("destinatarios") or []
        ],
        "destinatarioadvogados": [
            {
                "nome": (da.get("advogado") or {}).get("nome"),
                "numero_oab": (da.get("advogado") or {}).get("numero_oab"),
                "uf_oab": (da.get("advogado") or {}).get("uf_oab"),
            }
            for da in item.get("destinatarioadvogados") or []
        ],
        "texto": _html_para_texto(item.get("texto")),
    }


@mcp.tool()
async def consultar_processo_unificado(tribunal: str, numero_processo: str) -> dict:
    """Combina DataJud (capa + movimentos) e DJEN (partes, advogados e publicações) do mesmo
    processo em um único esquema JSON, para não precisar chamar as duas tools separadamente.

    Parâmetros: iguais a consultar_processo_datajud (tribunal, numero_processo).

    Retorno: dicionário com "numero_processo", "encontrado_datajud" (bool), "instancias" (lista de
    capa+movimentos por grau, igual a "processos" de consultar_processo_datajud), "partes"
    (nome e polo, deduplicadas por nome), "advogados" (nome, numero_oab e uf_oab, deduplicados
    por OAB) e "publicacoes" (itens do DJEN sem o campo "texto" completo).

    Limitações:
    - "partes", "advogados" e "publicacoes" vêm do DJEN e só existem se já houve ao menos uma
      publicação desse processo; um processo sem publicações retorna essas listas vazias, mesmo
      que existam partes reais (DataJud não expõe nomes de partes — ver consultar_processo_datajud).
    - Erros de qualquer uma das duas fontes (DataJud ou DJEN) interrompem a combinação e são
      retornados como "erro", mesmo que a outra fonte tenha respondido com sucesso.
    """
    try:
        resultado_datajud, resultado_djen = await asyncio.gather(
            consultar_processo_datajud(tribunal=tribunal, numero_processo=numero_processo),
            consultar_publicacoes_djen(numero_processo=numero_processo),
        )
        if resultado_datajud.get("erro"):
            return resultado_datajud
        if resultado_djen.get("erro"):
            return resultado_djen

        partes: dict[str, dict] = {}
        advogados: dict[str, dict] = {}
        publicacoes = []
        for item in resultado_djen.get("itens") or []:
            for parte in item.get("destinatarios") or []:
                chave = (parte.get("nome") or "").strip().upper()
                if chave:
                    partes[chave] = parte
            for advogado in item.get("destinatarioadvogados") or []:
                chave = advogado.get("numero_oab") or advogado.get("nome")
                if chave:
                    advogados[chave] = advogado
            publicacoes.append({k: v for k, v in item.items() if k != "texto"})

        return {
            "numero_processo": _so_digitos(numero_processo),
            "encontrado_datajud": bool(resultado_datajud.get("encontrado")),
            "instancias": resultado_datajud.get("processos") or [],
            "partes": list(partes.values()),
            "advogados": list(advogados.values()),
            "publicacoes": publicacoes,
        }
    except Exception as exc:
        log.exception("Falha inesperada em consultar_processo_unificado")
        return _erro(f"Erro inesperado ao combinar DataJud e DJEN: {exc}")


# --- Feriados forenses (TJSP) -------------------------------------------------
#
# Usado para calcular prazos processuais em dias úteis: o TJSP publica, por município/comarca,
# a lista de feriados forenses que suspendem a contagem (além de sábados e domingos). A busca usa
# o mesmo endpoint JSON que alimenta a página pública
# https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense - sem API oficial documentada,
# mas estável (JSON direto, não scraping de HTML como o CJPG). Resultado fica em cache em disco por
# município normalizado + ano, porque o TJSP às vezes corrige datas ao longo do ano (ex.:
# "ALTERADO PELO PROVIMENTO CSM Nº ...").

TJSP_FERIADOS_BASE_URL = "https://www.tjsp.jus.br"
FERIADOS_TIMEOUT_S = 20.0
FERIADOS_CACHE_TTL_S = 24 * 60 * 60  # 1 dia: datas de feriado podem ser corrigidas pelo TJSP
FERIADOS_ANO_MIN = 2013  # mais antigo disponível no seletor da página do TJSP

_RE_DATA_MS_TJSP = re.compile(r"/Date\((\d+)\)")

# ── Feriados nacionais e estaduais (para tribunais além do TJSP) ──────────────

_FERIADOS_NACIONAIS_FIXOS: list[tuple[str, str]] = [
    ("01-01", "Confraternização Universal"),
    ("04-21", "Tiradentes"),
    ("05-01", "Dia do Trabalho"),
    ("09-07", "Independência do Brasil"),
    ("10-12", "Nossa Sra. Aparecida"),
    ("11-02", "Finados"),
    ("11-15", "Proclamação da República"),
    ("11-20", "Dia da Consciência Negra"),
    ("12-25", "Natal"),
]

# Feriados estaduais exclusivos (MM-DD, descrição) — não incluem os nacionais já listados acima.
# Fonte: legislações estaduais; lista conservadora (apenas feriados com lei estadual consolidada).
_FERIADOS_ESTADUAIS: dict[str, list[tuple[str, str]]] = {
    "AC": [("01-23", "Dia do Estado do Acre"), ("06-15", "Aniversário de Rio Branco"),
           ("09-05", "Dia da Amazônia"), ("11-17", "Tratado de Petrópolis")],
    "AL": [("09-16", "Emancipação Política de Alagoas")],
    "AM": [("09-05", "Elevação à Categoria de Província")],
    "AP": [("09-13", "Criação do Território Federal do Amapá")],
    "BA": [("07-02", "Independência da Bahia")],
    "CE": [("03-25", "Data Magna do Ceará")],
    "DF": [],
    "ES": [("05-23", "Colonização do Espírito Santo")],
    "GO": [("10-24", "Pedra Fundamental de Goiânia")],
    "MA": [("07-28", "Adesão do Maranhão à Independência do Brasil")],
    "MG": [("12-08", "Nossa Sra. da Imaculada Conceição")],
    "MS": [("10-11", "Criação do Estado de Mato Grosso do Sul")],
    "MT": [],
    "PA": [("08-15", "Adesão do Pará à Independência do Brasil")],
    "PB": [("08-05", "Fundação da Paraíba")],
    "PE": [("03-06", "Revolução Pernambucana")],
    "PI": [("10-19", "Dia do Piauí")],
    "PR": [("12-19", "Emancipação Política do Paraná")],
    "RJ": [("04-23", "Dia de São Jorge")],
    "RN": [("10-03", "Mártires de Cunhaú e Uruaçu")],
    "RO": [("01-04", "Criação do Estado de Rondônia"), ("06-18", "Dia do Evangélico")],
    "RR": [("10-05", "Criação do Território de Roraima")],
    "RS": [("09-20", "Revolução Farroupilha")],
    "SC": [("11-25", "Dia de Santa Catarina")],
    "SE": [("07-08", "Autonomia Política de Sergipe")],
    "SP": [("07-09", "Revolução Constitucionalista de 1932")],
    "TO": [("10-05", "Criação do Estado do Tocantins")],
}

# UF sede de cada TRT (usado quando o tribunal é TRT e não TJSP)
_TRT_UF: dict[str, str] = {
    "trt1": "RJ", "trt2": "SP", "trt3": "MG", "trt4": "RS", "trt5": "BA",
    "trt6": "PE", "trt7": "CE", "trt8": "PA", "trt9": "PR", "trt10": "DF",
    "trt11": "AM", "trt12": "SC", "trt13": "PB", "trt14": "RO", "trt15": "SP",
    "trt16": "MA", "trt17": "ES", "trt18": "GO", "trt19": "AL", "trt20": "SE",
    "trt21": "RN", "trt22": "PI", "trt23": "MT", "trt24": "MS",
}

# UF sede de cada TRF
_TRF_UF: dict[str, str] = {
    "trf1": "DF", "trf2": "RJ", "trf3": "SP", "trf4": "RS", "trf5": "PE", "trf6": "MG",
}


def _pascoa(ano: int) -> datetime:
    """Algoritmo de Meeus/Jones/Butcher — retorna a data da Páscoa como objeto date."""
    from datetime import date
    a = ano % 19
    b = ano // 100
    c = ano % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mes = (h + l_ - 7 * m + 114) // 31
    dia = ((h + l_ - 7 * m + 114) % 31) + 1
    return date(ano, mes, dia)


def _uf_do_tribunal(tribunal: str) -> str | None:
    """Retorna a UF sede do tribunal a partir da sigla (ex.: 'tjsp' → 'SP', 'trt15' → 'SP')."""
    t = (tribunal or "").lower().strip()
    if t.startswith("tj"):
        uf = t[2:]
        if uf == "dft":
            return "DF"
        if len(uf) == 2:
            return uf.upper()
        return {"mmg": "MG", "msp": "SP", "mrs": "RS"}.get(uf)
    if t in _TRT_UF:
        return _TRT_UF[t]
    if t in _TRF_UF:
        return _TRF_UF[t]
    if t in ("stj", "stf", "stm", "cnj"):
        return "DF"
    return None


def _calcular_feriados_nacionais_e_estaduais(uf: str | None, ano: int) -> dict:
    """Computa feriados nacionais + estaduais sem chamada de rede.
    Retorna o mesmo formato que buscar_feriados_forenses."""
    from datetime import date
    feriados: dict[str, str] = {}

    for mmdd, desc in _FERIADOS_NACIONAIS_FIXOS:
        feriados[f"{ano}-{mmdd}"] = desc

    pascoa = _pascoa(ano)
    for delta, desc in [
        (-48, "Segunda-feira de Carnaval"),
        (-47, "Terça-feira de Carnaval"),
        (-2,  "Sexta-feira Santa"),
        (0,   "Páscoa"),
        (60,  "Corpus Christi"),
    ]:
        feriados[(pascoa + timedelta(days=delta)).isoformat()] = desc

    uf_upper = (uf or "").upper()
    for mmdd, desc in _FERIADOS_ESTADUAIS.get(uf_upper, []):
        feriados.setdefault(f"{ano}-{mmdd}", desc)

    lista = sorted([{"data": d, "descricao": n} for d, n in feriados.items()], key=lambda x: x["data"])
    return {
        "municipio": uf_upper or "federal",
        "uf": uf_upper or None,
        "ano": ano,
        "fonte": "calculado",
        "feriados": lista,
    }


def _dir_feriados_forenses() -> Path:
    caminho = Path(os.environ.get("CNJ_MCP_FERIADOS_DIR", "feriados_forenses"))
    caminho.mkdir(parents=True, exist_ok=True)
    return caminho


def _chave_cache_feriados(municipio: str, ano: int, tribunal: str = "tjsp") -> str:
    normalizado = _sem_acento_cjpg(municipio).strip().replace(" ", "_")
    normalizado = re.sub(r"[^a-z0-9_]", "", normalizado) or "municipio"
    trib = re.sub(r"[^a-z0-9]", "", (tribunal or "tjsp").lower()) or "tjsp"
    return f"{trib}_{normalizado}_{ano}"


async def _tjsp_buscar_municipios(termo: str) -> list[dict]:
    async with _cliente(FERIADOS_TIMEOUT_S) as cliente_http:
        resp = await cliente_http.post(
            f"{TJSP_FERIADOS_BASE_URL}/AutoComplete/ListarMunicipios",
            data={"texto": termo},
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        )
        resp.raise_for_status()
        dados = resp.json()
    if not isinstance(dados, list):
        return []
    return [
        {"codigo": item.get("Codigo"), "nome": item.get("Descricao")}
        for item in dados
        if item.get("Descricao")
    ]


async def _tjsp_buscar_feriados(nome_municipio: str, codigo_municipio: int, ano: int) -> list[dict]:
    async with _cliente(FERIADOS_TIMEOUT_S) as cliente_http:
        resp = await cliente_http.get(
            f"{TJSP_FERIADOS_BASE_URL}/CanaisComunicacao/Feriados/PesquisarFeriados",
            params={"nomeMunicipio": nome_municipio, "codigoMunicipio": codigo_municipio, "ano": ano},
        )
        resp.raise_for_status()
        dados = resp.json()
    feriados = []
    for item in (dados or {}).get("data") or []:
        m = _RE_DATA_MS_TJSP.search(item.get("DataFeriado") or "")
        if not m:
            continue
        data_iso = datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date().isoformat()
        feriados.append({"data": data_iso, "descricao": (item.get("Descricao") or "").strip()})
    feriados.sort(key=lambda f: f["data"])
    return feriados


def _feriados_do_cache(municipio: str, ano: int, tribunal: str = "tjsp") -> dict | None:
    arquivo = _dir_feriados_forenses() / f"{_chave_cache_feriados(municipio, ano, tribunal)}.json"
    if not arquivo.is_file():
        return None
    if time.time() - arquivo.stat().st_mtime > FERIADOS_CACHE_TTL_S:
        return None
    try:
        return json.loads(arquivo.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _salvar_feriados_no_cache(municipio: str, ano: int, resultado: dict, tribunal: str = "tjsp") -> None:
    arquivo = _dir_feriados_forenses() / f"{_chave_cache_feriados(municipio, ano, tribunal)}.json"
    arquivo.write_text(json.dumps(resultado, ensure_ascii=False), encoding="utf-8")


@mcp.tool()
async def buscar_feriados_forenses(municipio: str, ano: int, tribunal: str = "tjsp") -> dict:
    """Feriados forenses para um município/comarca e ano, usado para calcular prazos processuais
    em dias úteis (excluir sábados, domingos e feriados).

    Para TJSP (padrão), consulta a fonte oficial tjsp.jus.br.
    Para outros tribunais (ex: "tjrj", "trf3", "trt15"), calcula feriados nacionais +
    estaduais correspondentes ao tribunal informado, sem chamada de rede externa.

    Resultado fica em cache por até 1 dia."""
    municipio = (municipio or "").strip()
    tribunal = (tribunal or "tjsp").strip().lower()
    if not municipio:
        return _erro("informe o município/comarca.")
    ano_atual = datetime.now(timezone.utc).year
    if not (FERIADOS_ANO_MIN <= ano <= ano_atual + 1):
        return _erro(f"ano fora do intervalo suportado ({FERIADOS_ANO_MIN}-{ano_atual + 1}).")

    em_cache = _feriados_do_cache(municipio, ano, tribunal)
    if em_cache is not None:
        return em_cache

    # Tribunais não-TJSP: calcular sem rede
    if tribunal != "tjsp":
        uf = _uf_do_tribunal(tribunal)
        resultado = _calcular_feriados_nacionais_e_estaduais(uf, ano)
        resultado["municipio"] = municipio
        _salvar_feriados_no_cache(municipio, ano, resultado, tribunal)
        return resultado

    # TJSP: fonte oficial
    try:
        candidatos = await _tjsp_buscar_municipios(municipio)
    except httpx.HTTPError as exc:
        return _erro(f"falha ao consultar municípios no TJSP: {exc}")
    if not candidatos:
        return _erro(f"município/comarca não encontrado no TJSP: {municipio}")
    escolhido = candidatos[0]

    try:
        feriados = await _tjsp_buscar_feriados(escolhido["nome"], escolhido["codigo"], ano)
    except httpx.HTTPError as exc:
        return _erro(f"falha ao consultar feriados no TJSP: {exc}")

    resultado = {
        "municipio": escolhido["nome"],
        "codigo_municipio": escolhido["codigo"],
        "ano": ano,
        "feriados": feriados,
    }
    _salvar_feriados_no_cache(municipio, ano, resultado, tribunal)
    return resultado


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
            "nome": _html_para_texto(m.group("nome")).strip(),
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
        nome = _html_para_texto(m.group("nome")).strip()
        if codigo and codigo != "-1" and nome:
            registros.append({"codigo": codigo, "nome": nome})
    return registros


async def _baixar_arvore_cjpg(campo: str) -> list[dict]:
    url = _CJPG_ARVORE_URLS[campo]
    async with _cliente(CJPG_TIMEOUT_S, headers=CJPG_HEADERS, follow_redirects=True) as cliente:
        await cliente.get(f"{CJPG_BASE_URL}/")  # cookie de sessão
        resp = await cliente.get(url)
        resp.raise_for_status()
        html = resp.text
    if campo == "magistrado":
        return _parsear_magistrados_cjpg(html)
    return _parsear_arvore_cjpg(html)


async def atualizar_arvores_cjpg() -> dict:
    """Baixa e salva as 4 árvores de referência do CJPG. Usado pelo comando --atualizar-arvores-cjpg."""
    destino = _dir_arvores_cjpg()
    resumo = {}
    for campo in ("vara", "classe", "assunto", "magistrado"):
        registros = await _baixar_arvore_cjpg(campo)
        arquivo = destino / f"{campo}.json"
        arquivo.write_text(json.dumps(registros, ensure_ascii=False), encoding="utf-8")
        resumo[campo] = len(registros)
    (destino / "atualizado_em.txt").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    return resumo


_CACHE_ARVORES_CJPG: dict[str, list[dict]] = {}


def _carregar_arvore_cjpg(campo: str) -> list[dict]:
    if campo not in _CACHE_ARVORES_CJPG:
        arquivo = _dir_arvores_cjpg() / f"{campo}.json"
        if arquivo.is_file():
            _CACHE_ARVORES_CJPG[campo] = json.loads(arquivo.read_text(encoding="utf-8"))
        else:
            _CACHE_ARVORES_CJPG[campo] = []
    return _CACHE_ARVORES_CJPG[campo]


def _filhos_arvore_cjpg(campo: str, no_pai: str | None) -> list[dict]:
    nos = _carregar_arvore_cjpg(campo)
    return [n for n in nos if n["pai"] == no_pai]


def _buscar_arvore_cjpg(campo: str, termo: str, limite: int = 50) -> list[dict]:
    termo_norm = _sem_acento_cjpg(termo)
    nos = _carregar_arvore_cjpg(campo)
    resultado = [n for n in nos if n["folha"] and termo_norm in _sem_acento_cjpg(n["busca"])]
    return resultado[:limite]


def _sem_acento_cjpg(texto: str) -> str:
    nfkd = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn").lower()


# --- CJPG: endpoints HTTP de apoio ao autocomplete das árvores ---------------
#
# Puramente suporte de interface (navegação/busca na árvore pelo usuário clicando/digitando no
# /app) - por isso são endpoints HTTP simples, não tools MCP. Exigem o mesmo token Bearer do
# resto do app (checado no middleware antes de chegar aqui), mas não contam no limite de uso
# nem aparecem nos tools MCP por bom motivo: não fazem nenhuma chamada ao e-SAJ, só leem o cache
# local já baixado por --atualizar-arvores-cjpg.

_CAMPOS_ARVORE_CJPG = {"vara", "classe", "assunto"}


async def _arvore_filhos_http(scope, send) -> None:
    query = dict(_query(scope))
    campo = query.get("campo", "")
    if campo not in _CAMPOS_ARVORE_CJPG:
        await _json(send, 400, {"erro": f"campo inválido: use um entre {sorted(_CAMPOS_ARVORE_CJPG)}."})
        return
    no_pai = query.get("no") or None
    await _json(send, 200, {"filhos": _filhos_arvore_cjpg(campo, no_pai)})


async def _arvore_buscar_http(scope, send) -> None:
    query = dict(_query(scope))
    campo = query.get("campo", "")
    if campo not in _CAMPOS_ARVORE_CJPG:
        await _json(send, 400, {"erro": f"campo inválido: use um entre {sorted(_CAMPOS_ARVORE_CJPG)}."})
        return
    termo = (query.get("q") or "").strip()
    if len(termo) < 2:
        await _json(send, 400, {"erro": "informe ao menos 2 caracteres em q."})
        return
    await _json(send, 200, {"resultados": _buscar_arvore_cjpg(campo, termo)})


async def _arvore_magistrados_http(send) -> None:
    # lista plana (não é árvore) - servida inteira de uma vez, autocomplete filtra no navegador
    await _json(send, 200, {"magistrados": _carregar_arvore_cjpg("magistrado")})


async def _cep_http(send, cep: str) -> None:
    """GET /cep/<cep>: proxy para o ViaCEP usado pelo autopreenchimento de endereço. Existe
    porque o navegador do usuário às vezes não consegue chamar viacep.com.br direto - algumas
    hospedagens/proxies na frente do painel aplicam um Content-Security-Policy com
    connect-src 'self', que bloqueia fetch() para qualquer domínio de terceiro. Buscando aqui
    (same-origin) o problema desaparece, porque quem conversa com o ViaCEP é o servidor, não o
    navegador."""
    digitos = re.sub(r"\D", "", cep or "")
    if len(digitos) != 8:
        await _json(send, 400, _erro("CEP deve ter 8 dígitos."))
        return
    try:
        async with _cliente(8.0) as cliente_http:
            resp = await cliente_http.get(f"https://viacep.com.br/ws/{digitos}/json/")
        if resp.status_code != 200:
            await _json(send, 502, _erro("ViaCEP indisponível no momento."))
            return
        dados = resp.json()
    except (httpx.HTTPError, ValueError):
        await _json(send, 502, _erro("Não foi possível consultar o CEP agora."))
        return
    if dados.get("erro"):
        await _json(send, 404, _erro("CEP não encontrado."))
        return
    await _json(send, 200, dados)


# --- CJPG: busca e heurísticas de jurimetria ----------------------------------

CJPG_MARCADORES_DISPOSITIVO = [
    "ante o exposto", "diante do exposto", "posto isso", "isto posto", "pelo exposto", "do exposto",
]
CJPG_PALAVRAS_DESFECHO = [
    ("parcial", r"julgo\s+parcialmente\s+procedente"),
    ("procedente", r"julgo\s+procedente"),
    ("improcedente", r"julgo\s+improcedente"),
    ("acordo", r"homologo"),
    ("extinto", r"julgo\s+extint[ao]"),
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


def _cjpg_extrair_valor_condenacao(inteiro_teor: str | None) -> float | None:
    """Extrai o valor de condenação por dano moral do dispositivo. Heurística: pega o valor em
    R$ mais próximo textualmente de "moral"/"morais" (plural irregular - não é só sufixo "s"),
    dentro de uma distância curta, pra não pegar valor de honorários/custas/dano material.
    """
    if not inteiro_teor:
        return None
    texto_lower = inteiro_teor.lower()
    inicio = _cjpg_achar_inicio_dispositivo(texto_lower)
    regiao = inteiro_teor[inicio:] if inicio != -1 else inteiro_teor[-3000:]
    regiao_lower = regiao.lower()

    melhor_valor, melhor_dist = None, None
    for m in re.finditer(r"R\$\s*([\d.]+,\d{2})", regiao):
        pos_valor = m.start()
        dists = [abs(mm.start() - pos_valor) for mm in re.finditer(r"mora(?:l|is)", regiao_lower)]
        if not dists:
            continue
        dist = min(dists)
        if dist > 250:
            continue
        if melhor_dist is None or dist < melhor_dist:
            melhor_valor, melhor_dist = m.group(1), dist
    if melhor_valor is None:
        return None
    return float(melhor_valor.replace(".", "").replace(",", "."))


def _cjpg_parsear_resultados(html: str) -> list[dict]:
    blocos = re.split(r'<tr class="fundocinza1">', html)[1:]
    resultados = []
    for bloco in blocos:
        numero_m = re.search(r'<span class="fonteNegrito">\s*(.*?)\s*</span>', bloco, re.DOTALL)
        campos = {}
        for nome in CJPG_CAMPOS_RESULTADO:
            m = re.search(rf"<strong>\s*{re.escape(nome)}:\s*</strong>\s*(.*?)</td>", bloco, flags=re.DOTALL)
            campos[nome] = _html_para_texto(m.group(1)).strip() if m else None
        # a tag <img> de mostrar/ocultar fica entre o </span> e o </div> - por isso não exigimos </div>
        trecho_m = re.search(r'<div align="justify">\s*<span>(.*?)</span>', bloco, flags=re.DOTALL)
        teor_m = re.search(
            r'<div align="justify" style="display: none;">\s*<span>(.*?)</span>', bloco, flags=re.DOTALL
        )
        teor = _html_para_texto(teor_m.group(1)).strip() if teor_m else None
        resultados.append({
            "numero_processo": _html_para_texto(numero_m.group(1)).strip() if numero_m else None,
            "classe": campos["Classe"],
            "assunto": campos["Assunto"],
            "magistrado": campos["Magistrado"],
            "comarca": campos["Comarca"],
            "foro": campos["Foro"],
            "vara": campos["Vara"],
            "data_disponibilizacao": campos["Data de Disponibilização"],
            "trecho": _html_para_texto(trecho_m.group(1)).strip() if trecho_m else None,
            "desfecho": _cjpg_classificar_desfecho(teor),
            "valor_condenacao": _cjpg_extrair_valor_condenacao(teor),
        })
    return resultados


def _cjpg_total_resultados(html: str) -> int | None:
    m = re.search(r"Resultados\s*<strong>\s*\d+\s*a\s*\d+\s*</strong>\s*de\s*([\d.]+)", html, re.DOTALL)
    return int(m.group(1).replace(".", "")) if m else None


def _cjpg_bloqueado(html: str) -> bool:
    return "fundocinza1" not in html and "Parâmetros de Consulta" not in html


async def _cjpg_executar_busca(params: dict, paginas: int) -> tuple[int | None, list[dict], list[str]]:
    """Executa a busca paginada no CJPG (sessão + pesquisar.do + trocarDePagina.do) e devolve
    (total_servidor, resultados_parseados, avisos). Best-effort: se uma página falhar no meio,
    para ali e devolve o que já foi buscado, em vez de descartar tudo.
    """
    avisos: list[str] = []
    async with _cliente(CJPG_TIMEOUT_S, headers=CJPG_HEADERS, follow_redirects=True) as cliente:
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


@mcp.tool()
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
) -> dict:
    """Busca julgados de 1º grau do TJSP (CJPG, scraping - sem API oficial, best-effort) e aplica
    heurísticas de jurimetria: classifica o desfecho de cada decisão e extrai o valor de condenação
    por dano moral quando houver. Se assunto_codigo/assunto_nome for informado, agrega os valores
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
    - magistrado_codigo: código do magistrado (cdAgente), filtra de verdade no servidor.
    - data_inicio / data_fim: formato dd/mm/aaaa.
    - paginas: quantas páginas de 10 resultados buscar (padrão 1, teto 15). A busca é best-effort:
      se uma página falhar no meio, o resultado parcial já buscado é devolvido com um aviso, em
      vez de descartado.

    Limitações conhecidas:
    - O CJPG tem um teto de ~10.000 resultados por consulta (limite do índice de busca do TJSP);
      consultas muito amplas devem ser fatiadas por data.
    - A classificação de desfecho e a extração de valor são heurísticas de regex sobre o texto da
      decisão, não garantidas: funcionam bem para redação "padrão", erram em casos atípicos.
    """
    try:
        if paginas < 1 or paginas > CJPG_PAGINAS_MAX:
            return _erro(f"paginas deve ser entre 1 e {CJPG_PAGINAS_MAX}.")

        termo_busca = (termo or "").strip()
        if magistrado_nome:
            termo_busca = f'{termo_busca} "{magistrado_nome.strip()}"'.strip()

        params = {
            "conversationId": "",
            "dadosConsulta.pesquisaLivre": termo_busca,
            "tipoNumero": "UNIFICADO",
            "dadosConsulta.dtInicio": (data_inicio or "").strip(),
            "dadosConsulta.dtFim": (data_fim or "").strip(),
            "dadosConsulta.ordenacao": "DESC",
        }
        if classe_codigo:
            params["classeTreeSelection.values"] = classe_codigo
        if assunto_codigo:
            params["assuntoTreeSelection.values"] = assunto_codigo
        if vara_codigo:
            params["varasTreeSelection.values"] = vara_codigo
        if magistrado_codigo:
            params["cdAgente"] = magistrado_codigo
            params["agenteSelectedEntitiesList"] = magistrado_codigo

        try:
            total_servidor, todos, avisos = await _cjpg_executar_busca(params, paginas)
        except ValueError as exc:
            return _erro(str(exc))

        resposta: dict[str, Any] = {
            "total_servidor": total_servidor,
            "buscados": len(todos),
            "resultados": todos,
            "avisos": avisos,
        }

        if assunto_codigo or assunto_nome:
            procedentes = [r for r in todos if r["desfecho"] in ("procedente", "parcial")]
            valores = sorted(r["valor_condenacao"] for r in procedentes if r["valor_condenacao"] is not None)
            agregado: dict[str, Any] = {
                "procedentes_ou_parciais": len(procedentes),
                "com_valor_extraido": len(valores),
            }
            if len(valores) >= 1:
                agregado["mediana"] = statistics.median(valores)
                agregado["p25"] = valores[int(len(valores) * 0.25)]
                agregado["p75"] = valores[min(int(len(valores) * 0.75), len(valores) - 1)]
                agregado["min"] = valores[0]
                agregado["max"] = valores[-1]
            if len(valores) < 5:
                agregado["aviso"] = "Amostra pequena (menos de 5 valores extraídos) - interprete com cautela."
            resposta["agregado"] = agregado

        return resposta

    except httpx.HTTPError as exc:
        return _erro(f"Erro de rede ao consultar o CJPG: {exc}")
    except Exception as exc:
        log.exception("Falha inesperada em consultar_jurimetria_cjpg")
        return _erro(f"Erro inesperado ao consultar o CJPG: {exc}")


CJPG_CATEGORIAS_DESFECHO = ["procedente", "parcial", "improcedente", "acordo", "extinto"]


@mcp.tool()
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
) -> dict:
    """Busca julgados de 1º grau do TJSP (CJPG, scraping - sem API oficial, best-effort) de um
    magistrado específico e monta um perfil decisório: taxa de procedência/improcedência/parcial,
    proporção de acordos homologados e valor médio de indenização por dano moral, no período
    informado. Aceita os mesmos filtros estruturados de classe/assunto/vara de
    `consultar_jurimetria_cjpg` para refinar o universo de decisões analisadas (ex.: perfil do
    magistrado só nas ações de indenização por dano moral) - mas, ao contrário daquela tool, não
    calcula mediana/percentis de valor (isso é objetivo do benchmark de valor, não deste perfil).

    Parâmetros:
    - magistrado_codigo: código do magistrado (cdAgente), filtra de verdade no servidor. Resolvido
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
            return _erro("Informe magistrado_codigo ou magistrado_nome.")
        if paginas < 1 or paginas > CJPG_PAGINAS_MAX:
            return _erro(f"paginas deve ser entre 1 e {CJPG_PAGINAS_MAX}.")

        termo_busca = (termo or "").strip()
        if magistrado_nome:
            termo_busca = f'{termo_busca} "{magistrado_nome.strip()}"'.strip()

        params = {
            "conversationId": "",
            "dadosConsulta.pesquisaLivre": termo_busca,
            "tipoNumero": "UNIFICADO",
            "dadosConsulta.dtInicio": (data_inicio or "").strip(),
            "dadosConsulta.dtFim": (data_fim or "").strip(),
            "dadosConsulta.ordenacao": "DESC",
        }
        if classe_codigo:
            params["classeTreeSelection.values"] = classe_codigo
        if assunto_codigo:
            params["assuntoTreeSelection.values"] = assunto_codigo
        if vara_codigo:
            params["varasTreeSelection.values"] = vara_codigo
        if magistrado_codigo:
            params["cdAgente"] = magistrado_codigo
            params["agenteSelectedEntitiesList"] = magistrado_codigo

        try:
            total_servidor, todos, avisos = await _cjpg_executar_busca(params, paginas)
        except ValueError as exc:
            return _erro(str(exc))

        classificados = [r for r in todos if r["desfecho"] is not None]
        contagens = Counter(r["desfecho"] for r in classificados)
        total_classificados = len(classificados)

        perfil: dict[str, Any] = {
            "total_classificados": total_classificados,
            "nao_classificados": len(todos) - total_classificados,
        }
        for categoria in CJPG_CATEGORIAS_DESFECHO:
            perfil[f"taxa_{categoria}"] = (
                contagens.get(categoria, 0) / total_classificados if total_classificados else None
            )

        valores = [
            r["valor_condenacao"] for r in classificados
            if r["desfecho"] in ("procedente", "parcial") and r["valor_condenacao"] is not None
        ]
        perfil["com_valor_extraido"] = len(valores)
        perfil["valor_medio_indenizacao"] = statistics.mean(valores) if valores else None

        if total_classificados < 5:
            perfil["aviso"] = "Amostra pequena (menos de 5 decisões classificadas) - interprete com cautela."

        return {
            "total_servidor": total_servidor,
            "buscados": len(todos),
            "resultados": todos,
            "avisos": avisos,
            "perfil": perfil,
        }

    except httpx.HTTPError as exc:
        return _erro(f"Erro de rede ao consultar o CJPG: {exc}")
    except Exception as exc:
        log.exception("Falha inesperada em perfil_decisorio_magistrado")
        return _erro(f"Erro inesperado ao consultar o CJPG: {exc}")


# --- Tool 3 (bônus): certidão DJEN -------------------------------------------

@mcp.tool()
async def baixar_certidao_djen(hash: str) -> dict:
    """Baixa a certidão em PDF de uma publicação do DJEN e salva em arquivo temporário local.

    Parâmetro:
    - hash: valor do campo "hash" retornado por consultar_publicacoes_djen.

    Retorno: dicionário com "link_download" (URL que baixa o PDF direto no navegador, válida por 15
    minutos), "nome_arquivo", "bytes" e "validade_link". O caminho no servidor não é informado. Entregue o link ao usuário; não tente
    abri-lo como texto. Se "link_download" vier null, a resposta traz um campo "aviso".
    Certidões com mais de 7 dias são removidas do diretório temporário do servidor a cada novo download.
    """
    try:
        hash_limpo = (hash or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9]+", hash_limpo):
            return _erro("Hash inválido: deve conter apenas letras e números, como retornado por consultar_publicacoes_djen.")

        url = f"{DJEN_BASE_URL}/{hash_limpo}/certidao"
        resposta = await _djen_get_com_retry(url)
        if isinstance(resposta, dict):
            return resposta

        conteudo = resposta.content
        if not conteudo.startswith(b"%PDF"):
            return _erro("A API do DJEN não retornou um PDF válido para este hash.")

        CERTIDAO_DIR.mkdir(parents=True, exist_ok=True)
        _limpar_certidoes_antigas()
        caminho = CERTIDAO_DIR / f"certidao_{hash_limpo}.pdf"
        caminho.write_bytes(conteudo)
        resultado = {
            "nome_arquivo": caminho.name,
            "bytes": len(conteudo),
            "link_download": _link_certidao(caminho.name),
            "validade_link": f"{CERTIDAO_LINK_VALIDADE_S // 60} minutos",
        }
        if resultado["link_download"] is None:
            resultado["aviso"] = "Link de download indisponível: o administrador precisa definir CNJ_MCP_URL_PUBLICA."
        return resultado

    except Exception as exc:
        log.exception("Falha inesperada em baixar_certidao_djen")
        return _erro(f"Erro inesperado ao baixar a certidão: {exc}")


def _limpar_certidoes_antigas() -> None:
    """Remove certidões mais antigas que CERTIDAO_RETENCAO_DIAS. Falhas aqui não interrompem o download."""
    limite = time.time() - CERTIDAO_RETENCAO_DIAS * 86400
    try:
        for arquivo in CERTIDAO_DIR.glob("certidao_*.pdf"):
            if arquivo.stat().st_mtime < limite:
                arquivo.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("Não foi possível limpar certidões antigas: %s", exc)


def _assinatura_certidao(nome: str, expira: int) -> str:
    return hmac.new(_SEGREDO_CERTIDAO.encode(), f"{nome}:{expira}".encode(), hashlib.sha256).hexdigest()


def _link_certidao(nome: str) -> str | None:
    """URL assinada e temporária para baixar a certidão. None se CNJ_MCP_URL_PUBLICA não estiver definida."""
    base = os.environ.get("CNJ_MCP_URL_PUBLICA", "").strip().rstrip("/")
    if not base:
        return None
    expira = int(time.time()) + CERTIDAO_LINK_VALIDADE_S
    return f"{base}/certidoes/{nome}?exp={expira}&sig={_assinatura_certidao(nome, expira)}"


def _verificar_link_certidao(nome: str, exp: str, sig: str) -> bool:
    if not _NOME_CERTIDAO.fullmatch(nome) or not exp.isdigit():
        return False
    if int(exp) < time.time():
        return False
    return hmac.compare_digest(sig, _assinatura_certidao(nome, int(exp)))


async def _servir_certidao(scope, send) -> None:
    from urllib.parse import parse_qs as _pq

    nome = Path(scope.get("path", "")).name
    query = _pq(scope.get("query_string", b"").decode("latin-1"))
    exp = (query.get("exp") or [""])[0]
    sig = (query.get("sig") or [""])[0]
    if not _verificar_link_certidao(nome, exp, sig):
        await _responder(send, 403, b"Link invalido ou expirado. Peca uma nova certidao.")
        return
    arquivo = CERTIDAO_DIR / nome
    if not arquivo.is_file():
        await _responder(send, 404, b"Certidao nao encontrada (talvez ja tenha sido removida).")
        return
    await _responder(send, 200, arquivo.read_bytes(), tipo="application/pdf",
                     cabecalhos_extra=[(b"content-disposition", f'attachment; filename="{nome}"'.encode())])


# --- Autenticação HTTP: um token por usuário ----------------------------------

_HOSTS_LOCAIS = {"127.0.0.1", "localhost", "::1"}
_NOME_USUARIO = re.compile(r"[a-z0-9][a-z0-9._+@-]{1,253}")
_EMAIL = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}")
_TAMANHO_MAX_FORM = 4096

MENSAGEM_CADASTRO_OK = (
    "Se o e-mail informado for válido, você receberá o seu token em instantes. "
    "O token chega somente nesse e-mail."
)
MENSAGEM_CADASTRO_LIMITADO = "Já enviamos um token há pouco. Aguarde alguns minutos antes de pedir outro."
MENSAGEM_CADASTRO_FALHA = "Não foi possível enviar o e-mail agora. Tente novamente mais tarde."
MENSAGEM_TERMOS_NECESSARIOS = "Leia e aceite os termos de uso para continuar."

# Versão dos termos. Mude o valor sempre que o texto mudar: o registro guarda a versão aceita.
TERMOS_VERSAO = "2026-10-05"
TERMOS_SECOES = [
    ("1. Natureza do serviço", [
        "O cnj-processual é uma ferramenta experimental, oferecida sem garantia de disponibilidade, "
        "precisão ou continuidade.",
        "Ela consulta APIs públicas do CNJ (DataJud e DJEN) e pode mostrar informações incompletas, "
        "desatualizadas ou diferentes dos sistemas oficiais dos tribunais.",
    ]),
    ("2. Isenção de responsabilidade", [
        "O criador e os mantenedores do serviço não se responsabilizam por prejuízos de qualquer natureza "
        "decorrentes do uso ou da impossibilidade de uso da ferramenta.",
        "Isso inclui perda de prazo, decisão tomada com base nas informações exibidas, falhas de consulta "
        "e indisponibilidade do serviço.",
    ]),
    ("3. Responsabilidade do usuário", [
        "Você é responsável pelo uso correto da ferramenta.",
        "Antes de qualquer providência, confira as informações no processo eletrônico do tribunal e no "
        "Diário de Justiça.",
        "Não use a ferramenta para fins ilícitos, para violar sigilo legal ou para sobrecarregar o serviço.",
    ]),
    ("4. Não é aconselhamento jurídico", [
        "As informações exibidas servem de apoio à consulta. Elas não substituem a análise de um "
        "profissional habilitado.",
    ]),
    ("5. Dados pessoais e sigilo", [
        "As publicações podem conter dados pessoais de partes e advogados.",
        "Trate esses dados conforme a legislação aplicável, incluindo a LGPD, e use-os apenas para a "
        "finalidade legítima da consulta.",
    ]),
    ("6. Token, limites e suspensão", [
        "O token é pessoal e intransferível. Você é responsável pela sua guarda.",
        "O uso pode sofrer limites de quantidade de requisições.",
        "O criador pode suspender ou revogar o acesso, a qualquer momento, em caso de uso indevido.",
    ]),
    ("7. Alterações", [
        "O serviço pode ser alterado, interrompido ou descontinuado a qualquer momento.",
        "Os termos podem ser atualizados. O registro guarda a versão que você aceitou.",
    ]),
    ("8. Registro do aceite", [
        "Ao aceitar, registramos a data e a versão dos termos junto ao seu e-mail, para comprovação.",
    ]),
    ("9. Lei aplicável", [
        "Estes termos são regidos pela lei brasileira.",
    ]),
]


def _mascarar_email(email: str) -> str:
    local, _, dominio = email.partition("@")
    return f"{local[:1]}***@{dominio}"


# RegistroUsuarios e RegistroMonitoramentos (SQLite, não mais arquivo JSON solto) vêm de db.py.
# Mantêm a mesma interface pública (carregar/atualizar/identificar/ativos/do_usuario) usada
# em todo este arquivo, então nenhum outro ponto do servidor precisou mudar.


class LimitadorUso:
    """Limite de uso por chave (usuário, IP ou e-mail): por minuto e por dia, em memória.

    Os limites ficam em 0 para desligar. Os contadores são por processo: com mais de uma
    instância, cada uma conta separadamente.
    """

    def __init__(self, por_minuto: int, por_dia: int, agora=time.time) -> None:
        self.por_minuto = por_minuto
        self.por_dia = por_dia
        self._agora = agora
        self._janela: dict[str, deque] = {}
        self._dia: dict[str, tuple[str, int]] = {}

    def verificar(self, chave: str) -> tuple[bool, int, str]:
        """Registra a requisição se houver cota. Devolve (permitido, segundos_ate_nova_tentativa, motivo)."""
        return self._avaliar(chave, registrar=True)

    def ocupado(self, chave: str) -> tuple[bool, int, str]:
        """Consulta sem registrar: devolve (bloqueado, segundos_ate_nova_tentativa, motivo)."""
        permitido, espera, motivo = self._avaliar(chave, registrar=False)
        return (not permitido), espera, motivo

    def _avaliar(self, chave: str, registrar: bool) -> tuple[bool, int, str]:
        agora = self._agora()

        janela = self._janela.setdefault(chave, deque())
        while janela and agora - janela[0] >= 60:
            janela.popleft()
        if self.por_minuto and len(janela) >= self.por_minuto:
            espera = math.ceil(60 - (agora - janela[0]))
            return False, max(1, espera), f"limite de {self.por_minuto} requisições por minuto"

        dia_atual = datetime.fromtimestamp(agora).date()
        dia_registrado, contagem = self._dia.get(chave, (dia_atual, 0))
        if dia_registrado != dia_atual:
            contagem = 0
        if self.por_dia and contagem >= self.por_dia:
            proxima_meia_noite = datetime.combine(dia_atual + timedelta(days=1), datetime.min.time())
            espera = math.ceil((proxima_meia_noite - datetime.fromtimestamp(agora)).total_seconds())
            return False, max(1, espera), f"limite de {self.por_dia} requisições por dia"

        if registrar:
            janela.append(agora)
            self._dia[chave] = (dia_atual, contagem + 1)
        return True, 0, ""


def _rotulo_usuario(nome: str) -> str:
    """Nome seguro para logs: e-mails são mascarados (a***@dominio), nomes simples ficam como estão."""
    return _mascarar_email(nome) if "@" in nome else nome


# --- Cadastro público: o próprio usuário pede o token pelo e-mail -----------

@dataclass
class ConfiguracaoSMTP:
    host: str
    porta: int
    usuario: str
    senha: str
    remetente: str


def _enviar_token_por_email(cfg: ConfiguracaoSMTP, destino: str, token: str) -> None:
    """Envia o token ao e-mail do próprio usuário. Porta 465 usa SSL direto; as demais usam STARTTLS."""
    mensagem = EmailMessage()
    mensagem["Subject"] = "Seu token de acesso ao cnj-processual"
    mensagem["From"] = cfg.remetente
    mensagem["To"] = destino
    mensagem.set_content(
        "Olá,\n\n"
        "Este é o seu token de acesso ao servidor cnj-processual:\n\n"
        f"{token}\n\n"
        "Anote o token agora. Ele não será mostrado novamente. Se perder, peça um novo em /cadastro,\n"
        "e o anterior deixa de valer.\n\n"
        "Use-o no cabeçalho Authorization: Bearer <token> da configuração do seu cliente MCP.\n"
        "Não compartilhe este token. Se você não pediu este e-mail, ignore-o: o token anterior\n"
        "só deixa de valer se você solicitar um novo.\n"
    )
    contexto = ssl.create_default_context()
    if cfg.porta == 465:
        with smtplib.SMTP_SSL(cfg.host, cfg.porta, context=contexto, timeout=30) as servidor:
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)
    else:
        with smtplib.SMTP(cfg.host, cfg.porta, timeout=30) as servidor:
            servidor.starttls(context=contexto)
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)


# --- Monitoramento: acompanhar processo/OAB e avisar por e-mail quando sai publicação nova -----

def _normalizar_criterio_monitoramento(
    numero_processo: str | None, sigla_tribunal: str | None, numero_oab: str | None, uf_oab: str | None,
    nome: str | None = None,
) -> tuple[dict | None, dict | None]:
    """Mesma validação de consultar_publicacoes_djen. Devolve (criterio, None) ou (None, erro)."""
    numero = _so_digitos(numero_processo) if numero_processo else None
    if numero_processo and len(numero) != 20:
        return None, _erro(f"Número de processo inválido: esperados 20 dígitos, recebidos {len(numero)}.")

    oab = (numero_oab or "").strip() or None
    if not numero and not oab:
        return None, _erro("Informe ao menos um entre numero_processo e numero_oab.")

    uf = (uf_oab or "").strip().upper() or None
    if uf and not re.fullmatch(r"[A-Z]{2}", uf):
        return None, _erro("uf_oab inválida: use 2 letras, ex: 'SP'.")

    sigla = (sigla_tribunal or "").strip().upper() or None
    # "nome" é só um rótulo (ex.: o advogado/parte da OAB pesquisada), usado para identificar o
    # monitoramento na aba "Publicações por OAB" - não entra na busca ao DJEN.
    rotulo = (nome or "").strip() or None
    criterio = {k: v for k, v in {
        "numero_processo": numero, "sigla_tribunal": sigla, "numero_oab": oab, "uf_oab": uf, "nome": rotulo,
    }.items() if v is not None}
    return criterio, None


def _criar_monitoramento(
    registro: RegistroMonitoramentos, usuario: str, numero_processo: str | None, sigla_tribunal: str | None,
    numero_oab: str | None, uf_oab: str | None, agora, nome: str | None = None,
) -> dict:
    if "@" not in (usuario or ""):
        return _erro("Monitoramento exige um usuário com e-mail cadastrado.")

    criterio, erro = _normalizar_criterio_monitoramento(numero_processo, sigla_tribunal, numero_oab, uf_oab, nome)
    if erro:
        return erro

    if len(registro.do_usuario(usuario)) >= MONITORAMENTO_MAX_POR_USUARIO:
        return _erro(f"Limite de {MONITORAMENTO_MAX_POR_USUARIO} monitoramentos por usuário atingido.")

    agora_dt = agora()
    novo_id = secrets.token_hex(8)
    registro_novo = {
        "usuario": usuario,
        "criterio": criterio,
        "criado_em": agora_dt.isoformat(),
        "hashes_notificados": [],
        "expira_em": (agora_dt + timedelta(days=MONITORAMENTO_EXPIRACAO_DIAS)).isoformat(),
    }
    registro.atualizar(lambda dados: dados.update({novo_id: registro_novo}))
    return {"id": novo_id, **registro_novo}


def _listar_monitoramentos(registro: RegistroMonitoramentos, usuario: str) -> dict:
    itens = [
        {"id": i, **{k: v for k, v in m.items() if k != "hashes_notificados"}}
        for i, m in registro.do_usuario(usuario).items()
    ]
    itens.sort(key=lambda m: m["criado_em"])
    return {"monitoramentos": itens}


def _remover_monitoramento(registro: RegistroMonitoramentos, usuario: str, id_monitoramento: str) -> dict:
    encontrado = {"ok": False}

    def alterar(dados: dict):
        atual = dados.get(id_monitoramento)
        if atual is None or atual.get("usuario") != usuario:
            return False
        del dados[id_monitoramento]
        encontrado["ok"] = True

    registro.atualizar(alterar)
    if not encontrado["ok"]:
        return _erro("Monitoramento não encontrado.")
    return {"removido": True}


def _enviar_aviso_monitoramento(cfg: ConfiguracaoSMTP, destino: str, criterio: dict, itens: list[dict]) -> None:
    """E-mail de resumo (não o texto completo) avisando sobre publicações novas de um Monitoramento."""
    descricao = criterio.get("numero_processo") or f"OAB {criterio.get('numero_oab')}/{criterio.get('uf_oab') or '?'}"
    url_base = os.environ.get("CNJ_MCP_URL_PUBLICA", "").strip().rstrip("/")
    link = f"{url_base}/app" if url_base else "/app"

    linhas = ["Olá,", "", f"Encontramos {len(itens)} publicação(ões) nova(s) para {descricao}:", ""]
    for item in itens[:10]:
        rotulo = item.get("tipoComunicacao") or item.get("tipoDocumento") or "Publicação"
        linhas.append(f"- {item.get('data_disponibilizacao', '?')} · {item.get('siglaTribunal', '?')} · {rotulo}")
    linhas += [
        "", f"Veja os detalhes completos em: {link}", "",
        'Para parar de receber estes avisos, remova o monitoramento em "Meus monitoramentos".',
    ]

    mensagem = EmailMessage()
    mensagem["Subject"] = f"cnj-processual: {len(itens)} publicação(ões) nova(s) para {descricao}"
    mensagem["From"] = cfg.remetente
    mensagem["To"] = destino
    mensagem.set_content("\n".join(linhas))

    contexto = ssl.create_default_context()
    if cfg.porta == 465:
        with smtplib.SMTP_SSL(cfg.host, cfg.porta, context=contexto, timeout=30) as servidor:
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)
    else:
        with smtplib.SMTP(cfg.host, cfg.porta, timeout=30) as servidor:
            servidor.starttls(context=contexto)
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)


def _enviar_aviso_expiracao(cfg: ConfiguracaoSMTP, destino: str, criterio: dict, dias_restantes: int) -> None:
    """E-mail avisando que o monitoramento expirará em breve."""
    descricao = criterio.get("numero_processo") or f"OAB {criterio.get('numero_oab')}/{criterio.get('uf_oab') or '?'}"
    url_base = os.environ.get("CNJ_MCP_URL_PUBLICA", "").strip().rstrip("/")
    link = f"{url_base}/app" if url_base else "/app"

    mensagem = EmailMessage()
    mensagem["Subject"] = f"cnj-processual: monitoramento de {descricao} expira em {dias_restantes} dia(s)"
    mensagem["From"] = cfg.remetente
    mensagem["To"] = destino
    mensagem.set_content(
        f"Olá,\n\n"
        f"O seu monitoramento de {descricao} expirará em {dias_restantes} dia(s).\n\n"
        f"Para renová-lo, acesse: {link}\n\n"
        'Caso não queira mais receber estes avisos, remova o monitoramento em "Meus monitoramentos".\n'
    )
    contexto = ssl.create_default_context()
    if cfg.porta == 465:
        with smtplib.SMTP_SSL(cfg.host, cfg.porta, context=contexto, timeout=30) as servidor:
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)
    else:
        with smtplib.SMTP(cfg.host, cfg.porta, timeout=30) as servidor:
            servidor.starttls(context=contexto)
            servidor.login(cfg.usuario, cfg.senha)
            servidor.send_message(mensagem)


def _atualizar_apos_aviso(dados: dict, id_monitoramento: str, hashes: list[str], expira_em: str):
    if id_monitoramento not in dados:
        return False
    dados[id_monitoramento]["hashes_notificados"] = hashes
    dados[id_monitoramento]["expira_em"] = expira_em


def _marcar_aviso_expiracao(dados: dict, id_monitoramento: str, agora_iso: str):
    if id_monitoramento not in dados:
        return False
    dados[id_monitoramento]["ultimo_aviso_expiracao"] = agora_iso


def _calcular_proxima_tentativa(id_monitoramento: str) -> float:
    """Devolve o timestamp unix da próxima tentativa com backoff exponencial (6h→12h→24h→48h)."""
    falhas = _FALHAS_MONITORAMENTO.get(id_monitoramento, 0) + 1
    _FALHAS_MONITORAMENTO[id_monitoramento] = falhas
    horas = min(MONITORAMENTO_INTERVALO_HORAS * (2 ** (falhas - 1)), MONITORAMENTO_BACKOFF_MAX_HORAS)
    proximo = time.time() + horas * 3600
    _PROXIMA_TENTATIVA_MONITORAMENTO[id_monitoramento] = proximo
    log.info("Monitoramento %s: backoff %dh (falha %d)", id_monitoramento, int(horas), falhas)
    return proximo


async def _verificar_um_monitoramento(
    registro: RegistroMonitoramentos, id_monitoramento: str, monitoramento: dict, enviar_fn, agora_dt,
    gestao: "RegistroClientesCasos | None" = None,
    smtp: "ConfiguracaoSMTP | None" = None,
) -> None:
    # Backoff: se ainda está na janela de espera, pula este ciclo.
    proxima = _PROXIMA_TENTATIVA_MONITORAMENTO.get(id_monitoramento, 0.0)
    if time.time() < proxima:
        log.debug("Monitoramento %s: backoff ativo, pulando ciclo", id_monitoramento)
        return

    criterio = monitoramento.get("criterio") or {}
    params = {
        "numeroProcesso": criterio.get("numero_processo"),
        "siglaTribunal": criterio.get("sigla_tribunal"),
        "numeroOab": criterio.get("numero_oab"),
        "ufOab": criterio.get("uf_oab"),
        "pagina": 1,
        "itensPorPagina": 20,
    }
    params = {k: v for k, v in params.items() if v is not None}

    resposta = await _djen_get_com_retry(DJEN_BASE_URL, params=params)
    if isinstance(resposta, dict):
        # instabilidade transitória do DJEN: aplica backoff e tenta de novo no próximo ciclo
        log.warning("Monitoramento %s: DJEN indisponível neste ciclo (%s)", id_monitoramento, resposta.get("mensagem"))
        _calcular_proxima_tentativa(id_monitoramento)
        return

    dados_resp, erro_json = _json_da_resposta(resposta)
    if erro_json or not isinstance(dados_resp, dict):
        log.warning("Monitoramento %s: resposta inesperada do DJEN", id_monitoramento)
        _calcular_proxima_tentativa(id_monitoramento)
        return

    # Sucesso: limpa estado de backoff.
    _FALHAS_MONITORAMENTO.pop(id_monitoramento, None)
    _PROXIMA_TENTATIVA_MONITORAMENTO.pop(id_monitoramento, None)

    itens = [_extrair_publicacao_djen(item) for item in dados_resp.get("items") or []]
    hashes_vistos = set(monitoramento.get("hashes_notificados") or [])
    novos = [item for item in itens if item.get("hash") and item["hash"] not in hashes_vistos]

    if novos:
        try:
            await asyncio.to_thread(enviar_fn, monitoramento["usuario"], criterio, novos)
        except Exception:
            log.exception("Monitoramento %s: falha ao enviar e-mail de aviso", id_monitoramento)
            return  # tenta de novo no próximo ciclo; não marca como notificado

        hashes_atualizados = list(hashes_vistos | {item["hash"] for item in novos})
        hashes_atualizados = hashes_atualizados[-MONITORAMENTO_MAX_HASHES_LEMBRADOS:]
        nova_expiracao = (agora_dt + timedelta(days=MONITORAMENTO_EXPIRACAO_DIAS)).isoformat()
        registro.atualizar(lambda d: _atualizar_apos_aviso(d, id_monitoramento, hashes_atualizados, nova_expiracao))

        if gestao is not None:
            # Fase 2: além do aviso por e-mail, alimenta a linha do tempo de cada caso cadastrado
            # que já inclui o processo da publicação. Fase 3: se o monitoramento é por OAB (não
            # por número de processo específico) e o processo da publicação ainda não tem caso
            # nenhum, enfileira para triagem manual (nunca cria caso sozinho - ver Q10).
            eh_monitoramento_por_oab = bool(criterio.get("numero_oab"))
            for item in novos:
                numero = _so_digitos(item.get("numeroprocessocommascara"))
                if len(numero) != 20:
                    continue
                try:
                    casos_ligados = gestao.registrar_evento(numero, "publicacao", item, lambda: agora_dt)
                    if not casos_ligados and eh_monitoramento_por_oab:
                        gestao.registrar_pendente(numero, monitoramento["usuario"], item, lambda: agora_dt)
                except Exception:
                    log.exception("Monitoramento %s: falha ao gravar evento/pendência do caso", id_monitoramento)
        return

    expira_em = monitoramento.get("expira_em")
    if expira_em and datetime.fromisoformat(expira_em) <= agora_dt:
        registro.atualizar(lambda d: d.pop(id_monitoramento, None) if id_monitoramento in d else False)
        return

    # Aviso de expiração próxima: envia e-mail uma única vez quando restam <= 30 dias.
    if smtp is not None and expira_em:
        dias_restantes = (datetime.fromisoformat(expira_em) - agora_dt).days
        if 0 < dias_restantes <= MONITORAMENTO_AVISO_EXPIRACAO_DIAS:
            ultimo_aviso = monitoramento.get("ultimo_aviso_expiracao")
            if ultimo_aviso is None or (agora_dt - datetime.fromisoformat(ultimo_aviso)).days >= 7:
                try:
                    await asyncio.to_thread(
                        _enviar_aviso_expiracao, smtp, monitoramento["usuario"], criterio, dias_restantes,
                    )
                    agora_iso = agora_dt.isoformat()
                    registro.atualizar(lambda d: _marcar_aviso_expiracao(d, id_monitoramento, agora_iso))
                except Exception:
                    log.exception("Monitoramento %s: falha ao enviar aviso de expiração", id_monitoramento)


# --- Captura de publicações por OAB a cada 24h (aba "Publicações por OAB") -------------------
#
# Separada do ciclo de 6h acima (que manda e-mail): essa captura só alimenta o log geral da aba,
# sem mandar aviso nenhum. Pega TODO monitoramento por OAB (ignora os por número de processo
# específico - esses já têm sua própria linha do tempo via caso_eventos) e grava cada publicação
# achada (dedupe por hash, ver RegistroPublicacoesOAB.registrar). Publicação de processo que já
# tem caso cadastrado entra direto como "tratada" (Q11).

def _registrar_itens_capturados(
    itens_brutos: list[dict], monitoramento_id: str | None, nome_pesquisado: str | None,
    publicacoes: "RegistroPublicacoesOAB", gestao: "RegistroClientesCasos", agora,
) -> int:
    """Extrai e grava cada item do DJEN no log de publicações por OAB (dedupe por hash via
    RegistroPublicacoesOAB.registrar). Devolve quantas eram novas (não estavam capturadas ainda).
    Usado tanto pela captura automática de 24h quanto pela captura manual (data/OAB na hora)."""
    novas = 0
    for bruto in itens_brutos:
        item = _extrair_publicacao_djen(bruto)
        hash_publicacao = item.get("hash")
        if not hash_publicacao:
            continue
        numero = _so_digitos(item.get("numeroprocessocommascara"))
        numero = numero if len(numero) == 20 else None
        casos_ligados = gestao.casos_do_processo(numero) if numero else []
        status_inicial = "tratada" if casos_ligados else "nao_tratada"
        inseriu = publicacoes.registrar(
            hash_publicacao, monitoramento_id, nome_pesquisado, numero, item,
            status_inicial, casos_ligados[0] if casos_ligados else None, agora,
        )
        if inseriu:
            novas += 1
    return novas


async def _capturar_um_monitoramento_oab(
    id_monitoramento: str, criterio: dict, publicacoes: "RegistroPublicacoesOAB",
    gestao: "RegistroClientesCasos", agora,
) -> None:
    params = {k: v for k, v in {
        "numeroOab": criterio.get("numero_oab"), "ufOab": criterio.get("uf_oab"),
        "siglaTribunal": criterio.get("sigla_tribunal"), "pagina": 1, "itensPorPagina": 50,
    }.items() if v is not None}

    resposta = await _djen_get_com_retry(DJEN_BASE_URL, params=params)
    if isinstance(resposta, dict):
        log.warning("Captura 24h (OAB) %s: DJEN indisponível neste ciclo (%s)", id_monitoramento, resposta.get("mensagem"))
        return
    dados_resp, erro_json = _json_da_resposta(resposta)
    if erro_json or not isinstance(dados_resp, dict):
        log.warning("Captura 24h (OAB) %s: resposta inesperada do DJEN", id_monitoramento)
        return

    _registrar_itens_capturados(
        dados_resp.get("items") or [], id_monitoramento, criterio.get("nome"), publicacoes, gestao, agora,
    )


async def _capturar_publicacoes_oab(
    registro: RegistroMonitoramentos, publicacoes: "RegistroPublicacoesOAB", gestao: "RegistroClientesCasos",
    agora=lambda: datetime.now(timezone.utc),
) -> None:
    """Confere todo monitoramento por OAB e grava as publicações achadas no log da aba. Chamada
    pelo job do APScheduler a cada 24h; os testes chamam direto, com um relógio injetado."""
    if not _CIRCUIT_DJEN.pode_tentar():
        log.warning("CircuitBreaker DJEN: aberto — ciclo de captura OAB ignorado (cooldown ativo)")
        return
    sonda = await _djen_get_com_retry(DJEN_BASE_URL, params={"pagina": 1, "itensPorPagina": 1})
    if isinstance(sonda, dict):
        log.warning("CircuitBreaker DJEN: API indisponível na sonda — ciclo de captura OAB ignorado")
        return
    async def _capturar_com_sem(id_mon: str, criterio: dict) -> None:
        async with _SEM_MONITORAMENTO:
            try:
                await _capturar_um_monitoramento_oab(id_mon, criterio, publicacoes, gestao, agora)
            except Exception:
                log.exception("Captura 24h (OAB): falha no monitoramento %s", id_mon)

    await asyncio.gather(*[
        _capturar_com_sem(id_mon, mon.get("criterio") or {})
        for id_mon, mon in list(registro.carregar().items())
        if (mon.get("criterio") or {}).get("numero_oab")
    ])


async def _capturar_publicacoes_oab_manual(
    publicacoes: "RegistroPublicacoesOAB", gestao: "RegistroClientesCasos", dados: dict,
    agora=lambda: datetime.now(timezone.utc),
) -> tuple[dict | None, dict | None]:
    """Captura avulsa, disparada na hora pela pessoa (sem precisar de um monitoramento salvo):
    OAB + intervalo de datas obrigatórios. Mesma gravação/dedupe da captura automática de 24h -
    uma publicação já capturada antes (mesmo hash) não duplica. Devolve (resultado, None) ou
    (None, erro)."""
    numero_oab = (dados.get("numero_oab") or "").strip()
    if not numero_oab:
        return None, _erro("Informe numero_oab.")
    uf_oab = (dados.get("uf_oab") or "").strip().upper() or None
    if uf_oab and not re.fullmatch(r"[A-Z]{2}", uf_oab):
        return None, _erro("uf_oab inválida: use 2 letras, ex: 'SP'.")
    sigla_tribunal = (dados.get("sigla_tribunal") or "").strip().upper() or None
    data_inicio = (dados.get("data_inicio") or "").strip() or None
    data_fim = (dados.get("data_fim") or "").strip() or None
    if not data_inicio or not data_fim:
        return None, _erro("Informe data_inicio e data_fim (AAAA-MM-DD).")
    for rotulo, valor in (("data_inicio", data_inicio), ("data_fim", data_fim)):
        erro_data = _validar_data(rotulo, valor)
        if erro_data:
            return None, _erro(erro_data)
    if datetime.strptime(data_inicio, _FORMATO_DATA) > datetime.strptime(data_fim, _FORMATO_DATA):
        return None, _erro("data_inicio não pode ser posterior a data_fim.")
    nome = (dados.get("nome") or "").strip() or None

    params = {k: v for k, v in {
        "numeroOab": numero_oab, "ufOab": uf_oab, "siglaTribunal": sigla_tribunal,
        "dataDisponibilizacaoInicio": data_inicio, "dataDisponibilizacaoFim": data_fim,
        "pagina": 1, "itensPorPagina": 100,
    }.items() if v is not None}

    resposta = await _djen_get_com_retry(DJEN_BASE_URL, params=params)
    if isinstance(resposta, dict):
        return None, resposta  # já no formato de erro (_erro ou equivalente)
    dados_resp, erro_json = _json_da_resposta(resposta)
    if erro_json:
        return None, erro_json
    if not isinstance(dados_resp, dict):
        return None, _erro("Resposta inesperada da API do DJEN (não é um objeto JSON).")

    itens_brutos = dados_resp.get("items") or []
    novas = _registrar_itens_capturados(itens_brutos, None, nome, publicacoes, gestao, agora)
    return {"encontradas": len(itens_brutos), "novas": novas}, None


async def _verificar_monitoramentos_pendentes(
    registro: RegistroMonitoramentos, smtp: ConfiguracaoSMTP | None, agora=datetime.now, enviar=None,
    gestao: "RegistroClientesCasos | None" = None,
) -> None:
    """Confere todos os Monitoramentos ativos e avisa por e-mail quem tiver publicação nova.
    Chamada pelo job do APScheduler a cada MONITORAMENTO_INTERVALO_HORAS; os testes chamam direto,
    com um relógio e um 'enviar' injetados."""
    if smtp is None:
        return
    if not _CIRCUIT_DJEN.pode_tentar():
        log.warning("CircuitBreaker DJEN: aberto — ciclo de verificação de monitoramentos ignorado (cooldown ativo)")
        return
    sonda = await _djen_get_com_retry(DJEN_BASE_URL, params={"pagina": 1, "itensPorPagina": 1})
    if isinstance(sonda, dict):
        log.warning("CircuitBreaker DJEN: API indisponível na sonda — ciclo de verificação de monitoramentos ignorado")
        return
    enviar_fn = enviar or (lambda destino, criterio, itens: _enviar_aviso_monitoramento(smtp, destino, criterio, itens))
    agora_dt = agora()

    async def _verificar_com_sem(id_mon: str, mon: dict) -> None:
        async with _SEM_MONITORAMENTO:
            try:
                await _verificar_um_monitoramento(registro, id_mon, mon, enviar_fn, agora_dt, gestao, smtp)
            except Exception:
                log.exception("Falha ao verificar monitoramento %s", id_mon)

    await asyncio.gather(*[
        _verificar_com_sem(id_mon, mon)
        for id_mon, mon in list(registro.carregar().items())
    ])


# --- Sincronização periódica do Google Calendar (Fase 4: metade "Calendar -> sistema" do ------
# sincronismo bidirecional; a outra metade, "sistema -> Calendar", é a criação do evento em
# POST /casos/<id>/evento-calendar). Eventos sem a marca cnj_caso_id em extendedProperties.private
# (criados direto na agenda, sem relação com nenhum caso) são ignorados - a API do Google já
# filtra a maior parte disso via sharedExtendedProperty, ver google_integracao.listar_eventos_de_casos.

async def _sincronizar_calendar_google(
    registro_google: "RegistroIntegracaoGoogle", gestao: "RegistroClientesCasos",
    client_id: str, client_secret: str, cliente_http: httpx.AsyncClient, agora=lambda: datetime.now(timezone.utc),
) -> None:
    conexao = registro_google.obter_conexao()
    if not conexao:
        return
    access_token = await google_integracao.obter_access_token(cliente_http, client_id, client_secret, conexao["refresh_token"])
    sync_token = conexao.get("sync_token_calendar")
    eventos, novo_sync_token = await google_integracao.listar_eventos_de_casos(cliente_http, access_token, sync_token)
    if sync_token and not novo_sync_token:
        # sync_token expirado (HTTP 410 do Google): a API manda refazer a sincronização do zero
        eventos, novo_sync_token = await google_integracao.listar_eventos_de_casos(cliente_http, access_token, None)

    for evento in eventos:
        caso_id = ((evento.get("extendedProperties") or {}).get("private") or {}).get("cnj_caso_id")
        if not caso_id:
            continue
        evento_id = evento.get("id")
        status = evento.get("status")
        nova_data = (evento.get("start") or {}).get("date") or (evento.get("start") or {}).get("dateTime")
        anterior = gestao.obter_evento_calendar(caso_id, evento_id)

        if status == "cancelled":
            if anterior and anterior.get("status") != "cancelled":
                gestao.registrar_evento_no_caso(
                    caso_id, None, "evento_agenda_alterado",
                    {"evento_id": evento_id, "status": "cancelled"}, agora,
                )
            continue

        if not anterior or anterior.get("data") != nova_data:
            gestao.registrar_evento_no_caso(
                caso_id, None, "evento_agenda_alterado",
                {"evento_id": evento_id, "data": nova_data, "titulo": evento.get("summary"), "status": status}, agora,
            )

    if novo_sync_token:
        registro_google.salvar_sync_token_calendar(novo_sync_token)


async def _sincronizar_calendar_google_job(
    registro_google: "RegistroIntegracaoGoogle", gestao: "RegistroClientesCasos", client_id: str, client_secret: str,
) -> None:
    """Wrapper chamado pelo APScheduler: abre sua própria conexão HTTP (o job não recebe uma
    injetada, diferente de _sincronizar_calendar_google, que os testes chamam direto com mock)."""
    try:
        async with _cliente(20) as http_cliente:
            await _sincronizar_calendar_google(registro_google, gestao, client_id, client_secret, http_cliente)
    except Exception:
        log.exception("Falha na sincronização periódica do Google Calendar")


@dataclass
class _EstadoMonitoramento:
    """Estado compartilhado que as tools de Monitoramento leem. Só existe em modo HTTP: em modo
    stdio não há usuário autenticado nem SMTP, então _ESTADO_MONITORAMENTO fica None."""
    registro_usuarios: RegistroUsuarios
    oauth: "ServidorOAuth | None"
    registro_monitoramentos: RegistroMonitoramentos
    smtp: ConfiguracaoSMTP | None


_ESTADO_MONITORAMENTO: "_EstadoMonitoramento | None" = None


def _usuario_da_requisicao(ctx: Context) -> str | None:
    """Identifica o usuário autenticado dentro de uma tool, reaproveitando o Bearer token da
    requisição HTTP (mesma extração que _AutenticacaoBearer já faz). Em modo stdio não há
    requisição HTTP, então devolve None."""
    estado = _ESTADO_MONITORAMENTO
    if estado is None:
        return None
    request = getattr(ctx.request_context, "request", None)
    if request is None:
        return None
    autorizacao = request.headers.get("authorization", "")
    token = autorizacao[len("Bearer "):] if autorizacao.startswith("Bearer ") else ""
    if not token:
        return None
    usuario = estado.registro_usuarios.identificar(token)
    if usuario is None and estado.oauth is not None:
        usuario = estado.oauth.identificar(token)
    return usuario


def _estado_e_usuario_ou_erro(ctx: Context, exigir_smtp: bool = False) -> "tuple[_EstadoMonitoramento, str] | dict":
    """Guarda comum das 3 tools de Monitoramento: confere se o recurso está disponível (modo HTTP,
    com e-mail quando exigir_smtp) e identifica o usuário autenticado. Devolve (estado, usuario) em
    caso de sucesso, ou um dicionário de erro já pronto para a tool devolver direto."""
    estado = _ESTADO_MONITORAMENTO
    if estado is None or (exigir_smtp and estado.smtp is None):
        mensagem = "Monitoramento só está disponível no servidor hospedado"
        mensagem += ", com e-mail configurado." if exigir_smtp else "."
        return _erro(mensagem)
    usuario = _usuario_da_requisicao(ctx)
    if usuario is None:
        return _erro("Não foi possível identificar o usuário autenticado.")
    return estado, usuario


@mcp.tool()
async def monitorar_publicacoes(
    ctx: Context,
    numero_processo: str | None = None,
    sigla_tribunal: str | None = None,
    numero_oab: str | None = None,
    uf_oab: str | None = None,
    nome: str | None = None,
) -> dict:
    """Cria um Monitoramento: acompanha um processo e/ou uma OAB e avisa por e-mail (resumo + link
    para o painel) quando sair uma publicação nova no DJEN, verificado a cada 6 horas. Monitoramentos
    por OAB também alimentam a aba "Publicações por OAB" do painel, capturada a cada 24h.

    Parâmetros (ao menos um entre numero_processo e numero_oab): os mesmos de
    consultar_publicacoes_djen (numero_processo, sigla_tribunal, numero_oab, uf_oab), mais um
    `nome` opcional (ex.: o advogado ou parte dono da OAB) só para identificar o monitoramento
    nas telas - não entra na busca em si.

    Limitações:
    - Só funciona no servidor hospedado (modo HTTP, autenticado e com e-mail configurado); em uso
      local (stdio) esta tool devolve erro.
    - Limite de 5 monitoramentos ativos por usuário.
    - Expira automaticamente após 180 dias sem nenhuma publicação nova (o prazo é renovado a cada
      publicação encontrada).
    """
    resultado = _estado_e_usuario_ou_erro(ctx, exigir_smtp=True)
    if isinstance(resultado, dict):
        return resultado
    estado, usuario = resultado
    return _criar_monitoramento(
        estado.registro_monitoramentos, usuario, numero_processo, sigla_tribunal, numero_oab, uf_oab,
        datetime.now, nome,
    )


@mcp.tool()
async def listar_monitoramentos(ctx: Context) -> dict:
    """Lista os Monitoramentos ativos do usuário autenticado.

    Retorno: dicionário com "monitoramentos", uma lista de itens com id, criterio, criado_em e
    expira_em. O id pode ser passado a remover_monitoramento.
    """
    resultado = _estado_e_usuario_ou_erro(ctx)
    if isinstance(resultado, dict):
        return resultado
    estado, usuario = resultado
    return _listar_monitoramentos(estado.registro_monitoramentos, usuario)


@mcp.tool()
async def remover_monitoramento(ctx: Context, id: str) -> dict:
    """Remove um Monitoramento do usuário autenticado.

    Parâmetro:
    - id: valor do campo "id" devolvido por listar_monitoramentos ou por monitorar_publicacoes.
    """
    resultado = _estado_e_usuario_ou_erro(ctx)
    if isinstance(resultado, dict):
        return resultado
    estado, usuario = resultado
    return _remover_monitoramento(estado.registro_monitoramentos, usuario, id)


MENSAGEM_CAPTCHA_FALHA = "Confirme que você não é um robô e tente de novo."


class VerificadorRecaptcha:
    """Valida no Google o resultado do reCAPTCHA. Em caso de falha de rede, recusa (fecha por padrão)."""

    URL_VERIFICACAO = "https://www.google.com/recaptcha/api/siteverify"

    def __init__(self, segredo: str, hostname_esperado: str | None = None) -> None:
        self._segredo = segredo
        # o Google informa o domínio onde o captcha foi resolvido; confere-se que é o do serviço
        self._hostname = hostname_esperado

    async def validar(self, resposta: str, ip: str) -> bool:
        if not resposta:
            return False
        try:
            async with httpx.AsyncClient(timeout=10, transport=_TRANSPORTE_HTTP) as cliente:
                r = await cliente.post(self.URL_VERIFICACAO,
                                       data={"secret": self._segredo, "response": resposta, "remoteip": ip})
            dados = r.json()
            if not dados.get("success"):
                return False
            if self._hostname and dados.get("hostname") != self._hostname:
                log.warning("reCAPTCHA emitido para outro domínio (%s); cadastro recusado", dados.get("hostname"))
                return False
            return True
        except (httpx.HTTPError, ValueError):
            log.exception("Falha ao validar o reCAPTCHA; cadastro recusado por segurança")
            return False


class CadastroPublico:
    """Emite um token para o e-mail informado e o envia por e-mail. A página nunca mostra o token.

    Regras:
    - A resposta é a mesma para qualquer e-mail válido, então não revela quem já tem acesso.
    - Pedir de novo gera um token novo e invalida o anterior (é o caminho para quem perdeu o token).
    - Um usuário revogado pelo administrador não recebe token novo por este caminho.
    - Limites por IP e por e-mail impedem o uso do servidor para enviar spam.
    """

    def __init__(self, registro: RegistroUsuarios, cfg: ConfiguracaoSMTP,
                 limitador_ip: LimitadorUso, limitador_email: LimitadorUso,
                 enviar=None) -> None:
        self.registro = registro
        self.cfg = cfg
        self.limitador_ip = limitador_ip
        self.limitador_email = limitador_email
        self._enviar = enviar or (lambda destino, token: _enviar_token_por_email(cfg, destino, token))

    async def solicitar(self, email_bruto: str, ip: str, aceite_termos: bool = False) -> str:
        if not aceite_termos:
            return MENSAGEM_TERMOS_NECESSARIOS
        email = (email_bruto or "").strip().lower()
        if len(email) > 254 or not _EMAIL.fullmatch(email):
            return "Informe um e-mail válido."

        permitido_ip, _, _ = self.limitador_ip.verificar(ip)
        permitido_email, _, _ = self.limitador_email.verificar(email)
        if not (permitido_ip and permitido_email):
            log.warning("Pedido de token limitado (ip=%s, e-mail=%s)", ip, _mascarar_email(email))
            return MENSAGEM_CADASTRO_LIMITADO

        dados = self.registro.carregar()
        existente = dados.get(email, {})
        if existente.get("revogado") and existente.get("revogado_por") == "admin":
            log.warning("Pedido de token recusado: acesso de %s revogado pelo administrador", _mascarar_email(email))
            return MENSAGEM_CADASTRO_OK  # mesma resposta: não revela o bloqueio

        token = secrets.token_urlsafe(32)
        try:
            await asyncio.to_thread(self._enviar, email, token)
        except Exception:
            log.exception("Falha ao enviar o token por e-mail para %s", _mascarar_email(email))
            return MENSAGEM_CADASTRO_FALHA

        # Só grava depois do envio: se o e-mail falhar, o token antigo continua valendo.
        # A gravação lê o registro de novo e não reativa um e-mail revogado pelo administrador
        # enquanto o envio acontecia.
        gravado = {"ok": False}

        def gravar(dados_atuais: dict):
            atual = dados_atuais.get(email, {})
            if atual.get("revogado") and atual.get("revogado_por") == "admin":
                return False
            agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
            dados_atuais[email] = {
                "hash": _hash_token(token),
                "criado_em": agora,
                "revogado": False,
                "origem": "cadastro",
                "termos": {"versao": TERMOS_VERSAO, "aceito_em": agora},
            }
            gravado["ok"] = True

        self.registro.atualizar(gravar)
        if not gravado["ok"]:
            log.warning("Token não gravado: acesso de %s foi revogado durante o envio", _mascarar_email(email))
            return MENSAGEM_CADASTRO_OK  # mesma resposta: não revela o motivo
        log.info("Token emitido por cadastro público para %s", _mascarar_email(email))
        return MENSAGEM_CADASTRO_OK


# --- Middleware HTTP ---------------------------------------------------------

# --- OAuth 2.1 (PKCE) para conectores personalizados do Claude ---------------

_HOSTS_REDIRECT_CLAUDE = {"claude.ai", "claude.com"}
_HOSTS_REDIRECT_LOCAIS = {"localhost", "127.0.0.1"}


def _redirect_permitido(uri: str) -> bool:
    """Aceita só o callback do Claude (https) e callbacks locais (usados pelo Claude Code)."""
    from urllib.parse import urlsplit

    partes = urlsplit(uri)
    if partes.scheme == "https" and partes.hostname in _HOSTS_REDIRECT_CLAUDE:
        return True
    return partes.scheme == "http" and partes.hostname in _HOSTS_REDIRECT_LOCAIS


def _s256(verificador: str) -> str:
    import base64

    digest = hashlib.sha256(verificador.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


class ServidorOAuth:
    """Authorization server mínimo para o conector do Claude.

    Fluxo: o Claude registra um cliente (/oauth/register), abre /oauth/authorize, e a pessoa
    cola o próprio token do cnj-processual (recebido por e-mail ou entregue pelo administrador).
    O servidor devolve um código de uso único (5 min), que o Claude troca em /oauth/token por um
    access token com validade de 30 dias. A troca exige PKCE (S256).

    Access tokens ficam guardados só pelo hash, em oauth.json. Revogar o usuário invalida também
    os access tokens dele.
    """

    CODIGO_VALIDADE_S = 300
    TOKEN_VALIDADE_S = 30 * 86400

    def __init__(self, registro: RegistroUsuarios, caminho: Path, agora=time.time,
                 limitador_registro: "LimitadorUso | None" = None) -> None:
        self.limitador_registro = limitador_registro
        self.registro = registro
        self.caminho = caminho
        self._agora = agora
        self._codigos: dict[str, dict] = {}

    # --- armazenamento -------------------------------------------------------

    def _carregar(self) -> dict:
        if not self.caminho.exists():
            return {"clientes": {}, "tokens": {}}
        dados = json.loads(self.caminho.read_text(encoding="utf-8") or "{}")
        dados.setdefault("clientes", {})
        dados.setdefault("tokens", {})
        return dados

    def _salvar(self, dados: dict) -> None:
        self.caminho.parent.mkdir(parents=True, exist_ok=True)
        temporario = self.caminho.with_suffix(".tmp")
        temporario.write_text(json.dumps(dados, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(temporario, self.caminho)

    # --- clientes ------------------------------------------------------------

    MAX_CLIENTES = 500
    PRAZO_CLIENTE_NAO_USADO_S = 30 * 86400

    def registrar_cliente(self, redirect_uris: list[str], nome: str) -> str | None:
        if not redirect_uris or not all(_redirect_permitido(u) for u in redirect_uris):
            return None
        client_id = secrets.token_urlsafe(16)
        dados = self._carregar()
        agora = self._agora()
        # remove clientes que nunca chegaram a gerar token e estão parados há mais do que o prazo
        dados["clientes"] = {
            cid: c for cid, c in dados["clientes"].items()
            if c.get("usado") or agora - c.get("criado_em", agora) < self.PRAZO_CLIENTE_NAO_USADO_S
        }
        if len(dados["clientes"]) >= self.MAX_CLIENTES:
            return None  # teto atingido: o registro é recusado até que clientes antigos sejam limpos
        dados["clientes"][client_id] = {
            "redirect_uris": redirect_uris, "nome": nome[:100], "criado_em": agora, "usado": False,
        }
        self._salvar(dados)
        return client_id

    def cliente_valido(self, client_id: str, redirect_uri: str) -> bool:
        cliente = self._carregar()["clientes"].get(client_id)
        return bool(cliente) and redirect_uri in cliente["redirect_uris"]

    # --- códigos e tokens ----------------------------------------------------

    def emitir_codigo(self, client_id: str, redirect_uri: str, desafio: str, usuario: str) -> str:
        codigo = secrets.token_urlsafe(32)
        self._codigos[_hash_token(codigo)] = {
            "client_id": client_id, "redirect_uri": redirect_uri, "desafio": desafio,
            "usuario": usuario, "expira_em": self._agora() + self.CODIGO_VALIDADE_S,
        }
        return codigo

    def trocar_codigo(self, codigo: str, client_id: str, redirect_uri: str, verificador: str) -> str | None:
        """Devolve o access token, ou None se o código, o cliente, o redirect ou o PKCE não baterem."""
        registro = self._codigos.pop(_hash_token(codigo), None)  # uso único
        if not registro or self._agora() > registro["expira_em"]:
            return None
        if registro["client_id"] != client_id or registro["redirect_uri"] != redirect_uri:
            return None
        if not hmac.compare_digest(registro["desafio"], _s256(verificador)):
            return None

        access = secrets.token_urlsafe(32)
        dados = self._carregar()
        if client_id in dados["clientes"]:
            dados["clientes"][client_id]["usado"] = True  # cliente em uso não é removido na limpeza
        dados["tokens"][_hash_token(access)] = {
            "usuario": registro["usuario"],
            "expira_em": self._agora() + self.TOKEN_VALIDADE_S,
        }
        # descarta access tokens vencidos ao emitir um novo
        agora = self._agora()
        dados["tokens"] = {h: t for h, t in dados["tokens"].items() if t["expira_em"] > agora}
        self._salvar(dados)
        return access

    def identificar(self, access: str) -> str | None:
        registro = self._carregar()["tokens"].get(_hash_token(access))
        if not registro or self._agora() > registro["expira_em"]:
            return None
        usuario = registro["usuario"]
        conta = self.registro.carregar().get(usuario)
        if not conta or conta.get("revogado"):
            return None
        return usuario

    # --- HTTP ----------------------------------------------------------------

    async def tratar(self, scope, receive, send) -> None:
        caminho = scope.get("path", "")
        metodo = scope.get("method")
        base = _base_publica(scope)

        if caminho == "/.well-known/oauth-protected-resource" and metodo == "GET":
            await _json(send, 200, {"resource": f"{base}/mcp", "authorization_servers": [base],
                                    "bearer_methods_supported": ["header"]})
        elif caminho == "/.well-known/oauth-authorization-server" and metodo == "GET":
            await _json(send, 200, {
                "issuer": base,
                "authorization_endpoint": f"{base}/oauth/authorize",
                "token_endpoint": f"{base}/oauth/token",
                "registration_endpoint": f"{base}/oauth/register",
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
            })
        elif caminho == "/oauth/register" and metodo == "POST":
            await self._registrar(scope, receive, send)
        elif caminho == "/oauth/authorize" and metodo == "GET":
            await self._autorizar_pagina(scope, send, dict(_query(scope)))
        elif caminho == "/oauth/authorize" and metodo == "POST":
            await self._autorizar_envio(receive, send)
        elif caminho == "/oauth/token" and metodo == "POST":
            await self._token(receive, send)
        else:
            await _responder(send, 404, b"Nao encontrado")

    async def _registrar(self, scope, receive, send) -> None:
        if self.limitador_registro is not None:
            permitido, espera, motivo = self.limitador_registro.verificar(f"oauth-registro:{_ip_cliente(scope)}")
            if not permitido:
                await _json(send, 429, {"error": "temporarily_unavailable", "error_description": motivo})
                return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            dados = {}
        uris = dados.get("redirect_uris") or []
        if not isinstance(uris, list) or not all(isinstance(u, str) for u in uris):
            await _json(send, 400, {"error": "invalid_redirect_uri"})
            return
        client_id = self.registrar_cliente(uris, str(dados.get("client_name", "cliente MCP")))
        if client_id is None:
            await _json(send, 400, {"error": "invalid_redirect_uri",
                                    "error_description": "Use um redirect_uri https do claude.ai/claude.com ou localhost, "
                                                         "ou tente novamente mais tarde se o limite de clientes foi atingido."})
            return
        await _json(send, 201, {
            "client_id": client_id,
            "client_id_issued_at": int(self._agora()),
            "client_name": str(dados.get("client_name", "cliente MCP")),
            "redirect_uris": uris,
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })

    def _parametros_validos(self, params: dict) -> str | None:
        """Devolve None se válidos; caso contrário, o motivo. Nunca redireciona para URI não validada."""
        if params.get("response_type") != "code":
            return "response_type deve ser 'code'."
        if params.get("code_challenge_method") != "S256" or not params.get("code_challenge"):
            return "PKCE (S256) é obrigatório."
        if not self.cliente_valido(params.get("client_id", ""), params.get("redirect_uri", "")):
            return "Cliente ou redirect_uri não registrados."
        return None

    async def _autorizar_pagina(self, scope, send, params: dict) -> None:
        erro = self._parametros_validos(params)
        if erro:
            await _responder(send, 400, erro.encode("utf-8"))
            return
        await _responder(send, 200, _pagina_autorizacao(params).encode("utf-8"),
                         tipo="text/html; charset=utf-8")

    async def _autorizar_envio(self, receive, send) -> None:
        corpo = await _ler_corpo(receive)
        if corpo is None:
            await _responder(send, 413, b"Formulario grande demais")
            return
        params = {k: v[0] for k, v in parse_qs(corpo.decode("utf-8", "replace"), keep_blank_values=True).items()}
        erro = self._parametros_validos(params)
        if erro:
            await _responder(send, 400, erro.encode("utf-8"))
            return

        usuario = self.registro.identificar(params.get("token", "").strip())
        if usuario is None:
            log.warning("Autorização OAuth negada: token inválido ou revogado")
            await _responder(send, 401, _pagina_autorizacao(params, "Token inválido ou revogado.").encode("utf-8"),
                             tipo="text/html; charset=utf-8")
            return

        codigo = self.emitir_codigo(params["client_id"], params["redirect_uri"],
                                    params["code_challenge"], usuario)
        log.info("Autorização OAuth concedida para '%s'", _rotulo_usuario(usuario))
        from urllib.parse import urlencode

        separador = "&" if "?" in params["redirect_uri"] else "?"
        destino = params["redirect_uri"] + separador + urlencode(
            {"code": codigo, "state": params.get("state", "")})
        await _responder(send, 302, b"", cabecalhos_extra=[(b"location", destino.encode("utf-8"))])

    async def _token(self, receive, send) -> None:
        corpo = await _ler_corpo(receive)
        if corpo is None:
            await _json(send, 413, {"error": "invalid_request"})
            return
        p = {k: v[0] for k, v in parse_qs(corpo.decode("utf-8", "replace"), keep_blank_values=True).items()}
        if p.get("grant_type") != "authorization_code":
            await _json(send, 400, {"error": "unsupported_grant_type"})
            return
        access = self.trocar_codigo(p.get("code", ""), p.get("client_id", ""),
                                    p.get("redirect_uri", ""), p.get("code_verifier", ""))
        if access is None:
            await _json(send, 400, {"error": "invalid_grant"})
            return
        await _json(send, 200, {"access_token": access, "token_type": "Bearer",
                                "expires_in": self.TOKEN_VALIDADE_S})


def _base_publica(scope) -> str:
    """URL pública do servidor, a partir do Host da requisição (o Caddy repassa o domínio)."""
    host = ""
    for nome, valor in scope.get("headers") or []:
        if nome == b"host":
            host = valor.decode("latin-1")
    local = host.split(":")[0] in _HOSTS_LOCAIS or host.startswith("[::1]")
    return f"{'http' if local else 'https'}://{host}"


def _query(scope):
    from urllib.parse import parse_qsl

    return parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)


async def _json(send, status: int, corpo: dict) -> None:
    await _responder(send, status, json.dumps(corpo, ensure_ascii=False).encode("utf-8"),
                     tipo="application/json; charset=utf-8")


def _pagina_autorizacao(params: dict, erro: str | None = None) -> str:
    ocultos = "".join(
        f'<input type="hidden" name="{_escapar(k)}" value="{_escapar(params.get(k, ""))}">'
        for k in ("response_type", "client_id", "redirect_uri", "code_challenge",
                  "code_challenge_method", "state", "scope")
    )
    aviso = f"<p class='aviso'>{_escapar(erro)}</p>" if erro else ""
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cnj-processual · autorizar acesso</title>
<style>{_ESTILO_PAGINAS}</style></head><body>
<h1>Autorizar o Claude a usar o cnj-processual</h1>
<p>Cole o token que você recebeu por e-mail. Ele não fica salvo nesta página.</p>
{aviso}
<form method="post" action="/oauth/authorize">
{ocultos}
<label>Token<br><input type="password" name="token" required autocomplete="off"></label>
<button type="submit">Autorizar</button>
</form>
<p>Ainda não tem token? Peça em <a href="/cadastro">/cadastro</a>.</p>
</body></html>"""


_CAMPOS_DETALHES_CLIENTE = (
    "tipo_pessoa", "perfil", "rg_numero", "rg_emissao", "rg_emissor", "ctps_numero", "ctps_serie",
    "ctps_emissao", "ctps_uf", "pis", "estado_civil", "nacionalidade", "profissao",
)


def _detalhes_cliente_de(dados: dict) -> dict:
    """Extrai de `dados` os campos extras do cadastro completo (documentação, endereço,
    informações complementares) - usado tanto em POST /clientes quanto em PATCH /clientes/<id>."""
    return {campo: (dados.get(campo) or "").strip() or None for campo in _CAMPOS_DETALHES_CLIENTE}


def _itens_de(dados: dict, chave_lista: str, chave_unica: str, campos: tuple) -> list[dict]:
    """Aceita uma lista de dicts em `chave_lista` (formato novo, multi-entrada) ou, por
    compatibilidade, um único valor escalar em `chave_unica` (formato antigo)."""
    brutos = dados.get(chave_lista)
    if isinstance(brutos, list):
        itens = []
        for item in brutos:
            if not isinstance(item, dict):
                continue
            itens.append({campo: str(item.get(campo) or "").strip() for campo in campos})
        return itens
    unico = (dados.get(chave_unica) or "").strip()
    return [{campos[0]: unico}] if unico else []


def _telefones_de(dados: dict) -> list[dict]:
    return _itens_de(dados, "telefones", "telefone", ("telefone", "tipo", "operadora"))


def _emails_de(dados: dict) -> list[dict]:
    return _itens_de(dados, "emails", "email", ("email", "tipo"))


def _sites_de(dados: dict) -> list[dict]:
    return _itens_de(dados, "sites", "site", ("site",))


_CAMPOS_ENDERECO = ("tipo", "cep", "rua", "numero", "bairro", "complemento", "cidade", "estado", "pais")


def _enderecos_de(dados: dict) -> list[dict]:
    brutos = dados.get("enderecos")
    if isinstance(brutos, list):
        return [
            {campo: str(item.get(campo) or "").strip() for campo in _CAMPOS_ENDERECO}
            for item in brutos if isinstance(item, dict)
        ]
    # Compatibilidade com o formato antigo (endereco_rua, endereco_numero, ... escalares).
    unico = {
        campo: (dados.get(f"endereco_{campo}") or "").strip()
        for campo in _CAMPOS_ENDERECO if campo not in ("cep", "tipo")
    }
    return [unico] if any(unico.values()) else []


def _criar_cliente_validado(gestao: RegistroClientesCasos, dados: dict) -> tuple[dict | None, dict | None]:
    """Valida o corpo de POST /clientes. Devolve (cliente, None) ou (None, erro)."""
    nome = (dados.get("nome") or "").strip()
    if not nome:
        return None, _erro("Informe o nome do cliente.")
    cliente = gestao.criar_cliente(
        nome=nome,
        cpf_cnpj=(dados.get("cpf_cnpj") or "").strip() or None,
        observacoes=(dados.get("observacoes") or "").strip() or None,
        agora=lambda: datetime.now(timezone.utc),
        telefones=_telefones_de(dados),
        emails=_emails_de(dados),
        sites=_sites_de(dados),
        enderecos=_enderecos_de(dados),
        detalhes=_detalhes_cliente_de(dados),
    )
    return cliente, None


def _resolver_cliente_id(gestao: RegistroClientesCasos, item: dict) -> tuple[str | None, dict | None]:
    """Resolve {cliente_id} ou {cliente_novo} para um id de cliente existente. Em cliente_novo,
    reaproveita um cliente já cadastrado com o mesmo nome em vez de duplicar - comum quando a
    mesma parte aparece em publicações diferentes."""
    cliente_id = (item.get("cliente_id") or "").strip() or None
    if cliente_id:
        if gestao.obter_cliente(cliente_id) is None:
            return None, _erro(f"Cliente '{cliente_id}' não encontrado.")
        return cliente_id, None
    cliente_novo = item.get("cliente_novo")
    if not isinstance(cliente_novo, dict):
        return None, _erro("Informe cliente_id ou cliente_novo.")
    nome = (cliente_novo.get("nome") or "").strip()
    if nome:
        existente = gestao.buscar_cliente_por_nome(nome)
        if existente:
            return existente["id"], None
    novo_cliente, erro = _criar_cliente_validado(gestao, cliente_novo)
    if erro:
        return None, erro
    return novo_cliente["id"], None


def _criar_caso_validado(
    gestao: RegistroClientesCasos, dados: dict, publicacoes: "RegistroPublicacoesOAB | None" = None,
    usuario_padrao: str | None = None,
) -> tuple[dict | None, dict | None]:
    """Valida o corpo de POST /casos. Aceita cliente_id (existente) ou cliente_novo (cria na
    hora) - é o que permite o botão "cadastrar como caso" da consulta pontual de processo.
    clientes_adicionais (opcional) é uma lista de {cliente_id} ou {cliente_novo}: outras partes
    da mesma publicação/processo que também viram clientes do escritório, vinculadas a este
    mesmo caso (ex.: autor e réu, quando ambos interessam ao escritório).
    `publicacoes`, se dado, marca como "tratada" qualquer publicação já capturada (aba
    "Publicações por OAB") desses mesmos processos (Q11: processo que já tem caso aparece
    tratado direto).
    Devolve (caso, None) ou (None, erro).
    """
    cliente_id, erro = _resolver_cliente_id(gestao, dados)
    if erro:
        return None, erro

    adicionais_brutos = dados.get("clientes_adicionais") or []
    if not isinstance(adicionais_brutos, list):
        return None, _erro("clientes_adicionais deve ser uma lista.")
    clientes_adicionais = []
    for item in adicionais_brutos:
        if not isinstance(item, dict):
            return None, _erro("Cada item de clientes_adicionais deve ser um objeto.")
        cid, erro = _resolver_cliente_id(gestao, item)
        if erro:
            return None, erro
        clientes_adicionais.append(cid)

    numeros_brutos = dados.get("numeros_processo") or []
    if not isinstance(numeros_brutos, list) or not numeros_brutos:
        return None, _erro("Informe ao menos um número de processo em numeros_processo.")
    numeros = []
    for numero in numeros_brutos:
        numero_normalizado = _so_digitos(numero)
        if len(numero_normalizado) != 20:
            return None, _erro(f"Número de processo inválido: '{numero}' (esperados 20 dígitos).")
        numeros.append(numero_normalizado)

    caso = gestao.criar_caso(
        cliente_id=cliente_id,
        titulo=(dados.get("titulo") or "").strip() or None,
        responsavel=(dados.get("responsavel") or "").strip() or usuario_padrao or None,
        numeros_processo=numeros,
        agora=lambda: datetime.now(timezone.utc),
        clientes_adicionais=clientes_adicionais,
        acao=(dados.get("acao") or "").strip() or None,
        foro=(dados.get("foro") or "").strip() or None,
    )
    if publicacoes is not None:
        for numero in numeros:
            try:
                publicacoes.marcar_tratada_por_processo(numero, caso["id"])
            except Exception:
                log.exception("Caso %s: falha ao marcar publicações tratadas para o processo %s", caso["id"], numero)
    return caso, None


class _AutenticacaoBearer:
    """Middleware ASGI.

    - /mcp exige 'Authorization: Bearer <token>' de um usuário ativo e aplica os limites de uso.
    - /cadastro (se houver SMTP configurado) permite pedir o token pelo e-mail.
    - /admin (se houver CNJ_MCP_ADMIN_TOKEN) é a página administrativa.
    - /healthz é liberado para o health check da hospedagem.
    """

    def __init__(self, app, registro: RegistroUsuarios, limitador: LimitadorUso | None = None,
                 admin_token: str | None = None, cadastro: CadastroPublico | None = None,
                 oauth: "ServidorOAuth | None" = None, captcha: "VerificadorRecaptcha | None" = None,
                 captcha_site_key: str | None = None, falhas: LimitadorUso | None = None,
                 gestao: "RegistroClientesCasos | None" = None,
                 registro_google: "RegistroIntegracaoGoogle | None" = None,
                 google_client_id: str | None = None, google_client_secret: str | None = None,
                 publicacoes: "RegistroPublicacoesOAB | None" = None) -> None:
        self.app = app
        self.registro = registro
        self.limitador = limitador
        self.admin_token = admin_token
        self.cadastro = cadastro
        self.oauth = oauth
        self.captcha = captcha
        self.captcha_site_key = captcha_site_key
        # conta tentativas de autenticação falhas por IP (mcp e admin), para frear força bruta
        self.falhas = falhas
        self.gestao = gestao
        self.registro_google = registro_google
        self.publicacoes = publicacoes
        self.google_client_id = google_client_id
        self.google_client_secret = google_client_secret
        # state do fluxo OAuth do Google em andamento: state -> prazo de validade (datetime).
        # Em memória só: perde-se num restart do servidor, o que só obriga a pessoa a clicar
        # "Conectar" de novo - sem risco de segurança.
        self._google_estados_pendentes: dict[str, datetime] = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":  # lifespan e afins passam direto
            await self.app(scope, receive, send)
            return

        caminho = scope.get("path", "")
        if caminho == "/healthz":
            await _healthz(send)
            return
        if caminho == "/cadastro":
            if scope.get("method") == "POST":
                # tempo de resposta fixo: não revela se o e-mail foi enviado, recusado ou revogado
                await _com_tempo_minimo(self._cadastro_http, scope, receive, send)
            else:
                await self._cadastro_http(scope, receive, send)
            return
        if caminho == "/static/carbon/styles.min.css" and scope.get("method") == "GET":
            # folha de estilos do Carbon (Apache 2.0), servida pelo próprio servidor
            css = Path(__file__).resolve().parent / "static" / "carbon" / "styles.min.css"
            if css.is_file():
                await _responder(send, 200, css.read_bytes(), tipo="text/css; charset=utf-8")
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho == "/static/cadastro.js" and scope.get("method") == "GET":
            # script externo da página de cadastro (a CSP não permite script inline). Sem cache,
            # pelo mesmo motivo do /static/app.js (ver comentário lá).
            js = Path(__file__).resolve().parent / "static" / "cadastro.js"
            if js.is_file():
                await _responder(
                    send, 200, js.read_bytes(), tipo="application/javascript; charset=utf-8",
                    cabecalhos_extra=[(b"cache-control", b"no-store")],
                )
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho == "/static/app.js" and scope.get("method") == "GET":
            # script externo do painel web (cliente MCP em JavaScript puro). Sem cache: o arquivo
            # muda a cada deploy e não tem ETag/Last-Modified - sem "no-store" o navegador pode
            # seguir usando uma versão antiga em cache depois do deploy (sem dar erro nenhum, só
            # rodando código velho silenciosamente).
            js = Path(__file__).resolve().parent / "static" / "app.js"
            if js.is_file():
                await _responder(
                    send, 200, js.read_bytes(), tipo="application/javascript; charset=utf-8",
                    cabecalhos_extra=[(b"cache-control", b"no-store")],
                )
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho in (
            "/static/carbon/flatpickr.min.js",
            "/static/carbon/flatpickr-l10n-pt.js",
            "/static/carbon/flatpickr-rangePlugin.js",
        ) and scope.get("method") == "GET":
            # flatpickr (calendário do Date Picker do Carbon), vendorizado - sem dados sensíveis
            js = Path(__file__).resolve().parent / caminho.lstrip("/")
            if js.is_file():
                await _responder(send, 200, js.read_bytes(), tipo="application/javascript; charset=utf-8")
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho.startswith("/static/icons/") and scope.get("method") == "GET":
            # ícones das integrações (marcas oficiais), sem dados sensíveis
            nome = caminho[len("/static/icons/"):]
            if "/" in nome or ".." in nome:
                await _responder(send, 404, b"Nao encontrado")
                return
            arquivo = Path(__file__).resolve().parent / "static" / "icons" / nome
            tipos = {".svg": "image/svg+xml", ".png": "image/png"}
            tipo = tipos.get(arquivo.suffix.lower())
            if tipo and arquivo.is_file():
                await _responder(send, 200, arquivo.read_bytes(), tipo=tipo)
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho == "/app" and scope.get("method") == "GET":
            # painel público: a pessoa cola o próprio token no navegador, o servidor não autentica a
            # página. Sem cache, pelo mesmo motivo do /static/app.js (muda a cada deploy).
            pagina = Path(__file__).resolve().parent / "static" / "app.html"
            if pagina.is_file():
                await _responder(
                    send, 200, pagina.read_bytes(), tipo="text/html; charset=utf-8",
                    cabecalhos_extra=[(b"cache-control", b"no-store")],
                )
            else:
                await _responder(send, 404, b"Nao encontrado")
            return
        if caminho == "/guia" and scope.get("method") == "GET":
            # guia público para usuários finais: não tem dados sensíveis, por isso não exige token
            guia = Path(__file__).resolve().parent / "guia-do-usuario.html"
            if guia.is_file():
                await _responder(send, 200, guia.read_bytes(), tipo="text/html; charset=utf-8")
            else:
                await _responder(send, 404, b"Guia nao encontrado")
            return
        if caminho.startswith("/cep/") and scope.get("method") == "GET":
            # proxy do ViaCEP (sem token: é só geocodificação pública, igual ao /guia) - ver
            # _cep_http para o porquê de não deixar o navegador chamar o ViaCEP direto.
            await _cep_http(send, caminho[len("/cep/"):])
            return
        if caminho.startswith("/certidoes/"):
            # acesso por link assinado e temporário (sem token de usuário)
            await _servir_certidao(scope, send)
            return
        if caminho.startswith("/admin"):
            await self._admin(scope, receive, send)
            return
        if self.oauth and (caminho.startswith("/oauth/") or caminho.startswith("/.well-known/")):
            await self.oauth.tratar(scope, receive, send)
            return

        ip = _ip_cliente(scope)
        chave_falhas = f"mcp:{ip}"
        if self.falhas is not None:
            bloqueado, espera, motivo = self.falhas.ocupado(chave_falhas)
            if bloqueado:
                log.warning("Autenticação bloqueada para o IP %s: %s", ip, motivo)
                await _responder(send, 429, f"Muitas tentativas sem sucesso. Tente em {espera}s.".encode("utf-8"),
                                 cabecalhos_extra=[(b"retry-after", str(espera).encode())])
                return

        cabecalhos = dict(scope.get("headers") or [])
        autorizacao = cabecalhos.get(b"authorization", b"").decode("latin-1")
        token = autorizacao[len("Bearer "):] if autorizacao.startswith("Bearer ") else ""
        usuario = None
        if token:
            usuario = self.registro.identificar(token)
            if usuario is None and self.oauth is not None:
                usuario = self.oauth.identificar(token)
        if usuario is None:
            if self.falhas is not None:
                self.falhas.verificar(chave_falhas)
            log.warning("Requisição negada: token ausente, inválido ou revogado (%s %s)", scope.get("method"), caminho)
            desafio = b"Bearer"
            if self.oauth is not None:
                # o Claude usa este cabeçalho para descobrir onde autorizar (RFC 9728)
                desafio = f'Bearer resource_metadata="{_base_publica(scope)}/.well-known/oauth-protected-resource"'.encode()
            await _responder(send, 401, b"Token ausente, invalido ou revogado",
                             cabecalhos_extra=[(b"www-authenticate", desafio)])
            return

        scope["usuario"] = usuario

        if self.limitador and scope.get("method") == "POST" and caminho == "/mcp":
            permitido, espera, motivo = self.limitador.verificar(usuario)
            if not permitido:
                log.warning("Requisição de '%s' limitada: %s", _rotulo_usuario(usuario), motivo)
                await _responder(
                    send, 429, f"Limite de uso atingido: {motivo}. Tente em {espera}s.".encode("utf-8"),
                    cabecalhos_extra=[(b"retry-after", str(espera).encode())],
                )
                return

        if caminho == "/cjpg-arvore/filhos" and scope.get("method") == "GET":
            await _arvore_filhos_http(scope, send)
            return
        if caminho == "/cjpg-arvore/buscar" and scope.get("method") == "GET":
            await _arvore_buscar_http(scope, send)
            return
        if caminho == "/cjpg-arvore/magistrados" and scope.get("method") == "GET":
            await _arvore_magistrados_http(send)
            return

        if caminho == "/integracoes/status" and scope.get("method") == "GET":
            await _json(send, 200, {"google": self._google_configurado(), "asaas": _asaas_config() is not None})
            return

        if caminho == "/clientes" and self.gestao is not None:
            await self._clientes(scope, receive, send)
            return
        if caminho.startswith("/clientes/") and self.gestao is not None:
            await self._cliente_detalhe(scope, receive, send, caminho[len("/clientes/"):])
            return
        if caminho == "/casos" and self.gestao is not None:
            await self._casos(scope, receive, send)
            return
        if caminho.startswith("/casos/") and caminho.endswith("/evento-calendar") and self.gestao is not None:
            caso_id = caminho[len("/casos/"):-len("/evento-calendar")].rstrip("/")
            await self._evento_calendar_do_caso(scope, receive, send, caso_id)
            return
        if caminho.startswith("/casos/") and "/atividades" in caminho and self.gestao is not None:
            partes = caminho[len("/casos/"):].split("/atividades")
            caso_id = partes[0].rstrip("/")
            rest = partes[1].strip("/") if len(partes) > 1 else ""
            aid = int(rest) if rest.isdigit() else None
            await self._atividades_do_caso(scope, receive, send, caso_id, aid)
            return
        if caminho.startswith("/casos/") and "/publicacoes" in caminho \
                and self.publicacoes is not None and self.gestao is not None:
            partes = caminho[len("/casos/"):].split("/publicacoes")
            caso_id = partes[0].rstrip("/")
            pub_hash = partes[1].strip("/") if len(partes) > 1 else ""
            await self._publicacoes_do_caso(scope, receive, send, caso_id, pub_hash or None)
            return
        if caminho.startswith("/casos/") and "/vinculos" in caminho and self.gestao is not None:
            partes = caminho[len("/casos/"):].split("/vinculos")
            caso_id = partes[0].rstrip("/")
            vinculado_id = partes[1].strip("/") if len(partes) > 1 else ""
            await self._vinculos_do_caso(scope, receive, send, caso_id, vinculado_id or None)
            return
        if caminho.startswith("/casos/") and self.gestao is not None:
            await self._caso_detalhe(scope, receive, send, caminho[len("/casos/"):])
            return
        if caminho == "/lancamentos" and self.gestao is not None:
            await self._lancamentos(scope, receive, send)
            return
        if caminho.startswith("/lancamentos/") and self.gestao is not None:
            await self._lancamento_detalhe(scope, receive, send, caminho[len("/lancamentos/"):])
            return
        if caminho == "/pagamentos" and self.gestao is not None:
            await self._pagamentos(scope, receive, send)
            return
        if caminho.startswith("/pagamentos/") and self.gestao is not None:
            await self._pagamento_detalhe(scope, receive, send, caminho[len("/pagamentos/"):])
            return
        if caminho == "/pendentes" and self.gestao is not None:
            await _json(send, 200, {"pendentes": self.gestao.listar_pendentes()})
            return
        if caminho.startswith("/pendentes/") and caminho.endswith("/descartar") and self.gestao is not None:
            if scope.get("method") != "POST":
                await _responder(send, 404, b"Nao encontrado")
                return
            numero = caminho[len("/pendentes/"):-len("/descartar")].rstrip("/")
            encontrado = self.gestao.descartar_pendente(numero)
            await _json(send, 200 if encontrado else 404, {"descartado": encontrado})
            return
        if caminho == "/publicacoes-oab" and self.publicacoes is not None:
            await self._publicacoes_oab(scope, send)
            return
        if caminho == "/publicacoes-oab/status" and self.publicacoes is not None:
            await self._publicacoes_oab_status(scope, receive, send)
            return
        if caminho == "/publicacoes-oab/capturar-manual" and self.publicacoes is not None and self.gestao is not None:
            await self._publicacoes_oab_capturar_manual(scope, receive, send)
            return
        if caminho.startswith("/publicacoes-oab/") and caminho.endswith("/criar-caso") \
                and self.publicacoes is not None and self.gestao is not None:
            hash_publicacao = caminho[len("/publicacoes-oab/"):-len("/criar-caso")].rstrip("/")
            await self._publicacao_oab_criar_caso(scope, receive, send, hash_publicacao)
            return

        log.info("Requisição de '%s': %s %s", _rotulo_usuario(usuario), scope.get("method"), caminho)
        await self.app(scope, receive, send)

    # --- Cadastro público ------------------------------------------------------

    async def _cadastro_http(self, scope, receive, send):
        if self.cadastro is None:
            await _responder(send, 404, b"Nao encontrado")
            return
        if scope.get("method") == "GET":
            # Primeira tela: termos. A etapa de e-mail só abre com ?etapa=email (após o aceite).
            from urllib.parse import parse_qsl
            query = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1")))
            if query.get("etapa") == "email" and query.get("aceite") == "sim":
                pagina = _pagina_cadastro(site_key=self.captcha_site_key)
            elif query.get("etapa") == "email":
                pagina = _pagina_termos(MENSAGEM_TERMOS_NECESSARIOS, erro=True)
            else:
                pagina = _pagina_termos()
            await _responder(send, 200, pagina.encode("utf-8"), tipo="text/html; charset=utf-8")
            return
        if scope.get("method") == "POST":
            corpo = await _ler_corpo(receive)
            if corpo is None:
                await _responder(send, 413, b"Formulario grande demais")
                return
            campos = {k: v[0] for k, v in parse_qs(corpo.decode("utf-8", "replace"), keep_blank_values=True).items()}
            aceitou = campos.get("aceite") == "sim"
            if not aceitou:
                # sem aceite, o e-mail nem é lido: volta para a tela de termos
                await _responder(send, 200, _pagina_termos(MENSAGEM_TERMOS_NECESSARIOS, erro=True).encode("utf-8"),
                                 tipo="text/html; charset=utf-8")
                return
            if self.captcha is not None:
                humano = await self.captcha.validar(campos.get("g-recaptcha-response", ""), _ip_cliente(scope))
                if not humano:
                    log.warning("Cadastro recusado: reCAPTCHA inválido ou ausente")
                    await _responder(send, 200,
                                     _pagina_cadastro(MENSAGEM_CAPTCHA_FALHA, erro=True,
                                                      site_key=self.captcha_site_key).encode("utf-8"),
                                     tipo="text/html; charset=utf-8")
                    return
            mensagem = await self.cadastro.solicitar(campos.get("email", ""), _ip_cliente(scope), aceitou)
            erro = mensagem != MENSAGEM_CADASTRO_OK
            await _responder(send, 200, _pagina_cadastro(mensagem, erro=erro,
                                                         site_key=self.captcha_site_key).encode("utf-8"),
                             tipo="text/html; charset=utf-8")
            return
        await _responder(send, 404, b"Nao encontrado")

    # --- Página administrativa -------------------------------------------------

    async def _admin(self, scope, receive, send):
        if self.admin_token is None:
            await _responder(send, 404, b"Nao encontrado")
            return

        metodo = scope.get("method")
        caminho = scope.get("path")
        if metodo == "GET" and caminho == "/admin":
            # Sem token, a página só traz o formulário: a lista de usuários não é exibida.
            await _responder(send, 200,
                             _pagina_admin(self.registro, mensagem=None,
                                          google_conectado=self._google_conectado(),
                                          google_configurado=self._google_configurado()).encode("utf-8"),
                             tipo="text/html; charset=utf-8")
            return
        if metodo == "POST" and caminho == "/admin/google/iniciar":
            await self._google_iniciar(scope, receive, send)
            return
        if metodo == "GET" and caminho == "/admin/google/callback":
            await self._google_callback(scope, send)
            return
        if metodo == "POST" and caminho == "/admin/google/desconectar":
            await self._google_desconectar(scope, receive, send)
            return
        if metodo == "POST" and caminho == "/admin/acao":
            ip = _ip_cliente(scope)
            chave_admin = f"admin:{ip}"
            if self.falhas is not None:
                bloqueado, espera, motivo = self.falhas.ocupado(chave_admin)
                if bloqueado:
                    log.warning("Administração bloqueada para o IP %s: %s", ip, motivo)
                    await _responder(send, 429, _pagina_admin(self.registro,
                                                              f"Muitas tentativas. Tente em {espera}s.").encode("utf-8"),
                                     tipo="text/html; charset=utf-8",
                                     cabecalhos_extra=[(b"retry-after", str(espera).encode())])
                    return
            corpo = await _ler_corpo(receive)
            if corpo is None:
                await _responder(send, 413, b"Formulario grande demais")
                return
            campos = {k: v[0] for k, v in parse_qs(corpo.decode("utf-8", "replace"), keep_blank_values=True).items()}
            if not hmac.compare_digest(campos.get("token_admin", "").encode("utf-8"), self.admin_token.encode("utf-8")):
                if self.falhas is not None:
                    self.falhas.verificar(chave_admin)
                log.warning("Ação administrativa negada: token administrativo inválido")
                await _responder(send, 401, _pagina_admin(self.registro, "Token administrativo inválido.", erro=True).encode("utf-8"),
                                 tipo="text/html; charset=utf-8")
                return
            mensagem, token_novo = _executar_acao_admin(self.registro, campos.get("acao", ""), campos.get("nome", ""))
            log.info("Ação administrativa: %s '%s'", campos.get("acao"), _rotulo_usuario(campos.get("nome", "")))
            await _responder(send, 200,
                             _pagina_admin(self.registro, mensagem, token_novo, mostrar_lista=True,
                                          google_conectado=self._google_conectado(),
                                          google_configurado=self._google_configurado()).encode("utf-8"),
                             tipo="text/html; charset=utf-8")
            return

        await _responder(send, 404, b"Nao encontrado")

    # --- Integração Google (Fase 4): conta institucional única, conectada pelo admin ----------

    def _google_conectado(self) -> dict | None:
        if self.registro_google is None:
            return None
        return self.registro_google.obter_conexao()

    def _google_configurado(self) -> bool:
        return bool(self.registro_google and self.google_client_id and self.google_client_secret)

    def _limpar_estados_expirados(self) -> None:
        agora = datetime.now(timezone.utc)
        for state in [s for s, expira in self._google_estados_pendentes.items() if expira < agora]:
            del self._google_estados_pendentes[state]

    async def _google_iniciar(self, scope, receive, send) -> None:
        if not self._google_configurado():
            await _responder(send, 404, b"Integracao Google nao configurada (faltam credenciais no servidor).")
            return
        corpo = await _ler_corpo(receive)
        campos = {k: v[0] for k, v in parse_qs((corpo or b"").decode("utf-8", "replace"), keep_blank_values=True).items()}
        if not hmac.compare_digest(campos.get("token_admin", "").encode("utf-8"), (self.admin_token or "").encode("utf-8")):
            await _responder(send, 401, b"Token administrativo invalido.")
            return
        self._limpar_estados_expirados()
        state = secrets.token_urlsafe(24)
        self._google_estados_pendentes[state] = datetime.now(timezone.utc) + timedelta(minutes=10)
        redirect_uri = f"{_base_publica(scope)}/admin/google/callback"
        url = google_integracao.url_autorizacao(self.google_client_id, redirect_uri, state)
        await _responder(send, 302, b"", cabecalhos_extra=[(b"location", url.encode("utf-8"))])

    async def _google_callback(self, scope, send) -> None:
        if not self._google_configurado():
            await _responder(send, 404, b"Integracao Google nao configurada.")
            return
        query = dict(_query(scope))
        state = query.get("state", "")
        self._limpar_estados_expirados()
        if state not in self._google_estados_pendentes:
            await _responder(send, 400, b"Link de autorizacao invalido ou expirado. Volte em /admin e clique em Conectar de novo.")
            return
        del self._google_estados_pendentes[state]
        code = query.get("code", "")
        if not code:
            erro = query.get("error", "erro desconhecido")
            await _responder(send, 400, f"Google recusou a autorizacao: {erro}".encode("utf-8"))
            return
        redirect_uri = f"{_base_publica(scope)}/admin/google/callback"
        try:
            async with _cliente(20) as http_cliente:
                dados = await google_integracao.trocar_codigo_por_token(
                    http_cliente, self.google_client_id, self.google_client_secret, redirect_uri, code,
                )
        except google_integracao.ErroGoogle as erro:
            log.warning("Falha ao conectar Google: %s", erro)
            await _responder(send, 400, f"Falha ao conectar: {erro}".encode("utf-8"))
            return
        self.registro_google.salvar_conexao(dados["refresh_token"], lambda: datetime.now(timezone.utc))
        log.info("Integração Google conectada (conta institucional).")
        await _responder(
            send, 200,
            "<!doctype html><meta charset=utf-8><p>Google conectado. Pode fechar esta aba e voltar para /admin.</p>".encode("utf-8"),
            tipo="text/html; charset=utf-8",
        )

    async def _google_desconectar(self, scope, receive, send) -> None:
        corpo = await _ler_corpo(receive)
        campos = {k: v[0] for k, v in parse_qs((corpo or b"").decode("utf-8", "replace"), keep_blank_values=True).items()}
        if not hmac.compare_digest(campos.get("token_admin", "").encode("utf-8"), (self.admin_token or "").encode("utf-8")):
            await _responder(send, 401, b"Token administrativo invalido.")
            return
        if self.registro_google is not None:
            self.registro_google.desconectar()
            log.info("Integração Google desconectada.")
        await _responder(send, 302, b"", cabecalhos_extra=[(b"location", b"/admin")])

    # --- Clientes e casos (Fase 1 da gestão de escritório) ---------------------
    #
    # Suporte de interface do painel (/app): CRUD mínimo, sem tool MCP equivalente, porque não
    # faz sentido um agente de IA cadastrar cliente/caso por conta própria. Mesmo token Bearer
    # do resto do app; "todos veem tudo" (sem filtro por usuário), conforme decidido para a
    # Fase 1 da gestão de escritório.

    async def _clientes(self, scope, receive, send):
        metodo = scope.get("method")
        if metodo == "GET":
            await _json(send, 200, {"clientes": self.gestao.listar_clientes()})
            return
        if metodo == "POST":
            corpo = await _ler_corpo(receive)
            if corpo is None:
                await _json(send, 413, _erro("Corpo da requisição grande demais."))
                return
            try:
                dados = json.loads(corpo.decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                await _json(send, 400, _erro("JSON inválido."))
                return
            cliente, erro = _criar_cliente_validado(self.gestao, dados)
            if erro:
                await _json(send, 400, erro)
                return
            await _json(send, 201, cliente)
            return
        await _responder(send, 404, b"Nao encontrado")

    async def _cliente_detalhe(self, scope, receive, send, cliente_id: str):
        """GET /clientes/<id>: o contato. PATCH /clientes/<id>: atualiza o cadastro (tela de
        contato, aba Cadastro). DELETE /clientes/<id>: exclui o contato - recusado se ele ainda
        for cliente principal ou adicional de algum caso (o caso tem que ser excluído ou
        reatribuído primeiro)."""
        metodo = scope.get("method")
        if not cliente_id or metodo not in ("GET", "PATCH", "DELETE"):
            await _responder(send, 404, b"Nao encontrado")
            return
        if metodo == "GET":
            cliente_registro = self.gestao.obter_cliente(cliente_id)
            if cliente_registro is None:
                await _json(send, 404, _erro("Cliente não encontrado."))
                return
            await _json(send, 200, cliente_registro)
            return
        if metodo == "DELETE":
            try:
                excluiu = self.gestao.excluir_cliente(cliente_id)
            except sqlite3.IntegrityError:
                await _json(send, 409, _erro(
                    "Não é possível excluir: há um ou mais casos vinculados a este contato. "
                    "Exclua ou reatribua esses casos primeiro."
                ))
                return
            if not excluiu:
                await _json(send, 404, _erro("Cliente não encontrado."))
                return
            await _json(send, 200, {"excluido": True})
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        nome = (dados.get("nome") or "").strip()
        if not nome:
            await _json(send, 400, _erro("Informe o nome do cliente."))
            return
        cliente_atualizado = self.gestao.atualizar_cliente(
            cliente_id, nome=nome,
            cpf_cnpj=(dados.get("cpf_cnpj") or "").strip() or None,
            observacoes=(dados.get("observacoes") or "").strip() or None,
            telefones=_telefones_de(dados),
            emails=_emails_de(dados),
            sites=_sites_de(dados),
            enderecos=_enderecos_de(dados),
            detalhes=_detalhes_cliente_de(dados),
        )
        if cliente_atualizado is None:
            await _json(send, 404, _erro("Cliente não encontrado."))
            return
        await _json(send, 200, cliente_atualizado)

    async def _asaas_customer_id(
        self, http_cliente: httpx.AsyncClient, url_base: str, api_key: str, cliente_registro: dict,
    ) -> str:
        """Devolve o customer_id Asaas do cliente, cadastrando-o lá na primeira cobrança
        (e guardando o id com db.definir_asaas_customer_id para não recriá-lo depois)."""
        customer_id = cliente_registro.get("asaas_customer_id")
        if customer_id:
            return customer_id
        criado = await asaas_integracao.criar_cliente(
            http_cliente, url_base, api_key, nome=cliente_registro["nome"],
            cpf_cnpj=cliente_registro["cpf_cnpj"], email=cliente_registro.get("email"),
            telefone=cliente_registro.get("telefone"),
        )
        customer_id = criado["id"]
        self.gestao.definir_asaas_customer_id(cliente_registro["id"], customer_id)
        return customer_id

    async def _pagamentos(self, scope, receive, send) -> None:
        """GET /pagamentos[?cliente_id=&status=&offset=]: lista cobranças Asaas, com o cliente
        local já associado (para a página Financeiro > Pagamentos). POST /pagamentos: cria uma
        cobrança (boleto ou Pix) para um cliente já cadastrado."""
        config = _asaas_config()
        if config is None:
            await _json(send, 404, _erro("Integração Asaas não configurada (falta a API key no servidor)."))
            return
        url_base, api_key = config
        metodo = scope.get("method")
        if metodo == "GET":
            await self._listar_pagamentos(scope, send, url_base, api_key)
            return
        if metodo != "POST":
            await _responder(send, 405, b"Metodo nao permitido")
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        cliente_id = (dados.get("cliente_id") or "").strip()
        cliente_registro = self.gestao.obter_cliente(cliente_id)
        if cliente_registro is None:
            await _json(send, 400, _erro("Selecione um cliente válido."))
            return
        billing_type = (dados.get("billing_type") or "BOLETO").strip().upper()
        if billing_type not in ("BOLETO", "PIX"):
            await _json(send, 400, _erro("Tipo de cobrança inválido (use BOLETO ou PIX)."))
            return
        try:
            valor = float(dados.get("valor"))
        except (TypeError, ValueError):
            await _json(send, 400, _erro("Informe o valor da cobrança (número)."))
            return
        if valor <= 0:
            await _json(send, 400, _erro("O valor da cobrança deve ser maior que zero."))
            return
        parcelas_bruto = dados.get("parcelas")
        parcelas = None
        if parcelas_bruto not in (None, ""):
            try:
                parcelas = int(parcelas_bruto)
            except (TypeError, ValueError):
                await _json(send, 400, _erro("Quantidade de parcelas inválida."))
                return
            if parcelas < 2:
                parcelas = None  # 1 parcela é cobrança avulsa, não parcelamento
        vencimento = (dados.get("vencimento") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", vencimento):
            await _json(send, 400, _erro("Informe a data de vencimento (AAAA-MM-DD)."))
            return
        if not cliente_registro.get("cpf_cnpj"):
            await _json(send, 400, _erro("Cadastre o CPF/CNPJ do cliente antes de emitir cobrança."))
            return
        descricao = (dados.get("descricao") or "").strip() or None
        try:
            async with _cliente(20) as http_cliente:
                customer_id = await self._asaas_customer_id(http_cliente, url_base, api_key, cliente_registro)
                if parcelas:
                    cobranca = await asaas_integracao.criar_cobranca(
                        http_cliente, url_base, api_key, customer_id, vencimento,
                        billing_type=billing_type, descricao=descricao, parcelas=parcelas, valor_total=valor,
                    )
                else:
                    cobranca = await asaas_integracao.criar_cobranca(
                        http_cliente, url_base, api_key, customer_id, vencimento,
                        billing_type=billing_type, descricao=descricao, valor=valor,
                    )
        except asaas_integracao.ErroAsaas as erro:
            log.warning("Falha ao criar cobrança Asaas para cliente %s: %s", cliente_id, erro)
            await _json(send, 400, _erro(f"Falha ao criar cobrança: {erro}"))
            return
        cobranca["cliente_id"] = cliente_id
        cobranca["cliente_nome"] = cliente_registro["nome"]
        await _json(send, 201, cobranca)

    async def _listar_pagamentos(self, scope, send, url_base: str, api_key: str) -> None:
        query = dict(_query(scope))
        cliente_id = (query.get("cliente_id") or "").strip()
        customer_id = None
        if cliente_id:
            cliente_registro = self.gestao.obter_cliente(cliente_id)
            if cliente_registro is None:
                await _json(send, 400, _erro("Cliente não encontrado."))
                return
            customer_id = cliente_registro.get("asaas_customer_id")
            if not customer_id:
                await _json(send, 200, {"cobrancas": [], "totalCount": 0, "hasMore": False})
                return
        status = (query.get("status") or "").strip().upper() or None
        try:
            offset = max(0, int(query.get("offset") or 0))
        except ValueError:
            offset = 0
        try:
            async with _cliente(20) as http_cliente:
                resultado = await asaas_integracao.listar_cobrancas(
                    http_cliente, url_base, api_key, customer_id=customer_id, status=status, offset=offset,
                )
        except asaas_integracao.ErroAsaas as erro:
            log.warning("Falha ao listar cobranças Asaas: %s", erro)
            await _json(send, 502, _erro(f"Falha ao consultar o Asaas: {erro}"))
            return
        cobrancas = resultado.get("data") or []
        clientes_por_asaas_id = {
            c["asaas_customer_id"]: c for c in self.gestao.listar_clientes() if c.get("asaas_customer_id")
        }
        for cobranca in cobrancas:
            vinculado = clientes_por_asaas_id.get(cobranca.get("customer"))
            cobranca["cliente_id"] = vinculado["id"] if vinculado else None
            cobranca["cliente_nome"] = vinculado["nome"] if vinculado else None
        await _json(send, 200, {
            "cobrancas": cobrancas, "totalCount": resultado.get("totalCount", len(cobrancas)),
            "hasMore": resultado.get("hasMore", False),
        })

    async def _pagamento_detalhe(self, scope, receive, send, payment_id: str) -> None:
        """DELETE /pagamentos/<id>: cancela uma cobrança Asaas ainda não paga."""
        if scope.get("method") != "DELETE" or not payment_id:
            await _responder(send, 404, b"Nao encontrado")
            return
        config = _asaas_config()
        if config is None:
            await _json(send, 404, _erro("Integração Asaas não configurada (falta a API key no servidor)."))
            return
        url_base, api_key = config
        try:
            async with _cliente(20) as http_cliente:
                resultado = await asaas_integracao.excluir_cobranca(http_cliente, url_base, api_key, payment_id)
        except asaas_integracao.ErroAsaas as erro:
            log.warning("Falha ao cancelar cobrança Asaas %s: %s", payment_id, erro)
            await _json(send, 400, _erro(f"Falha ao cancelar cobrança: {erro}"))
            return
        await _json(send, 200, resultado)

    async def _casos(self, scope, receive, send):
        metodo = scope.get("method")
        if metodo == "GET":
            await _json(send, 200, {"casos": self.gestao.listar_casos()})
            return
        if metodo == "POST":
            corpo = await _ler_corpo(receive)
            if corpo is None:
                await _json(send, 413, _erro("Corpo da requisição grande demais."))
                return
            try:
                dados = json.loads(corpo.decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                await _json(send, 400, _erro("JSON inválido."))
                return
            caso, erro = _criar_caso_validado(self.gestao, dados, self.publicacoes, usuario_padrao=scope.get("usuario"))
            if erro:
                await _json(send, 400, erro)
                return
            if self._google_conectado():
                # Fase 4: pasta no Drive criada na hora, best-effort - se falhar (rede, token
                # revogado do lado do Google), o caso já foi criado mesmo assim; só não tem pasta.
                try:
                    pasta_id = await self._criar_pasta_drive_do_caso(caso)
                    if pasta_id:
                        caso["drive_pasta_id"] = pasta_id
                except Exception:
                    log.exception("Caso %s: falha ao criar pasta no Drive", caso["id"])
            await _json(send, 201, caso)
            return
        await _responder(send, 404, b"Nao encontrado")

    async def _criar_pasta_drive_do_caso(self, caso: dict) -> str | None:
        conexao_google = self.registro_google.obter_conexao()
        if not conexao_google:
            return None
        cliente_do_caso = self.gestao.obter_cliente(caso["cliente_id"])
        nome_cliente = cliente_do_caso["nome"] if cliente_do_caso else caso["cliente_id"]
        nome_pasta = f"{nome_cliente} - {caso.get('titulo') or ', '.join(caso.get('processos') or []) or caso['id']}"
        pasta_raiz = os.environ.get("CNJ_GOOGLE_DRIVE_PASTA_RAIZ", "").strip() or None
        async with _cliente(20) as http_cliente:
            access_token = await google_integracao.obter_access_token(
                http_cliente, self.google_client_id, self.google_client_secret, conexao_google["refresh_token"],
            )
            resultado = await google_integracao.criar_pasta_drive(http_cliente, access_token, nome_pasta, pasta_raiz)
        pasta_id = resultado.get("id")
        if pasta_id:
            self.gestao.atualizar_drive_pasta(caso["id"], pasta_id)
        return pasta_id

    async def _caso_detalhe(self, scope, receive, send, caso_id: str):
        """GET /casos/<id>: o caso com sua linha do tempo.
        PATCH /casos/<id>: atualiza campos cadastrais e partes.
        DELETE /casos/<id>: exclui o caso."""
        metodo = scope.get("method")
        if not caso_id or metodo not in ("GET", "PATCH", "DELETE"):
            await _responder(send, 404, b"Nao encontrado")
            return
        if metodo == "DELETE":
            excluiu = self.gestao.excluir_caso(caso_id)
            if not excluiu:
                await _json(send, 404, _erro("Caso não encontrado."))
                return
            await _json(send, 200, {"excluido": True})
            return
        if metodo == "PATCH":
            corpo = await _ler_corpo(receive)
            try:
                dados = json.loads((corpo or b"").decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                await _json(send, 400, _erro("JSON inválido."))
                return
            atual = self.gestao.obter_caso(caso_id)
            if atual is None:
                await _json(send, 404, _erro("Caso não encontrado."))
                return
            # PATCH de Partes e Cadastro envia somente os campos da respectiva aba.
            dados = {**atual, **dados}
            numeros = dados.get("numeros_processo")
            caso = self.gestao.atualizar_caso(
                caso_id,
                titulo=dados.get("titulo"),
                responsavel=dados.get("responsavel"),
                acao=dados.get("acao"),
                foro=dados.get("foro"),
                autor=dados.get("autor"),
                reu=dados.get("reu"),
                advogados=dados.get("advogados"),
                numeros_processo=numeros,
                desfecho=dados.get("desfecho"),
            )
            if caso is None:
                await _json(send, 404, _erro("Caso não encontrado."))
                return
            await _json(send, 200, caso)
            return
        caso = self.gestao.obter_caso(caso_id)
        if caso is None:
            await _json(send, 404, _erro("Caso não encontrado."))
            return
        await _json(send, 200, {**caso, "eventos": self.gestao.eventos_do_caso(caso_id)})

    async def _lancamentos(self, scope, receive, send) -> None:
        """GET /lancamentos: lista todos os lançamentos financeiros.
        POST /lancamentos: cria um lançamento (fase 1: só tipo HONORARIO tem tela no painel)."""
        metodo = scope.get("method")
        if metodo == "GET":
            await _json(send, 200, {"lancamentos": self.gestao.listar_lancamentos()})
            return
        if metodo != "POST":
            await _responder(send, 405, b"Metodo nao permitido")
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        vencimento = (dados.get("vencimento") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", vencimento):
            await _json(send, 400, _erro("Informe a data de vencimento (AAAA-MM-DD)."))
            return
        try:
            valor = float(dados.get("valor"))
        except (TypeError, ValueError):
            await _json(send, 400, _erro("Informe o valor (número)."))
            return
        if valor <= 0:
            await _json(send, 400, _erro("O valor deve ser maior que zero."))
            return
        descricao = (dados.get("descricao") or "").strip()
        if not descricao:
            await _json(send, 400, _erro("Informe a descrição."))
            return
        responsavel = (dados.get("responsavel") or "").strip()
        if not responsavel:
            await _json(send, 400, _erro("Informe o responsável."))
            return
        caso_id = (dados.get("caso_id") or "").strip()
        if self.gestao.obter_caso(caso_id) is None:
            await _json(send, 400, _erro("Selecione um processo/caso válido."))
            return
        cliente_id = (dados.get("cliente_id") or "").strip()
        if self.gestao.obter_cliente(cliente_id) is None:
            await _json(send, 400, _erro("Selecione um cliente válido."))
            return
        direcao = (dados.get("direcao") or "RECEITA").strip().upper()
        if direcao not in ("RECEITA", "DESPESA"):
            await _json(send, 400, _erro("Direção inválida (use RECEITA ou DESPESA)."))
            return
        lancamento = self.gestao.criar_lancamento(
            tipo="HONORARIO", vencimento=vencimento, valor=valor, descricao=descricao,
            recorrente=bool(dados.get("recorrente")), caso_id=caso_id, cliente_id=cliente_id,
            responsavel=responsavel, agora=lambda: datetime.now(timezone.utc), direcao=direcao,
        )
        await _json(send, 201, lancamento)

    async def _lancamento_detalhe(self, scope, receive, send, lancamento_id: str) -> None:
        """DELETE /lancamentos/<id>: exclui um lançamento. PATCH /lancamentos/<id>: marca/
        desmarca como pago (recebido, se direção RECEITA; pago, se DESPESA)."""
        metodo = scope.get("method")
        if not lancamento_id or metodo not in ("DELETE", "PATCH"):
            await _responder(send, 404, b"Nao encontrado")
            return
        if metodo == "DELETE":
            excluiu = self.gestao.excluir_lancamento(lancamento_id)
            await _json(send, 200 if excluiu else 404, {"excluido": excluiu})
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        lancamento = self.gestao.atualizar_lancamento_pago(lancamento_id, bool(dados.get("pago")))
        if lancamento is None:
            await _json(send, 404, _erro("Lançamento não encontrado."))
            return
        await _json(send, 200, lancamento)

    async def _atividades_do_caso(self, scope, receive, send, caso_id: str, aid: int | None):
        """GET /casos/<id>/atividades, POST /casos/<id>/atividades,
        PATCH /casos/<id>/atividades/<aid>, DELETE /casos/<id>/atividades/<aid>"""
        metodo = scope.get("method")
        if not caso_id:
            await _responder(send, 404, b"Nao encontrado")
            return
        if aid is None:
            if metodo == "GET":
                await _json(send, 200, {"atividades": self.gestao.listar_atividades(caso_id)})
                return
            if metodo == "POST":
                corpo = await _ler_corpo(receive)
                try:
                    dados = json.loads((corpo or b"").decode("utf-8") or "{}")
                except (ValueError, UnicodeDecodeError):
                    await _json(send, 400, _erro("JSON inválido."))
                    return
                titulo = (dados.get("titulo") or "").strip()
                if not titulo:
                    await _json(send, 400, _erro("Informe o título da atividade."))
                    return
                atividade = self.gestao.criar_atividade(
                    caso_id,
                    tipo=dados.get("tipo") or "tarefa",
                    titulo=titulo,
                    data=dados.get("data"),
                    hora=dados.get("hora"),
                    observacoes=dados.get("observacoes"),
                    agora=lambda: datetime.now(timezone.utc),
                )
                await _json(send, 201, atividade)
                return
            await _responder(send, 405, b"Metodo nao permitido")
            return
        if metodo == "PATCH":
            corpo = await _ler_corpo(receive)
            try:
                dados = json.loads((corpo or b"").decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                await _json(send, 400, _erro("JSON inválido."))
                return
            atividade = self.gestao.atualizar_atividade(caso_id, aid, **{
                k: v for k, v in dados.items()
                if k in ("titulo", "tipo", "data", "hora", "status", "observacoes")
            })
            if atividade is None:
                await _json(send, 404, _erro("Atividade não encontrada."))
                return
            await _json(send, 200, atividade)
            return
        if metodo == "DELETE":
            excluiu = self.gestao.excluir_atividade(caso_id, aid)
            await _json(send, 200 if excluiu else 404, {"excluido": excluiu})
            return
        await _responder(send, 405, b"Metodo nao permitido")

    async def _evento_calendar_do_caso(self, scope, receive, send, caso_id: str):
        """POST /casos/<id>/evento-calendar: cria um evento de dia inteiro no Google Calendar
        institucional para o prazo calculado (Fase 4), e grava na linha do tempo do caso (mesma
        tabela caso_eventos da Fase 2) - {titulo, data} no corpo."""
        if scope.get("method") != "POST":
            await _responder(send, 404, b"Nao encontrado")
            return
        caso = self.gestao.obter_caso(caso_id)
        if caso is None:
            await _json(send, 404, _erro("Caso não encontrado."))
            return
        conexao_google = self._google_conectado()
        if not conexao_google:
            await _json(send, 400, _erro("Google não conectado. Conecte em /admin antes de criar eventos na agenda."))
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        data_iso = (dados.get("data") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data_iso):
            await _json(send, 400, _erro("Informe 'data' no formato AAAA-MM-DD."))
            return
        titulo = (dados.get("titulo") or "").strip() or f"Prazo: {caso.get('titulo') or caso_id}"
        try:
            async with _cliente(20) as http_cliente:
                access_token = await google_integracao.obter_access_token(
                    http_cliente, self.google_client_id, self.google_client_secret,
                    conexao_google["refresh_token"],
                )
                resultado = await google_integracao.criar_evento_calendar(
                    http_cliente, access_token, titulo, data_iso,
                    f"Criado automaticamente pelo cnj-processual para o caso {caso_id}.", caso_id,
                )
        except google_integracao.ErroGoogle as erro:
            log.warning("Caso %s: falha ao criar evento no Calendar: %s", caso_id, erro)
            await _json(send, 502, _erro(f"Falha ao criar evento no Google Calendar: {erro}"))
            return
        self.gestao.registrar_evento_no_caso(
            caso_id=caso_id, numero_processo=(caso.get("processos") or [None])[0], tipo="prazo_agenda",
            conteudo={"titulo": titulo, "data": data_iso, "evento_id": resultado.get("id"),
                      "link": resultado.get("htmlLink")},
            agora=lambda: datetime.now(timezone.utc),
        )
        await _json(send, 201, {"evento_id": resultado.get("id"), "link": resultado.get("htmlLink")})

    # --- Publicações vinculadas a um caso -------------------------------------

    async def _publicacoes_do_caso(self, scope, receive, send, caso_id: str, pub_hash: str | None):
        metodo = scope.get("method")
        if metodo == "GET" and pub_hash is None:
            pubs = self.publicacoes.listar_por_caso(caso_id)
            await _json(send, 200, {"publicacoes": pubs})
        elif metodo == "POST" and pub_hash is None:
            try:
                corpo = json.loads(await _ler_corpo(receive))
            except Exception:
                await _json(send, 400, _erro("JSON inválido."))
                return
            h = (corpo.get("hash") or "").strip()
            if not h:
                await _json(send, 400, _erro("hash obrigatório."))
                return
            ok = self.publicacoes.vincular_caso(h, caso_id)
            if not ok:
                # Publicação ainda não existia no log (ex.: resultado de busca avulsa no DJEN ou
                # processo pendente de triagem, que não passam pela captura de monitoramento por
                # OAB) - se o cliente mandou os dados da publicação, grava agora já vinculada.
                dados_publicacao = corpo.get("dados")
                if isinstance(dados_publicacao, dict):
                    self.publicacoes.registrar(
                        h, None, corpo.get("nome_pesquisado"), corpo.get("numero_processo"),
                        dados_publicacao, "tratada", caso_id,
                        lambda: datetime.now(timezone.utc),
                    )
                    ok = True
            await _json(send, 200 if ok else 404, {"vinculada": ok})
        elif metodo == "DELETE" and pub_hash:
            ok = self.publicacoes.vincular_caso(pub_hash, None)
            await _json(send, 200 if ok else 404, {"desvinculada": ok})
        else:
            await _responder(send, 405, b"Method Not Allowed")

    # --- Vínculos entre casos -------------------------------------------------

    async def _vinculos_do_caso(
        self, scope, receive, send, caso_id: str, vinculado_id: str | None,
    ):
        """GET /casos/<id>/vinculos
        POST /casos/<id>/vinculos              {caso_vinculado_id, tipo}
        DELETE /casos/<id>/vinculos/<vid>"""
        metodo = scope.get("method")
        if not caso_id:
            await _responder(send, 404, b"Nao encontrado")
            return
        if metodo == "GET" and vinculado_id is None:
            vinculos = self.gestao.listar_vinculos_do_caso(caso_id)
            await _json(send, 200, {"vinculos": vinculos})
            return
        if metodo == "POST" and vinculado_id is None:
            try:
                dados = json.loads((await _ler_corpo(receive) or b"").decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                await _json(send, 400, _erro("JSON inválido."))
                return
            outro_id = (dados.get("caso_vinculado_id") or "").strip()
            tipo = (dados.get("tipo") or "relacionado").strip()
            tipos_validos = {"recurso", "apenso", "execucao", "cautelar", "relacionado"}
            if not outro_id:
                await _json(send, 400, _erro("Informe caso_vinculado_id."))
                return
            if tipo not in tipos_validos:
                await _json(send, 400, _erro(f"tipo inválido. Use: {', '.join(sorted(tipos_validos))}."))
                return
            try:
                vinculo = self.gestao.adicionar_vinculo(
                    caso_id, outro_id, tipo, agora=lambda: datetime.now(timezone.utc),
                )
            except ValueError as exc:
                await _json(send, 409, _erro(str(exc)))
                return
            if vinculo is None:
                await _json(send, 404, _erro("Um dos casos não foi encontrado."))
                return
            await _json(send, 201, vinculo)
            return
        if metodo == "DELETE" and vinculado_id:
            removeu = self.gestao.remover_vinculo(caso_id, vinculado_id)
            await _json(send, 200 if removeu else 404, {"removido": removeu})
            return
        await _responder(send, 405, b"Method Not Allowed")

    # --- Publicações por OAB (log geral, captura a cada 24h) -------------------

    async def _publicacoes_oab(self, scope, send):
        if scope.get("method") != "GET":
            await _responder(send, 404, b"Nao encontrado")
            return
        status = dict(_query(scope)).get("status") or None
        if status and status not in ("nao_tratada", "tratada", "arquivada"):
            await _json(send, 400, _erro("status inválido."))
            return
        publicacoes = self.publicacoes.listar(status)
        total = self.publicacoes.contar(status)
        await _json(send, 200, {"publicacoes": publicacoes, "total": total})

    async def _publicacoes_oab_status(self, scope, receive, send):
        """POST /publicacoes-oab/status: atualização em lote - {hashes: [...], status: "..."}."""
        if scope.get("method") != "POST":
            await _responder(send, 404, b"Nao encontrado")
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        hashes = dados.get("hashes")
        status = dados.get("status")
        if not isinstance(hashes, list) or not hashes:
            await _json(send, 400, _erro("Informe ao menos um hash em 'hashes'."))
            return
        if status not in ("nao_tratada", "tratada", "arquivada"):
            await _json(send, 400, _erro("status deve ser nao_tratada, tratada ou arquivada."))
            return
        quantidade = self.publicacoes.atualizar_status(hashes, status)
        await _json(send, 200, {"atualizadas": quantidade})

    async def _publicacoes_oab_capturar_manual(self, scope, receive, send):
        """POST /publicacoes-oab/capturar-manual: captura sob demanda por OAB + intervalo de datas."""
        if scope.get("method") != "POST":
            await _responder(send, 404, b"Nao encontrado")
            return
        corpo = await _ler_corpo(receive)
        try:
            dados = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        resultado, erro = await _capturar_publicacoes_oab_manual(self.publicacoes, self.gestao, dados)
        if erro:
            await _json(send, 400, erro)
            return
        await _json(send, 200, resultado)

    async def _publicacao_oab_criar_caso(self, scope, receive, send, hash_publicacao: str):
        """POST /publicacoes-oab/<hash>/criar-caso: atalho do "+" na tabela - cria o caso (cliente
        novo com o nome pesquisado, se houver) e já marca a publicação como tratada (Q9)."""
        if scope.get("method") != "POST":
            await _responder(send, 404, b"Nao encontrado")
            return
        publicacao = self.publicacoes.obter(hash_publicacao)
        if publicacao is None:
            await _json(send, 404, _erro("Publicação não encontrada."))
            return
        if not publicacao.get("numero_processo"):
            await _json(send, 400, _erro("Publicação sem número de processo identificado; não é possível criar caso."))
            return
        corpo = await _ler_corpo(receive)
        try:
            dados_corpo = json.loads((corpo or b"").decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            await _json(send, 400, _erro("JSON inválido."))
            return
        nome_sugerido = (dados_corpo.get("nome_cliente") or publicacao.get("nome_pesquisado") or "").strip()
        if not nome_sugerido:
            await _json(send, 400, _erro("Informe nome_cliente: a publicação não tem um nome pesquisado associado."))
            return
        corpo_caso = {
            "cliente_novo": {"nome": nome_sugerido},
            "titulo": (dados_corpo.get("titulo") or "").strip() or None,
            "numeros_processo": [publicacao["numero_processo"]],
        }
        caso, erro = _criar_caso_validado(self.gestao, corpo_caso, self.publicacoes)
        if erro:
            await _json(send, 400, erro)
            return
        self.publicacoes.atualizar_status([hash_publicacao], "tratada", caso_id=caso["id"])
        await _json(send, 201, caso)


def _ip_cliente(scope) -> str:
    """IP de quem fez a requisição. Atrás do Caddy, o último X-Forwarded-For é o IP que o proxy viu."""
    for nome, valor in scope.get("headers") or []:
        if nome == b"x-forwarded-for":
            return valor.decode("latin-1").split(",")[-1].strip() or "desconhecido"
    cliente = scope.get("client")
    return cliente[0] if cliente else "desconhecido"


CADASTRO_TEMPO_MINIMO_S = float(os.environ.get("CNJ_CADASTRO_TEMPO_MINIMO_S", "2.5"))


async def _com_tempo_minimo(atendimento, scope, receive, send) -> None:
    """Executa o atendimento e só entrega a resposta depois de um tempo mínimo fixo."""
    inicio = time.monotonic()
    mensagens: list[dict] = []

    async def guardar(mensagem):
        mensagens.append(mensagem)

    await atendimento(scope, receive, guardar)
    restante = CADASTRO_TEMPO_MINIMO_S - (time.monotonic() - inicio)
    if restante > 0:
        await asyncio.sleep(restante)
    for mensagem in mensagens:
        await send(mensagem)


async def _ler_corpo(receive) -> bytes | None:
    """Lê o corpo da requisição. Devolve None se passar do tamanho máximo de formulário."""
    partes: list[bytes] = []
    total = 0
    while True:
        mensagem = await receive()
        bloco = mensagem.get("body", b"")
        total += len(bloco)
        if total > _TAMANHO_MAX_FORM:
            return None
        partes.append(bloco)
        if not mensagem.get("more_body"):
            return b"".join(partes)


async def _healthz(send) -> None:
    """Responde ao /healthz com JSON rico: circuit breakers, cache DataJud e backoff de monitoramentos."""
    agora = time.time()

    def _info_cb(cb: CircuitBreaker) -> dict:
        with cb._lock:
            estado = cb._estado
            falhas = cb._falhas_consecutivas
            if estado == CircuitBreaker.ABERTO and cb._aberto_em is not None:
                restante = max(0.0, cb.cooldown_s - (agora - cb._aberto_em))
            else:
                restante = 0.0
        return {"estado": estado, "falhas_consecutivas": falhas, "cooldown_restante_s": round(restante, 1)}

    cache_stats: dict
    if _CACHE_DATAJUD is not None:
        try:
            cache_stats = await asyncio.to_thread(_CACHE_DATAJUD.stats)
            cache_stats["ttl_s"] = _CACHE_DATAJUD.ttl_s
        except Exception:
            cache_stats = {"erro": "indisponivel"}
    else:
        cache_stats = {"total": 0, "validos": 0, "ttl_s": 0}

    agora_ts = agora
    em_backoff = sum(
        1 for ts in _PROXIMA_TENTATIVA_MONITORAMENTO.values() if ts > agora_ts
    )

    payload = {
        "status": "ok",
        "uptime_s": round(agora - _INICIO_SERVIDOR, 1),
        "circuit_breakers": {
            "datajud": _info_cb(_CIRCUIT_DATAJUD),
            "djen": _info_cb(_CIRCUIT_DJEN),
        },
        "cache_datajud": cache_stats,
        "monitoramentos": {
            "em_backoff": em_backoff,
            "com_falhas": len(_FALHAS_MONITORAMENTO),
        },
    }
    corpo = json.dumps(payload, ensure_ascii=False).encode()
    await _responder(send, 200, corpo, tipo="application/json; charset=utf-8")


async def _responder(send, status: int, corpo: bytes, tipo: str = "text/plain; charset=utf-8",
                     cabecalhos_extra=()) -> None:
    cabecalhos = [(b"content-type", tipo.encode()), (b"content-length", str(len(corpo)).encode())]
    cabecalhos.extend(cabecalhos_extra)
    await send({"type": "http.response.start", "status": status, "headers": cabecalhos})
    await send({"type": "http.response.body", "body": corpo})


_ESTILO_PAGINAS = """
body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
td, th { border-bottom: 1px solid #ddd; padding: .4rem; text-align: left; }
form { display: block; margin: .6rem 0; }
input { padding: .5rem; margin: .2rem 0; width: 100%; max-width: 360px; box-sizing: border-box; }
button { padding: .5rem 1rem; }
.aviso { background: #f3f3f3; padding: .6rem; border-radius: 6px; }
"""


# Estilo próprio da página de cadastro. Paleta: tinta fria + um único acento teal (contraste AA
# com texto branco no botão). Raio único: 14px no cartão, 10px nos controles.
_ESTILO_CADASTRO = """
:root {
  color-scheme: light dark;
  --fundo: #f4f6f8;
  --cartao: #ffffff;
  --texto: #14202b;
  --texto-suave: #4a5a68;
  --borda: #d6dde4;
  --acento: #0f766e;
  --acento-hover: #0c5f58;
  --foco: #0f766e;
  --erro-fundo: #fdecec;
  --erro-texto: #8a1c1c;
  --aviso-fundo: #e7f4f2;
  --aviso-texto: #0c4a45;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --fundo: #0e151c;
    --cartao: #17222c;
    --texto: #eaf0f4;
    --texto-suave: #9fb0bd;
    --borda: #2b3a46;
    --acento: #2dd4bf;
    --acento-hover: #5eead4;
    --foco: #5eead4;
    --erro-fundo: #3a1c1c;
    --erro-texto: #ffb4b4;
    --aviso-fundo: #12332f;
    --aviso-texto: #bff3ea;
  }
}
:root[data-theme="dark"] {
  --fundo: #0e151c;
  --cartao: #17222c;
  --texto: #eaf0f4;
  --texto-suave: #9fb0bd;
  --borda: #2b3a46;
  --acento: #2dd4bf;
  --acento-hover: #5eead4;
  --foco: #5eead4;
  --erro-fundo: #3a1c1c;
  --erro-texto: #ffb4b4;
  --aviso-fundo: #12332f;
  --aviso-texto: #bff3ea;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: var(--fundo);
  color: var(--texto);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.cartao {
  width: 100%;
  max-width: 440px;
  background: var(--cartao);
  border: 1px solid var(--borda);
  border-radius: 14px;
  padding: 32px 28px;
  box-shadow: 0 1px 2px rgb(20 32 43 / 0.06), 0 12px 32px rgb(20 32 43 / 0.06);
}
.marca {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--texto-suave);
  margin: 0 0 16px;
}
h1 {
  font-size: 1.5rem;
  line-height: 1.25;
  font-weight: 650;
  letter-spacing: -0.01em;
  margin: 0 0 8px;
}
.apoio {
  margin: 0 0 24px;
  color: var(--texto-suave);
  font-size: 0.975rem;
}
.aviso {
  margin: 0 0 20px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--aviso-fundo);
  color: var(--aviso-texto);
  font-size: 0.925rem;
}
.aviso.erro {
  background: var(--erro-fundo);
  color: var(--erro-texto);
}
form { margin: 0; }
label {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 6px;
}
input {
  width: 100%;
  padding: 12px 14px;
  font: inherit;
  color: var(--texto);
  background: var(--cartao);
  border: 1px solid var(--borda);
  border-radius: 10px;
}
input::placeholder { color: var(--texto-suave); opacity: 0.8; }
input:focus-visible,
button:focus-visible,
a:focus-visible {
  outline: 3px solid var(--foco);
  outline-offset: 2px;
}
.ajuda {
  display: block;
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--texto-suave);
}
button {
  width: 100%;
  margin-top: 18px;
  padding: 13px 16px;
  font: inherit;
  font-weight: 600;
  color: #ffffff;
  background: var(--acento);
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 150ms ease, transform 100ms ease;
}
button:hover { background: var(--acento-hover); }
button:active { transform: scale(0.98); }
.rodape {
  margin: 24px 0 0;
  padding-top: 18px;
  border-top: 1px solid var(--borda);
  font-size: 0.875rem;
  color: var(--texto-suave);
}
@media (max-width: 480px) {
  .cartao { padding: 24px 20px; }
  h1 { font-size: 1.3rem; }
}
.termos {
  max-height: 300px;
  overflow-y: auto;
  padding: 14px 16px;
  margin: 0 0 18px;
  border: 1px solid var(--borda);
  border-radius: 10px;
  background: var(--fundo);
  font-size: 0.9rem;
  color: var(--texto);
}
.termos:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
.termos h2 {
  font-size: 0.95rem;
  font-weight: 650;
  margin: 14px 0 4px;
}
.termos h2:first-child { margin-top: 0; }
.termos p { margin: 0 0 8px; }
.aceite {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 0.9rem;
  font-weight: 500;
  margin: 0 0 4px;
}
.aceite input { width: auto; margin-top: 3px; }
.alerta {
  margin: 0 0 20px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--foco);
  background: var(--aviso-fundo);
  color: var(--aviso-texto);
  font-size: 0.925rem;
}
.alerta strong { display: block; margin-bottom: 2px; }
.g-recaptcha { margin-top: 16px; }
/* Feedback de envio: a barra só aparece enquanto o formulário está sendo enviado */
.enviando-barra {
  position: relative;
  height: 2px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--borda);
  opacity: 0;
  transition: opacity 150ms ease-out;
}
.enviando-barra::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--acento);
  transform: translateX(-100%);
}
form.enviando .enviando-barra { opacity: 1; }
form.enviando .enviando-barra::after { animation: enviando-correr 1.2s linear infinite; }
button:disabled { opacity: 0.7; cursor: progress; }
@keyframes enviando-correr {
  to { transform: translateX(100%); }
}
.voltar {
  display: inline-block;
  margin-top: 14px;
  font-size: 0.875rem;
  color: var(--texto-suave);
}
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
  form.enviando .enviando-barra::after { animation: none; transform: translateX(-40%); }
}
"""


def _pagina_termos(mensagem: str | None = None, erro: bool = False) -> str:
    """Primeira tela do cadastro: os termos precisam ser lidos e aceitos antes do e-mail."""
    classe_aviso = "aviso erro" if erro else "aviso"
    aviso = f"<p class='{classe_aviso}' role='status'>{_escapar(mensagem)}</p>" if mensagem else ""
    secoes = "\n".join(
        f"<h2>{_escapar(titulo)}</h2>" + "".join(f"<p>{_escapar(p)}</p>" for p in paragrafos)
        for titulo, paragrafos in TERMOS_SECOES
    )
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Termos de uso · cnj-processual</title>
<style>{_ESTILO_CADASTRO}</style></head><body>
<main class="cartao">
<p class="marca">cnj-processual · versão {_escapar(TERMOS_VERSAO)}</p>
<h1>Termos de uso</h1>
<p class="apoio">Leia os termos antes de pedir o seu token.</p>
{aviso}
<div class="termos" tabindex="0" aria-label="Texto dos termos de uso">
{secoes}
</div>
<form method="get" action="/cadastro">
<input type="hidden" name="etapa" value="email">
<label class="aceite"><input type="checkbox" name="aceite" value="sim" required>
<span>Li os termos de uso e concordo com eles.</span></label>
<button type="submit">Continuar</button>
</form>
<p class="rodape">A versão aceita fica registrada junto ao seu e-mail.</p>
<a class="voltar" href="/guia">Guia do usuário: como usar o serviço</a>
</main>
</body></html>"""


def _pagina_cadastro(mensagem: str | None = None, erro: bool = False, site_key: str | None = None) -> str:
    classe_aviso = "aviso erro" if erro else "aviso"
    aviso = (
        f"<p class='{classe_aviso}' role='status'>{_escapar(mensagem)}</p>" if mensagem else ""
    )
    # reCAPTCHA só aparece quando a chave de site está configurada no servidor
    if site_key:
        captcha = (
            '<script src="https://www.google.com/recaptcha/api.js" async defer></script>'
            f'<div class="g-recaptcha" data-sitekey="{_escapar(site_key)}"></div>'
        )
    else:
        captcha = ""
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pedir token de acesso · cnj-processual</title>
<style>{_ESTILO_CADASTRO}</style></head><body>
<main class="cartao">
<p class="marca">cnj-processual</p>
<h1>Pedir seu token de acesso</h1>
<p class="apoio">Informe o seu e-mail. O token será enviado para esse endereço e não aparece nesta página.</p>
<p class="alerta" role="note"><strong>Anote o seu token assim que chegar no e-mail.</strong>
Ele não será mostrado novamente. Se perder, peça um novo, e o anterior deixa de valer.</p>
{aviso}
<form method="post" action="/cadastro">
<input type="hidden" name="aceite" value="sim">
<label for="email">E-mail</label>
<input id="email" type="email" name="email" required autocomplete="email" inputmode="email"
       placeholder="voce@exemplo.com.br" aria-describedby="ajuda-email">
<span id="ajuda-email" class="ajuda">Use o e-mail que você vai cadastrar no seu cliente MCP.</span>
{captcha}
<button type="submit">Enviar token por e-mail</button>
<div class="enviando-barra" aria-hidden="true"></div>
</form>
<a class="voltar" href="/cadastro">Voltar aos termos de uso</a>
<a class="voltar" href="/guia">Guia do usuário: como usar o serviço</a>
<p class="rodape">Já tem token e perdeu o acesso? Peça um novo: o token anterior deixa de valer.</p>
</main>
<script src="/static/cadastro.js" defer></script>
</body></html>"""


# Layout da página administrativa, sobre a folha do Carbon (static/carbon/styles.min.css).
_ESTILO_ADMIN_LAYOUT = """
body { margin: 0; min-height: 100dvh; }
.admin-pagina { max-width: 960px; margin: 0 auto; padding: 2rem 1rem; }
.admin-cabecalho { margin-bottom: 2rem; }
.admin-cabecalho h1 { font-size: 1.75rem; font-weight: 600; margin: 0.25rem 0; }
.admin-cabecalho p { margin: 0; }
.admin-secao { margin-bottom: 2rem; }
.admin-secao h2 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.75rem; }
.cds--data-table-container { overflow-x: auto; }
.admin-form { max-width: 30rem; }
.admin-form .cds--form-item { margin-bottom: 1rem; }
.admin-acoes { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.token-valor {
  margin: 1rem 0 0;
  padding: 1rem;
  overflow-x: auto;
  background: var(--cds-layer-02, #f4f4f4);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 0.875rem;
}
.admin-notificacao { margin-bottom: 1.5rem; }
"""


def _data_legivel(iso: str) -> str:
    """'2026-10-05T14:03:00+00:00' vira '05/10/2026 14:03'. Valores fora do padrão voltam como vieram."""
    try:
        dt = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return str(iso or "")
    return dt.strftime("%d/%m/%Y %H:%M")


def _notificacao(tipo: str, titulo: str, subtitulo: str | None = None) -> str:
    """Notificação inline do Carbon. tipo: 'info', 'success', 'warning' ou 'error'."""
    sub = f"<p class='cds--inline-notification__subtitle'>{_escapar(subtitulo)}</p>" if subtitulo else ""
    papel = "alert" if tipo in ("warning", "error") else "status"
    return (
        f"<div class='cds--inline-notification cds--inline-notification--{tipo} admin-notificacao' role='{papel}'>"
        "<div class='cds--inline-notification__details'>"
        "<div class='cds--inline-notification__text-wrapper'>"
        f"<p class='cds--inline-notification__title'>{_escapar(titulo)}</p>{sub}"
        "</div></div></div>"
    )


def _pagina_admin(registro: RegistroUsuarios, mensagem: str | None, token_novo: str | None = None,
                  mostrar_lista: bool = False, erro: bool = False,
                  google_conectado: dict | None = None, google_configurado: bool = False) -> str:
    linhas = []
    if mostrar_lista:
        for nome, r in sorted(registro.carregar().items()):
            revogado = bool(r.get("revogado"))
            tag = "<span class='cds--tag cds--tag--gray'>Revogado</span>" if revogado \
                else "<span class='cds--tag cds--tag--green'>Ativo</span>"
            linhas.append(
                "<tr>"
                f"<td>{_escapar(nome)}</td>"
                f"<td>{tag}</td>"
                f"<td>{_escapar(_data_legivel(r.get('criado_em', '')))}</td>"
                "</tr>"
            )
    if linhas:
        corpo_tabela = "\n".join(linhas)
    elif mostrar_lista:
        corpo_tabela = "<tr><td colspan='3'>Nenhum usuário cadastrado.</td></tr>"
    else:
        corpo_tabela = ("<tr><td colspan='3'>Informe o token administrativo e escolha uma ação "
                        "para carregar a lista.</td></tr>")

    bloco_mensagem = ""
    if mensagem:
        bloco_mensagem = _notificacao("error" if erro else "info", mensagem)
    bloco_token = ""
    if token_novo:
        bloco_token = (
            "<section class='admin-secao'>"
            + _notificacao("warning", "Copie o token agora",
                           "Ele não será mostrado de novo. Entregue por canal seguro.")
            + f"<pre class='token-valor'>{_escapar(token_novo)}</pre>"
            + "</section>"
        )

    if not google_configurado:
        bloco_google_acao = "<p>Não configurada: defina CNJ_GOOGLE_CLIENT_ID e CNJ_GOOGLE_CLIENT_SECRET no servidor.</p>"
    elif google_conectado:
        bloco_google_acao = (
            f"<p>Conectada em {_escapar(_data_legivel(google_conectado.get('conectado_em', '')))}.</p>"
            "<form method='post' action='/admin/google/desconectar' class='admin-form'>"
            "<div class='cds--form-item'>"
            "<label class='cds--label' for='token_admin_google_desc'>Token administrativo</label>"
            "<input class='cds--text-input' id='token_admin_google_desc' type='password' name='token_admin' required autocomplete='off'>"
            "</div>"
            "<button class='cds--btn cds--btn--danger' type='submit'>Desconectar</button>"
            "</form>"
        )
    else:
        bloco_google_acao = (
            "<p>Agenda (Calendar) e arquivos (Drive) do escritório, numa única conta institucional.</p>"
            "<form method='post' action='/admin/google/iniciar' class='admin-form'>"
            "<div class='cds--form-item'>"
            "<label class='cds--label' for='token_admin_google'>Token administrativo</label>"
            "<input class='cds--text-input' id='token_admin_google' type='password' name='token_admin' required autocomplete='off'>"
            "</div>"
            "<button class='cds--btn cds--btn--primary' type='submit'>Conectar Google</button>"
            "</form>"
        )
    bloco_google = f"<section class='admin-secao'><h2>Integração Google</h2>{bloco_google_acao}</section>"

    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Administração · cnj-processual</title>
<link rel="stylesheet" href="/static/carbon/styles.min.css">
<style>{_ESTILO_ADMIN_LAYOUT}</style></head>
<body class="cds--g10">
<main class="admin-pagina">
<header class="admin-cabecalho">
<p class="cds--label">cnj-processual · administração</p>
<h1>Usuários</h1>
<p>Crie ou revogue o acesso de cada pessoa. A revogação vale imediatamente.</p>
</header>
{bloco_mensagem}
{bloco_token}
<section class="admin-secao">
<h2>Lista</h2>
<div class="cds--data-table-container">
<table class="cds--data-table">
<thead><tr>
<th scope="col">Nome</th><th scope="col">Situação</th><th scope="col">Criado em</th>
</tr></thead>
<tbody>
{corpo_tabela}
</tbody>
</table>
</div>
</section>

<section class="admin-secao">
<h2>Ação</h2>
<form method="post" action="/admin/acao" class="admin-form">
<div class="cds--form-item">
<label class="cds--label" for="nome">Nome ou e-mail</label>
<input class="cds--text-input" id="nome" name="nome" placeholder="ana ou ana@exemplo.com.br" required autocomplete="off">
</div>
<div class="cds--form-item">
<label class="cds--label" for="token_admin">Token administrativo</label>
<input class="cds--text-input" id="token_admin" type="password" name="token_admin" required autocomplete="off">
</div>
<div class="admin-acoes">
<button class="cds--btn cds--btn--primary" type="submit" name="acao" value="criar">Criar</button>
<button class="cds--btn cds--btn--danger" type="submit" name="acao" value="revogar">Revogar</button>
</div>
</form>
</section>

{bloco_google}
</main>
</body></html>"""


def _executar_acao_admin(registro: RegistroUsuarios, acao: str, nome: str) -> tuple[str, str | None]:
    """Cria ou revoga um usuário e devolve (mensagem, token_novo). Usada pela página administrativa."""
    nome = nome.strip().lower()
    if acao == "criar":
        _, mensagem, token = _criar_usuario_core(registro, nome)
        return mensagem, token
    if acao == "revogar":
        _, mensagem = _revogar_usuario_core(registro, nome)
        return mensagem, None
    return "Ação desconhecida.", None


# --- Administração de usuários (linha de comando e página) -------------------

def _criar_usuario_core(registro: RegistroUsuarios, nome: str) -> tuple[bool, str, str | None]:
    if not _NOME_USUARIO.fullmatch(nome):
        return False, "Nome inválido: use letras minúsculas, números, '.', '_', '-', '+', '@' (2 a 254 caracteres).", None
    token = secrets.token_urlsafe(32)
    resultado = {"ok": False}

    def criar(dados: dict):
        if nome in dados and not dados[nome].get("revogado"):
            return False
        dados[nome] = {
            "hash": _hash_token(token),
            "criado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "revogado": False,
            "origem": "admin",
        }
        resultado["ok"] = True

    registro.atualizar(criar)
    if not resultado["ok"]:
        return False, f"Já existe um usuário ativo chamado '{nome}'. Revogue antes de recriar.", None
    return True, f"Usuário '{nome}' criado.", token


def _revogar_usuario_core(registro: RegistroUsuarios, nome: str) -> tuple[bool, str]:
    resultado = {"ok": False}

    def revogar(dados: dict):
        if nome not in dados or dados[nome].get("revogado"):
            return False
        dados[nome]["revogado"] = True
        dados[nome]["revogado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        dados[nome]["revogado_por"] = "admin"
        resultado["ok"] = True

    registro.atualizar(revogar)
    if not resultado["ok"]:
        return False, f"Não há usuário ativo chamado '{nome}'."
    return True, f"Usuário '{nome}' revogado. O token deixa de valer imediatamente."


def _criar_usuario(registro: RegistroUsuarios, nome: str) -> int:
    ok, mensagem, token = _criar_usuario_core(registro, nome)
    if not ok:
        print(mensagem)
        return 1
    print(mensagem + " Token (mostrado só agora; entregue por canal seguro):")
    print(token)
    return 0


def _revogar_usuario(registro: RegistroUsuarios, nome: str) -> int:
    ok, mensagem = _revogar_usuario_core(registro, nome)
    print(mensagem)
    return 0 if ok else 1


def _listar_usuarios(registro: RegistroUsuarios) -> int:
    dados = registro.carregar()
    if not dados:
        print("Nenhum usuário cadastrado.")
        return 0
    for nome, r in sorted(dados.items()):
        situacao = "revogado" if r.get("revogado") else "ativo"
        print(f"{nome:<40} {situacao:<9} criado em {r.get('criado_em', '?')}")
    return 0


def _seguranca_de_transporte(hosts_permitidos: str) -> "TransportSecuritySettings | None":
    """Monta a lista de Host e Origin aceitos pelo SDK, a partir de CNJ_MCP_HOSTS_PERMITIDOS.

    O navegador manda o cabeçalho Origin em requisições POST, mesmo de mesma origem. Por isso o
    domínio público precisa entrar tanto em allowed_hosts quanto em allowed_origins: liberar só o
    primeiro derruba o painel web com "Invalid Origin header", porque curl e clientes MCP comuns
    não mandam Origin e por isso nunca pegam esse caso.
    """
    hosts_extras = [h.strip() for h in hosts_permitidos.split(",") if h.strip()]
    if not hosts_extras:
        return None
    origens_extras = [f"https://{h}" for h in hosts_extras] + [f"http://{h}" for h in hosts_extras]
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*", *hosts_extras],
        allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*", *origens_extras],
    )


def _inteiro_env(nome: str, padrao: int) -> int:
    try:
        return max(0, int(os.environ.get(nome, padrao)))
    except ValueError:
        sys.exit(f"Erro: {nome} deve ser um número inteiro.")


def _smtp_do_ambiente() -> ConfiguracaoSMTP | None:
    """Lê CNJ_SMTP_*. Sem CNJ_SMTP_HOST, o cadastro público fica desligado."""
    host = os.environ.get("CNJ_SMTP_HOST", "").strip()
    if not host:
        return None
    remetente = os.environ.get("CNJ_SMTP_REMETENTE", "").strip() or os.environ.get("CNJ_SMTP_USUARIO", "").strip()
    return ConfiguracaoSMTP(
        host=host,
        porta=_inteiro_env("CNJ_SMTP_PORTA", 587),
        usuario=os.environ.get("CNJ_SMTP_USUARIO", "").strip(),
        senha=os.environ.get("CNJ_SMTP_SENHA", ""),
        remetente=remetente,
    )


def _montar_app_http(
    registro,
    limitador,
    admin_token: str | None,
    cadastro,
    oauth,
    captcha,
    site_captcha_key: str | None,
    falhas,
    gestao,
    registro_google,
    google_client_id: str | None,
    google_client_secret: str | None,
    publicacoes,
):
    """Constrói e retorna o app ASGI completo (AutenticacaoBearer envolvendo o MCP)."""
    return _AutenticacaoBearer(
        mcp.streamable_http_app(),
        registro,
        limitador,
        admin_token,
        cadastro,
        oauth,
        captcha,
        site_captcha_key,
        falhas=falhas,
        gestao=gestao,
        registro_google=registro_google,
        google_client_id=google_client_id,
        google_client_secret=google_client_secret,
        publicacoes=publicacoes,
    )


def _montar_agendador(
    smtp,
    registro_monitoramentos,
    gestao,
    google_configurado: bool,
    registro_google,
    google_client_id: str | None,
    google_client_secret: str | None,
    publicacoes,
):
    """Monta e retorna um AsyncIOScheduler com todos os jobs periódicos configurados."""
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    agendador = AsyncIOScheduler()
    if smtp is not None:
        agendador.add_job(
            _verificar_monitoramentos_pendentes,
            "interval",
            hours=MONITORAMENTO_INTERVALO_HORAS,
            args=[registro_monitoramentos, smtp],
            kwargs={"gestao": gestao},
        )
        log.info("Monitoramento: verificação periódica a cada %dh.", MONITORAMENTO_INTERVALO_HORAS)
    if google_configurado:
        agendador.add_job(
            _sincronizar_calendar_google_job,
            "interval",
            hours=1,
            args=[registro_google, gestao, google_client_id, google_client_secret],
        )
        log.info("Google Calendar: sincronização periódica a cada 1h (se conectado em /admin).")
    agendador.add_job(
        _capturar_publicacoes_oab,
        "interval",
        hours=24,
        args=[registro_monitoramentos, publicacoes, gestao],
    )
    log.info("Publicações por OAB: captura periódica a cada 24h.")
    return agendador


def _principal() -> int:
    parser = argparse.ArgumentParser(description="Servidor MCP cnj-processual.")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default=os.environ.get("CNJ_MCP_TRANSPORT", "stdio"),
        help="stdio (padrão, uso local) ou http (servidor compartilhado).",
    )
    parser.add_argument("--host", default=os.environ.get("CNJ_MCP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("CNJ_MCP_PORT", "8000")))
    parser.add_argument("--criar-usuario", metavar="NOME", help="Cria um usuário e mostra o token uma vez.")
    parser.add_argument("--revogar-usuario", metavar="NOME", help="Revoga o token de um usuário.")
    parser.add_argument("--listar-usuarios", action="store_true", help="Lista os usuários cadastrados.")
    parser.add_argument(
        "--atualizar-arvores-cjpg", action="store_true",
        help="Baixa e salva as árvores de Vara/Classe/Assunto/Magistrado do CJPG (TJSP), usadas pelo autocomplete da aba Jurimetria.",
    )
    args = parser.parse_args()

    # CNJ_MCP_USUARIOS, por compatibilidade, só define o diretório de dados agora: o arquivo
    # usuarios.json (se existir) é migrado uma vez para o banco SQLite (cnj.db) nesse mesmo diretório.
    dados_dir = Path(os.environ.get("CNJ_MCP_USUARIOS", "usuarios.json")).parent
    banco_caminho = dados_dir / os.environ.get("CNJ_MCP_BANCO", "cnj.db")
    _db.migrar_de_json_se_necessario(banco_caminho, dados_dir)
    registro = RegistroUsuarios(banco_caminho)

    if args.criar_usuario:
        return _criar_usuario(registro, args.criar_usuario.strip().lower())
    if args.revogar_usuario:
        return _revogar_usuario(registro, args.revogar_usuario.strip().lower())
    if args.listar_usuarios:
        return _listar_usuarios(registro)
    if args.atualizar_arvores_cjpg:
        resumo = asyncio.run(atualizar_arvores_cjpg())
        for campo, quantidade in resumo.items():
            print(f"{campo}: {quantidade} registros salvos em {_dir_arvores_cjpg() / (campo + '.json')}")
        if resumo.get("magistrado", 0) == 0:
            print(
                "\nAVISO: 'magistrado' salvou 0 registros. Esse campo não é um scraping HTTP simples "
                "como os outros três - a grade de magistrados é montada no DOM pelo JavaScript do "
                "e-SAJ, não é espelhável por GET/POST direto (ver comentário em _CJPG_ARVORE_URLS). "
                "Até isso ser resolvido, atualize magistrado.json manualmente: abra a lupa de "
                "Magistrado no CJPG num navegador, extraia os pares código/nome do DOM "
                "(td[reference=cdAgente] + td[reference=nmAgente]) e salve como "
                "[{\"codigo\": \"...\", \"nome\": \"...\"}, ...] no arquivo magistrado.json.",
                file=sys.stderr,
            )
        return 0

    if args.transport == "stdio":
        mcp.run(transport="stdio")
        return 0

    smtp = _smtp_do_ambiente()
    if not registro.ativos() and smtp is None:
        print(
            "Erro: nenhum usuário ativo e cadastro público desligado (sem CNJ_SMTP_HOST). "
            "Crie um usuário com --criar-usuario NOME ou configure o SMTP.",
            file=sys.stderr,
        )
        return 1

    admin_token = os.environ.get("CNJ_MCP_ADMIN_TOKEN", "").strip() or None
    if admin_token and len(admin_token) < 24:
        sys.exit("Erro: CNJ_MCP_ADMIN_TOKEN precisa ter pelo menos 24 caracteres.")
    limitador = LimitadorUso(
        por_minuto=_inteiro_env("CNJ_MCP_LIMITE_POR_MINUTO", 20),
        por_dia=_inteiro_env("CNJ_MCP_LIMITE_DIARIO", 300),
    )
    cadastro = None
    if smtp is not None:
        cadastro = CadastroPublico(
            registro,
            smtp,
            limitador_ip=LimitadorUso(por_minuto=3, por_dia=30),
            limitador_email=LimitadorUso(por_minuto=1, por_dia=5),
        )

    # O SDK recusa Host e Origin que não estejam na lista (proteção contra DNS rebinding). Atrás de
    # um domínio público, é preciso liberá-lo em CNJ_MCP_HOSTS_PERMITIDOS (ex.: mcp.seudominio.com.br).
    seguranca = _seguranca_de_transporte(os.environ.get("CNJ_MCP_HOSTS_PERMITIDOS", ""))
    if seguranca:
        mcp.settings.transport_security = seguranca

    import uvicorn

    segredo_captcha = os.environ.get("CNJ_RECAPTCHA_SECRET", "").strip()
    site_captcha = os.environ.get("CNJ_RECAPTCHA_SITE_KEY", "").strip()
    if bool(segredo_captcha) != bool(site_captcha):
        sys.exit("Erro: defina CNJ_RECAPTCHA_SITE_KEY e CNJ_RECAPTCHA_SECRET juntos.")
    url_publica = os.environ.get("CNJ_MCP_URL_PUBLICA", "").strip()
    host_publico = urlsplit(url_publica).hostname if url_publica else None
    captcha = VerificadorRecaptcha(segredo_captcha, host_publico) if segredo_captcha else None
    if captcha is not None and not host_publico:
        log.warning("CNJ_MCP_URL_PUBLICA não definida: o reCAPTCHA não confere o domínio da resposta.")
    if cadastro is not None and captcha is None:
        log.warning("reCAPTCHA não configurado: o cadastro público não verifica se é um robô.")

    oauth = ServidorOAuth(registro, registro.caminho.parent / "oauth.json",
                          limitador_registro=LimitadorUso(por_minuto=5, por_dia=50))
    falhas = LimitadorUso(por_minuto=10, por_dia=300)

    registro_monitoramentos = RegistroMonitoramentos(banco_caminho)
    gestao = RegistroClientesCasos(banco_caminho)
    registro_google = RegistroIntegracaoGoogle(banco_caminho)
    publicacoes = RegistroPublicacoesOAB(banco_caminho)
    global _CACHE_DATAJUD
    _CACHE_DATAJUD = CacheDataJud(banco_caminho, ttl_s=DATAJUD_CACHE_TTL_S)
    google_client_id = os.environ.get("CNJ_GOOGLE_CLIENT_ID", "").strip() or None
    google_client_secret = os.environ.get("CNJ_GOOGLE_CLIENT_SECRET", "").strip() or None
    global _ESTADO_MONITORAMENTO
    _ESTADO_MONITORAMENTO = _EstadoMonitoramento(
        registro_usuarios=registro, oauth=oauth, registro_monitoramentos=registro_monitoramentos, smtp=smtp,
    )

    app = _montar_app_http(
        registro, limitador, admin_token, cadastro, oauth,
        captcha, site_captcha or None, falhas, gestao,
        registro_google, google_client_id, google_client_secret, publicacoes,
    )
    log.info(
        "Servidor HTTP em http://%s:%d/mcp (%d usuário(s) ativo(s); cadastro %s; admin %s; monitoramento %s)",
        args.host, args.port, len(registro.ativos()),
        "habilitado" if cadastro else "desabilitado", "habilitado" if admin_token else "desabilitado",
        "habilitado" if smtp else "desabilitado",
    )

    google_configurado = bool(google_client_id and google_client_secret)

    async def _servir() -> None:
        agendador = _montar_agendador(
            smtp, registro_monitoramentos, gestao, google_configurado,
            registro_google, google_client_id, google_client_secret, publicacoes,
        )
        agendador.start()

        # access_log desligado: o log padrão do uvicorn gravaria a URL completa, inclusive os
        # parâmetros assinados dos links de certidão. As requisições autenticadas já são
        # registradas pelo middleware. uvicorn.Server.serve() (em vez de uvicorn.run) porque o
        # agendador precisa do mesmo loop asyncio já em execução para disparar no horário certo.
        configuracao = uvicorn.Config(app, host=args.host, port=args.port, log_level="info", access_log=False)
        servidor = uvicorn.Server(configuracao)
        try:
            await servidor.serve()
        finally:
            if agendador is not None:
                agendador.shutdown(wait=False)

    asyncio.run(_servir())
    return 0


if __name__ == "__main__":
    sys.exit(_principal())
