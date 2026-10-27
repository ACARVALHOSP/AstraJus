"""Vínculo opcional Calendar/atividade: operações persistidas e reconciliação por ID.

Nenhuma transação SQLite permanece aberta durante acesso ao Google. O lease evita
processadores concorrentes; IDs estáveis e ETags protegem retomadas após interrupção.
"""
import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta, datetime, timezone

import httpx
import db
import google_integracao as google


class ErroAgenda(Exception):
    def __init__(self, mensagem, status=409):
        super().__init__(mensagem)
        self.status = status


def agora_iso():
    return datetime.now(timezone.utc).isoformat()


def assinatura_pedido(caso_id, aid, corpo):
    return hashlib.sha256(json.dumps([caso_id, aid, corpo], sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def dados_remotos(evento):
    inicio = (evento.get("start") or {}).get("date")
    fim = (evento.get("end") or {}).get("date")
    db.validar_data_atividade_agenda(inicio)
    if evento.get("recurrence") or evento.get("recurringEventId") or fim != (date.fromisoformat(inicio) + timedelta(days=1)).isoformat():
        raise db.ConflitoAgenda("O evento precisa ser de um único dia inteiro, sem recorrência.")
    titulo = evento.get("summary")
    if not isinstance(titulo, str) or not titulo.strip():
        raise db.ConflitoAgenda("O evento da agenda precisa de um título.")
    return titulo, inicio


def resumo(v):
    if not v:
        return None
    remoto = json.loads(v["remoto"] or "{}")
    link = remoto.get("htmlLink", "")
    # Não encaminhar URL arbitrária devolvida por integração para a interface.
    if not isinstance(link, str) or not link.startswith("https://www.google.com/calendar/"):
        link = None
    return {"id": v["id"], "estado": v["estado"], "versao": v["versao"], "erro": v["erro"],
            "data": v["data"], "titulo": v["titulo"], "link": link,
            "data_remota": (remoto.get("start") or {}).get("date"), "titulo_remoto": remoto.get("summary")}


class Repositorio:
    def __init__(self, caminho):
        self.caminho = caminho

    @contextmanager
    def transacao(self):
        with db._abrir(self.caminho) as c, c:
            c.row_factory = sqlite3.Row
            c.execute("BEGIN IMMEDIATE")
            yield c

    @staticmethod
    def _chave(c, usuario, chave, pedido):
        linha = c.execute("SELECT * FROM atividade_agenda_chaves WHERE usuario=? AND chave=?", (usuario, chave)).fetchone()
        if not linha:
            return None
        if linha["pedido"] != pedido:
            raise ErroAgenda("A chave desta operação já foi usada em outro pedido.")
        return dict(c.execute("SELECT * FROM atividade_agenda WHERE id=?", (linha["vinculo_id"],)).fetchone())

    def por_chave(self, usuario, chave, pedido):
        with self.transacao() as c:
            return self._chave(c, usuario, chave, pedido)

    def obter(self, caso_id, aid, vinculo_id=None):
        with self.transacao() as c:
            sql = "SELECT * FROM atividade_agenda WHERE caso_id=? AND atividade_id=?"
            args = [caso_id, aid]
            if vinculo_id is not None:
                sql += " AND id=?"
                args.append(vinculo_id)
            linha = c.execute(sql + " ORDER BY rowid DESC LIMIT 1", args).fetchone()
            return dict(linha) if linha else None

    def listar(self, caso_id=None):
        with self.transacao() as c:
            if caso_id is None:
                linhas = c.execute("SELECT * FROM atividade_agenda WHERE estado <> 'cancelado'").fetchall()
            else:
                linhas = c.execute("SELECT * FROM atividade_agenda WHERE caso_id=? ORDER BY rowid", (caso_id,)).fetchall()
            return [dict(linha) for linha in linhas]

    def reservar(self, caso_id, aid, calendario, usuario, chave, pedido):
        with self.transacao() as c:
            anterior = self._chave(c, usuario, chave, pedido)
            if anterior:
                return anterior
            a = c.execute("SELECT * FROM caso_atividades WHERE caso_id=? AND id=?", (caso_id, aid)).fetchone()
            if not a:
                raise ErroAgenda("Atividade não encontrada.", 404)
            db.validar_data_atividade_agenda(a["data"], a["hora"])
            if not a["titulo"] or not a["titulo"].strip():
                raise db.ConflitoAgenda("Informe um título para a atividade.")
            linha = c.execute("SELECT * FROM atividade_agenda WHERE caso_id=? AND atividade_id=? AND estado <> 'cancelado'", (caso_id, aid)).fetchone()
            if linha:
                if linha["calendario_id"] != calendario:
                    raise ErroAgenda("Este vínculo pertence a outro calendário. Reconecte a conta original.")
                identificador = linha["id"]
            else:
                identificador = uuid.uuid4().hex
                c.execute(
                    "INSERT INTO atividade_agenda (id, caso_id, atividade_id, calendario_id, evento_id, estado, operacao, titulo, data, criado_em) "
                    "VALUES (?, ?, ?, ?, ?, 'pendente', 'criar', ?, ?, ?)",
                    (identificador, caso_id, aid, calendario, uuid.uuid4().hex, a["titulo"], a["data"], agora_iso()),
                )
            c.execute("INSERT INTO atividade_agenda_chaves VALUES (?, ?, ?, ?)", (usuario, chave, pedido, identificador))
            return dict(c.execute("SELECT * FROM atividade_agenda WHERE id=?", (identificador,)).fetchone())

    def adquirir(self, identificador):
        with self.transacao() as c:
            linha = c.execute("SELECT * FROM atividade_agenda WHERE id=?", (identificador,)).fetchone()
            if not linha or linha["estado"] == "cancelado" or (linha["execucao_ate"] or 0) > time.time():
                return None
            token = uuid.uuid4().hex
            c.execute("UPDATE atividade_agenda SET execucao=?, execucao_ate=? WHERE id=?", (token, time.time() + 120, identificador))
            return {**dict(linha), "execucao": token}

    def concluir(self, snapshot, estado, remoto=None, aplicado=False, erro=None):
        with self.transacao() as c:
            atual = c.execute("SELECT * FROM atividade_agenda WHERE id=? AND execucao=?", (snapshot["id"], snapshot["execucao"])).fetchone()
            if not atual:
                return
            remoto_json = json.dumps(remoto, sort_keys=True) if remoto is not None else atual["remoto"]
            aplicado_json = remoto_json if aplicado else atual["aplicado"]
            if atual["versao"] != snapshot["versao"] and estado != "cancelado":
                # Uma edição/cancelamento ocorreu durante o I/O: guardar resultado remoto,
                # mas manter a operação mais nova para a próxima passagem.
                c.execute("UPDATE atividade_agenda SET remoto=?, aplicado=?, execucao=NULL, execucao_ate=NULL WHERE id=?",
                          (remoto_json, aplicado_json, snapshot["id"]))
                return
            operacao = None if estado in ("sincronizado", "divergente", "cancelado") else atual["operacao"]
            mudou = (atual["estado"], atual["remoto"], atual["erro"], atual["operacao"]) != (estado, remoto_json, erro, operacao)
            c.execute(
                "UPDATE atividade_agenda SET estado=?, operacao=?, remoto=?, aplicado=?, erro=?, forcar_etag=NULL, "
                "versao=versao+?, execucao=NULL, execucao_ate=NULL WHERE id=?",
                (estado, operacao, remoto_json, aplicado_json, erro, int(mudou), snapshot["id"]),
            )
            if mudou and estado in ("sincronizado", "divergente", "cancelado"):
                c.execute("INSERT INTO caso_eventos (caso_id, numero_processo, tipo, conteudo, criado_em) VALUES (?, NULL, ?, ?, ?)",
                          (atual["caso_id"], "agenda_atividade_" + estado,
                           json.dumps({"atividade_id": atual["atividade_id"], "vinculo_id": atual["id"], "data": atual["data"]}), agora_iso()))

    def cancelar(self, caso_id, aid, identificador, versao):
        with self.transacao() as c:
            v = self._para_comando(c, caso_id, aid, identificador)
            if v["estado"] == "cancelado" or v["operacao"] == "cancelar":
                return dict(v)
            if v["versao"] != versao:
                raise ErroAgenda("O vínculo mudou. Atualize a agenda antes de cancelar.")
            c.execute("UPDATE atividade_agenda SET estado='cancelamento_pendente', operacao='cancelar', versao=versao+1, erro=NULL, forcar_etag=NULL WHERE id=?", (identificador,))
            return dict(c.execute("SELECT * FROM atividade_agenda WHERE id=?", (identificador,)).fetchone())

    @staticmethod
    def _para_comando(c, caso_id, aid, identificador):
        v = c.execute("SELECT * FROM atividade_agenda WHERE caso_id=? AND atividade_id=? AND id=?", (caso_id, aid, identificador)).fetchone()
        if not v:
            raise ErroAgenda("Vínculo não encontrado.", 404)
        return v

    def resolver(self, caso_id, aid, identificador, versao, comando, remoto):
        with self.transacao() as c:
            v = self._para_comando(c, caso_id, aid, identificador)
            if v["versao"] != versao or v["estado"] != "divergente" or (v["execucao_ate"] or 0) > time.time():
                raise ErroAgenda("O vínculo mudou ou está em processamento. Atualize antes de decidir.")
            anterior = json.loads(v["remoto"] or "{}")
            if not remoto.get("etag") or anterior.get("etag") != remoto["etag"]:
                raise ErroAgenda("O evento mudou na agenda. Atualize e revise os novos dados.")
            if comando == "aceitar_data_da_agenda":
                titulo, data = dados_remotos(remoto)
                if c.execute("SELECT hora FROM caso_atividades WHERE caso_id=? AND id=?", (caso_id, aid)).fetchone()[0]:
                    raise db.ConflitoAgenda("A atividade precisa estar sem hora para aceitar o evento de dia inteiro.")
                c.execute("UPDATE caso_atividades SET titulo=?, data=? WHERE caso_id=? AND id=?", (titulo, data, caso_id, aid))
                c.execute("UPDATE atividade_agenda SET titulo=?, data=?, remoto=?, aplicado=?, estado='sincronizado', operacao=NULL, versao=versao+1, erro=NULL, execucao=NULL, execucao_ate=NULL WHERE id=?",
                          (titulo, data, json.dumps(remoto, sort_keys=True), json.dumps(remoto, sort_keys=True), identificador))
                c.execute("INSERT INTO caso_eventos (caso_id, numero_processo, tipo, conteudo, criado_em) VALUES (?, NULL, 'agenda_atividade_sincronizado', ?, ?)",
                          (caso_id, json.dumps({"atividade_id": aid, "vinculo_id": identificador, "data": data}), agora_iso()))
            elif comando == "usar_data_da_atividade":
                dados_remotos(remoto)  # não substituir recorrência/horário silenciosamente
                c.execute("UPDATE atividade_agenda SET estado='pendente', operacao='atualizar', forcar_etag=?, versao=versao+1, erro=NULL, execucao=NULL, execucao_ate=NULL WHERE id=?", (remoto["etag"], identificador))
            else:
                raise ErroAgenda("Comando de agenda inválido.", 400)


async def conectar(registro_google, client_id, client_secret, cliente):
    conexao = registro_google.obter_conexao() if registro_google else None
    if not conexao or not client_id or not client_secret:
        raise ErroAgenda("Google desconectado. Conecte a conta institucional em /admin.", 503)
    token = await google.obter_access_token(cliente, client_id, client_secret, conexao["refresh_token"])
    calendario = await google.calendario_principal(cliente, token)
    return token, calendario


def conferir_identidade(v, remoto):
    if remoto.get("id") != v["evento_id"]:
        raise ErroAgenda("O Google retornou outro evento.")
    if remoto.get("status") == "cancelled":
        return
    marcadores = (remoto.get("extendedProperties") or {}).get("private") or {}
    if any(marcadores.get(k) != esperado for k, esperado in (
        ("cnj_caso_id", v["caso_id"]), ("cnj_atividade_id", str(v["atividade_id"])), ("cnj_vinculo_id", v["id"]),
    )):
        raise ErroAgenda("O evento remoto não corresponde a este vínculo. Nenhuma alteração foi enviada.")


async def processar(repo, vinculo_id, registro_google, client_id, client_secret, cliente, conexao=None):
    v = repo.adquirir(vinculo_id)
    if not v:
        return
    remoto = None
    try:
        token, calendario = conexao or await conectar(registro_google, client_id, client_secret, cliente)
        if calendario != v["calendario_id"]:
            raise ErroAgenda("O calendário conectado é diferente. Reconecte a conta original.")
        try:
            remoto = await google.obter_evento_vinculado(cliente, token, calendario, v["evento_id"])
        except google.ErroAgendaGoogle as erro:
            if erro.status == 410 or erro.status == 404 and v["aplicado"]:
                repo.concluir(v, "cancelado", {"id": v["evento_id"], "status": "cancelled"})
                return
            if erro.status != 404 or v["operacao"] != "criar" or v["aplicado"]:
                raise
            try:
                remoto = await google.criar_evento_vinculado(cliente, token, v)
            except google.ErroAgendaGoogle as erro_criacao:
                if erro_criacao.status != 409:
                    raise
                remoto = await google.obter_evento_vinculado(cliente, token, calendario, v["evento_id"])
        conferir_identidade(v, remoto)
        if remoto.get("status") == "cancelled":
            repo.concluir(v, "cancelado", remoto)
            return
        etag = remoto.get("etag")
        if not isinstance(etag, str) or not etag:
            raise ErroAgenda("O Google não retornou a versão do evento. Atualize para tentar novamente.")
        if v["operacao"] == "cancelar":
            try:
                await google.cancelar_evento_vinculado(cliente, token, v, etag)
            except google.ErroAgendaGoogle as erro:
                if erro.status != 410:
                    raise
            repo.concluir(v, "cancelado", {**remoto, "status": "cancelled"})
            return
        try:
            dados = dados_remotos(remoto)
        except db.ConflitoAgenda as erro:
            repo.concluir(v, "divergente", remoto, erro=str(erro))
            return
        desejado = (v["titulo"], v["data"])
        if v["forcar_etag"] and v["forcar_etag"] != etag:
            repo.concluir(v, "divergente", remoto, erro="O evento mudou novamente. Revise os dados da agenda.")
        elif dados == desejado:
            repo.concluir(v, "sincronizado", remoto, aplicado=True)
        elif v["operacao"] == "atualizar" and (v["forcar_etag"] or v["aplicado"] and dados == dados_remotos(json.loads(v["aplicado"]))):
            atualizado = await google.atualizar_evento_vinculado(cliente, token, v, etag)
            conferir_identidade(v, atualizado)
            if dados_remotos(atualizado) != desejado:
                raise ErroAgenda("O Google não confirmou a data e o título solicitados.")
            repo.concluir(v, "sincronizado", atualizado, aplicado=True)
        else:
            repo.concluir(v, "divergente", remoto, erro="A data ou o título mudou na agenda. Escolha quais dados manter.")
    except google.ErroAgendaGoogle as erro:
        if erro.status == 412:
            repo.concluir(v, "divergente", remoto, erro="O evento mudou durante a operação. Atualize e revise a agenda.")
        else:
            repo.concluir(v, "falha", erro=f"Não foi possível confirmar a operação no Google Calendar (HTTP {erro.status}). Use Atualizar agenda para tentar novamente.")
    except (google.ErroGoogle, httpx.HTTPError, ErroAgenda, db.ConflitoAgenda) as erro:
        mensagem = str(erro) if isinstance(erro, (ErroAgenda, db.ConflitoAgenda)) else "Não foi possível confirmar a operação no Google. Use Atualizar agenda para reconciliar."
        repo.concluir(v, "falha", erro=mensagem)


async def sincronizar(registro_google, gestao, client_id, client_secret, cliente):
    repo = Repositorio(gestao.caminho)
    for v in repo.listar():
        await processar(repo, v["id"], registro_google, client_id, client_secret, cliente)
