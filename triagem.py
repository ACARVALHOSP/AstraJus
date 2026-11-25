"""Triagem de publicações com um modelo de decisão (Jev, da TypeSafe AI).

O Jev não escreve texto: recebe um estado e responde perguntas tipadas (noul = sim/não com
probabilidade, choice = uma opção de uma lista, score = nota numa escala). Por isso serve para
classificar e ordenar a caixa de publicações, nunca para decidir. As regras de segurança são:

- o texto enviado sai SEM nomes (partes, advogados, OAB), CPF/CNPJ, e-mails, telefones e números de
  processo (ver `anonimizar`);
- o resultado é só uma sugestão exibida para a pessoa: nada é criado, tratado, arquivado ou
  escondido por causa dele, e a data de um prazo continua vindo apenas do cálculo de prazos;
- as faixas de confiança (`faixa`) decidem apenas o destaque na tela;
- sem o serviço (modo desligado, chave ausente ou erro), o sistema funciona como antes.

Há dois classificadores com a mesma interface: `ClassificadorSimulado` (palavras-chave, para ver a
tela funcionando sem enviar nada a ninguém) e `ClassificadorJev` (API real).
"""
import asyncio
import json
import re
import unicodedata
from typing import Any, Callable

import httpx

LIMITE_ALTO = 0.90   # acima: sugestão em destaque
LIMITE_BAIXO = 0.50  # abaixo: nenhuma sugestão é mostrada
TAMANHO_MAX_TEXTO = 6000
MODOS = ("desligado", "simulado", "jev", "openrouter")
MODELO_OPENROUTER = "typesafe/jev-router"

# Mesmos ids de frontend/src/routes/publicacoes-oab/prazos.ts (PRAZOS_PADRAO); há um teste que confere.
PRAZOS_PADRAO = {
    "contestacao": "Prazo para apresentar contestação",
    "replica": "Prazo para apresentar réplica à contestação",
    "apelacao": "Prazo para apresentar apelação",
    "contrarrazoes": "Prazo para contrarrazões de apelação",
    "embargos_declaracao": "Prazo para embargos de declaração",
    "agravo_instrumento": "Prazo para agravo de instrumento",
    "agravo_interno": "Prazo para agravo interno",
    "recurso_especial": "Prazo para recurso especial ou extraordinário",
    "cumprimento_pagamento": "Prazo para pagar a dívida no cumprimento de sentença",
    "impugnacao_cumprimento": "Prazo para impugnar o cumprimento de sentença",
    "embargos_execucao": "Prazo para embargos à execução",
    "documentos": "Prazo para se manifestar sobre documentos juntados",
    "manifestacao": "Prazo para manifestação genérica sem prazo fixado",
    "recurso_inominado": "Prazo para recurso inominado em Juizado Especial",
    "embargos_declaracao_je": "Prazo para embargos de declaração em Juizado Especial",
    "nenhum": "A publicação não abre nenhum desses prazos",
}
TIPOS = {
    "exige_manifestacao": "A publicação intima a parte a se manifestar, cumprir algo ou praticar um ato",
    "ciencia": "A publicação apenas dá ciência de um ato, sem exigir nada",
    "despacho_expediente": "Despacho de mero expediente, como vista, juntada ou remessa",
    "sentenca_ou_decisao": "Sentença, decisão interlocutória ou acórdão",
    "outro": "Nenhuma das anteriores",
}
URGENCIA = [
    "Sem urgência: apenas informativa",
    "Pouco urgente: pode esperar alguns dias",
    "Moderada: tratar na semana",
    "Urgente: prazo curto ou ato importante",
    "Muito urgente: prazo imediato, liminar, audiência ou bloqueio",
]


class ErroTriagem(Exception):
    """Falha ao classificar (serviço fora do ar, chave inválida, resposta inesperada)."""


# ── Anonimização ──────────────────────────────────────────────────────────────

_PARTICULAS = {"de", "da", "do", "dos", "das", "e", "di", "du", "del", "la", "le", "van", "von", "y"}
_PADROES_MASCARA = [
    (re.compile(r"\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b"), "[PROCESSO]"),
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "[CPF]"),
    (re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b"), "[CNPJ]"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[EMAIL]"),
    (re.compile(r"\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b"), "[TELEFONE]"),
    (re.compile(r"\bOAB\s*/?\s*[A-Z]{0,2}\s*[\d.]{3,9}(?:\s*/\s*[A-Z]{2})?", re.IGNORECASE), "[OAB]"),
]


