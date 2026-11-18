"""Regras de distribuição de responsável: quem deve cuidar de um processo, segundo regras que o administrador escreve.

As regras são conferidas de cima para baixo e a primeira que casa e aponta para uma pessoa ativa vence. Nada aqui
sobrescreve um responsável já definido: a gravação usa `RegistroClientesCasos.definir_responsavel_se_vazio`.
A auditoria fica em tabela própria (`regras_responsavel_aplicacoes`), e não nos eventos do processo, porque a
"última movimentação" é calculada a partir deles.
"""
import json
import logging
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timezone

import notificacoes

log = logging.getLogger("cnj-processual")

TIPOS = {
    "captou": "Quem captou a publicação",
    "cliente": "Cliente",
    "classe": "Classe contém",
    "assunto": "Assunto contém",
    "tribunal": "Tribunal é",
    "orgao": "Órgão ou vara contém",
    "padrao": "Padrão do escritório",
}
TIPOS_COM_VALOR = ("cliente", "classe", "assunto", "tribunal", "orgao")
LIMITE_REGRAS = 50
ORIGEM = "automacao:responsavel_regras"


def _norm(texto) -> str:
    """Sem acento, sem maiúsculas e sem espaços sobrando: "Execução " casa "execucao"."""
    sem = unicodedata.normalize("NFD", str(texto or "")).encode("ascii", "ignore").decode()
    return " ".join(sem.lower().split())


def resolver_responsavel(contexto: dict, regras: list[dict], ativos: set[str]) -> dict | None:
    """Primeira regra ativa que casa com o contexto e aponta para pessoa ativa; ou None.

    `contexto`: {cliente_ids: [...], cliente_nomes: {id: nome}, classe, assunto, tribunal, orgao, captou}. Faltando uma
    informação, a regra que depende dela simplesmente não casa. Devolve {responsavel, regra_id, tipo, motivo}."""
    for regra in regras:
        if not regra.get("ativo", True):
            continue
        tipo, valor = regra["tipo"], regra.get("valor") or ""
        pessoa, motivo = regra.get("responsavel") or "", ""
        if tipo == "captou":
            pessoa, casou, motivo = contexto.get("captou") or "", bool(contexto.get("captou")), "Quem captou a publicação"
        elif tipo == "padrao":
            casou, motivo = True, "Padrão do escritório"
        elif tipo == "cliente":
            casou = valor in (contexto.get("cliente_ids") or [])
            motivo = f"Cliente {(contexto.get('cliente_nomes') or {}).get(valor) or valor}"
        elif tipo == "tribunal":
            casou, motivo = bool(valor) and _norm(valor) == _norm(contexto.get("tribunal")), f"Tribunal {valor}"
        else:  # classe, assunto, orgao: "contém"
            casou = bool(_norm(valor)) and _norm(valor) in _norm(contexto.get(tipo))
            motivo = f"{TIPOS[tipo]} \"{valor}\""
        if casou and pessoa and pessoa in ativos:
            return {"responsavel": pessoa, "regra_id": regra.get("id"), "tipo": tipo, "motivo": motivo}
    return None


