"""Regras de sugestão de prazos por assunto, classe, tipo de publicação e palavras-chave.

Substitui o modelo de prazo (critério em texto + lista fixa de prazos) por três cadastros:
tipo de prazo, regra e decisões. Uma regra liga até três critérios OPCIONAIS — escopo
(assuntos/classes), tipos de publicação do DJEN e uma expressão de palavras-chave — a um
tipo de prazo e SUGERE — nunca cria sozinho — um prazo quando uma publicação do DJEN ou um
movimento do processo casa. Basta ao menos um critério preenchido. Cada regra é sugerida uma
vez por evento; depois de aplicada ou dispensada, não é sugerida de novo para o mesmo evento.

A expressão de palavras-chave é uma função pura, sem banco: palavras soltas, "frase exata"
entre aspas duplas e os operadores escritos como palavras `e`, `ou` e `sem`. O `e` tem
precedência sobre o `ou` e o `sem` exclui (a sem b = a e não b). Não há parênteses. Para
buscar literalmente uma palavra que também é operador, coloque-a entre aspas (ex.: "ou").
"""
import json
import re
import sqlite3
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

MAX_ESCOPO = 20
MAX_PALAVRAS = 500
MAX_TIPOS_PUBLICACAO = 20
MAX_TIPO_PUBLICACAO = 80
CONTAGENS = ("uteis", "corridos")
INICIOS = ("disponibilizacao", "movimento")
COMBINACOES = ("e", "ou")
ORIGENS = ("publicacao", "movimento")
ACOES = ("aplicado", "dispensado")
TIPOS_ESCOPO = ("classe", "assunto")


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


def _opcional(valor, campo: str, maximo: int) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValueError(f"Informe {campo} como texto.")
    valor = " ".join(valor.split())
    if not valor:
        return None
    if len(valor) > maximo:
        raise ValueError(f"{campo[0].upper() + campo[1:]} passa de {maximo} caracteres.")
    return valor


class _Termo:
    """Termo já normalizado, com o padrão de palavra inteira pronto para casar."""

    __slots__ = ("texto", "chave", "frase", "padrao")

    def __init__(self, texto: str, frase: bool = False):
        self.texto = texto
        self.chave = normalizar(texto)
        self.frase = frase
        self.padrao = re.compile(r"(?<!\w)" + re.escape(self.chave) + r"(?!\w)")

    def casa(self, alvo: str) -> bool:
        return self.padrao.search(alvo) is not None


class Expressao:
    """Expressão de palavras-chave compilada. Use compilar() para montar uma."""

    def __init__(self, alternativas):
        self.alternativas = alternativas

    def avaliar(self, texto_alvo) -> list[str] | None:
        """Termos positivos que casaram, ou None se a expressão não casa com o texto.

        Cada alternativa é uma conjunção de termos positivos com eventuais termos excluídos.
        Basta uma alternativa casar; os termos de todas as que casam são devolvidos. Texto vazio nunca casa.
        """
        alvo = normalizar(texto_alvo)
        if not alvo or not self.alternativas:
            return None
        todos = []
        for positivos, negativos in self.alternativas:
            achados = [t.texto for t in positivos if t.casa(alvo)]
            if len(achados) != len(positivos) or any(t.casa(alvo) for t in negativos):
                continue
            todos += achados  # todas as alternativas que casam, para destacar o motivo da sugestão
        return list(dict.fromkeys(todos)) or None

    def descrever(self) -> str:
        """Leitura humana da expressão, para a prévia: 'contestar OU "prazo de 15 dias" mas SEM recurso'."""
        partes = []
        for positivos, negativos in self.alternativas:
            texto = " E ".join(_mostrar(t) for t in positivos)
            if negativos:
                texto += " mas SEM " + " E SEM ".join(_mostrar(t) for t in negativos)
            partes.append(texto)
        return " OU ".join(partes)


def _mostrar(termo: _Termo) -> str:
    return f'"{termo.texto}"' if termo.frase else termo.texto


