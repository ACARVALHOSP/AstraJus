"""Módulo Caçador de Alvarás: acha, nas publicações recebidas, as que tratam de alvará ou levantamento de valores.

Cada publicação é analisada uma vez (o resultado fica em `alvaras_cacados`). O Jev (OpenRouter) é usado quando há
integração ativa; sem ela, ou se ele falhar, vale o regex. Publicações que ficaram só com o regex voltam a ser
analisadas quando o Jev estiver disponível. Nada é criado nem alterado nas publicações."""
import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from urllib.parse import parse_qsl

from modulos.contrato import ferramenta
from modulos.nucleo import nucleo
from modulos.cacador_alvaras import deteccao

_BANCO: str | None = None
LIMITE_PADRAO, LIMITE_MAX, LIMITE_JEV_POR_RODADA = 200, 1000, 50


def migrar(conexao) -> None:
    global _BANCO
    conexao.execute(
        "CREATE TABLE IF NOT EXISTS alvaras_cacados (hash TEXT PRIMARY KEY, resultado TEXT NOT NULL, "
        "situacao TEXT NOT NULL, origem TEXT NOT NULL, analisado_em TEXT NOT NULL)")
    arquivo = next((linha[2] for linha in conexao.execute("PRAGMA database_list") if linha[1] == "main"), "")
    _BANCO = arquivo or None


def _classificador() -> deteccao.ClassificadorAlvaraJev | None:
    chave = (nucleo._config_integracao("OPENROUTER_API_KEY", "") or "").strip()
    if not chave:
        return None
    modelo = (nucleo._config_integracao("CNJ_ALVARAS_MODELO", "") or "").strip()
    return deteccao.ClassificadorAlvaraJev(chave, modelo if "/" in modelo else deteccao.MODELO_PADRAO)


def _publicacao(linha) -> dict:
    hash_, numero, dados, status, caso_id, criado_em = linha
    return {"hash": hash_, "numero_processo": numero, "dados": json.loads(dados), "status": status,
            "caso_id": caso_id, "criado_em": criado_em, "nome_pesquisado": None}


def _pendentes(con: sqlite3.Connection, limite: int, refazer: bool, jev: bool) -> list[dict]:
    """Publicações mais recentes ainda não analisadas (ou só no regex, se o Jev estiver disponível)."""
    refaz = "1" if refazer else "0"
    reanalisa = "a.origem = 'regex' AND a.situacao != 'nenhum'" if jev else "0"
    linhas = con.execute(
        "SELECT p.hash, p.numero_processo, p.dados, p.status, p.caso_id, p.criado_em FROM publicacoes_capturadas p "
        "LEFT JOIN alvaras_cacados a ON a.hash = p.hash "
        f"WHERE a.hash IS NULL OR {refaz} OR ({reanalisa}) ORDER BY p.criado_em DESC LIMIT ?", (limite,)).fetchall()
    return [_publicacao(l) for l in linhas]


def _gravar(con: sqlite3.Connection, hash_: str, resultado: dict) -> None:
    con.execute(
        "INSERT INTO alvaras_cacados VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET resultado=excluded.resultado, "
        "situacao=excluded.situacao, origem=excluded.origem, analisado_em=excluded.analisado_em",
        (hash_, json.dumps(resultado, ensure_ascii=False), resultado["situacao"], resultado["origem"],
         datetime.now(timezone.utc).isoformat(timespec="seconds")))


async def _cacar(limite: int = LIMITE_PADRAO, refazer: bool = False) -> dict:
    if not _BANCO:
        raise RuntimeError("O banco do módulo ainda não está pronto.")
    limite = min(max(int(limite), 1), LIMITE_MAX)
    classificador = _classificador()

    def carregar():
        with sqlite3.connect(_BANCO) as con:
            return _pendentes(con, limite, refazer, classificador is not None)
    publicacoes = await asyncio.to_thread(carregar)

    trava, usos_jev = asyncio.Semaphore(4), 0
    resultados: dict[str, dict] = {}

    async def um(pub: dict, com_jev: bool) -> None:
        async with trava:
            resultados[pub["hash"]] = await deteccao.cacar(pub, classificador if com_jev else None)

    tarefas = []
    for pub in publicacoes:  # o Jev só atende as primeiras candidatas de cada rodada; as demais ficam no regex
        candidata = classificador is not None and usos_jev < LIMITE_JEV_POR_RODADA and deteccao.eh_candidata(
            str((pub["dados"] or {}).get("texto") or ""))
        usos_jev += 1 if candidata else 0
        tarefas.append(um(pub, candidata))
    await asyncio.gather(*tarefas)

    def gravar():
        with sqlite3.connect(_BANCO) as con:
            for h, r in resultados.items():
                _gravar(con, h, r)
    await asyncio.to_thread(gravar)
    achadas = [r for r in resultados.values() if r["encontrou"]]
    return {
        "analisadas": len(resultados), "encontradas": len(achadas),
        "via_jev": sum(1 for r in resultados.values() if r["origem"] == "jev"),
        "via_regex": sum(1 for r in resultados.values() if r["origem"] == "regex"),
        "falhas_jev": sum(1 for r in resultados.values() if r.get("fallback_motivo")),
        "motivo_fallback": next((r["fallback_motivo"] for r in resultados.values() if r.get("fallback_motivo")), None),
        "jev_disponivel": classificador is not None,
    }


