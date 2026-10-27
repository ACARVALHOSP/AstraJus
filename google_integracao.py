"""Integração Google (Calendar + Drive), conta institucional única do escritório.

Fase 4 da gestão de escritório: um só OAuth (não por usuário, ver Q13), guardado como
refresh_token no banco (db.RegistroIntegracaoGoogle). Este módulo só fala com as APIs do
Google - não sabe nada de caso/cliente nem de como o token é guardado; quem chama (server.py)
passa o httpx.AsyncClient (para poder injetar _TRANSPORTE_HTTP nos testes) e o refresh_token.

Escopos pedidos: calendar (criar/ler eventos) e drive.file (só os arquivos/pastas que o
próprio app cria - não todo o Drive da conta, por privacidade).
"""

from typing import Any
from urllib.parse import urlencode, quote
from datetime import date, timedelta

import httpx

ESCOPOS = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.file",
]

_URL_AUTORIZACAO = "https://accounts.google.com/o/oauth2/v2/auth"
_URL_TOKEN = "https://oauth2.googleapis.com/token"
_URL_DRIVE_ARQUIVOS = "https://www.googleapis.com/drive/v3/files"
_URL_CALENDAR_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


class ErroGoogle(Exception):
    """Erro ao falar com a API do Google (credenciais, rede, ou resposta inesperada)."""


class ErroAgendaGoogle(ErroGoogle):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"Falha no Google Calendar (HTTP {status}).")


async def calendario_principal(cliente, token: str) -> str:
    resposta = await cliente.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary", headers={"Authorization": f"Bearer {token}"},
    )
    dados = _resposta_agenda(resposta)
    if not isinstance(dados.get("id"), str) or not dados["id"]:
        raise ErroGoogle("O Google não identificou o calendário.")
    return dados["id"]


def _url_eventos_vinculados(calendario: str, evento_id: str = "") -> str:
    base = f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendario, safe='')}/events"
    return base + ("/" + quote(evento_id, safe="") if evento_id else "")


def _resposta_agenda(resposta) -> dict:
    if resposta.status_code >= 400:
        raise ErroAgendaGoogle(resposta.status_code)
    if resposta.status_code == 204:
        return {}
    try:
        dados = resposta.json()
    except ValueError as erro:
        raise ErroGoogle("Resposta inválida do Google Calendar.") from erro
    if not isinstance(dados, dict):
        raise ErroGoogle("Resposta inválida do Google Calendar.")
    return dados


async def obter_evento_vinculado(cliente, token, calendario, evento_id):
    return _resposta_agenda(await cliente.get(
        _url_eventos_vinculados(calendario, evento_id), headers={"Authorization": f"Bearer {token}"},
    ))


def _corpo_evento_vinculado(vinculo):
    return {
        "summary": vinculo["titulo"], "start": {"date": vinculo["data"]},
        "end": {"date": (date.fromisoformat(vinculo["data"]) + timedelta(days=1)).isoformat()},
        "extendedProperties": {"private": {"cnj_caso_id": vinculo["caso_id"],
            "cnj_atividade_id": str(vinculo["atividade_id"]), "cnj_vinculo_id": vinculo["id"]}},
    }


async def criar_evento_vinculado(cliente, token, vinculo):
    corpo = {"id": vinculo["evento_id"], **_corpo_evento_vinculado(vinculo)}
    return _resposta_agenda(await cliente.post(
        _url_eventos_vinculados(vinculo["calendario_id"]), headers={"Authorization": f"Bearer {token}"}, json=corpo,
    ))


async def atualizar_evento_vinculado(cliente, token, vinculo, etag):
    return _resposta_agenda(await cliente.patch(
        _url_eventos_vinculados(vinculo["calendario_id"], vinculo["evento_id"]),
        headers={"Authorization": f"Bearer {token}", "If-Match": etag}, json=_corpo_evento_vinculado(vinculo),
    ))


async def cancelar_evento_vinculado(cliente, token, vinculo, etag):
    return _resposta_agenda(await cliente.delete(
        _url_eventos_vinculados(vinculo["calendario_id"], vinculo["evento_id"]),
        headers={"Authorization": f"Bearer {token}", "If-Match": etag},
    ))


