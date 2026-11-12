"""Modelos de prazos e tarefas por assunto ou classe processual.

O escritório cadastra, por assunto ou classe (ex.: "Ação de Cobrança"), os prazos e as tarefas
padrão. Quando um processo tem classe ou assunto que bate com um modelo, o sistema SUGERE esses
itens: nada é criado sem a revisão da pessoa. Cada modelo é sugerido uma vez por processo; depois
de aplicado ou dispensado, não é sugerido de novo.
"""
import json
import sqlite3
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

MAX_ITENS = 20
CONTAGENS = ("uteis", "corridos")
ACOES = ("aplicado", "dispensado")


def normalizar(texto) -> str:
    """Minúsculas, sem acento e com espaços simples: 'Ação  de Cobrança' -> 'acao de cobranca'."""
    sem_acento = "".join(c for c in unicodedata.normalize("NFKD", str(texto or "")) if not unicodedata.combining(c))
    return " ".join(sem_acento.casefold().split())


def _texto(valor, campo: str, maximo: int) -> str:
    if not isinstance(valor, str) or not valor.strip():
        raise ValueError(f"Informe {campo}.")
    valor = " ".join(valor.split())
    if len(valor) > maximo:
        raise ValueError(f"{campo[0].upper() + campo[1:]} passa de {maximo} caracteres.")
    return valor


def _inteiro(valor, campo: str, minimo: int, maximo: int) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int) or not minimo <= valor <= maximo:
        raise ValueError(f"Informe {campo} entre {minimo} e {maximo}.")
    return valor


def validar(dados) -> dict:
    """Confere e normaliza o corpo recebido. Levanta ValueError com mensagem para a pessoa."""
    if not isinstance(dados, dict):
        raise ValueError("Informe um objeto JSON.")
    prazos, tarefas = dados.get("prazos") or [], dados.get("tarefas") or []
    if not isinstance(prazos, list) or not isinstance(tarefas, list):
        raise ValueError("Prazos e tarefas devem ser listas.")
    if len(prazos) > MAX_ITENS or len(tarefas) > MAX_ITENS:
        raise ValueError(f"Use no máximo {MAX_ITENS} prazos e {MAX_ITENS} tarefas por modelo.")
    saida_prazos = []
    for p in prazos:
        if not isinstance(p, dict):
            raise ValueError("Cada prazo deve ser um objeto.")
        contagem = p.get("contagem") or "uteis"
        if contagem not in CONTAGENS:
            raise ValueError("A contagem do prazo deve ser uteis ou corridos.")
        saida_prazos.append({"titulo": _texto(p.get("titulo"), "o título do prazo", 120),
                             "dias": _inteiro(p.get("dias"), "os dias do prazo", 1, 365), "contagem": contagem})
    saida_tarefas = []
    for t in tarefas:
        if not isinstance(t, dict):
            raise ValueError("Cada tarefa deve ser um objeto.")
        saida_tarefas.append({"titulo": _texto(t.get("titulo"), "o título da tarefa", 120),
                              "dias": _inteiro(t.get("dias", 0), "os dias da tarefa", 0, 365)})
    if not saida_prazos and not saida_tarefas:
        raise ValueError("Cadastre ao menos um prazo ou uma tarefa no modelo.")
    ativo = dados.get("ativo", True)
    if not isinstance(ativo, bool):
        raise ValueError("O campo ativo deve ser verdadeiro ou falso.")
    criterio = _texto(dados.get("criterio"), "o assunto ou a classe processual", 200)
    if len(normalizar(criterio)) < 3:
        raise ValueError("O assunto ou a classe deve ter ao menos 3 letras.")
    return {"nome": _texto(dados.get("nome") or criterio, "o nome do modelo", 120), "criterio": criterio,
            "prazos": saida_prazos, "tarefas": saida_tarefas, "ativo": ativo}


def _modelo(linha) -> dict:
    return {"id": linha[0], "nome": linha[1], "criterio": linha[2], "prazos": json.loads(linha[3]),
            "tarefas": json.loads(linha[4]), "ativo": bool(linha[5]), "criado_por": linha[6],
            "criado_em": linha[7], "atualizado_em": linha[8]}


