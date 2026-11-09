"""Quem é "nosso cliente" numa parte de processo ou publicação, e em que polo ele está.

Reconhecimento estrito (decidido com o escritório): CPF/CNPJ igual ou nome completo igual, sem
acentos e sem diferença de maiúsculas. Nome parecido, parcial ou repetido em dois cadastros NÃO
reconhece ninguém: é melhor deixar de avisar do que avisar de um homônimo. Só clientes com perfil
"cliente" (não "contato") entram. Funções puras, sem banco e sem rede.
"""
import re
import unicodedata
from collections import Counter

POLOS = ("ativo", "passivo", "terceiro")


def normalizar_nome(nome) -> str:
    texto = unicodedata.normalize("NFD", str(nome or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto).strip().lower()


def so_digitos(valor) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def polo_da_parte(polo) -> str | None:
    """'A', 'AT', 'ATIVO' -> 'ativo'; 'P', 'PA', 'PASSIVO' -> 'passivo'; outros polos (terceiro,
    perito, etc.) ou ausente -> None (não afirma nada)."""
    p = str(polo or "").strip().upper()
    if p in ("A", "AT", "ATIVO"):
        return "ativo"
    if p in ("P", "PA", "PASSIVO"):
        return "passivo"
    return None


def montar_indice(clientes: list[dict], limitar_a: set[str] | None = None) -> dict:
    """Índice de clientes reconhecíveis. `limitar_a`: ids permitidos (ex.: clientes do processo)."""
    docs: dict[str, list[str]] = {}
    nomes: dict[str, list[str]] = {}
    base: dict[str, dict] = {}
    for c in clientes:
        if (c.get("perfil") or "cliente") != "cliente" or (limitar_a is not None and c["id"] not in limitar_a):
            continue
        base[c["id"]] = {"id": c["id"], "nome": c.get("nome") or ""}
        if len(so_digitos(c.get("cpf_cnpj"))) in (11, 14):
            docs.setdefault(so_digitos(c["cpf_cnpj"]), []).append(c["id"])
        if normalizar_nome(c.get("nome")):
            nomes.setdefault(normalizar_nome(c["nome"]), []).append(c["id"])
    return {"docs": docs, "nomes": nomes, "clientes": base}


def cliente_da_parte(parte: dict, indice: dict) -> str | None:
    """Id do cliente reconhecido, ou None (sem correspondência ou correspondência ambígua)."""
    doc = so_digitos(parte.get("cpf_cnpj"))
    if len(doc) in (11, 14):
        achados = indice["docs"].get(doc, [])
        if achados:
            return achados[0] if len(set(achados)) == 1 else None
    achados = indice["nomes"].get(normalizar_nome(parte.get("nome")), [])
    return achados[0] if len(set(achados)) == 1 else None


def polos_no_caso(clientes_do_caso: list[dict], fontes: list[list[dict]]) -> dict[str, str | None]:
    """Polo automático de cada cliente do processo: o que a maioria das partes reconhecidas (capa e
    publicações) informa. Empate ou nenhuma informação -> None."""
    indice = montar_indice(clientes_do_caso)
    votos: dict[str, Counter] = {c["id"]: Counter() for c in clientes_do_caso if c["id"] in indice["clientes"]}
    for partes in fontes:
        for parte in partes or []:
            cid, polo = cliente_da_parte(parte, indice), polo_da_parte(parte.get("polo"))
            if cid and polo:
                votos[cid][polo] += 1
    resultado: dict[str, str | None] = {}
    for c in clientes_do_caso:
        v = votos.get(c["id"])
        if not v:
            resultado[c["id"]] = None
            continue
        (polo, n), *resto = v.most_common()
        resultado[c["id"]] = None if resto and resto[0][1] == n else polo
    return resultado


def destino_da_publicacao(destinatarios: list[dict], indice: dict, polos_do_caso: dict[str, str | None] | None = None) -> dict | None:
    """Para quem a publicação é. {'tipo': 'cliente', 'clientes': [{id, nome, polo}]} quando algum
    destinatário é cliente; {'tipo': 'contraria'} quando, num processo com polo conhecido do(s)
    cliente(s), todos os destinatários estão no polo oposto; None nos demais casos."""
    achados, vistos = [], set()
    for d in destinatarios or []:
        cid = cliente_da_parte(d, indice)
        if cid and cid not in vistos:
            vistos.add(cid)
            achados.append({"id": cid, "nome": indice["clientes"][cid]["nome"], "polo": polo_da_parte(d.get("polo"))})
    if achados:
        return {"tipo": "cliente", "clientes": achados}
    nossos = {p for p in (polos_do_caso or {}).values() if p in ("ativo", "passivo")}
    polos = [polo_da_parte(d.get("polo")) for d in destinatarios or []]
    if len(nossos) == 1 and polos and all(p and p not in nossos for p in polos):
        return {"tipo": "contraria", "clientes": []}
    return None
