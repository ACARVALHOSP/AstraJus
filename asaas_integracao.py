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
    resposta = await cliente.post(
        f"{url_base}/customers", headers={"access_token": api_key}, json=corpo,
    )
    return _json_ou_erro(resposta, "criar cliente no Asaas")


async def criar_cobranca_boleto(
    cliente: httpx.AsyncClient, url_base: str, api_key: str, customer_id: str,
    valor: float, vencimento_iso: str, descricao: str | None = None,
) -> dict:
    """Cria uma cobrança via boleto para um cliente já cadastrado. Devolve o objeto criado,
    com `bankSlipUrl` (link do boleto) e `invoiceUrl` (fatura/página de pagamento)."""
    corpo: dict[str, Any] = {
        "customer": customer_id,
        "billingType": "BOLETO",
        "value": valor,
        "dueDate": vencimento_iso,
    }
    if descricao:
        corpo["description"] = descricao
    resposta = await cliente.post(
        f"{url_base}/payments", headers={"access_token": api_key}, json=corpo,
    )
    return _json_ou_erro(resposta, "criar cobrança no Asaas")


async def consultar_cobranca(cliente: httpx.AsyncClient, url_base: str, api_key: str, payment_id: str) -> dict:
    """Consulta o status atual de uma cobrança (status: PENDING, RECEIVED, OVERDUE, etc.)."""
    resposta = await cliente.get(
        f"{url_base}/payments/{payment_id}", headers={"access_token": api_key},
    )
    return _json_ou_erro(resposta, "consultar cobrança no Asaas")


def _json_ou_erro(resposta: httpx.Response, acao: str) -> dict:
    if resposta.status_code >= 400:
        raise ErroAsaas(f"Falha ao {acao} (HTTP {resposta.status_code}): {resposta.text[:300]}")
    try:
        return resposta.json()
    except ValueError:
        raise ErroAsaas(f"Resposta inesperada (não é JSON) ao {acao}.")
