"""Casa os dados da capa do processo (número CNJ, vara, classe, assunto) com os nós das árvores do CJPG.

Puro (sem rede nem estado): recebe as árvores já carregadas, o que permite testar com árvores pequenas.

Regras que valem no TJSP (conferidas no e-SAJ real em 13/11/2026):
- os 4 últimos dígitos do número CNJ são o id do nó de foro na árvore de varas (80 de 80 conferidos); como
  comarca e foro dividem o mesmo id, vale o nó "Foro ...";
- a mesma vara aparece cadastrada várias vezes ("12ª Vara Cível", "12ª. Vara Cível", "12ª V.CÍVEL");
  só uma tem decisões recentes, então agrupamos as variantes e devolvemos o nome mais limpo;
- classe e assunto vêm em lista plana, com o caminho no campo `busca` ("id-nome|id-nome|..."), e há
  assuntos homônimos em ramos diferentes: nesse caso não escolhemos sozinhos.
"""
import re
import unicodedata

# Palavras que descrevem o tipo da vara e por isso não podem ser descartadas ao comparar nomes.
_TIPO = {"civel", "criminal", "familia", "sucessoes", "fazenda", "publica", "juizado", "especial", "vara",
         "execucoes", "fiscais", "infancia", "juventude", "trabalho", "federal", "acidentes", "registros"}
_IGNORAR = {"de", "da", "do", "das", "dos", "e", "o", "a", "em", "no", "na", "foro", "comarca", "n", "no."}
_ABREVIACOES = {"v": ["vara"], "vc": ["vara", "civel"], "vcc": ["vara", "civel"], "faz": ["fazenda"], "publ": ["publica"],
                "fam": ["familia"], "suc": ["sucessoes"], "crim": ["criminal"], "jec": ["juizado", "especial", "civel"]}

# "UPJ da 1ª a 6ª Varas Cíveis": um órgão que reúne várias varas; nenhuma delas é "a" vara do processo.
_VARIAS_VARAS = re.compile(r"\b\d+\s*a\s*\d+\s*varas\b")

CONFIANCA_ALTA = 0.99
CONFIANCA_MINIMA = 0.5


def sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFD", texto or "").encode("ascii", "ignore").decode().lower()


def tokens(texto: str) -> list[str]:
    """Palavras comparáveis: sem acento, sem ª/º/ponto, abreviações expandidas, sem artigos nem 'foro'."""
    t = sem_acento(texto).replace("º", "").replace("ª", "").replace("°", "")
    t = re.sub(r"(\d+)\s*[ao]\b", r"\1", t)  # "12a" -> "12"
    t = re.sub(r"[^a-z0-9]+", " ", t)
    saida: list[str] = []
    for palavra in t.split():
        if palavra in _IGNORAR:
            continue
        saida.extend(_ABREVIACOES.get(palavra, [palavra]))
    return saida


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def partes_cnj(numero: str) -> dict | None:
    """Separa o número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO); None se não tiver 20 dígitos."""
    d = re.sub(r"\D", "", numero or "")
    if len(d) != 20:
        return None
    return {"sequencial": d[:7], "dv": d[7:9], "ano": d[9:13], "justica": d[13], "tribunal": d[14:16], "origem": d[16:20]}


def eh_tjsp(numero: str) -> bool:
    p = partes_cnj(numero)
    return bool(p and p["justica"] == "8" and p["tribunal"] == "26")


def foro_do_numero(numero: str, arvore_vara: list[dict]) -> dict | None:
    """Nó de foro cujo id é a origem do número CNJ. A árvore tem dois nós raiz com o mesmo id (a comarca,
    "Leme", e o foro, "Foro de Leme"): vale o foro, que é o que o CJPG exibe nos resultados."""
    p = partes_cnj(numero)
    if not p:
        return None
    alvo = str(int(p["origem"]))
    candidatos = [n for n in arvore_vara if n.get("pai") is None and n["id"] == alvo]
    return next((n for n in candidatos if sem_acento(n["nome"]).startswith("foro")), candidatos[-1] if candidatos else None)


