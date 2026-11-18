"""Normalização de nomes (clientes e títulos de processo) e saneamento em lote com desfazer.

Regra única: só mexe em nome TODO em maiúsculas ou TODO em minúsculas (como vem do tribunal). Nome em caixa mista é
considerado digitado por gente e nunca é tocado; é isso que faz a função ser idempotente.
"""
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

PARTICULAS = {"a", "à", "ao", "aos", "as", "às", "com", "contra", "da", "das", "de", "do", "dos", "e", "em", "na", "nas",
              "no", "nos", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "sem"}
SIGLAS = {"me": "ME", "epp": "EPP", "eireli": "EIRELI", "sa": "SA", "mei": "MEI", "cpf": "CPF", "cnpj": "CNPJ", "oab": "OAB",
          "inss": "INSS", "cef": "CEF", "fgts": "FGTS", "bndes": "BNDES", "tjsp": "TJSP", "stj": "STJ", "stf": "STF",
          "trf": "TRF", "trt": "TRT", "ltda": "Ltda"}
ROMANOS = {"ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"}
LIMITE_EXCECOES = 200
LIMITE_TELA = 200

_PALAVRA = re.compile(r"[^\W_]+")


def dobrar(texto: str | None) -> str:
    """Chave de comparação: sem acento, sem diferenciar caixa nem espaços repetidos."""
    base = unicodedata.normalize("NFD", (texto or "").casefold())
    return " ".join("".join(c for c in base if not unicodedata.combining(c)).split())


def precisa_normalizar(nome: str | None) -> bool:
    letras = [c for c in (nome or "") if c.isalpha()]
    return bool(letras) and (all(c.isupper() for c in letras) or all(c.islower() for c in letras))


def normalizar(nome: str | None, excecoes: list[str] | tuple[str, ...] = ()) -> str | None:
    """"MARIA DA SILVA" -> "Maria da Silva". Nome em caixa mista (ou sem letras) volta igual."""
    if not nome or not precisa_normalizar(nome):
        return nome
    primeira = True

    def trocar(m: re.Match) -> str:
        nonlocal primeira
        inicio, primeira = primeira, False
        palavra = m.group(0).lower()
        colada = (m.start() > 0 and nome[m.start() - 1] in "'’-") or (m.end() < len(nome) and nome[m.end()] in "'’-")
        if not colada:  # "O'Connor", "Ana-Maria": pedaços de uma palavra só nunca viram partícula/sigla
            if palavra in SIGLAS:
                return SIGLAS[palavra]
            if palavra in ROMANOS:
                return palavra.upper()
            if not inicio and palavra in PARTICULAS:
                return palavra
        return palavra[:1].upper() + palavra[1:]

    resultado = _PALAVRA.sub(trocar, nome)
    resultado = re.sub(r"(?i)(?<!\w)s/a(?!\w)", "S/A", resultado)
    for grafia in excecoes:
        resultado = re.sub(r"(?i)(?<!\w)" + re.escape(grafia) + r"(?!\w)", lambda _m, g=grafia: g, resultado)
    return resultado