def _nomes_da_publicacao(publicacao: dict) -> list[str]:
    dados = publicacao.get("dados") or {}
    nomes = [publicacao.get("nome_pesquisado") or ""]
    nomes += [p.get("nome") or "" for p in dados.get("destinatarios") or []]
    for a in dados.get("destinatarioadvogados") or []:
        nomes.append(a.get("nome") or (a.get("advogado") or {}).get("nome") or "")
    return sorted({" ".join(n.split()) for n in nomes if n and n.strip()}, key=len, reverse=True)


def anonimizar(publicacao: dict) -> dict:
    """O estado enviado ao classificador: tipo, classe, órgão, tribunal e o texto sem identificação.
    Nomes de partes e advogados saem por inteiro e também palavra a palavra (sobrenomes soltos),
    mesmo que isso apague uma palavra comum que coincida com um sobrenome: na dúvida, esconde."""
    dados = publicacao.get("dados") or {}
    texto = str(dados.get("texto") or "")
    for nome in _nomes_da_publicacao(publicacao):
        texto = re.sub(r"\s+".join(re.escape(p) for p in nome.split()), "[PARTE]", texto, flags=re.IGNORECASE)
        for palavra in nome.split():
            if len(palavra) >= 3 and palavra.lower() not in _PARTICULAS:
                texto = re.sub(rf"(?<!\w){re.escape(palavra)}(?!\w)", "[NOME]", texto, flags=re.IGNORECASE)
    for padrao, marca in _PADROES_MASCARA:
        texto = padrao.sub(marca, texto)
    return {
        "tipo_comunicacao": dados.get("tipoComunicacao") or "", "classe": dados.get("nomeClasse") or "",
        "orgao": dados.get("nomeOrgao") or "", "tribunal": (dados.get("siglaTribunal") or "").upper(),
        "texto": texto[:TAMANHO_MAX_TEXTO],
    }


# ── Perguntas (formato da API do Jev) ────────────────────────────────────────

def perguntas() -> dict[str, dict]:
    """Todas as perguntas vão na mesma chamada: o custo é por tokens do estado, não por pergunta."""
    return {
        "tipo": {"type": "choice", "instructions": "Classifique o que esta publicação do Diário de Justiça exige de quem a recebe.", "criteria": TIPOS},
        "gera_prazo": {"type": "noul", "instructions": "Esta publicação abre prazo processual para a parte intimada praticar algum ato?",
                       "criteria": {"true": "Há prazo para manifestação, recurso, pagamento ou cumprimento", "false": "Não há prazo para a parte"}},
        "prazo_padrao": {"type": "choice", "instructions": "Qual prazo processual a publicação provavelmente abre? Escolha 'nenhum' se não abrir um destes.", "criteria": PRAZOS_PADRAO},
        "urgencia": {"type": "score", "instructions": "Quão urgente é o tratamento desta publicação por um escritório de advocacia?", "criteria": URGENCIA},
    }


# ── Interpretação e faixas ───────────────────────────────────────────────────

def faixa(confianca: float | None) -> str:
    """'alta' (acima de 0,90), 'revisar' (de 0,50 a 0,90) ou 'baixa' (abaixo de 0,50)."""
    if confianca is None:
        return "baixa"
    return "alta" if confianca > LIMITE_ALTO else "revisar" if confianca >= LIMITE_BAIXO else "baixa"


def _escolha(resposta: dict) -> dict:
    valor = resposta.get("choice")
    probs = resposta.get("probabilities") or {}
    confianca = float(probs.get(valor, resposta.get("confidence") or 0.0))
    return {"valor": valor, "confianca": round(confianca, 3)}


