"""Integração com a API do Asaas (gateway de pagamentos: boleto, Pix, cartão).

Autenticação por API Key fixa (não é OAuth, ver google_integracao.py para o caso OAuth).
Este módulo só fala com a API do Asaas - não sabe nada de caso/cliente nem de onde a API
key é guardada; quem chama (server.py) passa o httpx.AsyncClient (para poder injetar
_TRANSPORTE_HTTP nos testes) e a api_key.
"""

import unicodedata
from datetime import date
from typing import Any

import httpx

URL_BASE_PRODUCAO = "https://api.asaas.com/v3"
URL_BASE_SANDBOX = "https://api-sandbox.asaas.com/v3"


class ErroAsaas(Exception):
    """Erro ao falar com a API do Asaas (credenciais, rede, ou resposta inesperada)."""


async def _pedido(chamada) -> httpx.Response:
    """Espera a chamada HTTP, convertendo falha de rede/timeout em ErroAsaas. Sem isso, uma
    instabilidade de rede (DNS, timeout, conexão recusada) vira exceção não tratada - cada
    função só tratava erro HTTP >=400 via _json_ou_erro, não falha de conexão - e derruba a
    requisição ASGI inteira (o que aparece pro usuário como "HTTP 502", não como um erro
    tratado com mensagem útil)."""
    try:
        return await chamada
    except httpx.HTTPError as erro:
        raise ErroAsaas(f"Falha de rede ao falar com o Asaas: {erro}") from erro


async def criar_cliente(
    cliente: httpx.AsyncClient, url_base: str, api_key: str, nome: str, cpf_cnpj: str,
    email: str | None = None, telefone: str | None = None,
) -> dict:
    """Cadastra um cliente (pagador) no Asaas. Devolve o objeto criado, com `id` (customer_id)
    a guardar junto do caso/cliente para as próximas cobranças."""
    corpo: dict[str, Any] = {"name": nome, "cpfCnpj": cpf_cnpj}
    if email:
        corpo["email"] = email
    if telefone:
        corpo["phone"] = telefone
    resposta = await _pedido(cliente.post(
        f"{url_base}/customers", headers={"access_token": api_key}, json=corpo,
    ))
    return _json_ou_erro(resposta, "criar cliente no Asaas")


async def criar_cobranca(
    cliente: httpx.AsyncClient, url_base: str, api_key: str, customer_id: str,
    vencimento_iso: str, billing_type: str = "BOLETO", descricao: str | None = None, *,
    valor: float | None = None, parcelas: int | None = None, valor_total: float | None = None,
) -> dict:
    """Cria uma cobrança (boleto ou Pix) para um cliente já cadastrado - avulsa (`valor`) ou
    parcelada (`parcelas` + `valor_total`: o Asaas divide o total pelas parcelas, jogando a
    sobra do arredondamento na última - nunca envie `valor` junto). Devolve só a 1ª cobrança
    criada, com `bankSlipUrl`/`invoiceUrl`; quando parcelada, o campo `installment` nela
    identifica o parcelamento todo (as demais cobranças aparecem em listar_cobrancas, para o
    mesmo customer_id)."""
    corpo: dict[str, Any] = {"customer": customer_id, "billingType": billing_type, "dueDate": vencimento_iso}
    if parcelas and parcelas > 1:
        corpo["installmentCount"] = parcelas
        corpo["totalValue"] = valor_total
    else:
        corpo["value"] = valor
    if descricao:
        corpo["description"] = descricao
    resposta = await _pedido(cliente.post(
        f"{url_base}/payments", headers={"access_token": api_key}, json=corpo,
    ))
    return _json_ou_erro(resposta, "criar cobrança no Asaas")


async def listar_cobrancas(
    cliente: httpx.AsyncClient, url_base: str, api_key: str, *,
    customer_id: str | None = None, status: str | None = None,
    limit: int = 50, offset: int = 0,
) -> dict:
    """Lista cobranças (paginado). Devolve a resposta crua do Asaas: `data` (lista de cobranças),
    `totalCount` e `hasMore`, usados pela página de administração de pagamentos."""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if customer_id:
        params["customer"] = customer_id
    if status:
        params["status"] = status
    resposta = await _pedido(cliente.get(
        f"{url_base}/payments", headers={"access_token": api_key}, params=params,
    ))
    return _json_ou_erro(resposta, "listar cobranças no Asaas")


async def listar_todas_cobrancas(
    cliente: httpx.AsyncClient, url_base: str, api_key: str, *,
    customer_id: str | None = None, max_paginas: int = 10,
) -> tuple[list[dict], bool]:
    """Percorre as páginas de /payments (100 por vez, até `max_paginas`) para montar o painel
    de Pagamentos com totais de todas as cobranças. Devolve (cobranças, truncado)."""
    todas: list[dict] = []
    for pagina in range(max_paginas):
        resultado = await listar_cobrancas(
            cliente, url_base, api_key, customer_id=customer_id, limit=100, offset=pagina * 100,
        )
        todas.extend(resultado.get("data") or [])
        if not resultado.get("hasMore"):
            return todas, False
    return todas, True


STATUS_RECEBIDOS = {"RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"}
SITUACOES_PAINEL = {
    "a_receber": {"PENDING"},
    "vencidas": {"OVERDUE"},
    "recebidas": STATUS_RECEBIDOS,
}


def _normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in texto if not unicodedata.combining(c)).lower()


def _data_pagamento(cobranca: dict) -> str:
    return cobranca.get("paymentDate") or cobranca.get("clientPaymentDate") or cobranca.get("confirmedDate") or ""


