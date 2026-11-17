"""Número único de processo (Resolução CNJ 65/2008): análise, dígito verificador e tribunal.

Fonte única das regras de NNNNNNN-DD.AAAA.J.TR.OOOO. Os pontos de entrada do servidor devem usar
`validar_cnj`; `tribunal_do_numero` só infere a sigla (não exige DV válido).
"""
from __future__ import annotations

import re
from typing import NamedTuple

_UFS = "ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc se sp to".split()

# Justiça Militar estadual (J=9): só MG, RS e SP têm tribunal próprio.
_TJM = {13: "tjmmg", 21: "tjmrs", 26: "tjmsp"}


class ParteCnj(NamedTuple):
    sequencial: str
    dv: str
    ano: str
    justica: str
    tribunal: str
    origem: str


def so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", valor or "")


def partes_cnj(numero: str | None) -> ParteCnj | None:
    """Separa NNNNNNN-DD.AAAA.J.TR.OOOO; None se não tiver exatamente 20 dígitos."""
    d = so_digitos(numero)
    if len(d) != 20:
        return None
    return ParteCnj(d[:7], d[7:9], d[9:13], d[13], d[14:16], d[16:20])


def calcular_dv(numero: str | None) -> str | None:
    """DV (módulo 97, base 10) calculado a partir dos demais campos: 98 - (NNNNNNNAAAAJTROOOO00 mod 97)."""
    p = partes_cnj(numero)
    if not p:
        return None
    base = p.sequencial + p.ano + p.justica + p.tribunal + p.origem + "00"
    return f"{98 - int(base) % 97:02d}"


def dv_valido(numero: str | None) -> bool:
    p = partes_cnj(numero)
    return bool(p) and calcular_dv(numero) == p.dv


def tribunal_do_numero(numero: str | None) -> str | None:
    """Sigla do índice da API pública do DataJud (`api_publica_<sigla>`) deduzida de J.TR; None se
    não houver como deduzir. STF e CNJ (J=1/2) não têm índice público, então devolvem None."""
    p = partes_cnj(numero)
    if not p:
        return None
    j, tr = p.justica, int(p.tribunal)
    if tr == 0:
        return {"3": "stj", "5": "tst", "6": "tse", "7": "stm"}.get(j)
    if j == "8" and 1 <= tr <= 27:
        return "tjdft" if tr == 7 else "tj" + _UFS[tr - 1]
    if j == "4" and 1 <= tr <= 6:
        return f"trf{tr}"
    if j == "5" and 1 <= tr <= 24:
        return f"trt{tr}"
    if j == "6" and 1 <= tr <= 27:
        return "tre-" + _UFS[tr - 1]
    if j == "9":
        return _TJM.get(tr)
    return None


def validar_cnj(numero: str | None) -> tuple[str | None, str | None]:
    """Devolve (20 dígitos, None) ou (None, mensagem de erro). Confere tamanho e dígito verificador.
    Não compara com a sigla do tribunal: o mesmo número é legítimo no tribunal superior (STJ, TST...)."""
    d = so_digitos(numero)
    if len(d) != 20:
        return None, f"Número de processo inválido: esperados 20 dígitos, recebidos {len(d)}. Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO."
    if not dv_valido(d):
        return None, f"Número de processo inválido: dígito verificador incorreto (esperado {calcular_dv(d)}, recebido {d[7:9]}). Confira a digitação."
    return d, None