class Repositorio:
    _COLUNAS = "id, nome, criterio, prazos, tarefas, ativo, criado_por, criado_em, atualizado_em"

    def __init__(self, caminho):
        self.caminho = caminho
        with self.abrir() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS modelos_prazo (
                    id TEXT PRIMARY KEY, nome TEXT NOT NULL, criterio TEXT NOT NULL,
                    prazos TEXT NOT NULL, tarefas TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
                    criado_por TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS modelo_prazo_decisoes (
                    caso_id TEXT NOT NULL, modelo_id TEXT NOT NULL, acao TEXT NOT NULL,
                    usuario TEXT, em TEXT NOT NULL, PRIMARY KEY (caso_id, modelo_id));
            """)

    @contextmanager
    def abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    def listar(self) -> list[dict]:
        with self.abrir() as c:
            linhas = c.execute(f"SELECT {self._COLUNAS} FROM modelos_prazo ORDER BY lower(nome), id").fetchall()
        return [_modelo(l) for l in linhas]

    def obter(self, modelo_id: str) -> dict | None:
        with self.abrir() as c:
            linha = c.execute(f"SELECT {self._COLUNAS} FROM modelos_prazo WHERE id = ?", (modelo_id,)).fetchone()
        return _modelo(linha) if linha else None

    def criar(self, dados: dict, usuario: str | None, agora=lambda: datetime.now(timezone.utc)) -> dict:
        d, instante, novo_id = validar(dados), agora().astimezone(timezone.utc).isoformat(timespec="seconds"), uuid.uuid4().hex
        with self.abrir() as c:
            c.execute("INSERT INTO modelos_prazo (id, nome, criterio, prazos, tarefas, ativo, criado_por, criado_em, atualizado_em) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (novo_id, d["nome"], d["criterio"], json.dumps(d["prazos"], ensure_ascii=False),
                       json.dumps(d["tarefas"], ensure_ascii=False), int(d["ativo"]), usuario, instante, instante))
        return self.obter(novo_id)

    def atualizar(self, modelo_id: str, dados: dict, agora=lambda: datetime.now(timezone.utc)) -> dict | None:
        atual = self.obter(modelo_id)
        if atual is None:
            return None
        d = validar({**atual, **(dados if isinstance(dados, dict) else {})})
        with self.abrir() as c:
            c.execute("UPDATE modelos_prazo SET nome=?, criterio=?, prazos=?, tarefas=?, ativo=?, atualizado_em=? WHERE id=?",
                      (d["nome"], d["criterio"], json.dumps(d["prazos"], ensure_ascii=False),
                       json.dumps(d["tarefas"], ensure_ascii=False), int(d["ativo"]),
                       agora().astimezone(timezone.utc).isoformat(timespec="seconds"), modelo_id))
        return self.obter(modelo_id)

    def excluir(self, modelo_id: str) -> bool:
        with self.abrir() as c:
            apagou = c.execute("DELETE FROM modelos_prazo WHERE id = ?", (modelo_id,)).rowcount > 0
            c.execute("DELETE FROM modelo_prazo_decisoes WHERE modelo_id = ?", (modelo_id,))
        return apagou

    def decisoes(self, caso_id: str) -> dict[str, str]:
        with self.abrir() as c:
            return dict(c.execute("SELECT modelo_id, acao FROM modelo_prazo_decisoes WHERE caso_id = ?", (caso_id,)).fetchall())

    def reservar(self, caso_id: str, modelo_id: str, acao: str, usuario: str | None,
                 agora=lambda: datetime.now(timezone.utc)) -> bool:
        """Registra a decisão (aplicar ou dispensar). False se o modelo já foi decidido para o processo,
        o que impede aplicar o mesmo modelo duas vezes."""
        if acao not in ACOES:
            raise ValueError("Ação inválida.")
        try:
            with self.abrir() as c:
                c.execute("INSERT INTO modelo_prazo_decisoes (caso_id, modelo_id, acao, usuario, em) VALUES (?, ?, ?, ?, ?)",
                          (caso_id, modelo_id, acao, usuario, agora().astimezone(timezone.utc).isoformat(timespec="seconds")))
            return True
        except sqlite3.IntegrityError:
            return False

    def liberar(self, caso_id: str, modelo_id: str) -> None:
        """Desfaz a decisão registrada (usado se a criação das atividades falhar no meio)."""
        with self.abrir() as c:
            c.execute("DELETE FROM modelo_prazo_decisoes WHERE caso_id = ? AND modelo_id = ?", (caso_id, modelo_id))

    def sugestoes(self, caso_id: str) -> list[dict] | None:
        """Modelos ativos que combinam com a classe/ação ou os assuntos do processo e ainda não foram
        aplicados nem dispensados nele. None se o processo não existe."""
        with self.abrir() as c:
            caso = c.execute("SELECT acao FROM casos WHERE id = ?", (caso_id,)).fetchone()
            if caso is None:
                return None
            textos = [caso[0]] if caso[0] else []
            for classe, assuntos in c.execute("SELECT classe, assuntos FROM caso_processo_capa WHERE caso_id = ?", (caso_id,)):
                if classe:
                    textos.append(classe)
                try:
                    textos += [a for a in json.loads(assuntos or "[]") if isinstance(a, str)]
                except ValueError:
                    pass
        decididos = self.decisoes(caso_id)
        normalizados = [(t, normalizar(t)) for t in textos if t]
        saida = []
        for modelo in self.listar():
            if not modelo["ativo"] or modelo["id"] in decididos:
                continue
            chave = normalizar(modelo["criterio"])
            achado = next((original for original, n in normalizados if chave and chave in n), None)
            if achado:
                saida.append({"modelo": modelo, "correspondeu_a": achado})
        return saida
