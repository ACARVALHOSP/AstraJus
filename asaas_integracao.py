"""Integração com a API do Asaas (gateway de pagamentos: boleto, Pix, cartão).

Autenticação por API Key fixa (não é OAuth, ver google_integracao.py para o caso OAuth).
Este módulo só fala com a API do Asaas - não sabe nada de caso/cliente nem de onde a API
key é guardada; quem chama (server.py) passa o httpx.AsyncClient (para poder injetar
_TRANSPORTE_HTTP nos testes) e a api_key.
"""

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