def compilar(texto) -> Expressao:
    """Compila a expressão de palavras-chave. Levanta ValueError com mensagem para a pessoa."""
    if texto is None:
        return Expressao([])
    if not isinstance(texto, str):
        raise ValueError("A expressão de palavras-chave deve ser texto.")
    texto = texto.strip()
    if not texto:
        return Expressao([])
    if len(texto) > MAX_PALAVRAS:
        raise ValueError(f"A expressão de palavras-chave passa de {MAX_PALAVRAS} caracteres.")
    return Expressao(_analisar(_tokenizar(texto)))


def _tokenizar(texto: str) -> list[tuple[str, str, bool]]:
    """Quebra em termos (com a marca de frase exata) e operadores, sem perder as aspas."""
    tokens = []
    i = 0
    while i < len(texto):
        c = texto[i]
        if c.isspace():
            i += 1
            continue
        if c in "()":
            raise ValueError('A expressão não aceita parênteses; use "e", "ou" e "sem".')
        if c == '"':
            fim = texto.find('"', i + 1)
            if fim < 0:
                raise ValueError("Feche as aspas da frase exata.")
            frase = texto[i + 1:fim].strip()
            if not frase:
                raise ValueError("Há um termo vazio na expressão (aspas sem conteúdo).")
            tokens.append(("termo", frase, True))
            i = fim + 1
            continue
        j = i
        while j < len(texto) and not texto[j].isspace() and texto[j] not in '()"':
            j += 1
        palavra = texto[i:j]
        i = j
        chave = normalizar(palavra)
        tokens.append((chave if chave in ("e", "ou", "sem") else "termo", palavra, False))
    return tokens


def _analisar(tokens: list[tuple[str, str, bool]]):
    """Valida a gramática e devolve as alternativas [(positivos, negativos)]."""
    alternativas = []
    positivos, negativos = [], []
    estado = "inicio"

    def fechar_alternativa():
        nonlocal positivos, negativos, estado
        alternativas.append((positivos, negativos))
        positivos, negativos = [], []
        estado = "inicio"

    for tipo, valor, frase in tokens:
        if tipo == "termo":
            if estado in ("inicio", "apos_e"):
                positivos.append(_Termo(valor, frase))
                estado = "apos_positivo"
            elif estado == "apos_sem":
                negativos.append(_Termo(valor, frase))
                estado = "apos_positivo"
            else:
                raise ValueError('Use "e", "ou" ou "sem" entre os termos.')
        elif tipo == "e":
            if estado == "apos_positivo":
                estado = "apos_e"
            elif estado == "inicio":
                raise ValueError('A expressão não pode começar com "e".')
            else:
                raise ValueError('Os operadores "e", "ou" e "sem" não podem ficar em sequência.')
        elif tipo == "ou":
            if estado == "apos_positivo":
                fechar_alternativa()
            elif estado == "inicio" and not alternativas:
                raise ValueError('A expressão não pode começar com "ou"; informe o termo antes.')
            else:
                raise ValueError('Os operadores "e", "ou" e "sem" não podem ficar em sequência.')
        else:  # sem
            if estado == "apos_positivo":
                estado = "apos_sem"
            elif estado == "inicio":
                raise ValueError('A expressão não pode começar com "sem"; informe o termo que deve casar.')
            else:
                raise ValueError('Os operadores "e", "ou" e "sem" não podem ficar em sequência.')

    if estado in ("apos_e", "apos_sem"):
        raise ValueError("A expressão termina com um operador; informe o termo que falta.")
    if estado == "inicio":
        if alternativas:
            raise ValueError('A expressão termina com "ou"; informe o termo que falta.')
        return []
    alternativas.append((positivos, negativos))
    return alternativas


