"""Camada SQLite do cnj-processual: usuários, monitoramentos, clientes, casos.

Fase 0 da gestão de escritório: substitui o armazenamento em arquivos JSON soltos
(usuarios.json, monitoramentos.json) por um único banco SQLite, e acrescenta o
esquema de clientes/casos que as fases seguintes (CRUD, linha do tempo, captura por
OAB, integrações Google) vão usar.

RegistroUsuarios e RegistroMonitoramentos mantêm exatamente a mesma interface pública
que já tinham quando eram baseadas em arquivo (carregar/atualizar/salvar/identificar/
ativos/do_usuario), para que o resto do server.py (CadastroPublico, ServidorOAuth,
página admin, CLI, agendador de monitoramento) continue funcionando sem alteração.

Cada operação abre e fecha sua própria conexão (como o acesso a arquivo original: abre,
lê/grava, fecha) em vez de manter uma conexão viva por toda a vida do objeto. Isso evita
ficar com um handle do arquivo .db aberto indefinidamente, que no Windows impediria
remover/renomear o arquivo enquanto o processo estivesse de pé.
"""

import hmac
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path


def conectar(caminho: Path) -> sqlite3.Connection:
    """Abre uma conexão ao banco (criando o arquivo e o esquema se preciso).

    Quem chama é responsável por fechar (`.close()`) quando terminar. Usado para
    operações pontuais (migração, CLI) — as classes abaixo abrem e fecham suas próprias
    conexões efêmeras a cada operação, por isso não guardam uma conexão feita aqui.
    """
    caminho.parent.mkdir(parents=True, exist_ok=True)
    conexao = sqlite3.connect(caminho, check_same_thread=False)
    conexao.execute("PRAGMA foreign_keys = ON")
    _criar_schema(conexao)
    return conexao


@contextmanager
def _abrir(caminho: Path):
    conexao = conectar(caminho)
    try:
        yield conexao
    finally:
        conexao.close()


def _criar_schema(conexao: sqlite3.Connection) -> None:
    with conexao:
        conexao.executescript(
            """
            -- usuarios/monitoramentos guardam o registro inteiro como JSON (coluna `dados`),
            -- não colunas tipadas: o chamador (CadastroPublico, ServidorOAuth, página admin)
            -- lia e gravava dicionários com formato livre no arquivo JSON original (ex.: um
            -- campo extra "revogado_por"), e precisa continuar podendo fazer isso.
            CREATE TABLE IF NOT EXISTS usuarios (
                nome TEXT PRIMARY KEY,
                dados TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS monitoramentos (
                id TEXT PRIMARY KEY,
                dados TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS clientes (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                cpf_cnpj TEXT,
                telefone TEXT,
                email TEXT,
                observacoes TEXT,
                criado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS casos (
                id TEXT PRIMARY KEY,
                cliente_id TEXT NOT NULL REFERENCES clientes(id),
                titulo TEXT,
                responsavel TEXT,
                status TEXT NOT NULL DEFAULT 'ativo',
                drive_pasta_id TEXT,
                calendar_evento_id TEXT,
                criado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS caso_processos (
                caso_id TEXT NOT NULL REFERENCES casos(id),
                numero_processo TEXT NOT NULL,
                PRIMARY KEY (caso_id, numero_processo)
            );

            -- Linha do tempo do caso (fase 2): publicações/movimentações já
            -- monitoradas, ligadas ao caso quando o processo está vinculado a um.
            CREATE TABLE IF NOT EXISTS caso_eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                caso_id TEXT NOT NULL REFERENCES casos(id),
                numero_processo TEXT,
                tipo TEXT NOT NULL,
                conteudo TEXT NOT NULL,
                criado_em TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_caso_processos_numero ON caso_processos (numero_processo);
            CREATE INDEX IF NOT EXISTS idx_casos_cliente ON casos (cliente_id);
            CREATE INDEX IF NOT EXISTS idx_caso_eventos_caso ON caso_eventos (caso_id);
            """
        )


def migrar_de_json_se_necessario(caminho_banco: Path, dados_dir: Path) -> None:
    """Importa usuarios.json/monitoramentos.json pré-existentes, uma única vez.

    Só importa se a tabela correspondente ainda estiver vazia: assim é seguro chamar
    isso em todo start do servidor. Os arquivos JSON originais não são apagados (ficam
    como backup), e passam a ser ignorados pelo servidor a partir da primeira migração.
    """
    with _abrir(caminho_banco) as conexao:
        _migrar_usuarios(conexao, dados_dir / "usuarios.json")
        _migrar_monitoramentos(conexao, dados_dir / "monitoramentos.json")


def _tabela_vazia(conexao: sqlite3.Connection, tabela: str) -> bool:
    (total,) = conexao.execute(f"SELECT COUNT(*) FROM {tabela}").fetchone()
    return total == 0