class Nomes:
    """Exceções de grafia e histórico de alterações em lote (com desfazer)."""

    def __init__(self, caminho: str | Path):
        self.caminho = Path(caminho)
        with self._abrir() as c:
            c.execute("CREATE TABLE IF NOT EXISTS nomes_excecoes (grafia TEXT PRIMARY KEY)")
            c.execute("""CREATE TABLE IF NOT EXISTS nomes_normalizados (
                id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, alvo_id TEXT NOT NULL, antes TEXT NOT NULL,
                depois TEXT NOT NULL, aplicado_em TEXT NOT NULL, aplicado_por TEXT NOT NULL,
                desfeito_em TEXT, desfeito_por TEXT)""")

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    # --- exceções -----------------------------------------------------------------------------------------------
    def excecoes(self) -> list[str]:
        with self._abrir() as c:
            return [r[0] for r in c.execute("SELECT grafia FROM nomes_excecoes ORDER BY lower(grafia)")]

    def salvar_excecoes(self, lista) -> list[str]:
        if not isinstance(lista, list) or not all(isinstance(g, str) for g in lista):
            raise ValueError("Informe a lista de grafias.")
        limpas = list({g.casefold(): g for g in reversed([" ".join(g.split()) for g in lista if g.strip()])}.values())[::-1]  # a 1ª grafia de cada uma vence
        if len(limpas) > LIMITE_EXCECOES:
            raise ValueError(f"No máximo {LIMITE_EXCECOES} exceções.")
        if any(len(g) > 100 for g in limpas):
            raise ValueError("Cada exceção pode ter até 100 caracteres.")
        with self._abrir() as c:
            c.execute("DELETE FROM nomes_excecoes")
            c.executemany("INSERT OR IGNORE INTO nomes_excecoes (grafia) VALUES (?)", [(g,) for g in limpas])
        return self.excecoes()

    # --- saneamento ---------------------------------------------------------------------------------------------
    def _candidatos(self) -> list[dict]:
        excecoes = self.excecoes()
        with self._abrir() as c:
            clientes = c.execute("SELECT id, nome FROM clientes").fetchall()
            casos = c.execute("SELECT id, titulo FROM casos").fetchall()
        nomes_clientes: dict[str, list[str]] = {}
        for cid, nome in clientes:
            nomes_clientes.setdefault(dobrar(nome), []).append(cid)
        itens = []
        for tipo, linhas in (("cliente", clientes), ("caso", casos)):
            for alvo, atual in linhas:
                depois = normalizar(atual, excecoes)
                if depois is None or depois == atual:
                    continue
                duplicado = tipo == "cliente" and any(i != alvo for i in nomes_clientes.get(dobrar(depois), []))
                itens.append({"tipo": tipo, "id": alvo, "antes": atual, "depois": depois, "duplicado": duplicado})
        return itens

    def verificar(self) -> dict:
        itens = self._candidatos()
        return {"itens": itens[:LIMITE_TELA], "total": len(itens), "duplicados": sum(i["duplicado"] for i in itens)}

    def aplicar(self, ator: str, itens: list[dict] | None = None, todos: bool = False, agora: datetime | None = None) -> dict:
        """Aplica os itens marcados (ou todos os que não são duplicados). Recalcula na hora: se o nome mudou desde a
        prévia, ignora o item. Guarda o valor anterior para desfazer."""
        pedidos = {(i.get("tipo"), i.get("id")) for i in (itens or []) if isinstance(i, dict)}
        quando = (agora or datetime.now(timezone.utc)).isoformat()
        aplicados = ignorados = 0
        escolhidos = [i for i in self._candidatos() if (not i["duplicado"] if todos else (i["tipo"], i["id"]) in pedidos)]
        ignorados = len(pedidos) - len(escolhidos) if not todos else 0
        with self._abrir() as c:
            for i in escolhidos:
                tabela, coluna = ("clientes", "nome") if i["tipo"] == "cliente" else ("casos", "titulo")
                feito = c.execute(f"UPDATE {tabela} SET {coluna}=? WHERE id=? AND {coluna}=?", (i["depois"], i["id"], i["antes"])).rowcount
                if not feito:
                    ignorados += 1
                    continue
                c.execute("INSERT INTO nomes_normalizados (tipo, alvo_id, antes, depois, aplicado_em, aplicado_por) VALUES (?,?,?,?,?,?)",
                          (i["tipo"], i["id"], i["antes"], i["depois"], quando, ator))
                aplicados += 1
        return {"aplicados": aplicados, "ignorados": max(ignorados, 0)}

    def aplicados(self, limite: int = 100) -> list[dict]:
        with self._abrir() as c:
            linhas = c.execute("SELECT id, tipo, alvo_id, antes, depois, aplicado_em, aplicado_por, desfeito_em FROM nomes_normalizados "
                               "ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
        chaves = ("id", "tipo", "alvo_id", "antes", "depois", "aplicado_em", "aplicado_por", "desfeito_em")
        return [dict(zip(chaves, r)) for r in linhas]

    def desfazer(self, ids: list, ator: str, agora: datetime | None = None) -> dict:
        """Restaura o valor anterior, só se o nome ainda for o que foi aplicado (se alguém editou depois, não pisa)."""
        quando = (agora or datetime.now(timezone.utc)).isoformat()
        desfeitos = ignorados = 0
        with self._abrir() as c:
            for registro in {i for i in ids if isinstance(i, int)}:
                linha = c.execute("SELECT tipo, alvo_id, antes, depois FROM nomes_normalizados WHERE id=? AND desfeito_em IS NULL", (registro,)).fetchone()
                if not linha:
                    ignorados += 1
                    continue
                tipo, alvo, antes, depois = linha
                tabela, coluna = ("clientes", "nome") if tipo == "cliente" else ("casos", "titulo")
                feito = c.execute(f"UPDATE {tabela} SET {coluna}=? WHERE id=? AND {coluna}=?", (antes, alvo, depois)).rowcount
                if feito:
                    c.execute("UPDATE nomes_normalizados SET desfeito_em=?, desfeito_por=? WHERE id=?", (quando, ator, registro))
                    desfeitos += 1
                else:
                    ignorados += 1
        return {"desfeitos": desfeitos, "ignorados": ignorados}
