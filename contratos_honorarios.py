"""Contratos de honorários: rascunho, prévia das parcelas e geração no Financeiro.

O contrato nasce como rascunho e só gera lançamentos quando é ativado. A entrada vira um
lançamento próprio e as parcelas do saldo viram um grupo de lançamentos — tudo na mesma
transação, para que uma falha não deixe lançamentos soltos nem o contrato pela metade.
Os três campos automáticos (ativar ao assinar, recibo e lembrete) só são guardados nesta fase.
"""
import math
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone

import db

SITUACOES = ("rascunho", "vigente", "encerrado", "cancelado")


class ConflitoContrato(ValueError):
    """Situação incompatível (ativar duas vezes, alterar contrato encerrado...). Vira HTTP 409."""


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hoje() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _data_iso(valor, campo) -> str:
    if isinstance(valor, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        try:
            return date.fromisoformat(valor).isoformat()
        except ValueError:
            pass
    raise ValueError(f"Informe {campo} no formato AAAA-MM-DD.")


def _reais_em_centavos(valor, campo, permitir_zero=False) -> int:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        raise ValueError(f"Informe {campo} em reais (número).")
    centavos = round(valor * 100)
    if centavos < 0:
        raise ValueError(f"{campo.capitalize()} não pode ser negativo.")
    if centavos == 0 and not permitir_zero:
        raise ValueError(f"{campo.capitalize()} deve ser maior que zero.")
    return centavos


def _inteiro(valor, campo, minimo, maximo) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int):
        raise ValueError(f"Informe {campo} como número inteiro.")
    if not minimo <= valor <= maximo:
        raise ValueError(f"Informe {campo} de {minimo} a {maximo}.")
    return valor


def _booleano(valor, campo) -> int:
    if not isinstance(valor, bool):
        raise ValueError(f"O campo {campo} deve ser verdadeiro ou falso.")
    return int(valor)


def criar_tabelas(conexao) -> None:
    """Garante o schema dos contratos. Idempotente, como os demais módulos."""
    conexao.executescript("""
    CREATE TABLE IF NOT EXISTS contratos_honorarios (
        id TEXT PRIMARY KEY,
        cliente_id TEXT NOT NULL REFERENCES clientes(id),
        caso_id TEXT REFERENCES casos(id),
        documento_id INTEGER,
        titulo TEXT NOT NULL,
        valor_total_centavos INTEGER NOT NULL,
        entrada_centavos INTEGER NOT NULL DEFAULT 0,
        entrada_vencimento TEXT,
        parcelas INTEGER NOT NULL DEFAULT 1,
        primeiro_vencimento TEXT NOT NULL,
        exito_percentual REAL,
        exito_descricao TEXT,
        vigencia_inicio TEXT,
        vigencia_fim TEXT,
        situacao TEXT NOT NULL DEFAULT 'rascunho',
        responsavel TEXT NOT NULL,
        ativar_ao_assinar INTEGER NOT NULL DEFAULT 0,
        recibo_automatico INTEGER NOT NULL DEFAULT 0,
        lembrete_automatico INTEGER NOT NULL DEFAULT 0,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL,
        ativado_em TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos_honorarios (cliente_id);
    CREATE INDEX IF NOT EXISTS idx_contratos_caso ON contratos_honorarios (caso_id);
    """)
    if conexao.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lancamentos_financeiros'"
    ).fetchone():
        conexao.execute("CREATE INDEX IF NOT EXISTS idx_lancamentos_contrato ON lancamentos_financeiros (contrato_id)")


_COLUNAS = (
    "id, cliente_id, caso_id, documento_id, titulo, valor_total_centavos, entrada_centavos, "
    "entrada_vencimento, parcelas, primeiro_vencimento, exito_percentual, exito_descricao, "
    "vigencia_inicio, vigencia_fim, situacao, responsavel, ativar_ao_assinar, recibo_automatico, "
    "lembrete_automatico, criado_em, atualizado_em, ativado_em"
)


