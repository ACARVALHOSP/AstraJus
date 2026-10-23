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

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from _util import _hash_token


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
                criado_em TEXT NOT NULL,
                asaas_customer_id TEXT,
                tipo_pessoa TEXT NOT NULL DEFAULT 'fisica',
                perfil TEXT NOT NULL DEFAULT 'cliente',
                site TEXT,
                endereco_rua TEXT,
                endereco_numero TEXT,
                endereco_bairro TEXT,
                endereco_complemento TEXT,
                endereco_cidade TEXT,
                endereco_estado TEXT,
                endereco_pais TEXT,
                rg_numero TEXT,
                rg_emissao TEXT,
                rg_emissor TEXT,
                ctps_numero TEXT,
                ctps_serie TEXT,
                ctps_emissao TEXT,
                ctps_uf TEXT,
                pis TEXT,
                estado_civil TEXT,
                nacionalidade TEXT,
                profissao TEXT,
                emails_json TEXT NOT NULL DEFAULT '[]',
                sites_json TEXT NOT NULL DEFAULT '[]',
                enderecos_json TEXT NOT NULL DEFAULT '[]'
            );

            -- Telefones de um cliente/contato (Fase 1 do cadastro completo): um cliente pode ter
            -- vários. clientes.telefone continua existindo, sincronizado com o primeiro telefone
            -- desta lista, para não quebrar a listagem e a integração Asaas (ver _salvar_telefones).
            CREATE TABLE IF NOT EXISTS cliente_telefones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
                telefone TEXT NOT NULL,
                tipo TEXT,
                operadora TEXT,
                ordem INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_cliente_telefones_cliente ON cliente_telefones (cliente_id);

            CREATE TABLE IF NOT EXISTS casos (
                id TEXT PRIMARY KEY,
                cliente_id TEXT NOT NULL REFERENCES clientes(id),
                titulo TEXT,
                responsavel TEXT,
                acao TEXT,
                foro TEXT,
                status TEXT NOT NULL DEFAULT 'ativo',
                drive_pasta_id TEXT,
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
                caso_id TEXT REFERENCES casos(id) ON DELETE SET NULL,
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

            -- Vínculos entre casos: recurso, apenso, execução de sentença, etc.
            -- A relação é simétrica: uma linha (A, B, tipo) é visível de ambos os lados.
            CREATE TABLE IF NOT EXISTS caso_vinculos (
                caso_id TEXT NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
                caso_vinculado_id TEXT NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
                tipo TEXT NOT NULL DEFAULT 'relacionado',
                criado_em TEXT NOT NULL,
                PRIMARY KEY (caso_id, caso_vinculado_id),
                CHECK (caso_id != caso_vinculado_id)
            );

            -- Capa de cada processo vinculado a um caso: campos auto-preenchíveis a partir de
            -- consultar_processo_unificado (tribunal, classe, assuntos, grau, data_distribuicao,
            -- nivel_sigilo, nome_processo) e campos sem fonte pública, editáveis manualmente
            -- (area_direito, magistrado, tipo_justica, cidade, uf, valor_causa, fase,
            -- status_processo). Comarca não existe aqui de propósito - casos.foro já cobre isso.
            CREATE TABLE IF NOT EXISTS caso_processo_capa (
                caso_id TEXT NOT NULL,
                numero_processo TEXT NOT NULL,
                tribunal TEXT,
                classe TEXT,
                assuntos TEXT,
                grau TEXT,
                data_distribuicao TEXT,
                nivel_sigilo INTEGER,
                nome_processo TEXT,
                area_direito TEXT,
                magistrado TEXT,
                tipo_justica TEXT,
                cidade TEXT,
                uf TEXT,
                valor_causa REAL,
                fase TEXT,
                status_processo TEXT,
                atualizado_em TEXT,
                PRIMARY KEY (caso_id, numero_processo),
                FOREIGN KEY (caso_id, numero_processo)
                    REFERENCES caso_processos (caso_id, numero_processo) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_caso_processos_numero ON caso_processos (numero_processo);
            CREATE INDEX IF NOT EXISTS idx_casos_cliente ON casos (cliente_id);
            CREATE INDEX IF NOT EXISTS idx_caso_eventos_caso ON caso_eventos (caso_id);
            CREATE INDEX IF NOT EXISTS idx_publicacoes_status ON publicacoes_capturadas (status);
            CREATE INDEX IF NOT EXISTS idx_caso_atividades_caso ON caso_atividades (caso_id);
            CREATE INDEX IF NOT EXISTS idx_caso_vinculos_vinculado ON caso_vinculos (caso_vinculado_id);

            -- Módulo Financeiro - Lançamentos (fase 1: só o tipo Honorário é criado pela tela;
            -- os demais tipos de lançamento seguem sem telas mapeadas ainda).
            CREATE TABLE IF NOT EXISTS lancamentos_financeiros (
                id TEXT PRIMARY KEY,
                tipo TEXT NOT NULL DEFAULT 'HONORARIO',
                vencimento TEXT NOT NULL,
                valor REAL NOT NULL,
                descricao TEXT NOT NULL,
                recorrente INTEGER NOT NULL DEFAULT 0,
                caso_id TEXT NOT NULL REFERENCES casos(id),
                cliente_id TEXT NOT NULL REFERENCES clientes(id),
                responsavel TEXT NOT NULL,
                criado_em TEXT NOT NULL,
                direcao TEXT NOT NULL DEFAULT 'RECEITA',
                pago INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_lancamentos_caso ON lancamentos_financeiros (caso_id);
            CREATE INDEX IF NOT EXISTS idx_lancamentos_cliente ON lancamentos_financeiros (cliente_id);

            -- Cache de resultados do DataJud: evita re-consultar a API lenta para o mesmo processo
            -- num curto intervalo. TTL verificado na leitura (criado_em + TTL_S > now).
            CREATE TABLE IF NOT EXISTS cache_datajud (
                chave TEXT PRIMARY KEY,
                resultado TEXT NOT NULL,
                criado_em REAL NOT NULL
            );
            """
        )
        if "orgao_julgador" not in {c[1] for c in conexao.execute("PRAGMA table_info(caso_processo_capa)")}:
            conexao.execute("ALTER TABLE caso_processo_capa ADD COLUMN orgao_julgador TEXT")
        _migrar_colunas_casos(conexao)
        _migrar_colunas_clientes(conexao)
        _migrar_colunas_lancamentos(conexao)
        _migrar_remover_calendar_evento_id(conexao)
        _migrar_fk_publicacoes_capturadas(conexao)
        _migrar_processos_individuais(conexao)


def _migrar_processos_individuais(conexao: sqlite3.Connection) -> None:
    """Separa cadastros antigos e impõe um único número por entidade.

    O índice também é o marcador idempotente da migração. Dados sem número
    (atividades, financeiro e eventos genéricos) continuam no registro original.
    Nomes físicos legados são mantidos para compatibilidade com a API.
    """
    if conexao.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_processo_unico_por_cadastro'").fetchone():
        return
    with conexao:
        antigos = conexao.execute(
            "SELECT caso_id FROM caso_processos GROUP BY caso_id HAVING COUNT(*) > 1"
        ).fetchall()
        colunas = [r[1] for r in conexao.execute("PRAGMA table_info(casos)")]
        for (original,) in antigos:
            dados = dict(zip(colunas, conexao.execute("SELECT * FROM casos WHERE id=?", (original,)).fetchone()))
            numeros = [r[0] for r in conexao.execute(
                "SELECT numero_processo FROM caso_processos WHERE caso_id=? ORDER BY numero_processo", (original,)
            )]
            for numero in numeros[1:]:
                novo = uuid.uuid4().hex
                copia = {**dados, "id": novo, "numero": conexao.execute("SELECT COALESCE(MAX(numero),0)+1 FROM casos").fetchone()[0]}
                conexao.execute(
                    f"INSERT INTO casos ({', '.join(colunas)}) VALUES ({', '.join('?' for _ in colunas)})",
                    [copia[c] for c in colunas],
                )
                conexao.execute("INSERT INTO caso_processos VALUES (?, ?)", (novo, numero))
                # A capa referencia a chave composta: copiar antes de excluir o vínculo antigo.
                capa_colunas = [r[1] for r in conexao.execute("PRAGMA table_info(caso_processo_capa)") if r[1] != "caso_id"]
                campos = ', '.join(capa_colunas)
                conexao.execute(
                    f"INSERT INTO caso_processo_capa (caso_id, {campos}) SELECT ?, {campos} FROM caso_processo_capa WHERE caso_id=? AND numero_processo=?",
                    (novo, original, numero),
                )
                for tabela in ("caso_eventos", "publicacoes_capturadas"):
                    conexao.execute(f"UPDATE {tabela} SET caso_id=? WHERE caso_id=? AND numero_processo=?", (novo, original, numero))
                conexao.execute("INSERT INTO caso_clientes SELECT ?, cliente_id FROM caso_clientes WHERE caso_id=?", (novo, original))
                conexao.execute("INSERT INTO caso_vinculos VALUES (?, ?, 'relacionado', ?)", (original, novo, dados["criado_em"]))
                conexao.execute("DELETE FROM caso_processos WHERE caso_id=? AND numero_processo=?", (original, numero))
        conexao.execute("CREATE UNIQUE INDEX idx_processo_unico_por_cadastro ON caso_processos(caso_id)")


def normalizar_numero_processo(numeros: list[str]) -> list[str]:
    """Contrato legado em lista: zero ou um número CNJ, armazenado sem máscara."""
    if not isinstance(numeros, list) or len(numeros) > 1:
        raise ValueError("Informe apenas um número CNJ por processo.")
    resultado = []
    for numero in numeros:
        if not isinstance(numero, str):
            raise ValueError("O número CNJ deve ser um texto com 20 dígitos.")
        numero = numero.strip()
        if not numero:
            continue
        if any(c not in "0123456789.- " for c in numero):
            raise ValueError("Número CNJ inválido: informe 20 dígitos.")
        digitos = ''.join(c for c in numero if c in "0123456789")
        if len(digitos) != 20:
            raise ValueError("Número CNJ inválido: informe 20 dígitos.")
        resultado.append(digitos)
    return resultado


def _migrar_colunas_clientes(conexao: sqlite3.Connection) -> None:
    """Bancos criados antes da integração Asaas (ou antes do cadastro completo) não têm todas
    as colunas atuais de `clientes`."""
    colunas = {linha[1] for linha in conexao.execute("PRAGMA table_info(clientes)")}
    if "asaas_customer_id" not in colunas:
        with conexao:
            conexao.execute("ALTER TABLE clientes ADD COLUMN asaas_customer_id TEXT")
    novas_colunas = {
        "tipo_pessoa": "TEXT NOT NULL DEFAULT 'fisica'",
        "perfil": "TEXT NOT NULL DEFAULT 'cliente'",
        "site": "TEXT",
        "endereco_rua": "TEXT",
        "endereco_numero": "TEXT",
        "endereco_bairro": "TEXT",
        "endereco_complemento": "TEXT",
        "endereco_cidade": "TEXT",
        "endereco_estado": "TEXT",
        "endereco_pais": "TEXT",
        "rg_numero": "TEXT",
        "rg_emissao": "TEXT",
        "rg_emissor": "TEXT",
        "ctps_numero": "TEXT",
        "ctps_serie": "TEXT",
        "ctps_emissao": "TEXT",
        "ctps_uf": "TEXT",
        "pis": "TEXT",
        "estado_civil": "TEXT",
        "nacionalidade": "TEXT",
        "profissao": "TEXT",
        "emails_json": "TEXT NOT NULL DEFAULT '[]'",
        "sites_json": "TEXT NOT NULL DEFAULT '[]'",
        "enderecos_json": "TEXT NOT NULL DEFAULT '[]'",
    }
    for coluna, definicao in novas_colunas.items():
        if coluna not in colunas:
            with conexao:
                conexao.execute(f"ALTER TABLE clientes ADD COLUMN {coluna} {definicao}")
    colunas_telefones = {linha[1] for linha in conexao.execute("PRAGMA table_info(cliente_telefones)")}
    for coluna in ("tipo", "operadora"):
        if coluna not in colunas_telefones:
            with conexao:
                conexao.execute(f"ALTER TABLE cliente_telefones ADD COLUMN {coluna} TEXT")


def _migrar_colunas_lancamentos(conexao: sqlite3.Connection) -> None:
    """Bancos criados antes de `direcao`/`pago` existirem em `lancamentos_financeiros`
    precisam do ALTER TABLE manual (lançamentos antigos nascem RECEITA/não pago, que já era o
    comportamento implícito até aqui - só o tipo Honorário tinha tela, e é sempre a receber)."""
    colunas = {linha[1] for linha in conexao.execute("PRAGMA table_info(lancamentos_financeiros)")}
    with conexao:
        if "direcao" not in colunas:
            conexao.execute("ALTER TABLE lancamentos_financeiros ADD COLUMN direcao TEXT NOT NULL DEFAULT 'RECEITA'")
        if "pago" not in colunas:
            conexao.execute("ALTER TABLE lancamentos_financeiros ADD COLUMN pago INTEGER NOT NULL DEFAULT 0")


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
        if "desfecho" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN desfecho TEXT")
        if "numero" not in colunas:
            conexao.execute("ALTER TABLE casos ADD COLUMN numero INTEGER")
    if "numero" not in colunas:
        _atribuir_numeros_casos_existentes(conexao)


def _atribuir_numeros_casos_existentes(conexao: sqlite3.Connection) -> None:
    """Bancos migrados ganham a coluna `numero` vazia - atribui sequencialmente por ordem de
    criação, pra cada caso existente ter um identificador único e estável desde já."""
    ids = [linha[0] for linha in conexao.execute("SELECT id FROM casos ORDER BY criado_em ASC")]
    with conexao:
        for indice, caso_id in enumerate(ids, start=1):
            conexao.execute("UPDATE casos SET numero = ? WHERE id = ?", (indice, caso_id))


def _migrar_remover_calendar_evento_id(conexao: sqlite3.Connection) -> None:
    """calendar_evento_id nunca foi escrita por nenhum código (o evento criado na agenda vai
    pra caso_eventos, a linha do tempo) - coluna morta desde sempre. Remove em bancos antigos
    que ainda a têm (precisa de SQLite 3.35+; python:3.12-slim já vem com uma bem mais nova)."""
    colunas = {linha[1] for linha in conexao.execute("PRAGMA table_info(casos)")}
    if "calendar_evento_id" not in colunas:
        return
    with conexao:
        conexao.execute("ALTER TABLE casos DROP COLUMN calendar_evento_id")


def _migrar_fk_publicacoes_capturadas(conexao: sqlite3.Connection) -> None:
    """publicacoes_capturadas.caso_id não tinha FOREIGN KEY declarado - a única referência a
    casos(id) no banco sem proteção nenhuma (se um caso fosse apagado por um caminho que não
    excluir_caso(), a publicação ficava órfã em silêncio). Reconstrói a tabela com REFERENCES
    casos(id) ON DELETE SET NULL - ALTER TABLE não adiciona constraint em coluna existente,
    então o jeito é recriar a tabela (procedimento padrão do próprio SQLite pra isso)."""
    fks = conexao.execute("PRAGMA foreign_key_list(publicacoes_capturadas)").fetchall()
    if any(fk[2] == "casos" for fk in fks):
        return  # já migrado
    with conexao:
        # zera caso_id que já estejam órfãos (apontando pra um caso que não existe mais),
        # senão o INSERT abaixo falha com violação da FK nova ao copiar os dados.
        conexao.execute(
            "UPDATE publicacoes_capturadas SET caso_id = NULL "
            "WHERE caso_id IS NOT NULL AND caso_id NOT IN (SELECT id FROM casos)"
        )
        conexao.execute(
            """
            CREATE TABLE publicacoes_capturadas_novo (
                hash TEXT PRIMARY KEY,
                monitoramento_id TEXT,
                nome_pesquisado TEXT,
                numero_processo TEXT,
                dados TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'nao_tratada',
                caso_id TEXT REFERENCES casos(id) ON DELETE SET NULL,
                criado_em TEXT NOT NULL
            )
            """
        )
        conexao.execute(
            "INSERT INTO publicacoes_capturadas_novo "
            "(hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, caso_id, criado_em) "
            "SELECT hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, caso_id, criado_em "
            "FROM publicacoes_capturadas"
        )
        conexao.execute("DROP TABLE publicacoes_capturadas")
        conexao.execute("ALTER TABLE publicacoes_capturadas_novo RENAME TO publicacoes_capturadas")
        conexao.execute("CREATE INDEX IF NOT EXISTS idx_publicacoes_status ON publicacoes_capturadas (status)")


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
        with _abrir(self.caminho) as conexao:
            row = conexao.execute(
                "SELECT nome FROM usuarios "
                "WHERE json_extract(dados, '$.hash') = ? "
                "AND (json_extract(dados, '$.revogado') IS NULL "
                "     OR json_extract(dados, '$.revogado') = 0)",
                (h,),
            ).fetchone()
        return row[0] if row else None

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
        self, nome: str, cpf_cnpj: str | None, observacoes: str | None, agora, *,
        telefones: list[dict] | None = None, emails: list[dict] | None = None,
        sites: list[dict] | None = None, enderecos: list[dict] | None = None,
        detalhes: dict | None = None,
    ) -> dict:
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        detalhes = detalhes or {}
        emails_limpos = _limpar_lista_dicts(emails, ("tipo", "email"), campo_obrigatorio="email")
        sites_limpos = _limpar_lista_dicts(sites, ("site",), campo_obrigatorio="site")
        enderecos_limpos = _limpar_lista_dicts(
            enderecos, ("tipo", "cep", "rua", "numero", "bairro", "complemento", "cidade", "estado", "pais"),
        )
        primeiro_endereco = enderecos_limpos[0] if enderecos_limpos else {}
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO clientes ("
                "id, nome, cpf_cnpj, telefone, email, observacoes, criado_em, tipo_pessoa, perfil, "
                "site, endereco_rua, endereco_numero, endereco_bairro, endereco_complemento, "
                "endereco_cidade, endereco_estado, endereco_pais, rg_numero, rg_emissao, rg_emissor, "
                "ctps_numero, ctps_serie, ctps_emissao, ctps_uf, pis, estado_civil, nacionalidade, "
                "profissao, emails_json, sites_json, enderecos_json"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    novo_id, nome, cpf_cnpj, None, emails_limpos[0]["email"] if emails_limpos else None,
                    observacoes, criado_em,
                    detalhes.get("tipo_pessoa") or "fisica", detalhes.get("perfil") or "cliente",
                    sites_limpos[0]["site"] if sites_limpos else None,
                    primeiro_endereco.get("rua"), primeiro_endereco.get("numero"),
                    primeiro_endereco.get("bairro"), primeiro_endereco.get("complemento"),
                    primeiro_endereco.get("cidade"), primeiro_endereco.get("estado"),
                    primeiro_endereco.get("pais"), detalhes.get("rg_numero"), detalhes.get("rg_emissao"),
                    detalhes.get("rg_emissor"), detalhes.get("ctps_numero"), detalhes.get("ctps_serie"),
                    detalhes.get("ctps_emissao"), detalhes.get("ctps_uf"), detalhes.get("pis"),
                    detalhes.get("estado_civil"), detalhes.get("nacionalidade"), detalhes.get("profissao"),
                    json.dumps(emails_limpos), json.dumps(sites_limpos), json.dumps(enderecos_limpos),
                ),
            )
            self._salvar_telefones(conexao, novo_id, telefones)
        return self.obter_cliente(novo_id)

    @staticmethod
    def _salvar_telefones(conexao: sqlite3.Connection, cliente_id: str, telefones: list[dict] | None) -> None:
        """Substitui a lista de telefones do cliente e mantém clientes.telefone sincronizado com
        o primeiro item (usado pela listagem legada e pela integração Asaas)."""
        limpos = _limpar_lista_dicts(telefones, ("tipo", "telefone", "operadora"), campo_obrigatorio="telefone")
        conexao.execute("DELETE FROM cliente_telefones WHERE cliente_id = ?", (cliente_id,))
        for ordem, item in enumerate(limpos):
            conexao.execute(
                "INSERT INTO cliente_telefones (cliente_id, telefone, tipo, operadora, ordem) "
                "VALUES (?, ?, ?, ?, ?)",
                (cliente_id, item["telefone"], item.get("tipo") or None, item.get("operadora") or None, ordem),
            )
        conexao.execute(
            "UPDATE clientes SET telefone = ? WHERE id = ?",
            (limpos[0]["telefone"] if limpos else None, cliente_id),
        )

    def _telefones_do_cliente(self, conexao: sqlite3.Connection, cliente_id: str) -> list[dict]:
        cursor = conexao.execute(
            "SELECT telefone, tipo, operadora FROM cliente_telefones WHERE cliente_id = ? ORDER BY ordem",
            (cliente_id,),
        )
        return [
            {"telefone": telefone, "tipo": tipo, "operadora": operadora}
            for telefone, tipo, operadora in cursor.fetchall()
        ]

    def obter_cliente(self, cliente_id: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em, asaas_customer_id, "
                "tipo_pessoa, perfil, site, endereco_rua, endereco_numero, endereco_bairro, "
                "endereco_complemento, endereco_cidade, endereco_estado, endereco_pais, rg_numero, "
                "rg_emissao, rg_emissor, ctps_numero, ctps_serie, ctps_emissao, ctps_uf, pis, "
                "estado_civil, nacionalidade, profissao, emails_json, sites_json, enderecos_json "
                "FROM clientes WHERE id = ?",
                (cliente_id,),
            ).fetchone()
            if not linha:
                return None
            cliente = _linha_cliente(linha)
            cliente["telefones"] = self._telefones_do_cliente(conexao, cliente_id)
        return cliente

    def atualizar_cliente(
        self, cliente_id: str, nome: str, cpf_cnpj: str | None, observacoes: str | None, *,
        telefones: list[dict] | None = None, emails: list[dict] | None = None,
        sites: list[dict] | None = None, enderecos: list[dict] | None = None,
        detalhes: dict | None = None,
    ) -> dict | None:
        detalhes = detalhes or {}
        emails_limpos = _limpar_lista_dicts(emails, ("tipo", "email"), campo_obrigatorio="email")
        sites_limpos = _limpar_lista_dicts(sites, ("site",), campo_obrigatorio="site")
        enderecos_limpos = _limpar_lista_dicts(
            enderecos, ("tipo", "cep", "rua", "numero", "bairro", "complemento", "cidade", "estado", "pais"),
        )
        primeiro_endereco = enderecos_limpos[0] if enderecos_limpos else {}
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "UPDATE clientes SET nome = ?, cpf_cnpj = ?, email = ?, observacoes = ?, "
                "tipo_pessoa = ?, perfil = ?, site = ?, endereco_rua = ?, endereco_numero = ?, "
                "endereco_bairro = ?, endereco_complemento = ?, endereco_cidade = ?, endereco_estado = ?, "
                "endereco_pais = ?, rg_numero = ?, rg_emissao = ?, rg_emissor = ?, ctps_numero = ?, "
                "ctps_serie = ?, ctps_emissao = ?, ctps_uf = ?, pis = ?, estado_civil = ?, "
                "nacionalidade = ?, profissao = ?, emails_json = ?, sites_json = ?, enderecos_json = ? "
                "WHERE id = ?",
                (
                    nome, cpf_cnpj, emails_limpos[0]["email"] if emails_limpos else None, observacoes,
                    detalhes.get("tipo_pessoa") or "fisica", detalhes.get("perfil") or "cliente",
                    sites_limpos[0]["site"] if sites_limpos else None,
                    primeiro_endereco.get("rua"), primeiro_endereco.get("numero"),
                    primeiro_endereco.get("bairro"), primeiro_endereco.get("complemento"),
                    primeiro_endereco.get("cidade"), primeiro_endereco.get("estado"),
                    primeiro_endereco.get("pais"), detalhes.get("rg_numero"), detalhes.get("rg_emissao"),
                    detalhes.get("rg_emissor"), detalhes.get("ctps_numero"), detalhes.get("ctps_serie"),
                    detalhes.get("ctps_emissao"), detalhes.get("ctps_uf"), detalhes.get("pis"),
                    detalhes.get("estado_civil"), detalhes.get("nacionalidade"), detalhes.get("profissao"),
                    json.dumps(emails_limpos), json.dumps(sites_limpos), json.dumps(enderecos_limpos),
                    cliente_id,
                ),
            )
            self._salvar_telefones(conexao, cliente_id, telefones)
        return self.obter_cliente(cliente_id)

    def buscar_cliente_por_nome(self, nome: str) -> dict | None:
        """Casamento exato (sem diferenciar maiúsculas) - usado para não duplicar cliente quando
        a mesma parte aparece em casos/publicações diferentes."""
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em, asaas_customer_id, "
                "tipo_pessoa, perfil, site, endereco_rua, endereco_numero, endereco_bairro, "
                "endereco_complemento, endereco_cidade, endereco_estado, endereco_pais, rg_numero, "
                "rg_emissao, rg_emissor, ctps_numero, ctps_serie, ctps_emissao, ctps_uf, pis, "
                "estado_civil, nacionalidade, profissao, emails_json, sites_json, enderecos_json "
                "FROM clientes WHERE lower(nome) = lower(?) LIMIT 1",
                (nome,),
            ).fetchone()
        return _linha_cliente(linha) if linha else None

    def listar_clientes(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT id, nome, cpf_cnpj, telefone, email, observacoes, criado_em, asaas_customer_id, "
                "tipo_pessoa, perfil, site, endereco_rua, endereco_numero, endereco_bairro, "
                "endereco_complemento, endereco_cidade, endereco_estado, endereco_pais, rg_numero, "
                "rg_emissao, rg_emissor, ctps_numero, ctps_serie, ctps_emissao, ctps_uf, pis, "
                "estado_civil, nacionalidade, profissao, emails_json, sites_json, enderecos_json "
                "FROM clientes ORDER BY nome"
            )
            return [_linha_cliente(linha) for linha in cursor.fetchall()]

    def definir_asaas_customer_id(self, cliente_id: str, asaas_customer_id: str) -> dict | None:
        """Guarda o customer_id devolvido pela Asaas ao cadastrar o cliente lá, pra não
        recriá-lo a cada cobrança nova."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "UPDATE clientes SET asaas_customer_id = ? WHERE id = ?",
                (asaas_customer_id, cliente_id),
            )
            if cursor.rowcount == 0:
                return None
        return self.obter_cliente(cliente_id)

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
        numeros_processo = normalizar_numero_processo(numeros_processo)
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            proximo_numero = conexao.execute("SELECT COALESCE(MAX(numero), 0) + 1 FROM casos").fetchone()[0]
            conexao.execute(
                "INSERT INTO casos (id, cliente_id, titulo, responsavel, acao, foro, status, criado_em, numero) "
                "VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?, ?)",
                (novo_id, cliente_id, titulo, responsavel, acao, foro, criado_em, proximo_numero),
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
        numeros = normalizar_numero_processo([numero_processo])
        if not numeros:
            raise ValueError("Informe o número CNJ.")
        numero_processo = numeros[0]
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                (caso_id, numero_processo),
            )

    _CAMPOS_CAPA = (
        "tribunal", "classe", "assuntos", "grau", "data_distribuicao", "nivel_sigilo", "nome_processo", "orgao_julgador",
        "area_direito", "magistrado", "tipo_justica", "cidade", "uf", "valor_causa", "fase", "status_processo",
    )

    def obter_capa_processo(self, caso_id: str, numero_processo: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                f"SELECT {', '.join(self._CAMPOS_CAPA)}, atualizado_em FROM caso_processo_capa "
                "WHERE caso_id = ? AND numero_processo = ?",
                (caso_id, numero_processo),
            ).fetchone()
            if not linha:
                return None
            capa = dict(zip((*self._CAMPOS_CAPA, "atualizado_em"), linha))
            capa["assuntos"] = json.loads(capa["assuntos"]) if capa["assuntos"] else []
            return capa

    def salvar_capa_processo(self, caso_id: str, numero_processo: str, agora, **campos) -> dict:
        """Upsert parcial: só grava os campos passados em `campos` (os demais mantêm o valor
        atual, ou ficam NULL na primeira gravação). Usado tanto pelo preenchimento automático
        (DataJud/DJEN, via consultar_processo_unificado) quanto pela edição manual."""
        invalidos = set(campos) - set(self._CAMPOS_CAPA)
        if invalidos:
            raise ValueError(f"Campos inválidos para capa de processo: {sorted(invalidos)}")
        if campos.get("assuntos") is not None:
            campos["assuntos"] = json.dumps(campos["assuntos"])
        atualizado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO caso_processo_capa (caso_id, numero_processo, atualizado_em) VALUES (?, ?, ?) "
                "ON CONFLICT (caso_id, numero_processo) DO UPDATE SET atualizado_em = excluded.atualizado_em",
                (caso_id, numero_processo, atualizado_em),
            )
            if campos:
                sets = ", ".join(f"{campo} = ?" for campo in campos)
                conexao.execute(
                    f"UPDATE caso_processo_capa SET {sets} WHERE caso_id = ? AND numero_processo = ?",
                    (*campos.values(), caso_id, numero_processo),
                )
        return self.obter_capa_processo(caso_id, numero_processo)

    def obter_caso(self, caso_id: str) -> dict | None:
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT id, cliente_id, titulo, responsavel, status, drive_pasta_id, "
                "criado_em, acao, foro, autor, reu, advogados, desfecho, numero "
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
        desfecho: str | None = None,
    ) -> dict | None:
        if numeros_processo is not None:
            numeros_processo = normalizar_numero_processo(numeros_processo)
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute("SELECT 1 FROM casos WHERE id = ?", (caso_id,))
            if cursor.fetchone() is None:
                return None
            conexao.execute(
                "UPDATE casos SET titulo=?, responsavel=?, acao=?, foro=?, autor=?, reu=?, advogados=?, desfecho=? "
                "WHERE id = ?",
                (titulo, responsavel, acao, foro, autor, reu, advogados, desfecho or None, caso_id),
            )
            if numeros_processo is not None:
                existentes = {r[0] for r in conexao.execute("SELECT numero_processo FROM caso_processos WHERE caso_id = ?", (caso_id,))}
                conexao.executemany(
                    "DELETE FROM caso_processos WHERE caso_id = ? AND numero_processo = ?",
                    [(caso_id, n) for n in existentes - set(numeros_processo)],
                )
                conexao.executemany(
                    "INSERT OR IGNORE INTO caso_processos (caso_id, numero_processo) VALUES (?, ?)",
                    [(caso_id, n) for n in numeros_processo],
                )
        return self.obter_caso(caso_id)

    def listar_casos(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            linhas = conexao.execute(
                "SELECT id, cliente_id, titulo, responsavel, status, drive_pasta_id, "
                "criado_em, acao, foro, autor, reu, advogados, desfecho, numero "
                "FROM casos ORDER BY criado_em DESC"
            ).fetchall()
            if not linhas:
                return []

            ids = [str(linha[0]) for linha in linhas]
            ph = ",".join("?" * len(ids))

            processos_map: dict[str, list[str]] = {i: [] for i in ids}
            for caso_id, numero in conexao.execute(
                f"SELECT caso_id, numero_processo FROM caso_processos WHERE caso_id IN ({ph})", ids
            ):
                processos_map[str(caso_id)].append(numero)

            clientes_add_map: dict[str, list[str]] = {i: [] for i in ids}
            for caso_id, cliente_id in conexao.execute(
                f"SELECT caso_id, cliente_id FROM caso_clientes WHERE caso_id IN ({ph})", ids
            ):
                clientes_add_map[str(caso_id)].append(str(cliente_id))

            ultima_mov_map: dict[str, str] = {}
            for caso_id, max_criado in conexao.execute(
                f"SELECT caso_id, MAX(criado_em) FROM caso_eventos WHERE caso_id IN ({ph}) GROUP BY caso_id",
                ids,
            ):
                if max_criado:
                    ultima_mov_map[str(caso_id)] = max_criado

            monitorado_set: set[str] = set()
            for (caso_id,) in conexao.execute(
                f"SELECT DISTINCT caso_id FROM publicacoes_capturadas WHERE caso_id IN ({ph})", ids
            ):
                monitorado_set.add(str(caso_id))

            return [
                {
                    **_linha_caso(linha),
                    "processos": processos_map[str(linha[0])],
                    "clientes_adicionais": clientes_add_map[str(linha[0])],
                    "ultima_movimentacao": ultima_mov_map.get(str(linha[0])) or linha[6],
                    "monitorado": str(linha[0]) in monitorado_set,
                }
                for linha in linhas
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
            # caso_vinculos usa ON DELETE CASCADE, mas SQLite não executa CASCADE por padrão
            # sem PRAGMA foreign_keys=ON (que não ativamos globalmente). Remove manualmente.
            conexao.execute(
                "DELETE FROM caso_vinculos WHERE caso_id = ? OR caso_vinculado_id = ?",
                (caso_id, caso_id),
            )
            conexao.execute("DELETE FROM casos WHERE id = ?", (caso_id,))
            return True

    # Vínculos entre casos

    def listar_vinculos_do_caso(self, caso_id: str) -> list[dict]:
        """Retorna todos os casos vinculados a `caso_id`, independente de qual lado da relação
        este caso ocupa. Cada item inclui dados básicos do caso vinculado e o tipo do vínculo."""
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                """
                SELECT
                    CASE WHEN v.caso_id = ? THEN v.caso_vinculado_id ELSE v.caso_id END AS outro_id,
                    v.tipo,
                    c.titulo,
                    c.acao,
                    c.status,
                    cli.nome AS cliente_nome
                FROM caso_vinculos v
                JOIN casos c
                    ON c.id = CASE WHEN v.caso_id = ? THEN v.caso_vinculado_id ELSE v.caso_id END
                LEFT JOIN clientes cli ON cli.id = c.cliente_id
                WHERE v.caso_id = ? OR v.caso_vinculado_id = ?
                ORDER BY v.criado_em ASC
                """,
                (caso_id, caso_id, caso_id, caso_id),
            )
            return [
                {
                    "caso_id": linha[0],
                    "tipo": linha[1],
                    "titulo": linha[2],
                    "acao": linha[3],
                    "status": linha[4],
                    "cliente_nome": linha[5],
                }
                for linha in cursor.fetchall()
            ]

    def adicionar_vinculo(self, caso_id: str, caso_vinculado_id: str, tipo: str, agora) -> dict | None:
        """Cria o vínculo entre dois casos. Devolve o vínculo criado, ou None se algum dos
        casos não existe. Levanta ValueError se caso_id == caso_vinculado_id ou se o vínculo
        já existe em qualquer direção."""
        if caso_id == caso_vinculado_id:
            raise ValueError("Um caso não pode ser vinculado a si mesmo.")
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            ids = {
                r[0] for r in conexao.execute(
                    "SELECT id FROM casos WHERE id IN (?, ?)", (caso_id, caso_vinculado_id)
                )
            }
            if caso_id not in ids or caso_vinculado_id not in ids:
                return None
            # Impede duplicata em qualquer direção antes de tentar inserir.
            existe = conexao.execute(
                "SELECT 1 FROM caso_vinculos WHERE (caso_id=? AND caso_vinculado_id=?) "
                "OR (caso_id=? AND caso_vinculado_id=?)",
                (caso_id, caso_vinculado_id, caso_vinculado_id, caso_id),
            ).fetchone()
            if existe:
                raise ValueError("Este vínculo já existe.")
            conexao.execute(
                "INSERT INTO caso_vinculos (caso_id, caso_vinculado_id, tipo, criado_em) "
                "VALUES (?, ?, ?, ?)",
                (caso_id, caso_vinculado_id, tipo, agora().isoformat()),
            )
        vinculos = self.listar_vinculos_do_caso(caso_id)
        return next((v for v in vinculos if v["caso_id"] == caso_vinculado_id), None)

    def remover_vinculo(self, caso_id: str, caso_vinculado_id: str) -> bool:
        """Remove o vínculo entre dois casos (em qualquer direção). Devolve True se removeu."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "DELETE FROM caso_vinculos WHERE (caso_id=? AND caso_vinculado_id=?) "
                "OR (caso_id=? AND caso_vinculado_id=?)",
                (caso_id, caso_vinculado_id, caso_vinculado_id, caso_id),
            )
            return cursor.rowcount > 0

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

    # Financeiro - Lançamentos

    _COLUNAS_LANCAMENTO = (
        "id, tipo, vencimento, valor, descricao, recorrente, caso_id, cliente_id, responsavel, "
        "criado_em, direcao, pago"
    )

    def criar_lancamento(
        self, tipo: str, vencimento: str, valor: float, descricao: str, recorrente: bool,
        caso_id: str, cliente_id: str, responsavel: str, agora, direcao: str = "RECEITA",
    ) -> dict:
        novo_id = uuid.uuid4().hex
        criado_em = agora().isoformat()
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT INTO lancamentos_financeiros "
                "(id, tipo, vencimento, valor, descricao, recorrente, caso_id, cliente_id, responsavel, criado_em, direcao) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (novo_id, tipo, vencimento, valor, descricao, int(recorrente), caso_id, cliente_id, responsavel, criado_em, direcao),
            )
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                f"SELECT {self._COLUNAS_LANCAMENTO} FROM lancamentos_financeiros WHERE id = ?", (novo_id,)
            ).fetchone()
        return _linha_lancamento(linha)

    def listar_lancamentos(self) -> list[dict]:
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                f"SELECT {self._COLUNAS_LANCAMENTO} "
                "FROM lancamentos_financeiros ORDER BY vencimento ASC, criado_em ASC"
            )
            return [_linha_lancamento(linha) for linha in cursor.fetchall()]

    def atualizar_lancamento_pago(self, lancamento_id: str, pago: bool) -> dict | None:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "UPDATE lancamentos_financeiros SET pago = ? WHERE id = ?", (int(pago), lancamento_id),
            )
            if cursor.rowcount == 0:
                return None
        with _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                f"SELECT {self._COLUNAS_LANCAMENTO} FROM lancamentos_financeiros WHERE id = ?", (lancamento_id,)
            ).fetchone()
        return _linha_lancamento(linha)

    def excluir_lancamento(self, lancamento_id: str) -> bool:
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "DELETE FROM lancamentos_financeiros WHERE id = ?", (lancamento_id,)
            )
            return cursor.rowcount > 0

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
    (
        id_, nome, cpf_cnpj, telefone, email, observacoes, criado_em, asaas_customer_id,
        tipo_pessoa, perfil, site, endereco_rua, endereco_numero, endereco_bairro,
        endereco_complemento, endereco_cidade, endereco_estado, endereco_pais, rg_numero,
        rg_emissao, rg_emissor, ctps_numero, ctps_serie, ctps_emissao, ctps_uf, pis,
        estado_civil, nacionalidade, profissao, emails_json, sites_json, enderecos_json,
    ) = linha
    return {
        "id": id_, "nome": nome, "cpf_cnpj": cpf_cnpj, "telefone": telefone,
        "email": email, "observacoes": observacoes, "criado_em": criado_em,
        "asaas_customer_id": asaas_customer_id,
        "tipo_pessoa": tipo_pessoa, "perfil": perfil, "site": site,
        "endereco_rua": endereco_rua, "endereco_numero": endereco_numero,
        "endereco_bairro": endereco_bairro, "endereco_complemento": endereco_complemento,
        "endereco_cidade": endereco_cidade, "endereco_estado": endereco_estado,
        "endereco_pais": endereco_pais, "rg_numero": rg_numero, "rg_emissao": rg_emissao,
        "rg_emissor": rg_emissor, "ctps_numero": ctps_numero, "ctps_serie": ctps_serie,
        "ctps_emissao": ctps_emissao, "ctps_uf": ctps_uf, "pis": pis,
        "estado_civil": estado_civil, "nacionalidade": nacionalidade, "profissao": profissao,
        "emails": json.loads(emails_json) if emails_json else [],
        "sites": json.loads(sites_json) if sites_json else [],
        "enderecos": json.loads(enderecos_json) if enderecos_json else [],
    }


def _limpar_lista_dicts(itens: list[dict] | None, campos: tuple, campo_obrigatorio: str | None = None) -> list[dict]:
    """Normaliza uma lista de dicts vinda da API (telefones/emails/sites/enderecos): mantém só
    os `campos` esperados, tira espaços e descarta itens vazios - sem o campo obrigatório
    preenchido (`campo_obrigatorio`), ou, se não for passado, sem nenhum campo preenchido (caso
    de endereços, onde nenhum campo isolado é sempre obrigatório)."""
    limpos = []
    for item in itens or []:
        if not isinstance(item, dict):
            continue
        limpo = {campo: str(item.get(campo) or "").strip() or None for campo in campos}
        valido = limpo.get(campo_obrigatorio) if campo_obrigatorio else any(limpo.values())
        if valido:
            limpos.append(limpo)
    return limpos


def _linha_lancamento(linha) -> dict:
    id_, tipo, vencimento, valor, descricao, recorrente, caso_id, cliente_id, responsavel, criado_em, direcao, pago = linha
    return {
        "id": id_, "tipo": tipo, "vencimento": vencimento, "valor": valor,
        "descricao": descricao, "recorrente": bool(recorrente), "caso_id": caso_id,
        "cliente_id": cliente_id, "responsavel": responsavel, "criado_em": criado_em,
        "direcao": direcao, "pago": bool(pago),
    }


def _linha_caso(linha) -> dict:
    id_, cliente_id, titulo, responsavel, status, drive_pasta_id, criado_em, acao, foro, autor, reu, advogados, desfecho, numero = linha
    return {
        "id": id_, "cliente_id": cliente_id, "titulo": titulo, "responsavel": responsavel,
        "status": status, "drive_pasta_id": drive_pasta_id,
        "criado_em": criado_em, "acao": acao, "foro": foro,
        "autor": autor, "reu": reu, "advogados": advogados, "desfecho": desfecho, "numero": numero,
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

    def listar_por_caso(self, caso_id: str) -> list[dict]:
        """Publicações vinculadas a um caso específico, mais recentes primeiro."""
        with _abrir(self.caminho) as conexao:
            cursor = conexao.execute(
                "SELECT hash, monitoramento_id, nome_pesquisado, numero_processo, dados, status, "
                "caso_id, criado_em FROM publicacoes_capturadas WHERE caso_id = ? "
                "ORDER BY criado_em DESC",
                (caso_id,),
            )
            return [_linha_publicacao(linha) for linha in cursor.fetchall()]

    def vincular_caso(self, hash_publicacao: str, caso_id: str | None) -> bool:
        """Vincula ou desvincula (caso_id=None) uma publicação de um caso. Retorna True se achou."""
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute(
                "UPDATE publicacoes_capturadas SET caso_id = ? WHERE hash = ?",
                (caso_id, hash_publicacao),
            )
            return cursor.rowcount > 0


def _linha_publicacao(linha) -> dict:
    hash_, monitoramento_id, nome_pesquisado, numero_processo, dados, status, caso_id, criado_em = linha
    return {
        "hash": hash_, "monitoramento_id": monitoramento_id, "nome_pesquisado": nome_pesquisado,
        "numero_processo": numero_processo, "dados": json.loads(dados), "status": status,
        "caso_id": caso_id, "criado_em": criado_em,
    }


class CacheDataJud:
    """Cache SQLite para resultados do DataJud. Cada entrada expira após `ttl_s` segundos.

    `obter` devolve o dict gravado ou None (ausente/expirado).
    `gravar` persiste o resultado; `limpar_expirados` é chamado de tempos em tempos para
    evitar acúmulo de entradas velhas.
    """

    def __init__(self, caminho: str | Path, ttl_s: float = 3600.0) -> None:
        self.caminho = Path(caminho)
        self.ttl_s = ttl_s
        self._trava = threading.Lock()

    def obter(self, chave: str) -> dict | None:
        import time as _time
        with self._trava, _abrir(self.caminho) as conexao:
            linha = conexao.execute(
                "SELECT resultado, criado_em FROM cache_datajud WHERE chave = ?", (chave,)
            ).fetchone()
        if linha is None:
            return None
        resultado_json, criado_em = linha
        if _time.time() - criado_em > self.ttl_s:
            return None  # expirado; não remove aqui para evitar write sob lock de leitura
        return json.loads(resultado_json)

    def gravar(self, chave: str, resultado: dict) -> None:
        import time as _time
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            conexao.execute(
                "INSERT OR REPLACE INTO cache_datajud (chave, resultado, criado_em) VALUES (?, ?, ?)",
                (chave, json.dumps(resultado), _time.time()),
            )

    def limpar_expirados(self) -> int:
        import time as _time
        corte = _time.time() - self.ttl_s
        with self._trava, _abrir(self.caminho) as conexao, conexao:
            cursor = conexao.execute("DELETE FROM cache_datajud WHERE criado_em < ?", (corte,))
            return cursor.rowcount

    def stats(self) -> dict:
        """Retorna {"total": N, "validos": M} sem remover entradas expiradas."""
        import time as _time
        corte = _time.time() - self.ttl_s
        with self._trava, _abrir(self.caminho) as conexao:
            (total,) = conexao.execute("SELECT COUNT(*) FROM cache_datajud").fetchone()
            (validos,) = conexao.execute(
                "SELECT COUNT(*) FROM cache_datajud WHERE criado_em >= ?", (corte,)
            ).fetchone()
        return {"total": total, "validos": validos}
