import hashlib
import re


def hash_origem_djen_valido(valor) -> bool:
    """Identificador opaco usado na referência, nunca um caminho ou número CNJ."""
    return isinstance(valor, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,512}", valor) is not None


def origem_djen_legada(observacoes) -> tuple[str | None, str | None]:
    """Extrai somente marcador único e válido, sem modificar o texto original."""
    if observacoes is None:
        return None, None
    if not isinstance(observacoes, str):
        return None, "observacoes_invalidas"
    prefixo = "Publicação de origem (DJEN)"
    linhas = [linha for linha in observacoes.splitlines() if linha.startswith(prefixo)]
    if not linhas:
        return None, None
    if len(linhas) != 1:
        return None, "marcadores_multiplos"
    marcador = prefixo + ": "
    valor = linhas[0][len(marcador):] if linhas[0].startswith(marcador) else None
    if not hash_origem_djen_valido(valor):
        return None, "marcador_invalido"
    return valor, None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