def _linha(linha) -> dict:
    (id_, cliente_id, caso_id, documento_id, titulo, valor_total_centavos, entrada_centavos,
     entrada_vencimento, parcelas, primeiro_vencimento, exito_percentual, exito_descricao,
     vigencia_inicio, vigencia_fim, situacao, responsavel, ativar_ao_assinar, recibo_automatico,
     lembrete_automatico, criado_em, atualizado_em, ativado_em) = linha
    return {
        "id": id_, "cliente_id": cliente_id, "caso_id": caso_id, "documento_id": documento_id,
        "titulo": titulo, "valor_total_centavos": valor_total_centavos, "entrada_centavos": entrada_centavos,
        "entrada_vencimento": entrada_vencimento, "parcelas": parcelas, "primeiro_vencimento": primeiro_vencimento,
        "exito_percentual": exito_percentual, "exito_descricao": exito_descricao,
        "vigencia_inicio": vigencia_inicio, "vigencia_fim": vigencia_fim, "situacao": situacao,
        "responsavel": responsavel, "ativar_ao_assinar": bool(ativar_ao_assinar),
        "recibo_automatico": bool(recibo_automatico), "lembrete_automatico": bool(lembrete_automatico),
        "criado_em": criado_em, "atualizado_em": atualizado_em, "ativado_em": ativado_em,
    }


def _publico(contrato: dict) -> dict:
    """Valores em reais, como no restante do Financeiro."""
    saida = dict(contrato)
    saida["valor_total"] = saida.pop("valor_total_centavos") / 100
    saida["entrada"] = saida.pop("entrada_centavos") / 100
    return saida


def _normalizar(dados: dict, atual: dict | None = None) -> dict:
    """Valida e devolve o contrato completo (valores em centavos). `atual` completa os campos
    omitidos ao atualizar um rascunho."""
    if not isinstance(dados, dict):
        raise ValueError("Informe os dados do contrato.")
    atual = atual or {}

    def escolha(nome, padrao=None):
        return dados[nome] if nome in dados else atual.get(nome, padrao)

    titulo = str(escolha("titulo") or "").strip()
    if not 1 <= len(titulo) <= 200:
        raise ValueError("O título do contrato deve ter de 1 a 200 caracteres.")

    if "valor_total" in dados:
        total = _reais_em_centavos(dados["valor_total"], "o valor total")
    else:
        total = atual.get("valor_total_centavos")
        if not total:
            raise ValueError("Informe o valor total do contrato.")
    if total <= 0:
        raise ValueError("O valor total deve ser maior que zero.")

    if "entrada" in dados:
        entrada = _reais_em_centavos(dados["entrada"], "a entrada", permitir_zero=True)
    else:
        entrada = atual.get("entrada_centavos") or 0
    if entrada >= total:
        raise ValueError("A entrada deve ser menor que o valor total.")

    if "parcelas" in dados:
        parcelas = _inteiro(dados["parcelas"], "o número de parcelas", 1, 120)
    else:
        parcelas = _inteiro(atual.get("parcelas") or 1, "o número de parcelas", 1, 120)

    primeiro_vencimento = _data_iso(escolha("primeiro_vencimento"), "o primeiro vencimento")
    entrada_vencimento = escolha("entrada_vencimento", None)
    entrada_vencimento = _data_iso(entrada_vencimento, "o vencimento da entrada") if entrada_vencimento else None
    if entrada == 0:
        entrada_vencimento = None

    exito_percentual = escolha("exito_percentual", None)
    if exito_percentual is not None:
        if isinstance(exito_percentual, bool) or not isinstance(exito_percentual, (int, float)) \
                or not math.isfinite(exito_percentual):
            raise ValueError("O êxito deve ser um percentual entre 0 e 100.")
        exito_percentual = float(exito_percentual)
        if not 0 <= exito_percentual <= 100:
            raise ValueError("O êxito deve ficar entre 0 e 100%.")

    exito_descricao = escolha("exito_descricao", None)
    exito_descricao = str(exito_descricao).strip() or None if exito_descricao is not None else None

    vigencia_inicio = escolha("vigencia_inicio", None)
    vigencia_fim = escolha("vigencia_fim", None)
    vigencia_inicio = _data_iso(vigencia_inicio, "o início da vigência") if vigencia_inicio else None
    vigencia_fim = _data_iso(vigencia_fim, "o fim da vigência") if vigencia_fim else None
    if vigencia_inicio and vigencia_fim and vigencia_inicio > vigencia_fim:
        raise ValueError("O início da vigência não pode ser depois do fim.")

    documento_id = escolha("documento_id", None)
    if documento_id is not None and (isinstance(documento_id, bool) or not isinstance(documento_id, int)
                                     or documento_id < 0):
        raise ValueError("Documento vinculado inválido.")

    cliente_id = escolha("cliente_id", None)
    if not isinstance(cliente_id, str) or not cliente_id.strip():
        raise ValueError("Informe o cliente do contrato.")
    cliente_id = cliente_id.strip()

    caso_id = escolha("caso_id", None)
    if caso_id is not None:
        if not isinstance(caso_id, str):
            raise ValueError("Processo/caso inválido.")
        caso_id = caso_id.strip() or None

    responsavel = str(escolha("responsavel") or "").strip()
    if not responsavel:
        raise ValueError("Informe o responsável pelo contrato.")
    responsavel = responsavel[:200]

    return {
        "cliente_id": cliente_id, "caso_id": caso_id, "documento_id": documento_id,
        "titulo": titulo, "valor_total_centavos": total, "entrada_centavos": entrada,
        "entrada_vencimento": entrada_vencimento, "parcelas": parcelas,
        "primeiro_vencimento": primeiro_vencimento, "exito_percentual": exito_percentual,
        "exito_descricao": exito_descricao, "vigencia_inicio": vigencia_inicio,
        "vigencia_fim": vigencia_fim, "responsavel": responsavel,
        "ativar_ao_assinar": _booleano(escolha("ativar_ao_assinar", False), "ativar_ao_assinar"),
        "recibo_automatico": _booleano(escolha("recibo_automatico", False), "recibo_automatico"),
        "lembrete_automatico": _booleano(escolha("lembrete_automatico", False), "lembrete_automatico"),
    }