def interpretar(respostas: dict[str, Any], modelo: str) -> dict:
    """Normaliza as respostas do classificador no formato guardado e mostrado."""
    try:
        p_prazo = float(respostas["gera_prazo"]["noul"])
        urg = respostas["urgencia"]
        nivel = float(urg["score"])
        n_niveis = max(2, len(URGENCIA))
        tipo, prazo = _escolha(respostas["tipo"]), _escolha(respostas["prazo_padrao"])
    except (KeyError, TypeError, ValueError) as e:
        raise ErroTriagem(f"Resposta inesperada do classificador: {e!r}") from e
    certeza_prazo = max(p_prazo, 1 - p_prazo)
    nota = round(1 + (min(max(nivel, 0), n_niveis - 1) / (n_niveis - 1)) * 9, 1)  # escala 1 a 10
    resultado = {
        "modelo": modelo,
        "tipo": tipo,
        "gera_prazo": {"valor": p_prazo >= 0.5, "probabilidade": round(p_prazo, 3), "confianca": round(certeza_prazo, 3)},
        "prazo_padrao": prazo,
        "urgencia": {"nota": nota, "confianca": round(float(urg.get("confidence") or 0.0), 3)},
    }
    resultado["faixas"] = {
        "tipo": faixa(tipo["confianca"]), "gera_prazo": faixa(certeza_prazo),
        "prazo_padrao": faixa(prazo["confianca"]), "urgencia": faixa(resultado["urgencia"]["confianca"]),
    }
    return resultado


# ── Classificadores ──────────────────────────────────────────────────────────

def _sem_acento(texto: str) -> str:
    return unicodedata.normalize("NFD", texto).encode("ascii", "ignore").decode().lower()


class ClassificadorSimulado:
    """Palavras-chave com probabilidades fixas, só para demonstrar a tela. Não é inteligência e não
    deve ser usado para decidir nada: os resultados trazem o modelo 'simulado' e a tela avisa."""
    modelo = "simulado"

    async def classificar(self, estado: dict) -> dict:
        t = _sem_acento(f"{estado.get('tipo_comunicacao', '')} {estado.get('texto', '')}")
        def tem(*palavras): return sum(1 for p in palavras if p in t)
        sentenca = tem("julgo", "sentenca", "acordao", "decisao interlocutoria", "defiro", "indefiro")
        manifestacao = tem("intime-se", "intimada", "intimado", "manifeste", "manifestar", "prazo de", "apresentar", "no prazo")
        ciencia = tem("ciencia", "ciente", "tomar ciencia", "nada a prover", "arquive")
        expediente = tem("vista", "juntada", "remetam-se", "cumpra-se", "certidao", "conclusos")
        urgente = tem("liminar", "tutela", "bloqueio", "penhora", "audiencia", "urgente", "prazo de 5", "prazo de 48")
        tipos = {"exige_manifestacao": 0.1 + 0.25 * manifestacao, "ciencia": 0.1 + 0.3 * ciencia,
                 "despacho_expediente": 0.1 + 0.3 * expediente, "sentenca_ou_decisao": 0.1 + 0.3 * sentenca, "outro": 0.15}
        total = sum(tipos.values())
        probs = {k: v / total for k, v in tipos.items()}
        melhor = max(probs, key=probs.get)
        alvo = _sem_acento(estado.get("texto", ""))
        regras = [("contestacao", "contestar|contestacao"), ("replica", "replica|replicar"), ("apelacao", "apelacao"),
                  ("contrarrazoes", "contrarrazoes"), ("embargos_declaracao", "embargos de declaracao"),
                  ("agravo_instrumento", "agravo de instrumento"), ("cumprimento_pagamento", r"pagar|pagamento.*15"),
                  ("recurso_inominado", "recurso inominado")]
        achados = [pid for pid, rx in regras if re.search(rx, alvo)]
        prazo = achados[0] if len(achados) == 1 else "nenhum"
        confianca_prazo = 0.93 if len(achados) == 1 else (0.55 if achados else 0.82)
        resto = (1 - confianca_prazo) / (len(PRAZOS_PADRAO) - 1)
        probs_prazo = {k: (confianca_prazo if k == prazo else resto) for k in PRAZOS_PADRAO}
        p_prazo = 0.96 if manifestacao >= 2 else 0.78 if manifestacao == 1 else 0.06 if (ciencia or expediente or sentenca) and not manifestacao else 0.35
        nivel = min(4, max(0, (1 if manifestacao else 0) + urgente + (1 if p_prazo > 0.9 else 0)))
        return interpretar({
            "tipo": {"choice": melhor, "probabilities": probs},
            "gera_prazo": {"noul": p_prazo},
            "prazo_padrao": {"choice": prazo, "probabilities": probs_prazo},
            "urgencia": {"score": float(nivel), "confidence": 0.92 if nivel in (0, 4) else 0.7},
        }, self.modelo)