def validar_tipo(dados) -> dict:
    """Confere e normaliza um tipo de prazo. Levanta ValueError com mensagem para a pessoa."""
    if not isinstance(dados, dict):
        raise ValueError("Informe um objeto JSON.")
    contagem = dados.get("contagem") or "uteis"
    if contagem not in CONTAGENS:
        raise ValueError("A contagem do prazo deve ser uteis ou corridos.")
    inicio = dados.get("inicio") or "disponibilizacao"
    if inicio not in INICIOS:
        raise ValueError("O início da contagem deve ser disponibilizacao ou movimento.")
    ativo = dados.get("ativo", True)
    if not isinstance(ativo, bool):
        raise ValueError("O campo ativo deve ser verdadeiro ou falso.")
    return {"nome": _texto(dados.get("nome"), "o nome do tipo de prazo", 120),
            "dias": _inteiro(dados.get("dias"), "os dias do prazo", 1, 365),
            "contagem": contagem, "base_legal": _opcional(dados.get("base_legal"), "a base legal", 200),
            "inicio": inicio, "ativo": ativo}


def _validar_escopo(valor) -> list[dict]:
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ValueError("O escopo deve ser uma lista de assuntos e classes.")
    if len(valor) > MAX_ESCOPO:
        raise ValueError(f"Use no máximo {MAX_ESCOPO} itens no escopo.")
    saida, vistos = [], set()
    for item in valor:
        if not isinstance(item, dict):
            raise ValueError("Cada item do escopo deve ser um objeto.")
        tipo = item.get("tipo")
        if tipo not in TIPOS_ESCOPO:
            raise ValueError("O tipo do escopo deve ser classe ou assunto.")
        codigo = item.get("codigo")
        if codigo is not None and (isinstance(codigo, bool) or not isinstance(codigo, int)):
            raise ValueError("O código do escopo deve ser um número inteiro ou ficar vazio.")
        nome = _texto(item.get("nome"), "o nome do escopo", 200)
        if len(normalizar(nome)) < 3:
            raise ValueError("O nome do escopo deve ter ao menos 3 letras.")
        chave = (tipo, normalizar(nome))
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append({"tipo": tipo, "codigo": codigo, "nome": nome})
    return saida


def _validar_palavras(valor) -> str:
    if valor is None:
        return ""
    if not isinstance(valor, str):
        raise ValueError("As palavras-chave devem ser texto.")
    valor = " ".join(valor.split())
    if len(valor) > MAX_PALAVRAS:
        raise ValueError(f"As palavras-chave passam de {MAX_PALAVRAS} caracteres.")
    if valor:
        compilar(valor)  # valida a sintaxe antes de gravar
    return valor


def _validar_tipos_publicacao(valor) -> list[str]:
    """Tipos de publicação do DJEN (comunicação ou documento) da regra: sem vazios nem repetidos."""
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise ValueError("Os tipos de publicação devem ser uma lista.")
    if len(valor) > MAX_TIPOS_PUBLICACAO:
        raise ValueError(f"Use no máximo {MAX_TIPOS_PUBLICACAO} tipos de publicação.")
    saida, vistos = [], set()
    for item in valor:
        texto = _texto(item, "o tipo da publicação", MAX_TIPO_PUBLICACAO)
        chave = normalizar(texto)
        if chave not in vistos:
            vistos.add(chave)
            saida.append(texto)
    return saida


def validar_regra(dados, tipo=None) -> dict:
    """Confere e normaliza uma regra. `tipo` é o tipo já resolvido (dá o nome padrão da regra)."""
    if not isinstance(dados, dict):
        raise ValueError("Informe um objeto JSON.")
    tipo_id = dados.get("tipo_id")
    if not isinstance(tipo_id, str) or not tipo_id.strip():
        raise ValueError("Escolha o tipo de prazo da regra.")
    nome_padrao = tipo.get("nome") if isinstance(tipo, dict) else None
    escopo = _validar_escopo(dados.get("escopo"))
    palavras = _validar_palavras(dados.get("palavras"))
    tipos_publicacao = _validar_tipos_publicacao(dados.get("tipos_publicacao"))
    if not escopo and not palavras and not tipos_publicacao:
        raise ValueError("Informe ao menos um critério: assunto/classe, tipo da publicação ou palavras-chave.")
    combinacao = dados.get("combinacao") or "e"
    if combinacao not in COMBINACOES:
        raise ValueError("A combinação da regra deve ser e ou ou.")
    ativo = dados.get("ativo", True)
    if not isinstance(ativo, bool):
        raise ValueError("O campo ativo deve ser verdadeiro ou falso.")
    return {"nome": _texto(dados.get("nome") or nome_padrao, "o nome da regra", 120), "tipo_id": tipo_id.strip(),
            "escopo": escopo, "palavras": palavras, "tipos_publicacao": tipos_publicacao,
            "combinacao": combinacao, "ativo": ativo}