def _migrar_usuarios(conexao: sqlite3.Connection, caminho_json: Path) -> None:
    if not caminho_json.exists() or not _tabela_vazia(conexao, "usuarios"):
        return
    dados = json.loads(caminho_json.read_text(encoding="utf-8") or "{}")
    if not dados:
        return
    with conexao:
        conexao.executemany(
            "INSERT INTO usuarios (nome, dados) VALUES (?, ?)",
            [(nome, json.dumps(registro)) for nome, registro in dados.items()],
        )


def _migrar_monitoramentos(conexao: sqlite3.Connection, caminho_json: Path) -> None:
    if not caminho_json.exists() or not _tabela_vazia(conexao, "monitoramentos"):
        return
    dados = json.loads(caminho_json.read_text(encoding="utf-8") or "{}")
    if not dados:
        return
    with conexao:
        conexao.executemany(
            "INSERT INTO monitoramentos (id, dados) VALUES (?, ?)",
            [(i, json.dumps(registro)) for i, registro in dados.items()],
        )


def _hash_token(token: str) -> str:
    import hashlib

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class _RegistroJSON:
    """Base comum: tabela (chave TEXT PRIMARY KEY, dados TEXT NOT NULL), dados = JSON do
    registro inteiro, sem colunas tipadas. Replica o comportamento do arquivo JSON original
    (dicionário de formato livre por chave; abre, lê/grava, fecha), só troca onde é guardado.
    """

    _tabela: str
    _coluna_chave: str

    def __init__(self, caminho: str | Path) -> None:
        self.caminho = Path(caminho)
        self._trava = threading.Lock()

    def atualizar(self, alterar) -> None:
        """Lê o registro mais recente, aplica `alterar` e grava, tudo sob trava.

        `alterar` recebe o dicionário {chave: registro} e devolve False para cancelar a
        gravação (mesmo contrato de antes, com o arquivo JSON).
        """
        with self._trava:
            dados = self.carregar()
            if alterar(dados) is not False:
                self.salvar(dados)

    def carregar(self) -> dict:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(f"SELECT {self._coluna_chave}, dados FROM {self._tabela}")
            return {chave: json.loads(dados) for chave, dados in cursor.fetchall()}

    def salvar(self, dados: dict) -> None:
        with _abrir(self.caminho) as conexao, conexao:
            conexao.execute(f"DELETE FROM {self._tabela}")
            conexao.executemany(
                f"INSERT INTO {self._tabela} ({self._coluna_chave}, dados) VALUES (?, ?)",
                [(chave, json.dumps(registro)) for chave, registro in dados.items()],
            )


class RegistroUsuarios(_RegistroJSON):
    """Usuários (nome -> {hash, criado_em, revogado, ...}), agora em SQLite.

    Mesma interface pública que a versão baseada em arquivo: carregar/atualizar/salvar/
    identificar/ativos, e o atributo `caminho` para quem deriva caminhos de arquivos
    vizinhos a partir dele (ex.: o server.py monta oauth.json a partir de registro.caminho).
    """

    _tabela = "usuarios"
    _coluna_chave = "nome"

    def identificar(self, token: str) -> str | None:
        """Devolve o nome do usuário dono do token, ou None se não existe ou foi revogado."""
        h = _hash_token(token)
        for nome, registro in self.carregar().items():
            if not registro.get("revogado") and hmac.compare_digest(registro.get("hash", ""), h):
                return nome
        return None

    def ativos(self) -> list[str]:
        return [nome for nome, r in self.carregar().items() if not r.get("revogado")]


class RegistroMonitoramentos(_RegistroJSON):
    """Monitoramentos (id -> {usuario, criterio, criado_em, hashes_notificados, expira_em}).

    Mesma interface pública que a versão baseada em arquivo: carregar/atualizar/salvar/do_usuario.
    """

    _tabela = "monitoramentos"
    _coluna_chave = "id"

    def do_usuario(self, usuario: str) -> dict:
        return {i: m for i, m in self.carregar().items() if m.get("usuario") == usuario}


# --- Clientes e casos: fundação para as fases seguintes (CRUD, timeline, OAB, Google) -----