class ClassificadorJev:
    """Chama POST /v1/systemone da TypeSafe AI (https://docs.typesafe.ai). Escrito pela documentação;
    ainda não exercitado com uma chave real. Erros 429 e 529 são repetidos com espera crescente."""

    def __init__(self, chave: str, modelo: str = "jev-latest", base: str = "https://api.typesafe.ai",
                 cliente_http: Callable[[], httpx.AsyncClient] | None = None, tentativas: int = 3, espera_s: float = 1.0):
        self.chave, self.modelo_pedido, self.base = chave, modelo, base.rstrip("/")
        self._cliente = cliente_http or (lambda: httpx.AsyncClient(timeout=20.0))
        self.tentativas, self.espera_s = tentativas, espera_s

    @property
    def modelo(self) -> str:
        return self.modelo_pedido

    async def classificar(self, estado: dict) -> dict:
        corpo = {"model": self.modelo_pedido, "state": estado, "questions": perguntas()}
        cabecalhos = {"Authorization": f"Bearer {self.chave}", "Content-Type": "application/json"}
        ultimo = "sem resposta"
        for tentativa in range(1, self.tentativas + 1):
            try:
                async with self._cliente() as http:
                    resp = await http.post(f"{self.base}/v1/systemone", json=corpo, headers=cabecalhos)
            except httpx.HTTPError as e:
                ultimo = f"falha de conexão: {e}"
            else:
                if resp.status_code == 200:
                    try:
                        dados = resp.json()
                    except ValueError as e:
                        raise ErroTriagem("Resposta do Jev não é JSON.") from e
                    return interpretar(dados.get("answers") or {}, str(dados.get("model") or self.modelo_pedido))
                if resp.status_code == 401:
                    raise ErroTriagem("A chave do Jev foi recusada (401). Confira TYPESAFE_API_KEY.")
                if resp.status_code in (400, 413, 422):
                    raise ErroTriagem(f"O Jev recusou o pedido ({resp.status_code}): {resp.text[:200]}")
                ultimo = f"HTTP {resp.status_code}"
                if resp.status_code not in (429, 529, 500, 502, 503, 504):
                    break
            if tentativa < self.tentativas:
                await asyncio.sleep(self.espera_s * 2 ** (tentativa - 1))
        raise ErroTriagem(f"O Jev não respondeu ({ultimo}).")


def _json_da_resposta(texto: str) -> dict:
    """Extrai o objeto JSON da resposta do modelo, tolerando cerca de código (```json) e texto em volta."""
    texto = (texto or "").strip()
    inicio, fim = texto.find("{"), texto.rfind("}")
    if inicio < 0 or fim <= inicio:
        raise ErroTriagem("A resposta do modelo não contém JSON.")
    try:
        dados = json.loads(texto[inicio:fim + 1])
    except ValueError as e:
        raise ErroTriagem("A resposta do modelo não é um JSON válido.") from e
    if not isinstance(dados, dict):
        raise ErroTriagem("A resposta do modelo não é um objeto JSON.")
    return dados


def _instrucoes_openrouter() -> str:
    def lista(criterios: dict) -> str:
        return "\n".join(f"  - {k}: {v}" for k, v in criterios.items())
    niveis = "\n".join(f"  - {i}: {t}" for i, t in enumerate(URGENCIA))
    return (
        "Você triage publicações do Diário de Justiça para um escritório de advocacia. O texto vem sem nomes, "
        "CPF/CNPJ, telefones e números de processo. Responda SOMENTE com um objeto JSON, sem comentários, com as chaves:\n"
        f"\"tipo\": um destes ids (o que a publicação exige de quem a recebe):\n{lista(TIPOS)}\n"
        "\"tipo_confianca\": número de 0 a 1.\n"
        "\"gera_prazo\": número de 0 a 1, a probabilidade de a publicação abrir prazo processual para a parte intimada.\n"
        f"\"prazo_padrao\": um destes ids (o prazo que provavelmente abre; 'nenhum' se não abrir um destes):\n{lista(PRAZOS_PADRAO)}\n"
        "\"prazo_padrao_confianca\": número de 0 a 1.\n"
        f"\"urgencia\": inteiro de 0 a {len(URGENCIA) - 1}:\n{niveis}\n"
        "\"urgencia_confianca\": número de 0 a 1.\n"
        "Seja conservador na confiança: use valores baixos quando o texto for ambíguo ou curto. "
        "Isto é apenas uma sugestão para leitura; um advogado revisa tudo."
    )


