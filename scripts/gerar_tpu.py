#!/usr/bin/env python3
"""Baixa as Tabelas Processuais Unificadas (classes, assuntos e movimentos) do SGT do CNJ e grava
tpu_dados/{classes,assuntos,movimentos}.json, usados por tpu.py sem rede.

    python3 scripts/gerar_tpu.py            # todas as tabelas
    python3 scripts/gerar_tpu.py classes    # só uma

Formato de cada arquivo: {"versao": "dd/mm/aaaa", "tabela": "...", "itens": {"codigo": [nome, codigo_pai|0]}}

Como baixa: o SGT só lista filhos diretos de um nó e não publica as raízes das árvores, mas a pesquisa por
nome (pesquisarItemPublicoWS) devolve código, código do pai e nome de todo item que contém o texto. Pesquisar
por cada letra e juntar os resultados cobre a tabela inteira (assuntos: ~5,6 mil itens). O script para de
pesquisar quando três letras seguidas não acrescentam nada e avisa se algum pai citado não estiver na tabela.
O endpoint usado está marcado como depreciado pelo CNJ (sucessor: https://sgt.cloud.cnj.jus.br/api/v1/soap):
se parar de responder, ajuste URL/protocolo aqui. Só biblioteca padrão."""
import html
import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

URL = "https://www.cnj.jus.br/sgt/sgt_ws.php"
NS = "{https://www.cnj.jus.br/sgt/sgt_ws.php}"
DESTINO = Path(__file__).resolve().parent.parent / "tpu_dados"
TABELAS = {"classes": "C", "assuntos": "A", "movimentos": "M"}
LETRAS = "aeoiuscrtdmnplvgbfhqjzxyk"


def _soap(operacao: str, corpo: str, tentativas: int = 4) -> ET.Element:
    envelope = (
        '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:u="urn:sgt"><soapenv:Body><u:{operacao}>{corpo}</u:{operacao}></soapenv:Body></soapenv:Envelope>'
    ).encode()
    for tentativa in range(1, tentativas + 1):
        try:
            req = urllib.request.Request(URL, data=envelope, headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return ET.fromstring(resp.read())
        except Exception:
            if tentativa == tentativas:
                raise
            time.sleep(2 * tentativa)
    raise RuntimeError("inalcançável")


def versao() -> str:
    return _soap("getDataUltimaVersao", "").findtext(".//return") or ""


def pesquisar(tipo: str, texto: str) -> dict[int, tuple[str, int]]:
    raiz = _soap("pesquisarItemPublicoWS",
                 f"<tipoTabela>{tipo}</tipoTabela><tipoPesquisa>N</tipoPesquisa><valorPesquisa>{texto}</valorPesquisa>")
    achados = {}
    for no in raiz.iter(f"{NS}Item"):
        achados[int(no.findtext("cod_item"))] = (html.unescape((no.findtext("nome") or "").strip()), int(no.findtext("cod_item_pai") or 0))
    return achados


def baixar(tipo: str) -> dict[str, list]:
    itens: dict[int, tuple[str, int]] = {}
    sem_novidade = 0
    for letra in LETRAS:
        antes = len(itens)
        itens.update(pesquisar(tipo, letra))
        sem_novidade = sem_novidade + 1 if len(itens) == antes else 0
        if sem_novidade >= 3:
            break
    faltando = {pai for _, pai in itens.values() if pai and pai not in itens}
    if faltando:
        print(f"  aviso: {len(faltando)} pai(s) citado(s) fora da tabela (ficam como raiz): {sorted(faltando)[:10]}", file=sys.stderr)
    return {str(c): [nome, pai if pai in itens else 0] for c, (nome, pai) in sorted(itens.items())}


def main(escolhidas: list[str]) -> int:
    DESTINO.mkdir(exist_ok=True)
    data = versao()
    for nome in escolhidas or TABELAS:
        if nome not in TABELAS:
            print(f"tabela desconhecida: {nome} (use {', '.join(TABELAS)})", file=sys.stderr)
            return 2
        dados = baixar(TABELAS[nome])
        if not dados:
            print(f"{nome}: nenhum item baixado; arquivo mantido", file=sys.stderr)
            return 1
        (DESTINO / f"{nome}.json").write_text(
            json.dumps({"versao": data, "tabela": nome, "itens": dados}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"{nome}: {len(dados)} itens (versão {data})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