def url_autorizacao(client_id: str, redirect_uri: str, state: str) -> str:
    """Monta o link de consentimento do Google. access_type=offline + prompt=consent garantem
    um refresh_token mesmo que essa conta já tenha autorizado o app antes (senão o Google só
    manda o refresh_token na primeira vez)."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(ESCOPOS),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{_URL_AUTORIZACAO}?{urlencode(params)}"


async def trocar_codigo_por_token(
    cliente: httpx.AsyncClient, client_id: str, client_secret: str, redirect_uri: str, code: str,
) -> dict:
    """Troca o code (vindo do callback) por um refresh_token. Levanta ErroGoogle se o Google
    recusar (code expirado/inválido, credenciais erradas)."""
    resposta = await cliente.post(_URL_TOKEN, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "code": code,
        "grant_type": "authorization_code",
    })
    dados = _json_ou_erro(resposta, "trocar código por token")
    if "refresh_token" not in dados:
        raise ErroGoogle(
            "O Google não devolveu um refresh_token. Normalmente acontece quando essa conta já "
            "autorizou o app antes: revogue o acesso em myaccount.google.com/permissions e tente de novo."
        )
    return dados


async def obter_access_token(cliente: httpx.AsyncClient, client_id: str, client_secret: str, refresh_token: str) -> str:
    """Troca o refresh_token por um access_token novo. Chamado a cada operação (sem cache): o
    volume de uso de um escritório pequeno não justifica a complexidade de guardar e expirar
    um access_token em memória."""
    resposta = await cliente.post(_URL_TOKEN, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    })
    dados = _json_ou_erro(resposta, "renovar access_token")
    access_token = dados.get("access_token")
    if not access_token:
        raise ErroGoogle("O Google não devolveu um access_token válido.")
    return access_token


async def criar_pasta_drive(
    cliente: httpx.AsyncClient, access_token: str, nome: str, pasta_pai_id: str | None = None,
) -> dict:
    """Cria uma pasta no Drive da conta institucional. Devolve {id, webViewLink}."""
    corpo: dict[str, Any] = {"name": nome, "mimeType": "application/vnd.google-apps.folder"}
    if pasta_pai_id:
        corpo["parents"] = [pasta_pai_id]
    resposta = await cliente.post(
        f"{_URL_DRIVE_ARQUIVOS}?fields=id,webViewLink",
        headers={"Authorization": f"Bearer {access_token}"},
        json=corpo,
    )
    return _json_ou_erro(resposta, "criar pasta no Drive")


async def criar_evento_calendar(
    cliente: httpx.AsyncClient, access_token: str, titulo: str, data_iso: str, descricao: str, caso_id: str,
) -> dict:
    """Cria um evento de dia inteiro no Google Calendar da conta institucional, na data do prazo
    calculado. `caso_id` vai em extendedProperties.private: é o que permite a sincronização
    periódica (Calendar -> sistema) reconhecer "este evento é deste caso" sem depender do título
    ou da descrição, que a pessoa pode editar livremente na própria agenda. Devolve {id, htmlLink}.
    """
    resposta = await cliente.post(
        f"{_URL_CALENDAR_EVENTOS}?fields=id,htmlLink",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "summary": titulo,
            "description": descricao,
            "start": {"date": data_iso},
            "end": {"date": data_iso},
            "extendedProperties": {"private": {"cnj_caso_id": caso_id}},
        },
    )
    return _json_ou_erro(resposta, "criar evento no Calendar")


async def listar_eventos_de_casos(
    cliente: httpx.AsyncClient, access_token: str, sync_token: str | None = None,
) -> tuple[list[dict], str | None]:
    """Lista eventos alterados desde `sync_token` (sincronização incremental da API do Google);
    sem `sync_token`, faz a primeira sincronização (só eventos futuros, pra não trazer o
    histórico inteiro da agenda). Devolve (eventos, novo_sync_token). Só é chamado por quem já
    filtra por extendedProperties (ver _sincronizar_calendar_google em server.py): mesmo que a
    API devolva eventos sem relação com nenhum caso, o filtro de 'cnj_caso_id' descarta o resto.
    `novo_sync_token` vem None se o Google pedir uma ressincronização completa (código 410 -
    sync_token expirado ou inválido): quem chama deve então refazer sem sync_token.
    """
    params = {"sharedExtendedProperty": "cnj_caso_id=*", "fields": "nextPageToken,nextSyncToken,items"}
    if sync_token:
        params["syncToken"] = sync_token
    else:
        from datetime import datetime, timezone
        params["timeMin"] = datetime.now(timezone.utc).isoformat()
        params["singleEvents"] = "true"

    eventos: list[dict] = []
    novo_sync_token: str | None = None
    url = _URL_CALENDAR_EVENTOS
    while True:
        resposta = await cliente.get(url, headers={"Authorization": f"Bearer {access_token}"}, params=params)
        if resposta.status_code == 410:
            return [], None  # sync_token expirado: quem chama deve refazer do zero
        dados = _json_ou_erro(resposta, "listar eventos do Calendar")
        eventos.extend(dados.get("items") or [])
        novo_sync_token = dados.get("nextSyncToken") or novo_sync_token
        proxima_pagina = dados.get("nextPageToken")
        if not proxima_pagina:
            break
        params = {"pageToken": proxima_pagina, "fields": "nextPageToken,nextSyncToken,items"}
    return eventos, novo_sync_token


def _json_ou_erro(resposta: httpx.Response, acao: str) -> dict:
    if resposta.status_code >= 400:
        raise ErroGoogle(f"Falha ao {acao} (HTTP {resposta.status_code}): {resposta.text[:300]}")
    try:
        return resposta.json()
    except ValueError:
        raise ErroGoogle(f"Resposta inesperada (não é JSON) ao {acao}.")