class RegistroClientesCasos:
    """CRUD mínimo de clientes e casos/pastas, usado a partir da Fase 1.

    Um caso pertence a um cliente e pode abranger vários números de processo
    (caso_processos). Criado aqui, na Fase 0, só para o esquema já nascer completo;
    as telas do painel web que o usam vêm na Fase 1.
    """

    def __init__(self, caminho: str | Path) -> None:
        self.caminho = Path(caminho)
        self._trava = threading.Lock()

    # Clientes

    def criar_cliente(
        self, nome: str, cpf_cnpj: str | None, telefone: str | None, email: str | None,
        observacoes: str | None, agora,
    ) -> dict:
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO clientes (id, nome, cpf_cnpj, telefone, email, observacoes, criado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (novo_id, nome, cpf_cnpj, telefone, email, observacoes, criado_em),
            )
        return self.obter_cliente(novo_id)

    def obter_cliente(self, cliente_id: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em "
                "FROM clientes WHERE id = ?",
                (cliente_id,),
            ).fetchone()
        return _linha_cliente(linha) if linha else None

    def listar_clientes(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em "
                "FROM clientes ORDER BY nome"
            )
            return [_linha_cliente(linha) for linha in cursor.fetchall()]

    # Casos

    def criar_caso(
        self, cliente_id: str, titulo: str | None, responsavel: str | None,
        numeros_processo: list[str], agora,
    ) -> dict:
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO casos (id, cliente_id, titulo, responsavel, status, criado_em) "
                "VALUES (?, ?, ?, ?, 'ativo', ?)",
                (novo_id, cliente_id, titulo, responsavel, criado_em),
            )
            conexao.executemany(
                "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                [(novo_id, numero) for numero in numeros_processo],
            )
        return self.obter_caso(novo_id)

    def adicionar_processo_ao_caso(self, caso_id: str, numero_processo: str) -> None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                (caso_id, numero_processo),
            )

    def obter_caso(self, caso_id: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, cliente_id, titulo, responsavel, status, drive_pasta_id, "
                "calendar_evento_id, criado_em FROM casos WHERE id = ?",
                (caso_id,),
            ).fetchone()
            if not linha:
                return None
            return {**_linha_caso(linha), "processos": self._processos_do_caso(conexao, caso_id)}

    def listar_casos(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, cliente_id, titulo, responsavel, status, drive_pasta_id, "
                "calendar_evento_id, criado_em FROM casos ORDER BY criado_em DESC"
            )
            return [
                {**_linha_caso(linha), "processos": self._processos_do_caso(conexao, linha[0])}
                for linha in cursor.fetchall()
            ]

    def casos_do_processo(self, numero_processo: str) -> list[str]:
        """IDs dos casos que incluem esse número de processo (0, 1 ou mais)."""
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT caso_id FROM caso_processos WHERE numero_processo = ?", (numero_processo,)
            )
            return [linha[0] for linha in cursor.fetchall()]

    @staticmethod
    def _processos_do_caso(conexao: sqlite3.Connection, caso_id: str) -> list[str]:
        cursor = conexao.execute(
            "SELECT numero_processo FROM caso_processos WHERE caso_id = ?", (caso_id,)
        )
        return [linha[0] for linha in cursor.fetchall()]

    # Linha do tempo (Fase 2)

    def registrar_evento(self, numero_processo: str, tipo: str, conteudo: dict, agora) -> list[str]:
        """Grava `conteudo` (ex.: uma publicação do DJEN) na linha do tempo de cada caso que
        inclui `numero_processo` (pode ser 0, 1 ou mais casos). Devolve os IDs dos casos
        atualizados - vazio se nenhum caso cadastrado inclui esse processo.
        """
        casos = self.casos_do_processo(numero_processo)
        if not casos:
            return []
        criado_em = agora().isoformat()
        conteudo_json = json.dumps(conteudo, ensure_ascii=False)
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.executemany(
                "INSERT INTO caso_eventos (caso_id, numero_processo, tipo, conteudo, criado_em) "
                "VALUES (?, ?, ?, ?, ?)",
                [(caso_id, numero_processo, tipo, conteudo_json, criado_em) for caso_id in casos],
            )
        return casos

    def eventos_do_caso(self, caso_id: str) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT numero_processo, tipo, conteudo, criado_em FROM caso_eventos "
                "WHERE caso_id = ? ORDER BY criado_em DESC",
                (caso_id,),
            )
            return [
                {
                    "numero_processo": numero_processo, "tipo": tipo,
                    "conteudo": json.loads(conteudo), "criado_em": criado_em,
                }
                for numero_processo, tipo, conteudo, criado_em in cursor.fetchall()
            ]


def _linha_cliente(linha) -> dict:
    id_, nome, cpf_cnpj, telefone, email, observacoes, criado_em = linha
    return {
        "id": id_, "nome": nome, "cpf_cnpj": cpf_cnpj, "telefone": telefone,
        "email": email, "observacoes": observacoes, "criado_em": criado_em,
    }


def _linha_caso(linha) -> dict:
    id_, cliente_id, titulo, responsavel, status, drive_pasta_id, calendar_evento_id, criado_em = linha
    return {
        "id": id_, "cliente_id": cliente_id, "titulo": titulo, "responsavel": responsavel,
        "status": status, "drive_pasta_id": drive_pasta_id, "calendar_evento_id": calendar_evento_id,
        "criado_em": criado_em,
    }