class Repositorio:
    def __init__(self, caminho, gestao):
        self.caminho = str(caminho)
        self.gestao = gestao
        with self._abrir() as c:
            criar_tabelas(c)

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        try:
            with c:
                yield c
        finally:
            c.close()

    @staticmethod
    def _conferir_vinculos(conexao, cliente_id, caso_id) -> None:
        if not conexao.execute("SELECT 1 FROM clientes WHERE id = ?", (cliente_id,)).fetchone():
            raise ValueError("Cliente não encontrado.")
        if caso_id and not conexao.execute("SELECT 1 FROM casos WHERE id = ?", (caso_id,)).fetchone():
            raise ValueError("Processo/caso não encontrado.")

    def previa(self, dados: dict) -> list[dict]:
        """Calendário do contrato sem gravar nada: entrada (se houver) + parcelas mensais do saldo."""
        if not isinstance(dados, dict):
            raise ValueError("Informe os dados do contrato.")
        total = _reais_em_centavos(dados.get("valor_total"), "o valor total")
        entrada = _reais_em_centavos(dados.get("entrada", 0), "a entrada", permitir_zero=True)
        parcelas = _inteiro(dados.get("parcelas", 1), "o número de parcelas", 1, 120)
        primeiro_vencimento = _data_iso(dados.get("primeiro_vencimento"), "o primeiro vencimento")
        if entrada >= total:
            raise ValueError("A entrada deve ser menor que o valor total.")
        entrada_vencimento = dados.get("entrada_vencimento")
        entrada_vencimento = _data_iso(entrada_vencimento, "o vencimento da entrada") if entrada_vencimento else None

        itens = []
        numero = 1
        if entrada > 0:
            itens.append({
                "numero": numero, "rotulo": "Entrada",
                "vencimento": entrada_vencimento or primeiro_vencimento, "valor": entrada / 100,
            })
            numero += 1

        saldo = total - entrada
        base = saldo // parcelas
        valores = [base] * parcelas
        valores[-1] += saldo - base * parcelas
        for i, centavos in enumerate(valores):
            itens.append({
                "numero": numero + i, "rotulo": f"Parcela {i + 1}/{parcelas}",
                "vencimento": db._somar_meses_iso(primeiro_vencimento, i), "valor": centavos / 100,
            })
        return itens

    def criar(self, dados: dict, usuario: str) -> dict:
        if not isinstance(dados, dict):
            raise ValueError("Informe os dados do contrato.")
        dados = dict(dados)
        if not dados.get("responsavel"):
            dados["responsavel"] = usuario
        campos = _normalizar(dados)
        novo_id = uuid.uuid4().hex
        instante = _agora()
        with self._abrir() as c:
            self._conferir_vinculos(c, campos["cliente_id"], campos["caso_id"])
            c.execute(
                "INSERT INTO contratos_honorarios ("
                "id, cliente_id, caso_id, documento_id, titulo, valor_total_centavos, entrada_centavos, "
                "entrada_vencimento, parcelas, primeiro_vencimento, exito_percentual, exito_descricao, "
                "vigencia_inicio, vigencia_fim, situacao, responsavel, ativar_ao_assinar, recibo_automatico, "
                "lembrete_automatico, criado_em, atualizado_em, ativado_em"
                ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    novo_id, campos["cliente_id"], campos["caso_id"], campos["documento_id"], campos["titulo"],
                    campos["valor_total_centavos"], campos["entrada_centavos"], campos["entrada_vencimento"],
                    campos["parcelas"], campos["primeiro_vencimento"], campos["exito_percentual"],
                    campos["exito_descricao"], campos["vigencia_inicio"], campos["vigencia_fim"], "rascunho",
                    campos["responsavel"], campos["ativar_ao_assinar"], campos["recibo_automatico"],
                    campos["lembrete_automatico"], instante, instante, None,
                ),
            )
        return self.obter(novo_id)

    def listar(self, cliente_id=None, situacao=None) -> list[dict]:
        filtros, valores = [], []
        if cliente_id:
            filtros.append("cliente_id = ?")
            valores.append(cliente_id)
        if situacao:
            if situacao not in SITUACOES:
                raise ValueError("Situação inválida (use " + ", ".join(SITUACOES) + ").")
            filtros.append("situacao = ?")
            valores.append(situacao)
        onde = (" WHERE " + " AND ".join(filtros)) if filtros else ""
        with self._abrir() as c:
            linhas = c.execute(
                f"SELECT {_COLUNAS} FROM contratos_honorarios{onde} ORDER BY criado_em DESC, id DESC", valores,
            ).fetchall()
        return [_publico(_linha(linha)) for linha in linhas]

    def obter(self, contrato_id: str) -> dict:
        with self._abrir() as c:
            linha = c.execute(f"SELECT {_COLUNAS} FROM contratos_honorarios WHERE id = ?", (contrato_id,)).fetchone()
            if not linha:
                raise LookupError("Contrato não encontrado.")
            contrato = _publico(_linha(linha))
            lancamentos = [
                db._linha_lancamento(l) for l in c.execute(
                    f"SELECT {db.RegistroClientesCasos._COLUNAS_LANCAMENTO} FROM lancamentos_financeiros "
                    "WHERE contrato_id = ? ORDER BY vencimento, parcela_numero", (contrato_id,),
                )
            ]
        total = round(sum(l["valor"] for l in lancamentos), 2)
        pago = round(sum(l["valor"] for l in lancamentos if l["pago"]), 2)
        em_aberto = round(total - pago, 2)
        vencido = round(sum(
            l["valor"] for l in lancamentos if not l["pago"] and l["vencimento"][:10] < _hoje()
        ), 2)
        contrato["parcelas_lancamentos"] = lancamentos
        contrato["resumo"] = {
            "total": total, "pago": pago, "em_aberto": em_aberto, "vencido": vencido,
            "quitado": bool(lancamentos) and em_aberto <= 0,
        }
        return contrato

    @staticmethod
    def _conferir_travados(dados: dict, atual: dict) -> None:
        """Depois de ativado, valores, parcelas e vínculos não mudam (só título, vigência, êxito,
        documento e automações). Rejeita apenas quando o valor enviado difere do atual."""
        if "valor_total" in dados and _reais_em_centavos(dados["valor_total"], "o valor total") != atual["valor_total_centavos"]:
            raise ValueError("Depois de ativado, o valor do contrato não pode ser alterado.")
        if "entrada" in dados and _reais_em_centavos(dados["entrada"], "a entrada", permitir_zero=True) != atual["entrada_centavos"]:
            raise ValueError("Depois de ativado, a entrada do contrato não pode ser alterada.")
        if "parcelas" in dados and _inteiro(dados["parcelas"], "o número de parcelas", 1, 120) != atual["parcelas"]:
            raise ValueError("Depois de ativado, as parcelas do contrato não podem ser alteradas.")
        if "primeiro_vencimento" in dados and _data_iso(dados["primeiro_vencimento"], "o primeiro vencimento") != atual["primeiro_vencimento"]:
            raise ValueError("Depois de ativado, o primeiro vencimento não pode ser alterado.")
        if "entrada_vencimento" in dados:
            novo = _data_iso(dados["entrada_vencimento"], "o vencimento da entrada") if dados["entrada_vencimento"] else None
            if novo != atual["entrada_vencimento"]:
                raise ValueError("Depois de ativado, o vencimento da entrada não pode ser alterado.")
        for campo, rotulo in (("cliente_id", "o cliente"), ("caso_id", "o processo"), ("responsavel", "o responsável")):
            if campo in dados and (str(dados[campo] or "").strip() or None) != (atual[campo] or None):
                raise ValueError(f"Depois de ativado, {rotulo} do contrato não pode ser alterado.")

    def atualizar(self, contrato_id: str, dados: dict) -> dict:
        if not isinstance(dados, dict):
            raise ValueError("Informe os dados do contrato.")
        with self._abrir() as c:
            linha = c.execute(f"SELECT {_COLUNAS} FROM contratos_honorarios WHERE id = ?", (contrato_id,)).fetchone()
            if not linha:
                raise LookupError("Contrato não encontrado.")
            atual = _linha(linha)
            if atual["situacao"] in ("encerrado", "cancelado"):
                raise ConflitoContrato("Contrato encerrado ou cancelado não pode ser alterado.")
            if atual["situacao"] == "vigente":
                self._conferir_travados(dados, atual)
            campos = _normalizar(dados, atual)
            self._conferir_vinculos(c, campos["cliente_id"], campos["caso_id"])
            c.execute(
                "UPDATE contratos_honorarios SET cliente_id=?, caso_id=?, documento_id=?, titulo=?, "
                "valor_total_centavos=?, entrada_centavos=?, entrada_vencimento=?, parcelas=?, "
                "primeiro_vencimento=?, exito_percentual=?, exito_descricao=?, vigencia_inicio=?, vigencia_fim=?, "
                "responsavel=?, ativar_ao_assinar=?, recibo_automatico=?, lembrete_automatico=?, atualizado_em=? "
                "WHERE id=?",
                (
                    campos["cliente_id"], campos["caso_id"], campos["documento_id"], campos["titulo"],
                    campos["valor_total_centavos"], campos["entrada_centavos"], campos["entrada_vencimento"],
                    campos["parcelas"], campos["primeiro_vencimento"], campos["exito_percentual"],
                    campos["exito_descricao"], campos["vigencia_inicio"], campos["vigencia_fim"],
                    campos["responsavel"], campos["ativar_ao_assinar"], campos["recibo_automatico"],
                    campos["lembrete_automatico"], _agora(), contrato_id,
                ),
            )
        return self.obter(contrato_id)

    def ativar(self, contrato_id: str, usuario: str) -> dict:
        """Gera entrada e parcelas no Financeiro e marca o contrato como vigente, numa transação."""
        with self._abrir() as c:
            c.execute("BEGIN IMMEDIATE")
            linha = c.execute(f"SELECT {_COLUNAS} FROM contratos_honorarios WHERE id = ?", (contrato_id,)).fetchone()
            if not linha:
                raise LookupError("Contrato não encontrado.")
            atual = _linha(linha)
            if atual["situacao"] != "rascunho":
                raise ConflitoContrato("Só um contrato em rascunho pode ser ativado.")
            self._conferir_vinculos(c, atual["cliente_id"], atual["caso_id"])
            instante = _agora()
            if atual["entrada_centavos"] > 0:
                db.inserir_lancamentos(
                    c, tipo="HONORARIO",
                    vencimento=atual["entrada_vencimento"] or atual["primeiro_vencimento"],
                    total_centavos=atual["entrada_centavos"],
                    descricao=f"{atual['titulo']} (entrada)", recorrente=False,
                    caso_id=atual["caso_id"], cliente_id=atual["cliente_id"],
                    responsavel=atual["responsavel"], criado_em=instante, direcao="RECEITA",
                    parcelas=1, contrato_id=contrato_id, agrupar=False,
                )
            saldo = atual["valor_total_centavos"] - atual["entrada_centavos"]
            db.inserir_lancamentos(
                c, tipo="HONORARIO", vencimento=atual["primeiro_vencimento"],
                total_centavos=saldo, descricao=atual["titulo"], recorrente=False,
                caso_id=atual["caso_id"], cliente_id=atual["cliente_id"],
                responsavel=atual["responsavel"], criado_em=instante, direcao="RECEITA",
                parcelas=atual["parcelas"], contrato_id=contrato_id, agrupar=True,
            )
            c.execute(
                "UPDATE contratos_honorarios SET situacao='vigente', ativado_em=?, atualizado_em=? WHERE id=?",
                (instante, instante, contrato_id),
            )
        return self.obter(contrato_id)

    def cancelar(self, contrato_id: str) -> dict:
        """Cancela e apaga os lançamentos ainda não pagos e sem cobrança emitida."""
        with self._abrir() as c:
            c.execute("BEGIN IMMEDIATE")
            linha = c.execute("SELECT situacao FROM contratos_honorarios WHERE id = ?", (contrato_id,)).fetchone()
            if not linha:
                raise LookupError("Contrato não encontrado.")
            if linha["situacao"] not in ("rascunho", "vigente"):
                raise ConflitoContrato("Só um contrato em rascunho ou vigente pode ser cancelado.")
            c.execute(
                "UPDATE contratos_honorarios SET situacao='cancelado', atualizado_em=? WHERE id=?",
                (_agora(), contrato_id),
            )
            removidos = c.execute(
                "DELETE FROM lancamentos_financeiros WHERE contrato_id=? AND pago=0 "
                "AND COALESCE(asaas_cobranca_id, '') = ''", (contrato_id,),
            ).rowcount
            mantidos = c.execute(
                "SELECT count(*) FROM lancamentos_financeiros WHERE contrato_id = ?", (contrato_id,),
            ).fetchone()[0]
        return {"removidos": removidos, "mantidos": mantidos}

    def encerrar(self, contrato_id: str) -> dict:
        with self._abrir() as c:
            c.execute("BEGIN IMMEDIATE")
            linha = c.execute("SELECT situacao FROM contratos_honorarios WHERE id = ?", (contrato_id,)).fetchone()
            if not linha:
                raise LookupError("Contrato não encontrado.")
            if linha["situacao"] != "vigente":
                raise ConflitoContrato("Só um contrato vigente pode ser encerrado.")
            c.execute(
                "UPDATE contratos_honorarios SET situacao='encerrado', atualizado_em=? WHERE id=?",
                (_agora(), contrato_id),
            )
        return self.obter(contrato_id)