def _caminho_busca(busca: str, nome_folha: str) -> str:
    """Ramo do assunto/classe a partir de `busca` ("id-nome|id-nome|..."), com a folha em nome bonito."""
    nomes = [seg.split("-", 1)[1].strip() for seg in (busca or "").split("|") if "-" in seg]
    pais = [n.capitalize() for n in nomes[:-1]] if nomes else []
    return " > ".join([*pais, nome_folha])


def _classificar(score: float, unico: bool) -> str:
    if score >= CONFIANCA_ALTA and unico:
        return "alta"
    return "media" if score >= 0.75 else "baixa"


def resolver_vara(texto: str, foro: dict | None, arvore_vara: list[dict], limite: int = 5) -> dict:
    """Vara dentro do foro. Variantes com as mesmas palavras formam um grupo; devolve o nome mais limpo de cada."""
    if not foro or not texto.strip():
        return {"candidatos": [], "escolhido": None, "confianca": None}
    consulta = set(tokens(texto))
    lugar = set(tokens(foro["nome"])) - _TIPO
    consulta -= lugar
    grupos: dict[frozenset, list[dict]] = {}
    for no in arvore_vara:
        if no.get("pai") == foro["id"] and no.get("folha"):
            chave = frozenset(set(tokens(no["nome"])) - lugar)
            grupos.setdefault(chave, []).append(no)
    ranking = []
    for chave, nos in grupos.items():
        score = jaccard(consulta, set(chave))
        if score >= CONFIANCA_MINIMA:
            # nome mais limpo: sem ponto/abreviação, depois o de código menor
            nos.sort(key=lambda n: (bool(re.search(r"\.|\bV\b|\bVC\b", n["nome"])), len(n["nome"]), n["id"]))
            ranking.append((score, nos))
    ranking.sort(key=lambda r: (-r[0], r[1][0]["nome"]))
    candidatos = [{
        "id": nos[0]["id"], "nome": nos[0]["nome"], "caminho": f'{foro["nome"]} > {nos[0]["nome"]}',
        "confianca": round(score, 2), "variantes": [n["id"] for n in nos[1:]],
    } for score, nos in ranking[:limite]]
    escolhido = None
    varias = bool(_VARIAS_VARAS.search(sem_acento(texto)))
    if candidatos:
        unico = len(candidatos) == 1 or candidatos[0]["confianca"] - candidatos[1]["confianca"] >= 0.1
        if candidatos[0]["confianca"] >= CONFIANCA_ALTA and unico and not varias:
            escolhido = candidatos[0]
        candidatos[0]["nivel"] = "baixa" if varias else _classificar(candidatos[0]["confianca"], unico)
    return {"candidatos": candidatos, "escolhido": escolhido, "confianca": candidatos[0]["confianca"] if candidatos else None,
            **({"varias_varas": True} if varias else {})}


def resolver_lista(texto: str, arvore: list[dict], limite: int = 6) -> dict:
    """Classe ou assunto por nome. Nome igual em ramos diferentes é ambíguo: a pessoa escolhe."""
    consulta = set(tokens(texto))
    if not consulta:
        return {"candidatos": [], "escolhido": None, "confianca": None, "ambiguo": False}
    ranking = []
    for no in arvore:
        if not no.get("folha", True):
            continue
        score = jaccard(consulta, set(tokens(no["nome"])))
        if score >= CONFIANCA_MINIMA:
            ranking.append((score, no))
    ranking.sort(key=lambda r: (-r[0], r[1]["nome"], r[1]["id"]))
    topo = [r for r in ranking if r[0] == (ranking[0][0] if ranking else 0)]
    candidatos = [{"id": n["id"], "nome": n["nome"], "caminho": _caminho_busca(n.get("busca", ""), n["nome"]), "confianca": round(s, 2)}
                  for s, n in ranking[:limite]]
    ambiguo = len(topo) > 1
    escolhido = candidatos[0] if candidatos and candidatos[0]["confianca"] >= CONFIANCA_ALTA and not ambiguo else None
    return {"candidatos": candidatos, "escolhido": escolhido, "confianca": candidatos[0]["confianca"] if candidatos else None, "ambiguo": ambiguo}


