"""Coleta e entregas duráveis. Datas legadas sem fuso são interpretadas como UTC.

SMTP não suporta confirmação exatamente uma vez: queda após envio e antes do commit
pode repetir o e-mail. Os destinos locais são idempotentes e têm confirmação separada.
"""
import asyncio
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import automacoes


def utc(valor=None):
    valor = valor or datetime.now(timezone.utc)
    if isinstance(valor, str):
        valor = datetime.fromisoformat(valor)
    return valor.replace(tzinfo=timezone.utc) if valor.tzinfo is None else valor.astimezone(timezone.utc)


class Repositorio:
    def __init__(self, caminho):
        self.caminho = caminho
        with self.abrir() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS monitoramento_entregas (
                    monitoramento_id TEXT NOT NULL, hash TEXT NOT NULL,
                    dados TEXT NOT NULL, criado_em TEXT NOT NULL,
                    email INTEGER NOT NULL DEFAULT 0, local INTEGER NOT NULL DEFAULT 0,
                    resumo INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY(monitoramento_id, hash));
                CREATE INDEX IF NOT EXISTS monitoramento_entregas_pendentes
                    ON monitoramento_entregas(monitoramento_id, email, local);
                CREATE TABLE IF NOT EXISTS monitoramento_coletas (
                    chave TEXT PRIMARY KEY, dados TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS automacao_execucoes (
                    id TEXT PRIMARY KEY, rotina TEXT NOT NULL, inicio TEXT NOT NULL,
                    fim TEXT, estado TEXT NOT NULL, erro TEXT);
                CREATE INDEX IF NOT EXISTS automacao_execucoes_rotina
                    ON automacao_execucoes(rotina, inicio);
                CREATE TABLE IF NOT EXISTS automacao_leases (
                    rotina TEXT PRIMARY KEY, dono TEXT NOT NULL, expira REAL NOT NULL);
            ''')
            # Tabela criada antes do resumo diário: 1 = nada aguardando o resumo (o que já existe segue como estava).
            if 'resumo' not in {linha[1] for linha in c.execute('PRAGMA table_info(monitoramento_entregas)')}:
                c.execute('ALTER TABLE monitoramento_entregas ADD COLUMN resumo INTEGER NOT NULL DEFAULT 1')

    @contextmanager
    def abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    def estado(self, chave):
        with self.abrir() as c:
            row = c.execute('SELECT dados FROM monitoramento_coletas WHERE chave=?', (chave,)).fetchone()
        return json.loads(row[0]) if row else {}

    def marcar(self, chave, **campos):
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT dados FROM monitoramento_coletas WHERE chave=?', (chave,)).fetchone()
            dados = json.loads(row[0]) if row else {}
            dados.update(campos)
            c.execute('INSERT OR REPLACE INTO monitoramento_coletas VALUES (?,?)',
                      (chave, json.dumps(dados, ensure_ascii=False)))

    def ingerir(self, mid, itens, agora, hashes_legados=(), aguarda_resumo=False):
        """Guarda os itens novos na fila de entregas. `aguarda_resumo`: a pessoa recebe o resumo diário, então o
        item fica pendente nesse canal (resumo=0) até o resumo sair."""
        novos = 0
        with self.abrir() as c:
            for item in itens:
                if not item.get('hash'):
                    continue
                cursor = c.execute('INSERT OR IGNORE INTO monitoramento_entregas '
                    '(monitoramento_id,hash,dados,criado_em,email,resumo) VALUES (?,?,?,?,?,?)',
                    (mid, item['hash'], json.dumps(item, ensure_ascii=False), utc(agora).isoformat(),
                     int(item['hash'] in hashes_legados), 0 if aguarda_resumo else 1))
                novos += cursor.rowcount
        return novos

    def pendentes(self, mid, canal):
        return [i['dados'] for i in self.pendentes_detalhe(mid, canal)]

    def pendentes_detalhe(self, mid, canal):
        """Itens ainda não entregues num canal ('email', 'local' ou 'resumo'), com a data em que chegaram e o
        estado dos outros dois canais."""
        if canal not in ('email', 'local', 'resumo'):
            raise ValueError('Canal inválido')
        with self.abrir() as c:
            rows = c.execute(f'SELECT hash, dados, criado_em, email, local, resumo FROM monitoramento_entregas '
                             f'WHERE monitoramento_id=? AND {canal}=0 ORDER BY criado_em,hash', (mid,)).fetchall()
        return [{'hash': h, 'dados': json.loads(d), 'criado_em': criado, 'email': e, 'local': l, 'resumo': r}
                for h, d, criado, e, l, r in rows]

    def confirmar(self, mid, canal, hashes):
        if canal not in ('email', 'local', 'resumo'):
            raise ValueError('Canal inválido')
        with self.abrir() as c:
            c.executemany(f'UPDATE monitoramento_entregas SET {canal}=1 WHERE monitoramento_id=? AND hash=?',
                          [(mid, h) for h in hashes])
            # O conteúdo só é apagado quando os três canais terminaram.
            c.execute("UPDATE monitoramento_entregas SET dados='{}' WHERE monitoramento_id=? AND email=1 AND local=1 AND resumo=1", (mid,))

    def remover(self, mid):
        with self.abrir() as c:
            c.execute('DELETE FROM monitoramento_entregas WHERE monitoramento_id=?', (mid,))
            c.execute('DELETE FROM monitoramento_coletas WHERE chave IN (?,?)', (mid + ':djen', mid + ':oab'))

    def historico(self, rotina, limite=10):
        with self.abrir() as c:
            rows = c.execute('SELECT inicio,fim,estado,erro FROM automacao_execucoes '
                             'WHERE rotina=? ORDER BY inicio DESC LIMIT ?', (rotina, limite)).fetchall()
        return [dict(zip(('inicio', 'fim', 'estado', 'erro'), r)) for r in rows]

    async def executar(self, rotina, horas, funcao, args, kwargs=None):
        """Lease renovável entre processos + execução imediata apenas se estiver atrasada.
        Rotina desligada em Administração › Automações não executa (e não conta como falha)."""
        if not automacoes.Repositorio(self.caminho).ativa(rotina):
            return
        dono, agora = uuid.uuid4().hex, utc()
        with self.abrir() as c:
            c.execute('BEGIN IMMEDIATE')
            ultimo = c.execute("SELECT inicio FROM automacao_execucoes WHERE rotina=? AND estado='concluida' "
                               'ORDER BY fim DESC LIMIT 1', (rotina,)).fetchone()
            if ultimo and utc(ultimo[0]) + timedelta(hours=horas) > agora:
                return
            lease = c.execute('SELECT expira FROM automacao_leases WHERE rotina=?', (rotina,)).fetchone()
            if lease and lease[0] > agora.timestamp():
                return
            c.execute('INSERT OR REPLACE INTO automacao_leases VALUES (?,?,?)',
                      (rotina, dono, agora.timestamp() + 300))
            c.execute("UPDATE automacao_execucoes SET estado='interrompida',fim=? "
                      "WHERE rotina=? AND estado='executando'", (agora.isoformat(), rotina))
            c.execute('INSERT INTO automacao_execucoes VALUES (?,?,?,?,?,?)',
                      (dono, rotina, agora.isoformat(), None, 'executando', None))

        async def renovar():
            while True:
                await asyncio.sleep(30)
                with self.abrir() as c:
                    c.execute('UPDATE automacao_leases SET expira=? WHERE rotina=? AND dono=?',
                              (utc().timestamp() + 300, rotina, dono))

        tarefa = asyncio.create_task(renovar())
        estado, erro = 'concluida', None
        try:
            resultado = await funcao(*args, **(kwargs or {}))
            if resultado is False:
                estado, erro = 'falha', 'Uma ou mais verificações não foram concluídas. Consulte o estado dos monitoramentos.'
        except BaseException:
            estado, erro = 'falha', 'Execução interrompida ou indisponível. Consulte os logs do servidor.'
            raise
        finally:
            tarefa.cancel()
            try:
                await tarefa
            except asyncio.CancelledError:
                pass
            with self.abrir() as c:
                c.execute('UPDATE automacao_execucoes SET fim=?,estado=?,erro=? WHERE id=?',
                          (utc().isoformat(), estado, erro, dono))
                c.execute('DELETE FROM automacao_leases WHERE rotina=? AND dono=?', (rotina, dono))
                # Histórico operacional limitado; entregas não são descartadas por idade.
                c.execute('DELETE FROM automacao_execucoes WHERE inicio<? AND estado!=?',
                          ((utc() - timedelta(days=180)).isoformat(), 'executando'))
