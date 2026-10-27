"""Outbox e feed individual. Eventos guardam referências, nunca inteiro teor ou tokens."""
import base64
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone


RETENCAO_DIAS = 180


def instante(valor=None):
    valor = valor or datetime.now(timezone.utc)
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=timezone.utc)
    return valor.astimezone(timezone.utc).isoformat(timespec="microseconds")


def registrar_evento(conexao, usuario, tipo, chave, *, caso_id=None, atividade_id=None, publicacao_hash=None, agora=None):
    if not usuario:
        return
    conexao.execute(
        "INSERT OR IGNORE INTO notificacao_eventos (usuario, tipo, chave, caso_id, atividade_id, publicacao_hash, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (usuario, tipo, chave, caso_id, atividade_id, publicacao_hash, instante(agora)),
    )


# A aplicação compartilha processos/publicações entre usuários autenticados. Não
# reinterpretar campos acesso/responsavel como ACL. Existência/vínculo atual e
# destinatário são verificados aqui tanto para itens quanto contagem e leitura.
_FONTES = """
 FROM notificacao_eventos e
 JOIN usuarios u ON u.nome=e.usuario
 LEFT JOIN casos c ON c.id=e.caso_id
 LEFT JOIN caso_atividades a ON a.id=e.atividade_id AND a.caso_id=e.caso_id
 LEFT JOIN publicacoes_capturadas p ON p.hash=e.publicacao_hash
"""
_VISIVEL = """
 (json_extract(u.dados, '$.revogado') IS NULL OR json_extract(u.dados, '$.revogado')=0)
 AND (
   (e.tipo='atividade_delegada' AND a.id IS NOT NULL AND c.id IS NOT NULL)
   OR (e.tipo='publicacao_monitorada' AND p.hash IS NOT NULL AND (
       (e.caso_id IS NULL AND p.caso_id IS NULL)
       OR (c.id IS NOT NULL AND p.caso_id=e.caso_id)
   ))
 )
"""