_TRATAMENTO = {"dr", "dra", "juiz", "juiza", "desembargador", "desembargadora", "direito", "substituto", "substituta"}


def resolver_magistrado(texto: str, lista: list[dict], limite: int = 5) -> dict:
    """Magistrado pelo nome (a lista do CJPG tem {codigo, nome}). Só escolhe quando o nome bate inteiro e é único."""
    consulta = {t for t in tokens(texto) if t not in _TRATAMENTO}
    if not consulta:
        return {"candidatos": [], "escolhido": None, "confianca": None, "ambiguo": False}
    ranking = []
    for m in lista:
        score = jaccard(consulta, {t for t in tokens(m["nome"]) if t not in _TRATAMENTO})
        if score >= 0.6:
            ranking.append((score, m))
    ranking.sort(key=lambda r: (-r[0], r[1]["nome"]))
    candidatos = [{"id": m["codigo"], "nome": m["nome"], "caminho": m["nome"], "confianca": round(sc, 2)} for sc, m in ranking[:limite]]
    exatos = [c for c in candidatos if c["confianca"] >= CONFIANCA_ALTA]
    return {"candidatos": candidatos, "escolhido": exatos[0] if len(exatos) == 1 else None,
            "confianca": candidatos[0]["confianca"] if candidatos else None, "ambiguo": len(exatos) > 1}


def descrever_no(campo: str, id_no: str, arvores: dict[str, list[dict]]) -> dict | None:
    """{id, nome, caminho} de um nó pelo id (para reabrir uma escolha guardada ou um link). None se não existir."""
    if campo == "magistrado":
        m = next((x for x in arvores.get("magistrado", []) if x["codigo"] == id_no), None)
        return {"id": m["codigo"], "nome": m["nome"], "caminho": m["nome"]} if m else None
    arvore = arvores.get(campo, [])
    achados = [n for n in arvore if n["id"] == id_no]
    if campo == "vara":  # comarca e foro (raízes) dividem o id com o prefixo das varas; só vale a vara
        achados = [n for n in achados if n.get("pai") is not None]
    if not achados:
        return None
    no = achados[0]
    if campo == "vara":
        pai = [n for n in arvore if n.get("pai") is None and n["id"] == no["pai"]]
        foro = next((n for n in pai if sem_acento(n["nome"]).startswith("foro")), pai[-1] if pai else None)
        return {"id": no["id"], "nome": no["nome"], "caminho": f'{foro["nome"]} > {no["nome"]}' if foro else no["nome"]}
    return {"id": no["id"], "nome": no["nome"], "caminho": _caminho_busca(no.get("busca", ""), no["nome"])}


def resolver(numero: str, vara: str, classe: str, assunto: str, arvores: dict[str, list[dict]], magistrado: str = "") -> dict:
    """Resolve foro, vara, classe e assunto de um processo do TJSP. Fora do TJSP devolve {"tjsp": False}."""
    if not eh_tjsp(numero):
        return {"tjsp": False}
    foro = foro_do_numero(numero, arvores.get("vara", []))
    return {
        "tjsp": True,
        "foro": {"id": foro["id"], "nome": foro["nome"]} if foro else None,
        "vara": resolver_vara(vara or "", foro, arvores.get("vara", [])),
        "classe": resolver_lista(classe or "", arvores.get("classe", [])),
        "assunto": resolver_lista(assunto or "", arvores.get("assunto", [])),
        "magistrado": resolver_magistrado(magistrado or "", arvores.get("magistrado", [])),
    }