def montar_painel_pagamentos(
    cobrancas: list[dict], *, hoje: date, situacao: str = "a_receber", forma: str = "",
    vencimento_de: str = "", vencimento_ate: str = "", busca: str = "",
    cpf_por_cliente: dict[str, str] | None = None, offset: int = 0, limite: int = 20,
) -> dict:
    """Monta o painel da tela Pagamentos a partir de todas as cobranças (já com `cliente_id` e
    `cliente_nome` associados): totais (a receber, vencidas, recebidas no mês), contadores por
    situação (respeitando forma/vencimento/busca), a lista filtrada, ordenada e paginada.
    Cada cobrança parcelada ganha `parcelas_total` (quantas cobranças há no parcelamento)."""
    cpf_por_cliente = cpf_por_cliente or {}
    por_parcelamento: dict[str, int] = {}
    for c in cobrancas:
        if c.get("installment"):
            por_parcelamento[c["installment"]] = por_parcelamento.get(c["installment"], 0) + 1
    for c in cobrancas:
        if c.get("installment"):
            c["parcelas_total"] = por_parcelamento[c["installment"]]

    def valor(c: dict) -> float:
        try:
            return float(c.get("value") or 0)
        except (TypeError, ValueError):
            return 0.0

    mes = hoje.strftime("%Y-%m")
    pendentes = [c for c in cobrancas if c.get("status") == "PENDING"]
    vencidas = [c for c in cobrancas if c.get("status") == "OVERDUE"]
    recebidas_mes = [c for c in cobrancas if c.get("status") in STATUS_RECEBIDOS and _data_pagamento(c).startswith(mes)]
    resumo = {
        "a_receber": {
            "total": round(sum(valor(c) for c in pendentes), 2), "quantidade": len(pendentes),
            "proximo_vencimento": min((c.get("dueDate") or "" for c in pendentes), default=None) or None,
        },
        "vencidas": {
            "total": round(sum(valor(c) for c in vencidas), 2), "quantidade": len(vencidas),
            "mais_antigo": min((c.get("dueDate") or "" for c in vencidas), default=None) or None,
        },
        "recebidas_mes": {
            "total": round(sum(valor(c) for c in recebidas_mes), 2), "quantidade": len(recebidas_mes), "mes": mes,
        },
    }

    forma = (forma or "").upper()
    termo = _normalizar(busca.strip())
    termo_digitos = "".join(ch for ch in busca if ch.isdigit())

    def passa_filtros(c: dict) -> bool:
        if forma and c.get("billingType") != forma:
            return False
        venc = c.get("dueDate") or ""
        if vencimento_de and venc < vencimento_de:
            return False
        if vencimento_ate and venc > vencimento_ate:
            return False
        if termo:
            alvo = _normalizar(f"{c.get('cliente_nome') or ''} {c.get('description') or ''}")
            cpf = "".join(ch for ch in cpf_por_cliente.get(c.get("cliente_id") or "", "") if ch.isdigit())
            if termo not in alvo and not (len(termo_digitos) >= 3 and termo_digitos in cpf):
                return False
        return True

    filtradas = [c for c in cobrancas if passa_filtros(c)]
    contagens = {nome: sum(1 for c in filtradas if c.get("status") in st) for nome, st in SITUACOES_PAINEL.items()}
    contagens["todas"] = len(filtradas)

    if situacao in SITUACOES_PAINEL:
        filtradas = [c for c in filtradas if c.get("status") in SITUACOES_PAINEL[situacao]]
    if situacao in ("a_receber", "vencidas"):
        filtradas.sort(key=lambda c: (c.get("dueDate") or "9999", c.get("id") or ""))
    elif situacao == "recebidas":
        filtradas.sort(key=lambda c: (_data_pagamento(c), c.get("id") or ""), reverse=True)
    else:
        filtradas.sort(key=lambda c: (c.get("dueDate") or "", c.get("id") or ""), reverse=True)

    offset = max(0, offset)
    pagina = filtradas[offset:offset + limite]
    return {
        "resumo": resumo, "contagens": contagens, "cobrancas": pagina,
        "totalCount": len(filtradas), "hasMore": offset + limite < len(filtradas),
    }


async def consultar_cobranca(cliente: httpx.AsyncClient, url_base: str, api_key: str, payment_id: str) -> dict:
    """Consulta o status atual de uma cobrança (status: PENDING, RECEIVED, OVERDUE, etc.)."""
    resposta = await _pedido(cliente.get(
        f"{url_base}/payments/{payment_id}", headers={"access_token": api_key},
    ))
    return _json_ou_erro(resposta, "consultar cobrança no Asaas")


async def excluir_cobranca(cliente: httpx.AsyncClient, url_base: str, api_key: str, payment_id: str) -> dict:
    """Exclui/cancela uma cobrança (só é permitido para cobranças ainda não pagas)."""
    resposta = await _pedido(cliente.delete(
        f"{url_base}/payments/{payment_id}", headers={"access_token": api_key},
    ))
    return _json_ou_erro(resposta, "cancelar cobrança no Asaas")


def _json_ou_erro(resposta: httpx.Response, acao: str) -> dict:
    if resposta.status_code >= 400:
        raise ErroAsaas(f"Falha ao {acao} (HTTP {resposta.status_code}): {resposta.text[:300]}")
    try:
        return resposta.json()
    except ValueError:
        raise ErroAsaas(f"Resposta inesperada (não é JSON) ao {acao}.")
