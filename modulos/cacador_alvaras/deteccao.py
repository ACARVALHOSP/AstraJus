"""Detecção de alvarás no texto de uma publicação: regex (sempre) e Jev (opcional, com fallback).

O regex é o piso: roda sempre, não envia nada a ninguém e serve de pré-filtro (só candidatas vão ao Jev)
e de reserva (sem chave, sem rede ou com resposta inválida, vale o resultado do regex). O Jev, pelo OpenRouter
(`typesafe/jev-router`), recebe o texto anonimizado por `triagem.anonimizar` e refina a situação e o valor.
O resultado é só uma sugestão de leitura: a data e o valor oficiais continuam sendo os da publicação."""
import asyncio
import json
import re
from typing import Callable

import httpx

import triagem
from triagem import ErroTriagem, _sem_acento, faixa

SITUACOES = {
    "expedido": "Alvará já expedido ou disponível para retirada/levantamento",
    "determinado": "O juízo determinou ou deferiu a expedição do alvará ou o levantamento",
    "providencia_parte": "A parte precisa informar dados (conta, beneficiário) para o alvará ser expedido",
    "indeferido": "O pedido de alvará ou de levantamento foi indeferido",
    "mencao": "Cita alvará ou levantamento sem ato claro",
    "nenhum": "Não trata de alvará nem de levantamento de valores",
}
# Quanto maior, mais "acionável" a situação (ordena a lista e desempata trechos).
PRIORIDADE = {"expedido": 5, "determinado": 4, "providencia_parte": 3, "indeferido": 2, "mencao": 1, "nenhum": 0}
CONFIANCA_REGEX = {"expedido": 0.85, "determinado": 0.8, "providencia_parte": 0.75, "indeferido": 0.75, "mencao": 0.4}
MODELO_PADRAO = "typesafe/jev-router"  # o caçador e a triagem usam o mesmo modelo do OpenRouter

# Trabalha sobre texto sem acento e em minúsculas (ver `_sem_acento`).
_CANDIDATA = re.compile(
    r"\balvaras?\b|mandados? de levantamento|\bmle\b"
    r"|\blevantamento\b(?! (?:d[aeo]s? )?(?:penhora|bloqueio|restricao|constricao|gravame|arresto|sequestro|topografic))"
    r"|levantar (?:o |os |a )?(?:valor|valores|quantia|deposito|importancia|saldo)"
    r"|liberacao d[eoa]s? (?:valor|valores|quantia|deposito|importancia|saldo)")
_REGRAS = (  # (situação, regex): vale a de maior PRIORIDADE que casar na janela
    ("expedido", re.compile(
        r"alvara[^.]{0,60}(?:foi |ja |esta |encontra-se )?(?:expedido|disponivel|liberado|pronto|assinado)"
        r"|(?:expedido|liberado|disponibilizado)[^.]{0,40}alvara"
        r"|(?:retirar|retirada d[oe])[^.]{0,40}alvara"
        r"|mandado de levantamento[^.]{0,40}(?:expedido|disponivel|liberado)")),
    ("determinado", re.compile(
        r"expec[a-z]*-se[^.]{0,40}(?:alvara|mandado de levantamento|mle)|expeca[^.]{0,30}alvara"
        r"|determino[^.]{0,30}(?:expedicao|levantamento)|\b(?:defiro|autorizo|determino)[^.]{0,40}(?:levantamento|expedicao d[oe] alvara)"
        r"|\b(?:defiro|autorizo)[^.]{0,40}alvara|libere-se|levante-se")),
    ("providencia_parte", re.compile(
        r"(?:dados bancarios|conta bancaria|conta judicial|numero da conta|agencia e conta|chave pix)[^.]{0,80}(?:alvara|levantamento|mandado)"
        r"|(?:alvara|levantamento|mandado)[^.]{0,80}(?:dados bancarios|conta bancaria|indicar|indique|informe|informar)"
        r"|(?:indique|informe|informar|indicar|forneca)[^.]{0,60}(?:dados bancarios|conta bancaria|beneficiario)")),
    ("indeferido", re.compile(
        r"(?:\bindefiro|indeferido|indeferimento|\bnego|negado|nao conheco)[^.]{0,60}(?:alvara|levantamento|mandado)"
        r"|(?:alvara|levantamento|mandado)[^.]{0,60}(?:indeferid|negad|nao autorizad)")),
)
_VALOR = re.compile(r"r\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)")
_JANELA = 220