class Regras:
    def __init__(self, caminho):
        self.caminho = caminho
        with self._abrir() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS regras_responsavel (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, ordem INTEGER NOT NULL, tipo TEXT NOT NULL,
                    valor TEXT NOT NULL DEFAULT '', responsavel TEXT NOT NULL DEFAULT '', ativo INTEGER NOT NULL DEFAULT 1);
                CREATE TABLE IF NOT EXISTS regras_responsavel_aplicacoes (
                    caso_id TEXT PRIMARY KEY, responsavel TEXT NOT NULL, tipo TEXT, motivo TEXT NOT NULL,
                    aplicado_em TEXT NOT NULL, aplicado_por TEXT);
            """)

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    def listar(self) -> list[dict]:
        with self._abrir() as c:
            linhas = c.execute("SELECT id, tipo, valor, responsavel, ativo FROM regras_responsavel ORDER BY ordem, id").fetchall()
        return [{"id": i, "tipo": t, "valor": v, "responsavel": r, "ativo": bool(a)} for i, t, v, r, a in linhas]

    def salvar(self, enviadas, ativos: set[str], ator: str, ativa: bool, agora: datetime | None = None) -> list[dict]:
        """Substitui a lista inteira (a ordem da lista é a prioridade). Valida tudo antes de gravar."""
        if not isinstance(enviadas, list):
            raise ValueError("Informe as regras como uma lista.")
        if len(enviadas) > LIMITE_REGRAS:
            raise ValueError(f"No máximo {LIMITE_REGRAS} regras.")
        limpas, padroes = [], 0
        for n, bruta in enumerate(enviadas, 1):
            if not isinstance(bruta, dict) or bruta.get("tipo") not in TIPOS:
                raise ValueError(f"Regra {n}: tipo inválido.")
            tipo = bruta["tipo"]
            valor = str(bruta.get("valor") or "").strip()
            pessoa = str(bruta.get("responsavel") or "").strip()
            if tipo in TIPOS_COM_VALOR and not valor:
                raise ValueError(f"Regra {n} ({TIPOS[tipo]}): informe o valor.")
            if len(valor) > 200:
                raise ValueError(f"Regra {n}: o valor passou de 200 caracteres.")
            if tipo == "captou":
                valor, pessoa = "", ""                      # a pessoa vem de quem captou
            else:
                valor = valor if tipo in TIPOS_COM_VALOR else ""
                if tipo == "padrao":
                    padroes += 1
                if pessoa and pessoa not in ativos:
                    raise ValueError(f"Regra {n}: {pessoa} não é uma pessoa ativa.")
                if tipo != "padrao" and not pessoa:
                    raise ValueError(f"Regra {n} ({TIPOS[tipo]}): escolha o responsável.")
            ativo = bruta.get("ativo", True)
            if not isinstance(ativo, bool):
                raise ValueError(f"Regra {n}: ativo deve ser verdadeiro ou falso.")
            limpas.append({"tipo": tipo, "valor": valor, "responsavel": pessoa, "ativo": ativo})
        if padroes > 1:
            raise ValueError("Só pode haver uma regra de padrão do escritório.")
        limpas.sort(key=lambda r: r["tipo"] == "padrao")      # o padrão é sempre a última; o resto mantém a ordem
        antes = self.listar()
        instante = (agora or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
        with self._abrir() as c:
            c.execute("DELETE FROM regras_responsavel")
            c.executemany("INSERT INTO regras_responsavel (ordem, tipo, valor, responsavel, ativo) VALUES (?,?,?,?,?)",
                          [(i, r["tipo"], r["valor"], r["responsavel"], int(r["ativo"])) for i, r in enumerate(limpas)])
            if [self._chave(r) for r in antes] != [self._chave(r) for r in limpas]:
                c.execute("INSERT INTO automacoes_config_historico (ocorrido_em, ator, chave, antes, depois) VALUES (?,?,?,?,?)",
                          (instante, ator, "responsavel_regras",
                           json.dumps({"ativo": ativa, "parametros": {}, "regras": len(antes)}),
                           json.dumps({"ativo": ativa, "parametros": {}, "regras": len(limpas)})))
        return self.listar()

    @staticmethod
    def _chave(regra: dict) -> tuple:
        return (regra["tipo"], regra["valor"], regra["responsavel"], regra["ativo"])

    # --- auditoria --------------------------------------------------------------------------------

    def registrar_aplicacao(self, caso_id: str, resultado: dict, ator: str, agora: datetime | None = None) -> None:
        instante = (agora or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
        with self._abrir() as c:
            c.execute("INSERT INTO regras_responsavel_aplicacoes (caso_id, responsavel, tipo, motivo, aplicado_em, aplicado_por) "
                      "VALUES (?,?,?,?,?,?) ON CONFLICT(caso_id) DO UPDATE SET responsavel=excluded.responsavel, tipo=excluded.tipo, "
                      "motivo=excluded.motivo, aplicado_em=excluded.aplicado_em, aplicado_por=excluded.aplicado_por",
                      (caso_id, resultado["responsavel"], resultado["tipo"], resultado["motivo"], instante, ator))

    def aplicacao(self, caso_id: str) -> dict | None:
        with self._abrir() as c:
            linha = c.execute("SELECT responsavel, tipo, motivo, aplicado_em FROM regras_responsavel_aplicacoes WHERE caso_id=?",
                              (caso_id,)).fetchone()
        return dict(zip(("responsavel", "tipo", "motivo", "aplicado_em"), linha)) if linha else None


# --- contexto, simulação e aplicação ---------------------------------------------------------------

def contexto_da_publicacao(registro_monitoramentos, publicacao: dict, assunto: str | None = None,
                           cliente_ids: list[str] | None = None, cliente_nomes: dict | None = None) -> dict:
    """Contexto das regras para uma publicação (a que o monitoramento de alguém trouxe)."""
    dados = publicacao.get("dados") or {}
    monitoramento = registro_monitoramentos.carregar().get(publicacao.get("monitoramento_id") or "") or {}
    return {"captou": monitoramento.get("usuario"), "cliente_ids": cliente_ids or [], "cliente_nomes": cliente_nomes or {},
            "classe": dados.get("nomeClasse"), "assunto": assunto, "tribunal": dados.get("siglaTribunal"),
            "orgao": dados.get("nomeOrgao")}


def contexto_do_caso(gestao, registro_monitoramentos, caso: dict, nomes_clientes: dict | None = None) -> dict:
    """Contexto das regras para um processo que já existe (capa, clientes e quem captou as publicações dele)."""
    capa = {}
    for numero in caso.get("processos") or []:
        capa = gestao.obter_capa_processo(caso["id"], numero) or {}
        if capa:
            break
    with Regras(gestao.caminho)._abrir() as c:
        linha = c.execute("SELECT monitoramento_id FROM publicacoes_capturadas WHERE caso_id=? AND monitoramento_id IS NOT NULL "
                          "ORDER BY criado_em LIMIT 1", (caso["id"],)).fetchone()
    monitoramento = registro_monitoramentos.carregar().get(linha[0]) if linha else None
    ids = [caso.get("cliente_id"), *(caso.get("clientes_adicionais") or [])]
    return {"captou": (monitoramento or {}).get("usuario"), "cliente_ids": [i for i in ids if i],
            "cliente_nomes": nomes_clientes or {}, "classe": capa.get("classe") or caso.get("acao"),
            "assunto": " ".join(capa.get("assuntos") or []) if isinstance(capa.get("assuntos"), list) else capa.get("assuntos"),
            "tribunal": capa.get("tribunal"), "orgao": capa.get("orgao_julgador") or caso.get("foro")}


def sem_responsavel(gestao) -> list[dict]:
    return [c for c in gestao.listar_casos() if not (c.get("responsavel") or "").strip()]


def _resultados(gestao, registro_monitoramentos, regras: list[dict], ativos: set[str]) -> list[tuple[dict, dict | None]]:
    nomes = {c["id"]: c.get("nome") for c in gestao.listar_clientes()}
    return [(caso, resolver_responsavel(contexto_do_caso(gestao, registro_monitoramentos, caso, nomes), regras, ativos))
            for caso in sem_responsavel(gestao)]


def simular(gestao, registro_monitoramentos, regras: list[dict], ativos: set[str]) -> list[dict]:
    """O que `aplicar` faria, sem gravar nada."""
    return [{"caso_id": caso["id"], "titulo": caso.get("titulo") or "", "responsavel": (r or {}).get("responsavel"),
             "motivo": (r or {}).get("motivo")} for caso, r in _resultados(gestao, registro_monitoramentos, regras, ativos)]


def aplicar(gestao, registro_monitoramentos, regras: list[dict], ativos: set[str], ator: str,
            agora: datetime | None = None) -> dict:
    """Dá responsável aos processos que não têm, pelas regras. Nunca sobrescreve; avisa cada pessoa só no sino."""
    auditoria = Regras(gestao.caminho)
    avisos = notificacoes.Repositorio(gestao.caminho, agora=(lambda: agora) if agora else None)
    aplicados = sem_regra = 0
    for caso, resultado in _resultados(gestao, registro_monitoramentos, regras, ativos):
        if not resultado:
            sem_regra += 1
            continue
        if gestao.definir_responsavel_se_vazio(caso["id"], resultado["responsavel"]):
            auditoria.registrar_aplicacao(caso["id"], resultado, ator, agora)
            avisos.registrar_processo_atribuido(caso["id"], resultado["responsavel"])
            aplicados += 1
    return {"aplicados": aplicados, "sem_regra": sem_regra}