class Repositorio:
    def __init__(self, caminho, agora=None):
        self.caminho = caminho
        self.agora = agora or (lambda: datetime.now(timezone.utc))

    @contextmanager
    def transacao(self):
        from db import _abrir
        with _abrir(self.caminho) as c, c:
            c.row_factory = sqlite3.Row
            c.execute("BEGIN IMMEDIATE")
            yield c

    def registrar_monitoramento(self, usuario, itens):
        """Captura já consultada: não publicar conteúdo novo para toda a coleção.

        Sem publicação existente, a ocorrência fica pendente até existir destino
        autorizado pelos fluxos de captura atuais. Falha SMTP não remove o evento.
        """
        with self.transacao() as c:
            for item in itens:
                h = item.get("hash")
                if not isinstance(h, str) or not h:
                    continue
                linha = c.execute("SELECT caso_id FROM publicacoes_capturadas WHERE hash=?", (h,)).fetchone()
                registrar_evento(c, usuario, "publicacao_monitorada", h, publicacao_hash=h,
                                 caso_id=linha[0] if linha else None, agora=self.agora())

    def _processar(self, c, usuario, corte, agora):
        c.execute("UPDATE notificacao_eventos SET pendencia='destino_indisponivel' WHERE usuario=? AND criado_em>=? AND processado_em IS NULL AND pendencia IS NULL", (usuario, corte))
        ids = [linha[0] for linha in c.execute("SELECT e.id" + _FONTES + " WHERE e.usuario=? AND e.criado_em>=? AND e.processado_em IS NULL AND " + _VISIVEL, (usuario, corte))]
        c.executemany("INSERT OR IGNORE INTO notificacoes (evento_id) VALUES (?)", [(i,) for i in ids])
        c.executemany("UPDATE notificacao_eventos SET processado_em=COALESCE(processado_em, ?), pendencia=NULL WHERE id=?", [(agora, i) for i in ids])

    @staticmethod
    def _cursor(usuario, estado, teto, antes):
        dados = [hashlib.sha256(usuario.encode()).hexdigest(), estado, teto, *antes]
        return base64.urlsafe_b64encode(json.dumps(dados, separators=(",", ":")).encode()).decode().rstrip("=")

    @staticmethod
    def _ler_cursor(cursor, usuario, estado):
        try:
            if len(cursor) > 2048 or not re.fullmatch(r"[A-Za-z0-9_-]+", cursor):
                raise ValueError
            dados = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if not isinstance(dados, list) or len(dados) != 5:
                raise ValueError
            dono, filtro, teto, data, identificador = dados
            if dono != hashlib.sha256(usuario.encode()).hexdigest() or filtro != estado:
                raise ValueError
            if type(teto) is not int or type(identificador) is not int or not 0 < identificador <= teto <= 9223372036854775807:
                raise ValueError
            if not isinstance(data, str) or instante(datetime.fromisoformat(data)) != data:
                raise ValueError
            return teto, data, identificador
        except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
            raise ValueError("Cursor de notificações inválido. Atualize a lista.") from None

    def listar(self, usuario, limite=20, estado="todas", cursor=None):
        if type(limite) is not int or not 1 <= limite <= 100 or estado not in ("todas", "nao_lidas"):
            raise ValueError("Informe limite entre 1 e 100 e estado todas ou nao_lidas.")
        agora_dt = datetime.fromisoformat(instante(self.agora()))
        corte = instante(agora_dt - timedelta(days=RETENCAO_DIAS))
        with self.transacao() as c:
            self._processar(c, usuario, corte, instante(agora_dt))
            if cursor:
                teto, data, anterior = self._ler_cursor(cursor, usuario, estado)
            else:
                teto = c.execute("SELECT COALESCE(MAX(id),0) FROM notificacao_eventos WHERE usuario=?", (usuario,)).fetchone()[0]
                data, anterior = None, None
            base = _FONTES + " JOIN notificacoes n ON n.evento_id=e.id WHERE e.usuario=? AND e.criado_em>=? AND " + _VISIVEL
            argumentos = [usuario, corte]
            nao_lidas = c.execute("SELECT COUNT(*)" + base + " AND n.lida_em IS NULL", argumentos).fetchone()[0]
            query = base + " AND e.id<=?"
            argumentos.append(teto)
            if data is not None:
                query += " AND (e.criado_em<? OR (e.criado_em=? AND e.id<?))"
                argumentos.extend([data, data, anterior])
            if estado == "nao_lidas":
                query += " AND n.lida_em IS NULL"
            linhas = c.execute(
                "SELECT e.id, e.tipo, e.caso_id, e.atividade_id, e.criado_em, n.lida_em, a.titulo, a.responsavel" + query
                + " ORDER BY e.criado_em DESC, e.id DESC LIMIT ?", [*argumentos, limite + 1],
            ).fetchall()
            mais = len(linhas) > limite
            linhas = linhas[:limite]
            itens = []
            for linha in linhas:
                delegacao = linha["tipo"] == "atividade_delegada"
                destino = {"tipo": "atividade", "caso_id": linha["caso_id"], "atividade_id": linha["atividade_id"]} if delegacao else (
                    {"tipo": "publicacoes_processo", "caso_id": linha["caso_id"]} if linha["caso_id"] else {"tipo": "publicacoes_monitoradas"})
                mensagem = linha["titulo"] if delegacao else "Confira a publicação na área autorizada."
                if delegacao and linha["responsavel"] != usuario:
                    mensagem = f"{mensagem} — a atribuição mudou desde este aviso."
                itens.append({"id": str(linha["id"]), "tipo": linha["tipo"], "titulo": "Atividade atribuída" if delegacao else "Nova publicação monitorada",
                              "mensagem": mensagem, "criado_em": linha["criado_em"], "lida_em": linha["lida_em"], "destino": destino})
            proximo = self._cursor(usuario, estado, teto, (linhas[-1]["criado_em"], linhas[-1]["id"])) if mais else None
            return {"notificacoes": itens, "proximo_cursor": proximo, "nao_lidas": nao_lidas, "retencao_dias": RETENCAO_DIAS}

    def marcar_lida(self, usuario, identificador):
        if not isinstance(identificador, str) or not identificador.isdigit():
            return None
        agora_dt = datetime.fromisoformat(instante(self.agora()))
        corte = instante(agora_dt - timedelta(days=RETENCAO_DIAS))
        with self.transacao() as c:
            self._processar(c, usuario, corte, instante(agora_dt))
            linha = c.execute("SELECT e.id" + _FONTES + " JOIN notificacoes n ON n.evento_id=e.id WHERE e.usuario=? AND e.id=? AND e.criado_em>=? AND " + _VISIVEL,
                              (usuario, identificador, corte)).fetchone()
            if not linha:
                return None
            c.execute("UPDATE notificacoes SET lida_em=COALESCE(lida_em, ?) WHERE evento_id=?", (instante(agora_dt), linha[0]))
            return {"id": str(linha[0]), "lida_em": c.execute("SELECT lida_em FROM notificacoes WHERE evento_id=?", (linha[0],)).fetchone()[0]}

    def destino(self, usuario, identificador):
        # O mesmo predicado usado no feed, reavaliado no momento de abrir o destino.
        if not isinstance(identificador, str) or not identificador.isdigit():
            return None
        corte = instante(datetime.fromisoformat(instante(self.agora())) - timedelta(days=RETENCAO_DIAS))
        with self.transacao() as c:
            linha = c.execute("SELECT e.tipo, e.caso_id, e.atividade_id" + _FONTES
                              + " JOIN notificacoes n ON n.evento_id=e.id WHERE e.usuario=? AND e.id=? AND e.criado_em>=? AND " + _VISIVEL,
                              (usuario, identificador, corte)).fetchone()
            if not linha:
                return None
            if linha["tipo"] == "atividade_delegada":
                return {"tipo": "atividade", "caso_id": linha["caso_id"], "atividade_id": linha["atividade_id"]}
            return {"tipo": "publicacoes_processo", "caso_id": linha["caso_id"]} if linha["caso_id"] else {"tipo": "publicacoes_monitoradas"}
