"""Tabelas Processuais Unificadas (TPU) do CNJ: classes, assuntos e movimentos, consultadas offline.

Os dados ficam em tpu_dados/*.json (gerados por scripts/gerar_tpu.py a partir do SGT do CNJ). A resposta do
DataJud já traz código e nome de cada classe, assunto e movimento; a TPU acrescenta o que ele não traz:
a hierarquia (ex.: Procedimento Comum Cível < Procedimento de Conhecimento < Processo de Conhecimento) e
a busca por nome, que dá o código para os filtros de buscar_processos_datajud."""
from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DIR = Path(__file__).resolve().parent / "tpu_dados"
TABELAS = ("classes", "assuntos", "movimentos")
_PROFUNDIDADE_MAX = 12  # guarda contra ciclo em dado corrompido


def _sem_acento(texto: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower()).strip()


@lru_cache(maxsize=None)
def _carregar(tabela: str) -> dict:
    if tabela not in TABELAS:
        raise ValueError(f"Tabela inválida: use {', '.join(TABELAS)}.")
    arquivo = json.loads((DIR / f"{tabela}.json").read_text(encoding="utf-8"))
    itens = {int(c): (v[0], int(v[1])) for c, v in arquivo["itens"].items()}
    return {"versao": arquivo.get("versao"), "itens": itens,
            "indice": [(c, _sem_acento(nome)) for c, (nome, _) in itens.items()]}


def versao() -> str | None:
    """Data da versão das tabelas embutidas (a do SGT na hora do download)."""
    return _carregar("classes")["versao"]


def nome(tabela: str, codigo: int | str | None) -> str | None:
    itens = _carregar(tabela)["itens"]  # tabela inválida é erro de uso: levanta ValueError
    try:
        item = itens.get(int(codigo))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return item[0] if item else None


def caminho(tabela: str, codigo: int | str | None) -> list[dict]:
    """Do ancestral mais alto até o próprio item: [{"codigo", "nome"}, ...]; vazio se o código não existe."""
    itens = _carregar(tabela)["itens"]
    try:
        atual = int(codigo)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return []
    trilha: list[dict] = []
    while atual in itens and len(trilha) < _PROFUNDIDADE_MAX:
        nome_item, pai = itens[atual]
        trilha.append({"codigo": atual, "nome": nome_item})
        atual = pai
    return trilha[::-1]


def grupo(tabela: str, codigo: int | str | None, nivel: int = 1) -> str | None:
    """Nome do ancestral no `nivel` indicado (0 = raiz, p.ex. "DIREITO CIVIL"); o próprio item se a trilha é mais curta."""
    trilha = caminho(tabela, codigo)
    return trilha[min(nivel, len(trilha) - 1)]["nome"] if trilha else None


def buscar(tabela: str, texto: str, limite: int = 20) -> list[dict]:
    """Itens cujo nome contém todas as palavras de `texto` (sem acento, sem caixa). Quem começa com o texto vem
    primeiro, depois os nomes mais curtos. Um número busca pelo código exato."""
    dados = _carregar(tabela)
    consulta = _sem_acento(texto)
    if not consulta:
        return []
    if consulta.isdigit():
        achados = [int(consulta)] if int(consulta) in dados["itens"] else []
    else:
        palavras = consulta.split()
        candidatos = [(c, n) for c, n in dados["indice"] if all(p in n for p in palavras)]
        candidatos.sort(key=lambda cn: (not cn[1].startswith(consulta), len(cn[1]), cn[0]))
        achados = [c for c, _ in candidatos]
    return [{"codigo": c, "nome": dados["itens"][c][0], "caminho": " > ".join(i["nome"] for i in caminho(tabela, c)[:-1])}
            for c in achados[:max(1, limite)]]
