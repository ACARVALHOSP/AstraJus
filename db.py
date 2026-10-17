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
                acao TEXT,
                foro TEXT,
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

            -- Clientes adicionais de um caso (ex.: mais de uma parte da mesma publicação vira
            -- cliente do escritório). casos.cliente_id continua sendo o cliente principal; esta
            -- tabela só guarda os extras, então um caso sem nenhum aqui segue igual a antes.
            CREATE TABLE IF NOT EXISTS caso_clientes (
                caso_id TEXT NOT NULL REFERENCES casos(id),
                cliente_id TEXT NOT NULL REFERENCES clientes(id),
                PRIMARY KEY (caso_id, cliente_id)
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

            -- Integração Google (fase 4): uma linha só (id=1) - conta institucional única do
            -- escritório, não por usuário (ver Q13). sync_token_calendar é o cursor da
            -- sincronização incremental Calendar -> sistema (ver listar_eventos_de_casos).
            CREATE TABLE IF NOT EXISTS integracao_google (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                refresh_token TEXT NOT NULL,
                conectado_em TEXT NOT NULL,
                sync_token_calendar TEXT
            );

            -- Triagem (fase 3): processo novo achado pela busca periódica por OAB, ainda sem
            -- caso cadastrado. Não vira caso sozinho (decisão explícita: homônimos/erro de
            -- grafia tornam a associação automática por nome arriscada) - fica à espera de
            -- confirmação manual no painel, ou de ser descartado.
            CREATE TABLE IF NOT EXISTS triagem_processos (
                numero_processo TEXT PRIMARY KEY,
                usuario TEXT NOT NULL,
                dados TEXT NOT NULL,
                criado_em TEXT NOT NULL,
                descartado INTEGER NOT NULL DEFAULT 0
            );

            -- Log geral de publicações capturadas por monitoramento de OAB (aba "Publicações por
            -- OAB"), diferente de triagem_processos: aqui entra TODA publicação achada (tenha ou
            -- não caso já cadastrado), com status de tratamento manual. Captura roda a cada 24h,
            -- separada do ciclo de 6h que manda e-mail.
            CREATE TABLE IF NOT EXISTS publicacoes_capturadas (
                hash TEXT PRIMARY KEY,
                monitoramento_id TEXT,
                nome_pesquisado TEXT,
                numero_processo TEXT,
                dados TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'nao_tratada',
                caso_id TEXT,
                criado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS caso_atividades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                caso_id TEXT NOT NULL REFERENCES casos(id),
                tipo TEXT NOT NULL DEFAULT 'tarefa',
                titulo TEXT NOT NULL,
                data TEXT,
                hora TEXT,
                status TEXT NOT NULL DEFAULT 'pendente',
                observacoes TEXT,
                criado_em TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_caso_processos_numero ON caso_processos (numero_processo);
            CREATE INDEX IF NOT EXISTS idx_casos_cliente ON casos (cliente_id);
            CREATE INDEX IF NOT EXISTS idx_caso_eventos_caso ON caso_eventos (caso_id);
            CREATE INDEX IF NOT EXISTS idx_publicacoes_status ON publicacoes_capturadas (status);
            CREATE INDEX IF NOT EXISTS idx_caso_atividades_caso ON caso_atividades (caso_id);
            """
        )
        _migrar_colunas_casos(conexao)


def _migrar_colunas_casos(conexao: sqlite3.Connection) -> None:
    """Bancos criados antes de certas colunas existirem na tabela `casos` precisam do ALTER
    TABLE manual - CREATE TABLE IF NOT EXISTS não adiciona coluna em tabela já existente."""
    colunas = {linha[1] for linha in conexao.execute("PRAGMA table_info(casos)")}
    with conexao:
        if "acao" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN acao TEXT")
        if "foro" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN foro TEXT")
        if "autor" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN autor TEXT")
        if "reu" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN reu TEXT")
        if "advogados" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN advogados TEXT")


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

    def atualizar_cliente(
        self, cliente_id: str, nome: str, cpf_cnpj: str | None, telefone: str | None,
        email: str | None, observacoes: str | None,
    ) -> dict | None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "UPDATE clientes SET nome = ?, cpf_cnpj = ?, telefone = ?, email = ?, observacoes = ? "
                "WHERE id = ?",
                (nome, cpf_cnpj, telefone, email, observacoes, cliente_id),
            )
        return self.obter_cliente(cliente_id)

    def buscar_cliente_por_nome(self, nome: str) -> dict | None:
        """Casamento exato (sem diferenciar maiúsculas) - usado para não duplicar cliente quando
        a mesma parte aparece em casos/publicações diferentes."""
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em "
                "FROM clientes WHERE lower(nome) = lower(?) LIMIT 1",
                (nome,),
            ).fetchone()
        return _linha_cliente(linha) if linha else None

    def listar_clientes(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em "
                "FROM clientes ORDER BY nome"
            )
            return [_linha_cliente(linha) for linha in cursor.fetchall()]

    def excluir_cliente(self, cliente_id: str) -> bool:
        """Devolve True se excluiu, False se o id não existia. Levanta sqlite3.IntegrityError
        (não tratado aqui) se o cliente ainda for cliente_id principal de algum caso ou estiver
        em caso_clientes - quem chama decide a mensagem (ver _cliente_detalhe em server.py)."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute("DELETE FROM clientes WHERE id = ?", (cliente_id,))
            return cursor.rowcount > 0

    # Casos

    def criar_caso(
        self, cliente_id: str, titulo: str | None, responsavel: str | None,
        numeros_processo: list[str], agora, clientes_adicionais: list[str] | None = None,
        acao: str | None = None, foro: str | None = None,
    ) -> dict:
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO casos (id, cliente_id, titulo, responsavel, acao, foro, status, criado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)",
                (novo_id, cliente_id, titulo, responsavel, acao, foro, criado_em),
            )
            conexao.executemany(
                "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                [(novo_id, numero) for numero in numeros_processo],
            )
            if clientes_adicionais:
                conexao.executemany(
                    "INSERT OR IGNORE INTO caso_clientes (caso_id, cliente_id) VALUES (?, ?)",
                    [(novo_id, cid) for cid in clientes_adicionais if cid != cliente_id],
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
                "calendar_evento_id, criado_em, acao, foro, autor, reu, advogados "
                "FROM casos WHERE id = ?",
                (caso_id,),
            ).fetchone()
            if not linha:
                return None
            return {
                **_linha_caso(linha),
                "processos": self._processos_do_caso(conexao, caso_id),
                "clientes_adicionais": self._clientes_adicionais_do_caso(conexao, caso_id),
            }

    def atualizar_caso(
        self, caso_id: str, titulo: str | None, responsavel: str | None,
        acao: str | None, foro: str | None, autor: str | None, reu: str | None,
        advogados: str | None, numeros_processo: list[str] | None = None,
    ) -> dict | None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute("SELECT 1 FROM casos WHERE id = ?", (caso_id,))
            if cursor.fetchone() is None:
                return None
            conexao.execute(
                "UPDATE casos SET titulo=?, responsavel=?, acao=?, foro=?, autor=?, reu=?, advogados=? "
                "WHERE id = ?",
                (titulo, responsavel, acao, foro, autor, reu, advogados, caso_id),
            )
            if numeros_processo is not None:
                conexao.execute("DELETE FROM caso_processos WHERE caso_id = ?", (caso_id,))
                conexao.executemany(
                    "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                    [(caso_id, n) for n in numeros_processo],
                )
        return self.obter_caso(caso_id)

    def listar_casos(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, cliente_id, titulo, responsavel, status, drive_pasta_id, "
                "calendar_evento_id, criado_em, acao, foro, autor, reu, advogados "
                "FROM casos ORDER BY criado_em DESC"
            )
            return [
                {
                    **_linha_caso(linha),
                    "processos": self._processos_do_caso(conexao, linha[0]),
                    "clientes_adicionais": self._clientes_adicionais_do_caso(conexao, linha[0]),
                    "ultima_movimentacao": self._ultima_movimentacao_do_caso(conexao, linha[0], linha[7]),
                    "monitorado": self._caso_tem_publicacao_monitorada(conexao, linha[0]),
                }
                for linha in cursor.fetchall()
            ]

    def excluir_caso(self, caso_id: str) -> bool:
        """Remove o caso e tudo que depende dele (processos, clientes adicionais, linha do
        tempo). Publicações já capturadas (aba "Publicações por OAB") que apontavam pra este
        caso voltam a "não tratada" em vez de serem apagadas - a publicação em si continua
        existindo, só perde o vínculo. Devolve True se excluiu, False se o id não existia."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute("SELECT 1 FROM casos WHERE id = ?", (caso_id,))
            if cursor.fetchone() is None:
                return False
            conexao.execute(
                "UPDATE publicacoes_capturadas SET caso_id = NULL, status = 'nao_tratada' "
                "WHERE caso_id = ?",
                (caso_id,),
            )
            conexao.execute("DELETE FROM caso_atividades WHERE caso_id = ?", (caso_id,))
            conexao.execute("DELETE FROM caso_eventos WHERE caso_id = ?", (caso_id,))
            conexao.execute("DELETE FROM caso_clientes WHERE caso_id = ?", (caso_id,))
            conexao.execute("DELETE FROM caso_processos WHERE caso_id = ?", (caso_id,))
            conexao.execute("DELETE FROM casos WHERE id = ?", (caso_id,))
            return True

    def listar_atividades(self, caso_id: str) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, caso_id, tipo, titulo, data, hora, status, observacoes, criado_em "
                "FROM caso_atividades WHERE caso_id = ? ORDER BY data ASC, criado_em ASC",
                (caso_id,),
            )
            return [_linha_atividade(linha) for linha in cursor.fetchall()]

    def criar_atividade(
        self, caso_id: str, tipo: str, titulo: str,
        data: str | None, hora: str | None, observacoes: str | None, agora,
    ) -> dict:
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "INSERT INTO caso_atividades (caso_id, tipo, titulo, data, hora, status, observacoes, criado_em) "
                "VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?) RETURNING id",
                (caso_id, tipo, titulo, data or None, hora or None, observacoes or None, criado_em),
            )
            aid = cursor.fetchone()[0]
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, caso_id, tipo, titulo, data, hora, status, observacoes, criado_em "
                "FROM caso_atividades WHERE id = ?", (aid,)
            ).fetchone()
        return _linha_atividade(linha)

    def atualizar_atividade(
        self, caso_id: str, aid: int, titulo: str | None = None,
        tipo: str | None = None, data: str | None = None, hora: str | None = None,
        status: str | None = None, observacoes: str | None = None,
    ) -> dict | None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            linha = conexao.execute(
                "SELECT id, caso_id, tipo, titulo, data, hora, status, observacoes, criado_em "
                "FROM caso_atividades WHERE id = ? AND caso_id = ?", (aid, caso_id)
            ).fetchone()
            if linha is None:
                return None
            atual = _linha_atividade(linha)
            novo_titulo = titulo if titulo is not None else atual["titulo"]
            novo_tipo = tipo if tipo is not None else atual["tipo"]
            nova_data = data if data is not None else atual["data"]
            nova_hora = hora if hora is not None else atual["hora"]
            novo_status = status if status is not None else atual["status"]
            novas_obs = observacoes if observacoes is not None else atual["observacoes"]
            conexao.execute(
                "UPDATE caso_atividades SET titulo=?, tipo=?, data=?, hora=?, status=?, observacoes=? "
                "WHERE id=? AND caso_id=?",
                (novo_titulo, novo_tipo, nova_data or None, nova_hora or None, novo_status, novas_obs or None, aid, caso_id),
            )
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, caso_id, tipo, titulo, data, hora, status, observacoes, criado_em "
                "FROM caso_atividades WHERE id = ?", (aid,)
            ).fetchone()
        return _linha_atividade(linha)

    def excluir_atividade(self, caso_id: str, aid: int) -> bool:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "DELETE FROM caso_atividades WHERE id = ? AND caso_id = ?", (aid, caso_id)
            )
            return cursor.rowcount > 0

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

    @staticmethod
    def _clientes_adicionais_do_caso(conexao: sqlite3.Connection, caso_id: str) -> list[str]:
        cursor = conexao.execute(
            "SELECT cliente_id FROM caso_clientes WHERE caso_id = ?", (caso_id,)
        )
        return [linha[0] for linha in cursor.fetchall()]

    @staticmethod
    def _ultima_movimentacao_do_caso(conexao: sqlite3.Connection, caso_id: str, criado_em_caso: str) -> str:
        linha = conexao.execute(
            "SELECT MAX(criado_em) FROM caso_eventos WHERE caso_id = ?", (caso_id,)
        ).fetchone()
        return (linha[0] if linha and linha[0] else None) or criado_em_caso

    @staticmethod
    def _caso_tem_publicacao_monitorada(conexao: sqlite3.Connection, caso_id: str) -> bool:
        linha = conexao.execute(
            "SELECT 1 FROM publicacoes_capturadas WHERE caso_id = ? LIMIT 1", (caso_id,)
        ).fetchone()
        return linha is not None

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

    def registrar_evento_no_caso(self, caso_id: str, numero_processo: str | None, tipo: str, conteudo: dict, agora) -> None:
        """Como registrar_evento, mas grava direto no `caso_id` dado - para quando quem chama já
        sabe exatamente em qual caso (ex.: evento de agenda criado a partir da tela do caso),
        em vez de descobrir o(s) caso(s) a partir do número do processo."""
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO caso_eventos (caso_id, numero_processo, tipo, conteudo, criado_em) "
                "VALUES (?, ?, ?, ?, ?)",
                (caso_id, numero_processo, tipo, json.dumps(conteudo, ensure_ascii=False), criado_em),
            )

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

    def obter_evento_calendar(self, caso_id: str, evento_id: str) -> dict | None:
        """Último registro conhecido (criado ou de uma alteração detectada) de um evento do
        Google Calendar nesse caso, pelo id do evento - usado pela sincronização periódica
        (Fase 4) para saber se algo mudou desde a última vez que olhou."""
        for evento in self.eventos_do_caso(caso_id):
            if evento["tipo"] in ("prazo_agenda", "evento_agenda_alterado") and \
                    evento["conteudo"].get("evento_id") == evento_id:
                return evento["conteudo"]
        return None

    # Triagem de processo novo achado por OAB (Fase 3)

    def registrar_pendente(self, numero_processo: str, usuario: str, dados: dict, agora) -> None:
        """Enfileira `numero_processo` para triagem manual, a menos que já esteja na fila (ativo
        ou descartado): sinalizações repetidas do mesmo processo em ciclos de monitoramento
        seguintes não reabrem algo que a pessoa já descartou."""
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT OR IGNORE INTO triagem_processos (numero_processo, usuario, dados, criado_em, descartado) "
                "VALUES (?, ?, ?, ?, 0)",
                (numero_processo, usuario, json.dumps(dados, ensure_ascii=False), criado_em),
            )

    def listar_pendentes(self) -> list[dict]:
        """Processos aguardando triagem: não descartados e ainda sem nenhum caso cadastrado
        (criar um caso para o processo é o que tira ele desta lista, sem precisar de um passo
        extra de 'resolver')."""
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT numero_processo, usuario, dados, criado_em FROM triagem_processos "
                "WHERE descartado = 0 AND numero_processo NOT IN (SELECT numero_processo FROM caso_processos) "
                "ORDER BY criado_em DESC"
            )
            return [
                {"numero_processo": n, "usuario": u, "dados": json.loads(d), "criado_em": c}
                for n, u, d, c in cursor.fetchall()
            ]

    def descartar_pendente(self, numero_processo: str) -> bool:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "UPDATE triagem_processos SET descartado = 1 WHERE numero_processo = ?", (numero_processo,)
            )
            return cursor.rowcount > 0

    # Integração Google (Fase 4)

    def atualizar_drive_pasta(self, caso_id: str, drive_pasta_id: str) -> None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute("UPDATE casos SET drive_pasta_id = ? WHERE id = ?", (drive_pasta_id, caso_id))


class RegistroIntegracaoGoogle:
    """Conexão Google institucional (uma linha só, id=1): refresh_token + cursor da
    sincronização incremental do Calendar. Mesmo padrão de conexão efêmera das outras classes."""

    def __init__(self, caminho: str | Path) -> None:
        self.caminho = Path(caminho)
        self._trava = threading.Lock()

    def salvar_conexao(self, refresh_token: str, agora) -> None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO integracao_google (id, refresh_token, conectado_em, sync_token_calendar) "
                "VALUES (1, ?, ?, NULL) "
                "ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token, "
                "conectado_em = excluded.conectado_em, sync_token_calendar = NULL",
                (refresh_token, agora().isoformat()),
            )

    def obter_conexao(self) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT refresh_token, conectado_em, sync_token_calendar FROM integracao_google WHERE id = 1"
            ).fetchone()
            if not linha:
                return None
            refresh_token, conectado_em, sync_token = linha
            return {"refresh_token": refresh_token, "conectado_em": conectado_em, "sync_token_calendar": sync_token}

    def desconectar(self) -> None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute("DELETE FROM integracao_google WHERE id = 1")

    def salvar_sync_token_calendar(self, sync_token: str | None) -> None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute("UPDATE integracao_google SET sync_token_calendar = ? WHERE id = 1", (sync_token,))


def _linha_cliente(linha) -> dict:
    id_, nome, cpf_cnpj, telefone, email, observacoes, criado_em = linha
    return {
        "id": id_, "nome": nome, "cpf_cnpj": cpf_cnpj, "telefone": telefone,
        "email": email, "observacoes": observacoes, "criado_em": criado_em,
    }


def _linha_caso(linha) -> dict:
    id_, cliente_id, titulo, responsavel, status, drive_pasta_id, calendar_evento_id, criado_em, acao, foro, autor, reu, advogados = linha
    return {
        "id": id_, "cliente_id": cliente_id, "titulo": titulo, "responsavel": responsavel,
        "status": status, "drive_pasta_id": drive_pasta_id, "calendar_evento_id": calendar_evento_id,
        "criado_em": criado_em, "acao": acao, "foro": foro,
        "autor": autor, "reu": reu, "advogados": advogados,
    }


def _linha_atividade(linha) -> dict:
    id_, caso_id, tipo, titulo, data, hora, status, observacoes, criado_em = linha
    return {
        "id": id_, "caso_id": caso_id, "tipo": tipo, "titulo": titulo,
        "data": data, "hora": hora, "status": status, "observacoes": observacoes, "criado_em": criado_em,
    }


_STATUS_PUBLICACAO_VALIDOS = {"nao_tratada", "tratada", "arquivada"}


class RegistroPublicacoesOAB:
    """Log geral de publicações capturadas por monitoramento de OAB (aba "Publicações por OAB").
    Mesmo padrão de conexão efêmera das outras classes."""

    def __init__(self, caminho: str | Path) -> None:
        self.caminho = Path(caminho)
        self._trava = threading.Lock()

    def registrar(
        self, hash_publicacao: str, monitoramento_id: str | None, nome_pesquisado: str | None,
        numero_processo: str | None, dados: dict, status: str, caso_id: str | None, agora,
    ) -> bool:
        """INSERT OR IGNORE pelo hash: uma publicação já vista (mesmo hash) não aparece de novo
        nas capturas seguintes. Devolve True se inseriu (publicação nova), False se já existia."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "INSERT OR IGNORE INTO publicacoes_capturadas "
                "(hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, caso_id, criado_em) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    hash_publicacao, monitoramento_id, nome_pesquisado, numero_processo,
                    json.dumps(dados, ensure_ascii=False), status, caso_id, agora().isoformat(),
                ),
            )
            return cursor.rowcount > 0

    def listar(self, status: str | None = None, limite: int = 300) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            if status:
                cursor = conexao.execute(
                    "SELECT hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, "
                    "caso_id, criado_em FROM publicacoes_capturadas WHERE status = ? "
                    "ORDER BY criado_em DESC LIMIT ?",
                    (status, limite),
                )
            else:
                cursor = conexao.execute(
                    "SELECT hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, "
                    "caso_id, criado_em FROM publicacoes_capturadas ORDER BY criado_em DESC LIMIT ?",
                    (limite,),
                )
            return [_linha_publicacao(linha) for linha in cursor.fetchall()]

    def contar(self, status: str | None = None) -> int:
        with _abrir(self.caminho) as conexao:
            if status:
                linha = conexao.execute(
                    "SELECT COUNT(*) FROM publicacoes_capturadas WHERE status = ?", (status,)
                ).fetchone()
            else:
                linha = conexao.execute("SELECT COUNT(*) FROM publicacoes_capturadas").fetchone()
            return linha[0] if linha else 0

    def obter(self, hash_publicacao: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, "
                "caso_id, criado_em FROM publicacoes_capturadas WHERE hash = ?",
                (hash_publicacao,),
            ).fetchone()
        return _linha_publicacao(linha) if linha else None

    def atualizar_status(self, hashes: list[str], status: str, caso_id: str | None = None) -> int:
        """Atualiza o status (em lote) de uma lista de hashes. `caso_id`, se dado, também é
        gravado (uso: ao criar um caso a partir da publicação). Devolve quantas linhas mudaram."""
        if status not in _STATUS_PUBLICACAO_VALIDOS:
            raise ValueError(f"status inválido: {status}")
        if not hashes:
            return 0
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            marcadores = ",".join("?" for _ in hashes)
            if caso_id is not None:
                cursor = conexao.execute(
                    f"UPDATE publicacoes_capturadas SET status = ?, caso_id = ? WHERE hash IN ({marcadores})",
                    (status, caso_id, *hashes),
                )
            else:
                cursor = conexao.execute(
                    f"UPDATE publicacoes_capturadas SET status = ? WHERE hash IN ({marcadores})",
                    (status, *hashes),
                )
            return cursor.rowcount

    def marcar_tratada_por_processo(self, numero_processo: str, caso_id: str) -> int:
        """Quando um processo já tem caso (ou acaba de ganhar um), as publicações já capturadas
        desse processo viram "tratada" automaticamente (Q11 da fase de publicações por OAB)."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "UPDATE publicacoes_capturadas SET status = 'tratada', caso_id = ? "
                "WHERE numero_processo = ? AND status != 'tratada'",
                (caso_id, numero_processo),
            )
            return cursor.rowcount


def _linha_publicacao(linha) -> dict:
    hash_, monitoramento_id, nome_pesquisado, numero_processo, dados, status, caso_id, criado_em = linha
    return {
        "hash": hash_, "monitoramento_id": monitoramento_id, "nome_pesquisado": nome_pesquisado,
        "numero_processo": numero_processo, "dados": json.loads(dados), "status": status,
        "caso_id": caso_id, "criado_em": criado_em,
    }