def _tipo(linha) -> dict:
    return {"id": linha[0], "nome": linha[1], "dias": linha[2], "contagem": linha[3],
            "base_legal": linha[4], "inicio": linha[5], "ativo": bool(linha[6]), "criado_por": linha[7],
            "criado_em": linha[8], "atualizado_em": linha[9]}


def _regra(linha) -> dict:
    return {"id": linha[0], "nome": linha[1], "tipo_id": linha[2], "escopo": json.loads(linha[3]),
            "palavras": linha[4], "combinacao": linha[5], "ativo": bool(linha[6]), "criado_por": linha[7],
            "criado_em": linha[8], "atualizado_em": linha[9], "tipos_publicacao": json.loads(linha[10] or "[]")}


_ESQUEMA = (
    """CREATE TABLE IF NOT EXISTS tipos_prazo (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL, dias INTEGER NOT NULL,
        contagem TEXT NOT NULL DEFAULT 'uteis', base_legal TEXT,
        inicio TEXT NOT NULL DEFAULT 'disponibilizacao', ativo INTEGER NOT NULL DEFAULT 1,
        criado_por TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS regras_prazo (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL, tipo_id TEXT NOT NULL, escopo TEXT NOT NULL,
        palavras TEXT NOT NULL, combinacao TEXT NOT NULL DEFAULT 'e',
        ativo INTEGER NOT NULL DEFAULT 1, criado_por TEXT,
        criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
        tipos_publicacao TEXT NOT NULL DEFAULT '[]')""",
    """CREATE TABLE IF NOT EXISTS regra_prazo_decisoes (
        regra_id TEXT NOT NULL, origem TEXT NOT NULL, origem_id TEXT NOT NULL,
        caso_id TEXT NOT NULL, acao TEXT NOT NULL, usuario TEXT, em TEXT NOT NULL,
        PRIMARY KEY (regra_id, origem, origem_id))""",
)