def _numero(bruto: str) -> float | None:
    try:
        return float(bruto.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _janelas(texto: str, comprimento: int = _JANELA) -> list[tuple[int, int]]:
    """Trechos em volta de cada ocorrência candidata, fundidos quando se sobrepõem."""
    intervalos: list[list[int]] = []
    for m in _CANDIDATA.finditer(texto):
        ini, fim = max(0, m.start() - comprimento), min(len(texto), m.end() + comprimento)
        if intervalos and ini <= intervalos[-1][1]:
            intervalos[-1][1] = fim
        else:
            intervalos.append([ini, fim])
    return [(a, b) for a, b in intervalos]


def detectar_regex(texto: str) -> dict:
    """Resultado do regex: {encontrou, situacao, confianca, faixa, valor, trechos, origem: "regex"}.
    `encontrou` é False quando o texto não cita alvará nem levantamento de valores."""
    original = " ".join(str(texto or "").split())
    base = _sem_acento(original)  # mesmo comprimento do original: NFD só remove marcas, e `ignore` descarta o resto
    if len(base) != len(original):  # caracteres exóticos: perde o alinhamento, então trabalha só no texto normalizado
        original = base
    melhor, trechos, valores = "nenhum", [], []
    for ini, fim in _janelas(base):
        janela = base[ini:fim]
        situacao = "mencao"
        for nome, rx in _REGRAS:
            if rx.search(janela) and PRIORIDADE[nome] > PRIORIDADE[situacao]:
                situacao = nome
        if PRIORIDADE[situacao] > PRIORIDADE[melhor]:
            melhor = situacao
        trechos.append(original[ini:fim].strip())
        valores += [v for v in (_numero(m.group(1)) for m in _VALOR.finditer(janela)) if v]
    confianca = CONFIANCA_REGEX.get(melhor, 0.0)
    return {"origem": "regex", "modelo": "regex", "encontrou": melhor != "nenhum", "situacao": melhor,
            "confianca": confianca, "faixa": faixa(confianca) if melhor != "nenhum" else "baixa",
            "valor": valores[0] if valores else None, "trechos": trechos[:3]}


def eh_candidata(texto: str) -> bool:
    return bool(_CANDIDATA.search(_sem_acento(" ".join(str(texto or "").split()))))


# ── Jev (OpenRouter) ─────────────────────────────────────────────────────────

def _instrucoes() -> str:
    lista = "\n".join(f"  - {k}: {v}" for k, v in SITUACOES.items())
    return (
        "Você procura alvarás judiciais e levantamentos de valores em publicações do Diário de Justiça para um "
        "escritório de advocacia. O texto vem sem nomes, CPF/CNPJ, telefones e números de processo. "
        "Responda SOMENTE com um objeto JSON, sem comentários, com as chaves:\n"
        f"\"situacao\": um destes ids:\n{lista}\n"
        "\"confianca\": número de 0 a 1.\n"
        "\"valor\": o valor em reais a levantar como número (ex.: 1234.56) ou null se não houver.\n"
        "Seja conservador na confiança quando o texto for ambíguo ou curto. Isto é apenas uma sugestão para leitura; "
        "um advogado revisa tudo.")


def _json_da_resposta(texto: str) -> dict:
    texto = (texto or "").strip()
    ini, fim = texto.find("{"), texto.rfind("}")
    if ini < 0 or fim <= ini:
        raise ErroTriagem("A resposta do modelo não contém JSON.")
    try:
        dados = json.loads(texto[ini:fim + 1])
    except ValueError as e:
        raise ErroTriagem("A resposta do modelo não é um JSON válido.") from e
    if not isinstance(dados, dict):
        raise ErroTriagem("A resposta do modelo não é um objeto JSON.")
    return dados


class ClassificadorAlvaraJev:
    """Jev (typesafe/jev-router) pelo OpenRouter. Erros 429 e 5xx são repetidos com espera crescente."""

    def __init__(self, chave: str, modelo: str = MODELO_PADRAO, base: str = "https://openrouter.ai/api/v1",
                 cliente_http: Callable[[], httpx.AsyncClient] | None = None, tentativas: int = 3, espera_s: float = 1.0):
        self.chave, self.modelo, self.base = chave, modelo, base.rstrip("/")
        self._cliente = cliente_http or (lambda: httpx.AsyncClient(timeout=60.0))
        self.tentativas, self.espera_s = tentativas, espera_s

    @staticmethod
    def interpretar(dados: dict, modelo: str) -> dict:
        situacao = dados.get("situacao")
        if situacao not in SITUACOES:
            raise ErroTriagem("O modelo respondeu com uma situação que não existe na lista.")
        try:
            confianca = min(max(float(dados.get("confianca")), 0.0), 1.0)
        except (TypeError, ValueError) as e:
            raise ErroTriagem("Campo 'confianca' inválido na resposta do modelo.") from e
        valor = dados.get("valor")
        try:
            valor = round(float(valor), 2) if valor not in (None, "") and float(valor) > 0 else None
        except (TypeError, ValueError):
            valor = None
        return {"origem": "jev", "modelo": modelo, "encontrou": situacao != "nenhum", "situacao": situacao,
                "confianca": round(confianca, 3), "faixa": faixa(confianca) if situacao != "nenhum" else "baixa", "valor": valor}

    async def classificar(self, estado: dict) -> dict:
        corpo = {"model": self.modelo, "temperature": 0, "messages": [
            {"role": "system", "content": _instrucoes()},
            {"role": "user", "content": json.dumps(estado, ensure_ascii=False)}]}
        cabecalhos = {"Authorization": f"Bearer {self.chave}", "Content-Type": "application/json"}
        ultimo = "sem resposta"
        for tentativa in range(1, self.tentativas + 1):
            try:
                async with self._cliente() as http:
                    resp = await http.post(f"{self.base}/chat/completions", json=corpo, headers=cabecalhos)
            except httpx.HTTPError as e:
                ultimo = f"falha de conexão: {e}"
            else:
                if resp.status_code == 200:
                    try:
                        dados = resp.json()
                        texto = dados["choices"][0]["message"]["content"]
                    except (ValueError, KeyError, IndexError, TypeError) as e:
                        raise ErroTriagem("Resposta inesperada do OpenRouter.") from e
                    return self.interpretar(_json_da_resposta(texto), str(dados.get("model") or self.modelo))
                if resp.status_code in (401, 403):
                    raise ErroTriagem(f"A chave do OpenRouter foi recusada ({resp.status_code}).")
                if resp.status_code == 402:
                    raise ErroTriagem("Créditos insuficientes no OpenRouter (402).")
                if resp.status_code in (400, 404, 413, 422):
                    raise ErroTriagem(f"O OpenRouter recusou o pedido ({resp.status_code}).")
                ultimo = f"HTTP {resp.status_code}"
                if resp.status_code not in (408, 429, 500, 502, 503, 504, 529):
                    break
            if tentativa < self.tentativas:
                await asyncio.sleep(self.espera_s * 2 ** (tentativa - 1))
        raise ErroTriagem(f"O OpenRouter não respondeu ({ultimo}).")


async def cacar(publicacao: dict, classificador: ClassificadorAlvaraJev | None) -> dict:
    """Analisa uma publicação. O regex decide se é candidata (sem candidata, o Jev nem é chamado) e é o resultado
    quando não há classificador ou ele falha (`fallback_motivo` explica). Com o Jev, valem a situação e a confiança
    dele; o valor do regex complementa quando o Jev não achou um; os trechos são sempre os do regex."""
    texto = str((publicacao.get("dados") or {}).get("texto") or "")
    reserva = detectar_regex(texto)
    if not reserva["encontrou"] or classificador is None:
        return reserva
    try:
        resultado = await classificador.classificar(triagem.anonimizar(publicacao))
    except ErroTriagem as e:
        return {**reserva, "fallback_motivo": str(e)}
    resultado["valor"] = resultado["valor"] or reserva["valor"]
    resultado["trechos"] = reserva["trechos"]
    return resultado