def _listar(situacao: str | None = None, limite: int = 100) -> dict:
    if not _BANCO:
        raise RuntimeError("O banco do módulo ainda não está pronto.")
    limite = min(max(int(limite), 1), 500)
    with sqlite3.connect(_BANCO) as con:
        resumo = dict(con.execute("SELECT situacao, COUNT(*) FROM alvaras_cacados WHERE situacao != 'nenhum' GROUP BY situacao"))
        filtro, valores = "a.situacao != 'nenhum'", []
        if situacao:
            if situacao not in deteccao.SITUACOES or situacao == "nenhum":
                raise ValueError("Situação inválida.")
            filtro, valores = "a.situacao = ?", [situacao]
        linhas = con.execute(
            "SELECT p.hash, p.numero_processo, p.dados, p.status, p.caso_id, a.resultado, a.analisado_em "
            "FROM alvaras_cacados a JOIN publicacoes_capturadas p ON p.hash = a.hash "
            f"WHERE {filtro} ORDER BY substr(json_extract(p.dados, '$.data_disponibilizacao'), 1, 10) DESC LIMIT ?",
            valores + [limite * 4]).fetchall()
    con.close()
    itens = []
    for hash_, numero, dados_json, status, caso_id, resultado_json, analisado_em in linhas:
        dados, resultado = json.loads(dados_json), json.loads(resultado_json)
        itens.append({
            "hash": hash_, "numero_processo": numero, "status": status, "caso_id": caso_id,
            "tribunal": (dados.get("siglaTribunal") or "").upper(), "orgao": dados.get("nomeOrgao") or "",
            "data": str(dados.get("data_disponibilizacao") or "")[:10], "tipo_comunicacao": dados.get("tipoComunicacao") or "",
            "analisado_em": analisado_em, **resultado})
    itens.sort(key=lambda i: i["data"], reverse=True)  # estável: com a mesma prioridade, a data mais nova vem antes
    itens.sort(key=lambda i: -deteccao.PRIORIDADE.get(i["situacao"], 0))
    return {"alvaras": itens[:limite], "resumo": resumo, "situacoes": deteccao.SITUACOES,
            "jev_disponivel": _classificador() is not None}


@ferramenta
async def cacar_alvaras(limite: int = LIMITE_PADRAO, refazer: bool = False) -> dict:
    """Varre as publicações recebidas ainda não analisadas atrás de alvarás e levantamentos de valores.
    Usa o Jev (OpenRouter) quando há integração ativa e regex como reserva. `limite` (1 a 1000) é quantas
    publicações analisar; `refazer` reanalisa também as já analisadas. Devolve contagens, sem listar os achados
    (use `listar_alvaras`)."""
    try:
        return await _cacar(limite, refazer)
    except (RuntimeError, ValueError) as e:
        return nucleo._erro(str(e))


@ferramenta
async def listar_alvaras(situacao: str | None = None, limite: int = 50) -> dict:
    """Lista os alvarás já achados nas publicações (do mais acionável ao menos). `situacao` filtra por:
    expedido, determinado, providencia_parte, indeferido ou mencao. Cada item traz processo, tribunal, data,
    situação, confiança, valor (se houver), a origem da análise (jev ou regex) e os trechos do texto."""
    try:
        return _listar(situacao, limite)
    except (RuntimeError, ValueError) as e:
        return nucleo._erro(str(e))


async def http_com_corpo(scope, receive, send, caminho: str) -> bool:
    metodo = scope.get("method")
    if caminho == "/alvaras/cacador" and metodo == "GET":
        parametros = dict(parse_qsl(scope.get("query_string", b"").decode("latin-1")))
        try:
            dados = _listar(parametros.get("situacao") or None, int(parametros.get("limite", "100")))
        except (RuntimeError, ValueError) as e:
            await nucleo._json(send, 400, nucleo._erro(str(e)))
        else:
            await nucleo._json(send, 200, dados)
        return True
    if caminho == "/alvaras/cacador/cacar" and metodo == "POST":
        bruto = await nucleo._ler_corpo(receive, 4096)
        if bruto is None:
            await nucleo._json(send, 413, nucleo._erro("Corpo grande demais."))
            return True
        try:
            pedido = json.loads(bruto.decode("utf-8") or "{}")
            if not isinstance(pedido, dict):
                raise ValueError
            resultado = await _cacar(pedido.get("limite", LIMITE_PADRAO), bool(pedido.get("refazer")))
        except (ValueError, UnicodeDecodeError, TypeError):
            await nucleo._json(send, 400, nucleo._erro("Pedido inválido."))
        except RuntimeError as e:
            await nucleo._json(send, 503, nucleo._erro(str(e)))
        else:
            await nucleo._json(send, 200, resultado)
        return True
    return False


async def http(scope, send, caminho: str) -> bool:
    async def vazio():
        return {"type": "http.request", "body": b"", "more_body": False}
    return await http_com_corpo(scope, vazio, send, caminho)