def _criar_tabelas(conexao) -> None:
    for comando in _ESQUEMA:
        conexao.execute(comando)
    # Bancos criados antes do critério "tipo da publicação" não têm a coluna.
    if "tipos_publicacao" not in {l[1] for l in conexao.execute("PRAGMA table_info(regras_prazo)")}:
        conexao.execute("ALTER TABLE regras_prazo ADD COLUMN tipos_publicacao TEXT NOT NULL DEFAULT '[]'")


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def migrar_legado(caminho) -> int:
    """Converte os modelos de prazo antigos em tipos e regras e apaga as tabelas antigas.

    Cada prazo de cada modelo vira (ou reutiliza) um tipo e ganha uma regra INATIVA: uma regra
    só com escopo, sem palavras-chave, dispararia em toda publicação do processo. O escopo leva
    o critério antigo como classe e como assunto, porque o modelo antigo casava com a ação, a
    classe da capa e os assuntos. Modelo só com tarefas não gera nada. Tudo acontece numa única
    transação, junto com o DROP das tabelas antigas; rodar de novo não duplica nada. Devolve
    quantas regras foram criadas.
    """
    criadas = 0
    conexao = sqlite3.connect(caminho, timeout=30)
    try:
        with conexao:
            conexao.execute("BEGIN IMMEDIATE")
            _criar_tabelas(conexao)
            if conexao.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'modelos_prazo'").fetchone() is None:
                return 0
            instante = _agora()
            tipos = {(normalizar(nome), dias, contagem): tipo_id for tipo_id, nome, dias, contagem
                     in conexao.execute("SELECT id, nome, dias, contagem FROM tipos_prazo")}
            regras = {(nome, tipo_id, escopo) for nome, tipo_id, escopo
                      in conexao.execute("SELECT nome, tipo_id, escopo FROM regras_prazo")}
            for modelo_nome, criterio, prazos_json in conexao.execute("SELECT nome, criterio, prazos FROM modelos_prazo"):
                if not criterio or len(normalizar(criterio)) < 3:
                    continue
                try:
                    prazos = json.loads(prazos_json or "[]")
                except ValueError:
                    continue
                if not isinstance(prazos, list):
                    continue
                for prazo in prazos:
                    if not isinstance(prazo, dict):
                        continue
                    titulo = " ".join(str(prazo.get("titulo") or "").split())
                    dias, contagem = prazo.get("dias"), prazo.get("contagem") or "uteis"
                    if not titulo or isinstance(dias, bool) or not isinstance(dias, int) or not 1 <= dias <= 365:
                        continue
                    if contagem not in CONTAGENS:
                        contagem = "uteis"
                    chave = (normalizar(titulo), dias, contagem)
                    tipo_id = tipos.get(chave)
                    if tipo_id is None:
                        tipo_id = uuid.uuid4().hex
                        conexao.execute(
                            "INSERT INTO tipos_prazo (id, nome, dias, contagem, base_legal, inicio, ativo, criado_por, criado_em, atualizado_em) "
                            "VALUES (?, ?, ?, ?, NULL, 'disponibilizacao', 1, 'migração', ?, ?)",
                            (tipo_id, titulo, dias, contagem, instante, instante))
                        tipos[chave] = tipo_id
                    nome_regra = f"{modelo_nome} – {titulo}"
                    # O critério antigo olhava ação, classe e assuntos; _escopo_casou separa pelo
                    # campo tipo, então o mesmo nome vai nos dois itens.
                    escopo = [{"tipo": "classe", "codigo": None, "nome": criterio},
                              {"tipo": "assunto", "codigo": None, "nome": criterio}]
                    escopo_json = json.dumps(escopo, ensure_ascii=False)
                    if (nome_regra, tipo_id, escopo_json) in regras:
                        continue
                    conexao.execute(
                        "INSERT INTO regras_prazo (id, nome, tipo_id, escopo, palavras, combinacao, ativo, criado_por, criado_em, atualizado_em) "
                        "VALUES (?, ?, ?, ?, '', 'e', 0, 'migração', ?, ?)",
                        (uuid.uuid4().hex, nome_regra, tipo_id, escopo_json, instante, instante))
                    regras.add((nome_regra, tipo_id, escopo_json))
                    criadas += 1
            conexao.execute("DROP TABLE modelos_prazo")
            conexao.execute("DROP TABLE IF EXISTS modelo_prazo_decisoes")
    finally:
        conexao.close()
    return criadas


def _escopo_casou(escopo: list[dict], classes: list[str], assuntos: list[str]):
    """Primeiro item do escopo que bate com a classe/ação ou os assuntos do processo."""
    for item in escopo:
        chave = normalizar(item.get("nome"))
        alvos = classes if item.get("tipo") == "classe" else assuntos
        for original in alvos:
            alvo = normalizar(original)
            if alvo and (chave == alvo or chave in alvo or alvo in chave):
                return item
    return None


