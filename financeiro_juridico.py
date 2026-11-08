"""Resumos do financeiro jurídico: por processo (honorários, custas, repasses) e inadimplência.

Funções puras sobre a lista de lançamentos (dicts de RegistroClientesCasos.listar_lancamentos);
não tocam em banco nem em rede, para serem fáceis de testar.
"""
from datetime import date

HONORARIOS = ("HONORARIO", "EXITO")
FAIXAS = (("1-30", 1, 30), ("31-60", 31, 60), ("61-90", 61, 90), ("90+", 91, 10**6))


def _dias(de_iso: str, ate_iso: str) -> int:
    return (date.fromisoformat(ate_iso[:10]) - date.fromisoformat(de_iso[:10])).days


def _soma(itens) -> float:
    return round(sum(i["valor"] for i in itens), 2)


def por_processo(lancamentos: list[dict], hoje: str) -> list[dict]:
    """Uma linha por processo com lançamentos:
    - honorários: previstos, recebidos, em aberto e vencidos (receitas de honorário e êxito);
    - custas: gasto no processo e quanto delas o cliente ainda deve reembolsar (custas
      reembolsáveis sem cobrança de reembolso emitida) ou já foi cobrado e aguarda pagamento;
    - repasses: total, já repassado e pendente;
    - saldo: o que entrou (receitas pagas) menos o que saiu (despesas pagas)."""
    por_caso: dict[str, list[dict]] = {}
    for l in lancamentos:
        por_caso.setdefault(l["caso_id"], []).append(l)
    reembolsados = {l["origem_id"] for l in lancamentos if l["direcao"] == "RECEITA" and l["tipo"] == "CUSTAS" and l.get("origem_id")}
    linhas = []
    for caso_id, itens in por_caso.items():
        honor = [l for l in itens if l["direcao"] == "RECEITA" and l["tipo"] in HONORARIOS]
        custas = [l for l in itens if l["direcao"] == "DESPESA" and l["tipo"] == "CUSTAS"]
        repasses = [l for l in itens if l["tipo"] == "REPASSE"]
        a_reembolsar = [l for l in custas if l["reembolsavel"] and l["id"] not in reembolsados]
        reembolsos = [l for l in itens if l["direcao"] == "RECEITA" and l["tipo"] == "CUSTAS" and l.get("origem_id")]
        abertos = [l for l in honor if not l["pago"]]
        entrou = _soma([l for l in itens if l["direcao"] == "RECEITA" and l["pago"]])
        saiu = _soma([l for l in itens if l["direcao"] == "DESPESA" and l["pago"]])
        linhas.append({
            "caso_id": caso_id, "cliente_id": itens[0]["cliente_id"],
            "honorarios": {
                "previstos": _soma(honor), "recebidos": _soma([l for l in honor if l["pago"]]),
                "em_aberto": _soma(abertos),
                "vencidos": _soma([l for l in abertos if l["vencimento"][:10] < hoje]),
            },
            "custas": {
                "gastas": _soma(custas), "a_reembolsar": _soma(a_reembolsar),
                "reembolso_pendente": _soma([l for l in reembolsos if not l["pago"]]),
                "reembolsadas": _soma([l for l in reembolsos if l["pago"]]),
            },
            "repasses": {
                "total": _soma(repasses), "repassado": _soma([l for l in repasses if l["pago"]]),
                "pendente": _soma([l for l in repasses if not l["pago"]]),
            },
            "entrou": entrou, "saiu": saiu, "saldo": round(entrou - saiu, 2),
        })
    linhas.sort(key=lambda r: (-r["honorarios"]["vencidos"], -r["honorarios"]["em_aberto"], r["caso_id"]))
    return linhas


def inadimplencia(lancamentos: list[dict], hoje: str) -> dict:
    """Receitas vencidas e não recebidas: por faixa de atraso e por cliente (maior dívida primeiro).
    A taxa é o vencido sobre tudo que já deveria ter sido recebido até hoje."""
    vencidos = []
    for l in lancamentos:
        if l["direcao"] != "RECEITA" or l["pago"] or l["vencimento"][:10] >= hoje:
            continue
        vencidos.append({**l, "dias_atraso": _dias(l["vencimento"], hoje)})
    exigivel = _soma([l for l in lancamentos if l["direcao"] == "RECEITA" and l["vencimento"][:10] < hoje]) \
        + _soma([l for l in lancamentos if l["direcao"] == "RECEITA" and l["pago"] and l["vencimento"][:10] >= hoje])
    faixas = []
    for nome, minimo, maximo in FAIXAS:
        dentro = [l for l in vencidos if minimo <= l["dias_atraso"] <= maximo]
        faixas.append({"faixa": nome, "quantidade": len(dentro), "valor": _soma(dentro)})
    por_cliente: dict[str, list[dict]] = {}
    for l in vencidos:
        por_cliente.setdefault(l["cliente_id"], []).append(l)
    clientes = [{
        "cliente_id": cliente_id, "quantidade": len(itens), "valor": _soma(itens),
        "maior_atraso": max(i["dias_atraso"] for i in itens),
        "itens": [{
            "id": i["id"], "caso_id": i["caso_id"], "descricao": i["descricao"], "tipo": i["tipo"],
            "vencimento": i["vencimento"][:10], "valor": i["valor"], "dias_atraso": i["dias_atraso"],
            "asaas_cobranca_id": i.get("asaas_cobranca_id"),
        } for i in sorted(itens, key=lambda i: -i["dias_atraso"])],
    } for cliente_id, itens in por_cliente.items()]
    clientes.sort(key=lambda c: (-c["valor"], c["cliente_id"]))
    total = _soma(vencidos)
    return {
        "total_vencido": total, "quantidade": len(vencidos), "clientes_inadimplentes": len(clientes),
        "taxa": round(total / exigivel * 100, 1) if exigivel else 0.0,
        "faixas": faixas, "clientes": clientes,
    }
