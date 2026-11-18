"""Ajuda comum aos testes HTTP que chamam o middleware ASGI diretamente.

O nome começa com "helpers_" para o pytest não coletar este arquivo como teste.
"""
import asyncio
import json


def chamar(middleware, metodo, url, token=None, corpo=None):
    """Chamada ASGI com corpo JSON opcional. Devolve (status, dict)."""
    enviado = json.dumps(corpo).encode() if corpo is not None else b""
    respostas = []

    async def receive():
        return {"type": "http.request", "body": enviado, "more_body": False}

    async def send(mensagem):
        respostas.append(mensagem)

    cabecalhos = [(b"authorization", f"Bearer {token}".encode())] if token else []
    if corpo is not None:
        cabecalhos.append((b"content-type", b"application/json"))
    caminho, _, consulta = url.partition("?")
    scope = {"type": "http", "method": metodo, "path": caminho, "query_string": consulta.encode(), "headers": cabecalhos}
    asyncio.run(middleware(scope, receive, send))
    bruto = b"".join(m.get("body", b"") for m in respostas[1:])
    try:
        return respostas[0]["status"], json.loads(bruto) if bruto else {}
    except ValueError:
        return respostas[0]["status"], {}