class Repositorio:
    _COLUNAS_TIPO = "id, nome, dias, contagem, base_legal, inicio, ativo, criado_por, criado_em, atualizado_em"
    _COLUNAS_REGRA = "id, nome, tipo_id, escopo, palavras, combinacao, ativo, criado_por, criado_em, atualizado_em, tipos_publicacao"

    def __init__(self, caminho):
        self.caminho = caminho
        with self.abrir() as c:
            _criar_tabelas(c)
        migrar_legado(self.caminho)

    @contextmanager
    def abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    # Tipos de prazo

    def listar_tipos(self) -> list[dict]:
        with self.abrir() as c:
            linhas = c.execute(f"SELECT {self._COLUNAS_TIPO} FROM tipos_prazo ORDER BY lower(nome), id").fetchall()
        return [_tipo(l) for l in linhas]

    def obter_tipo(self, tipo_id: str) -> dict | None:
        with self.abrir() as c:
            linha = c.execute(f"SELECT {self._COLUNAS_TIPO} FROM tipos_prazo WHERE id = ?", (tipo_id,)).fetchone()
        return _tipo(linha) if linha else None

    def criar_tipo(self, dados: dict, usuario: str | None, agora=lambda: datetime.now(timezone.utc)) -> dict:
        d, instante, novo_id = validar_tipo(dados), agora().astimezone(timezone.utc).isoformat(timespec="seconds"), uuid.uuid4().hex
        with self.abrir() as c:
            c.execute("INSERT INTO tipos_prazo (id, nome, dias, contagem, base_legal, inicio, ativo, criado_por, criado_em, atualizado_em) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (novo_id, d["nome"], d["dias"], d["contagem"], d["base_legal"], d["inicio"],
                       int(d["ativo"]), usuario, instante, instante))
        return self.obter_tipo(novo_id)

    def atualizar_tipo(self, tipo_id: str, dados: dict, agora=lambda: datetime.now(timezone.utc)) -> dict | None:
        atual = self.obter_tipo(tipo_id)
        if atual is None:
            return None
        d = validar_tipo({**atual, **(dados if isinstance(dados, dict) else {})})
        with self.abrir() as c:
            c.execute("UPDATE tipos_prazo SET nome=?, dias=?, contagem=?, base_legal=?, inicio=?, ativo=?, atualizado_em=? WHERE id=?",
                      (d["nome"], d["dias"], d["contagem"], d["base_legal"], d["inicio"], int(d["ativo"]),
                       agora().astimezone(timezone.utc).isoformat(timespec="seconds"), tipo_id))
        return self.obter_tipo(tipo_id)

    def excluir_tipo(self, tipo_id: str) -> bool:
        """Recusa com ValueError se alguma regra ainda usa o tipo, para não deixar a regra órfã."""
        with self.abrir() as c:
            usadas = c.execute("SELECT COUNT(*) FROM regras_prazo WHERE tipo_id = ?", (tipo_id,)).fetchone()[0]
            if usadas:
                raise ValueError(f"Não é possível excluir este tipo: {usadas} regra(s) ainda usam ele. "
                                 "Troque ou exclua essas regras antes.")
            return c.execute("DELETE FROM tipos_prazo WHERE id = ?", (tipo_id,)).rowcount > 0

    # Regras

    def listar_regras(self) -> list[dict]:
        with self.abrir() as c:
            linhas = c.execute(f"SELECT {self._COLUNAS_REGRA} FROM regras_prazo ORDER BY lower(nome), id").fetchall()
        return [_regra(l) for l in linhas]

    def obter_regra(self, regra_id: str) -> dict | None:
        with self.abrir() as c:
            linha = c.execute(f"SELECT {self._COLUNAS_REGRA} FROM regras_prazo WHERE id = ?", (regra_id,)).fetchone()
        return _regra(linha) if linha else None

    def criar_regra(self, dados: dict, usuario: str | None, agora=lambda: datetime.now(timezone.utc)) -> dict:
        if not isinstance(dados, dict):
            raise ValueError("Informe um objeto JSON.")
        tipo_id = dados.get("tipo_id")
        tipo = self.obter_tipo(tipo_id.strip() if isinstance(tipo_id, str) else tipo_id)
        if tipo is None:
            raise ValueError("Escolha um tipo de prazo válido para a regra.")
        d, instante, novo_id = validar_regra(dados, tipo), agora().astimezone(timezone.utc).isoformat(timespec="seconds"), uuid.uuid4().hex
        with self.abrir() as c:
            c.execute("INSERT INTO regras_prazo (id, nome, tipo_id, escopo, palavras, combinacao, ativo, criado_por, criado_em, atualizado_em, tipos_publicacao) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      (novo_id, d["nome"], d["tipo_id"], json.dumps(d["escopo"], ensure_ascii=False),
                       d["palavras"], d["combinacao"], int(d["ativo"]), usuario, instante, instante,
                       json.dumps(d["tipos_publicacao"], ensure_ascii=False)))
        return self.obter_regra(novo_id)

    def atualizar_regra(self, regra_id: str, dados: dict, agora=lambda: datetime.now(timezone.utc)) -> dict | None:
        atual = self.obter_regra(regra_id)
        if atual is None:
            return None
        mesclado = {**atual, **(dados if isinstance(dados, dict) else {})}
        tipo_id = mesclado.get("tipo_id")
        tipo = self.obter_tipo(tipo_id.strip() if isinstance(tipo_id, str) else tipo_id)
        if tipo is None:
            raise ValueError("Escolha um tipo de prazo válido para a regra.")
        d = validar_regra(mesclado, tipo)
        with self.abrir() as c:
            c.execute("UPDATE regras_prazo SET nome=?, tipo_id=?, escopo=?, palavras=?, combinacao=?, ativo=?, atualizado_em=?, tipos_publicacao=? WHERE id=?",
                      (d["nome"], d["tipo_id"], json.dumps(d["escopo"], ensure_ascii=False), d["palavras"],
                       d["combinacao"], int(d["ativo"]),
                       agora().astimezone(timezone.utc).isoformat(timespec="seconds"),
                       json.dumps(d["tipos_publicacao"], ensure_ascii=False), regra_id))
        return self.obter_regra(regra_id)

    def excluir_regra(self, regra_id: str) -> bool:
        with self.abrir() as c:
            apagou = c.execute("DELETE FROM regras_prazo WHERE id = ?", (regra_id,)).rowcount > 0
            c.execute("DELETE FROM regra_prazo_decisoes WHERE regra_id = ?", (regra_id,))
        return apagou

    # Decisões

    def decisoes(self, caso_id: str) -> list[dict]:
        """Decisões já registradas para o processo (para a interface e para conferência)."""
        with self.abrir() as c:
            linhas = c.execute("SELECT regra_id, origem, origem_id, acao, usuario, em FROM regra_prazo_decisoes "
                               "WHERE caso_id = ? ORDER BY em, regra_id", (caso_id,)).fetchall()
        return [{"regra_id": l[0], "origem": l[1], "origem_id": l[2], "acao": l[3], "usuario": l[4], "em": l[5]}
                for l in linhas]

    def reservar(self, regra_id: str, origem: str, origem_id: str, caso_id: str, acao: str, usuario: str | None,
                 agora=lambda: datetime.now(timezone.utc)) -> bool:
        """Registra a decisão (aplicar ou dispensar) de uma regra para um evento. False se já foi decidida."""
        if origem not in ORIGENS:
            raise ValueError("A origem deve ser publicacao ou movimento.")
        if acao not in ACOES:
            raise ValueError("A ação deve ser aplicado ou dispensado.")
        if not isinstance(origem_id, str) or not origem_id.strip():
            raise ValueError("Informe o identificador do evento.")
        try:
            with self.abrir() as c:
                c.execute("INSERT INTO regra_prazo_decisoes (regra_id, origem, origem_id, caso_id, acao, usuario, em) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?)",
                          (regra_id, origem, origem_id.strip(), caso_id, acao, usuario,
                           agora().astimezone(timezone.utc).isoformat(timespec="seconds")))
            return True
        except sqlite3.IntegrityError:
            return False

    def liberar(self, regra_id: str, origem: str, origem_id: str) -> None:
        """Desfaz a decisão registrada (usado se a criação do prazo falhar no meio)."""
        if origem not in ORIGENS:
            raise ValueError("A origem deve ser publicacao ou movimento.")
        with self.abrir() as c:
            c.execute("DELETE FROM regra_prazo_decisoes WHERE regra_id = ? AND origem = ? AND origem_id = ?",
                      (regra_id, origem, origem_id))

    def sugestoes(self, caso_id: str, evento: dict) -> list[dict] | None:
        """Regras ativas (de tipos ativos) que casam com o processo e o evento, ainda não decididas.

        `evento` = {"origem": "publicacao"|"movimento", "id": str, "texto": str}. None se o
        processo não existe. Nada é criado: a lista é só uma sugestão para a revisão da pessoa.
        """
        if not isinstance(evento, dict):
            raise ValueError("Informe o evento (origem, id e texto).")
        origem = evento.get("origem")
        if origem not in ORIGENS:
            raise ValueError("A origem deve ser publicacao ou movimento.")
        origem_id = evento.get("id")
        if not isinstance(origem_id, str) or not origem_id.strip():
            raise ValueError("Informe o identificador do evento.")
        origem_id = origem_id.strip()
        texto = evento.get("texto") or ""
        if not isinstance(texto, str):
            raise ValueError("O texto do evento deve ser texto.")
        tipos_evento = evento.get("tipos") or []
        if not isinstance(tipos_evento, list):
            raise ValueError("Os tipos do evento devem ser uma lista.")
        tipos_evento = [(t, normalizar(t)) for t in tipos_evento if isinstance(t, str) and t.strip()]

        with self.abrir() as c:
            caso = c.execute("SELECT acao FROM casos WHERE id = ?", (caso_id,)).fetchone()
            if caso is None:
                return None
            classes = [caso[0]] if caso[0] else []
            assuntos = []
            for classe, lista in c.execute("SELECT classe, assuntos FROM caso_processo_capa WHERE caso_id = ?", (caso_id,)):
                if classe:
                    classes.append(classe)
                try:
                    itens = json.loads(lista or "[]")
                except ValueError:
                    itens = []
                for assunto in itens:
                    if isinstance(assunto, str):
                        assuntos.append(assunto)
                    elif isinstance(assunto, dict) and isinstance(assunto.get("nome"), str):
                        assuntos.append(assunto["nome"])
            tipos = {t["id"]: t for t in (_tipo(l) for l in c.execute(
                f"SELECT {self._COLUNAS_TIPO} FROM tipos_prazo").fetchall())}
            regras = [_regra(l) for l in c.execute(
                f"SELECT {self._COLUNAS_REGRA} FROM regras_prazo WHERE ativo = 1 ORDER BY lower(nome), id").fetchall()]
            decididos = {l[0] for l in c.execute(
                "SELECT regra_id FROM regra_prazo_decisoes WHERE origem = ? AND origem_id = ?", (origem, origem_id))}

        saida = []
        for regra in regras:
            tipo = tipos.get(regra["tipo_id"])
            if tipo is None or not tipo["ativo"] or regra["id"] in decididos:
                continue
            escopo, palavras, tipos_regra = regra["escopo"], regra["palavras"], regra["tipos_publicacao"]
            if not escopo and not palavras and not tipos_regra:
                continue
            correspondeu_a = _escopo_casou(escopo, classes, assuntos) if escopo else None
            termos = compilar(palavras).avaliar(texto) if palavras else None
            # O tipo da publicação só existe em publicações do DJEN: movimento nunca casa esse critério.
            tipo_casou = None
            if tipos_regra and origem == "publicacao":
                tipo_casou = next((t for t in tipos_regra if any(normalizar(t) == n for _, n in tipos_evento)), None)
            casou = [correspondeu_a is not None if escopo else None, bool(termos) if palavras else None,
                     tipo_casou is not None if tipos_regra else None]
            preenchidos = [c for c in casou if c is not None]  # critério vazio não conta
            if not (any(preenchidos) if regra["combinacao"] == "ou" else all(preenchidos)):
                continue
            saida.append({"regra": regra, "tipo": tipo, "correspondeu_a": correspondeu_a,
                          "termos": termos or [], "tipo_publicacao_casou": tipo_casou})
        saida.sort(key=lambda s: (-(bool(s["regra"]["escopo"]) + bool(s["regra"]["palavras"]) + bool(s["regra"]["tipos_publicacao"])),
                                  normalizar(s["regra"]["nome"]), s["regra"]["id"]))
        return saida