class ClassificadorOpenRouter:
    """Jev (typesafe/jev-router) pelo OpenRouter: chat completions comum, com a mesma saída da triagem.
    As confianças são as informadas pelo modelo (não são probabilidades calibradas como as do /v1/systemone),
    por isso a tela continua tratando tudo como sugestão. Erros 429 e 5xx são repetidos com espera crescente."""

    def __init__(self, chave: str, modelo: str = MODELO_OPENROUTER, base: str = "https://openrouter.ai/api/v1",
                 cliente_http: Callable[[], httpx.AsyncClient] | None = None, tentativas: int = 3, espera_s: float = 1.0):
        self.chave, self.modelo_pedido, self.base = chave, modelo, base.rstrip("/")
        self._cliente = cliente_http or (lambda: httpx.AsyncClient(timeout=60.0))
        self.tentativas, self.espera_s = tentativas, espera_s

    @property
    def modelo(self) -> str:
        return self.modelo_pedido

    @staticmethod
    def _numero(valor: Any, nome: str) -> float:
        try:
            n = float(valor)
        except (TypeError, ValueError) as e:
            raise ErroTriagem(f"Campo '{nome}' inválido na resposta do modelo.") from e
        return min(max(n, 0.0), 1.0)

    def _respostas(self, dados: dict) -> dict:
        tipo, prazo = dados.get("tipo"), dados.get("prazo_padrao")
        if tipo not in TIPOS or prazo not in PRAZOS_PADRAO:
            raise ErroTriagem("O modelo respondeu com uma opção que não existe na lista.")
        try:
            nivel = int(round(float(dados.get("urgencia"))))
        except (TypeError, ValueError) as e:
            raise ErroTriagem("Campo 'urgencia' inválido na resposta do modelo.") from e
        nivel = min(max(nivel, 0), len(URGENCIA) - 1)
        c_tipo, c_prazo = self._numero(dados.get("tipo_confianca"), "tipo_confianca"), self._numero(dados.get("prazo_padrao_confianca"), "prazo_padrao_confianca")
        return {
            "tipo": {"choice": tipo, "probabilities": {tipo: c_tipo}},
            "gera_prazo": {"noul": self._numero(dados.get("gera_prazo"), "gera_prazo")},
            "prazo_padrao": {"choice": prazo, "probabilities": {prazo: c_prazo}},
            "urgencia": {"score": float(nivel), "confidence": self._numero(dados.get("urgencia_confianca"), "urgencia_confianca")},
        }

    async def classificar(self, estado: dict) -> dict:
        corpo = {"model": self.modelo_pedido, "temperature": 0, "messages": [
            {"role": "system", "content": _instrucoes_openrouter()},
            {"role": "user", "content": json.dumps(estado, ensure_ascii=False)},
        ]}
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
                    resultado = interpretar(self._respostas(_json_da_resposta(texto)), str(dados.get("model") or self.modelo_pedido))
                    return resultado
                if resp.status_code in (401, 403):
                    raise ErroTriagem(f"A chave do OpenRouter foi recusada ({resp.status_code}). Confira a integração OpenRouter.")
                if resp.status_code == 402:
                    raise ErroTriagem("Créditos insuficientes no OpenRouter (402).")
                if resp.status_code in (400, 404, 413, 422):
                    raise ErroTriagem(f"O OpenRouter recusou o pedido ({resp.status_code}): {resp.text[:200]}")
                ultimo = f"HTTP {resp.status_code}"
                if resp.status_code not in (408, 429, 500, 502, 503, 504, 529):
                    break
            if tentativa < self.tentativas:
                await asyncio.sleep(self.espera_s * 2 ** (tentativa - 1))
        raise ErroTriagem(f"O OpenRouter não respondeu ({ultimo}).")


def criar_classificador(modo: str, chave: str = "", modelo: str = "jev-latest", chave_openrouter: str = "",
                        modelo_openrouter: str = MODELO_OPENROUTER) -> ClassificadorSimulado | ClassificadorJev | ClassificadorOpenRouter | None:
    """None quando desligado ou quando o modo escolhido está sem chave."""
    if modo == "simulado":
        return ClassificadorSimulado()
    if modo == "jev" and chave:
        return ClassificadorJev(chave, modelo or "jev-latest")
    if modo == "openrouter" and chave_openrouter:
        return ClassificadorOpenRouter(chave_openrouter, modelo_openrouter or MODELO_OPENROUTER)
    return None
