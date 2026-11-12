"""Horas trabalhadas por processo: lançamento manual, cronômetro, valor por hora, relatório e faturamento.

Cada lançamento de horas pertence a um processo e a uma pessoa. O valor por hora vem de uma tarifa por
pessoa (definida pelo administrador) e fica gravado no lançamento no momento em que ele é criado, para que
mudar a tarifa depois não altere horas antigas; também pode ser informado à mão em cada lançamento.
Horas faturáveis podem virar um lançamento de honorário no Financeiro; depois disso ficam travadas.
"""
import logging
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

log = logging.getLogger("cnj-processual")

BRASILIA = timezone(timedelta(hours=-3))
MAX_MINUTOS = 24 * 60
MAX_FATURAR = 500
RESERVA_SEGUNDOS = 600  # reserva de horas durante o faturamento; depois disso considera-se abandonada
_RESERVA = "pendente:"


class ConflitoHoras(ValueError):
    """Estado incompatível (horas já faturadas, cronômetro já ligado...). Vira HTTP 409."""


class ProibidoHoras(PermissionError):
    """Horas de outra pessoa. Vira HTTP 403."""


def _agora():
    return datetime.now(timezone.utc)


def _data_iso(valor, campo="a data") -> str:
    if isinstance(valor, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        try:
            return date.fromisoformat(valor).isoformat()
        except ValueError:
            pass
    raise ValueError(f"Informe {campo} no formato AAAA-MM-DD.")


def _minutos(valor) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int) or not 1 <= valor <= MAX_MINUTOS:
        raise ValueError(f"Informe o tempo em minutos, de 1 a {MAX_MINUTOS} (24 horas).")
    return valor


def _centavos(valor) -> int:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not 0 < valor <= 100000:
        raise ValueError("Informe o valor por hora, maior que zero e até R$ 100.000,00.")
    return round(valor * 100)


def _descricao(valor) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValueError("A descrição deve ser um texto.")
    valor = " ".join(valor.split())
    if len(valor) > 300:
        raise ValueError("A descrição passa de 300 caracteres.")
    return valor or None


def valor_em_centavos(minutos: int, valor_hora_centavos: int | None) -> int | None:
    """Valor de um lançamento (meio centavo arredonda para cima)."""
    return None if valor_hora_centavos is None else (minutos * valor_hora_centavos + 30) // 60


_COLUNAS = ("h.id, h.caso_id, c.titulo, c.cliente_id, h.usuario, h.data, h.minutos, h.descricao, h.faturavel, "
            "h.valor_hora_centavos, h.lancamento_id, l.id, h.criado_em")
_JOIN = (" FROM horas_lancamentos h LEFT JOIN casos c ON c.id = h.caso_id "
         "LEFT JOIN lancamentos_financeiros l ON l.id = h.lancamento_id")


def _lancamento(linha) -> dict:
    (hid, caso_id, titulo, cliente_id, usuario, data, minutos, descricao, faturavel, vh, lanc_ref, lanc_existe, criado_em) = linha
    valor = valor_em_centavos(minutos, vh) if faturavel else None
    return {"id": hid, "caso_id": caso_id, "caso_titulo": titulo, "cliente_id": cliente_id, "usuario": usuario,
            "data": data, "minutos": minutos, "descricao": descricao, "faturavel": bool(faturavel),
            "valor_hora": None if vh is None else vh / 100, "valor": None if valor is None else valor / 100,
            "lancamento_id": lanc_existe,  # só quando o lançamento ainda existe
            "faturado": lanc_existe is not None, "criado_em": criado_em}


class Repositorio:
    def __init__(self, caminho):
        self.caminho = caminho
        with self.abrir() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS horas_lancamentos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, caso_id TEXT NOT NULL, usuario TEXT NOT NULL,
                    data TEXT NOT NULL, minutos INTEGER NOT NULL, descricao TEXT,
                    faturavel INTEGER NOT NULL DEFAULT 1, valor_hora_centavos INTEGER, lancamento_id TEXT,
                    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS horas_lancamentos_data ON horas_lancamentos(data);
                CREATE INDEX IF NOT EXISTS horas_lancamentos_caso ON horas_lancamentos(caso_id);
                CREATE TABLE IF NOT EXISTS horas_tarifas (
                    usuario TEXT PRIMARY KEY, valor_hora_centavos INTEGER NOT NULL, atualizado_em TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS horas_cronometro (
                    usuario TEXT PRIMARY KEY, caso_id TEXT NOT NULL, descricao TEXT, inicio TEXT NOT NULL);
            """)

    @contextmanager
    def abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    # -- tarifa por pessoa -------------------------------------------------------------------------
    def tarifa(self, usuario: str) -> int | None:
        with self.abrir() as c:
            linha = c.execute("SELECT valor_hora_centavos FROM horas_tarifas WHERE usuario = ?", (usuario,)).fetchone()
        return linha[0] if linha else None

    def listar_tarifas(self) -> dict[str, float]:
        with self.abrir() as c:
            return {u: v / 100 for u, v in c.execute("SELECT usuario, valor_hora_centavos FROM horas_tarifas ORDER BY usuario")}

    def definir_tarifa(self, usuario: str, valor_hora, agora=_agora) -> float | None:
        """Define (ou, com None, remove) o valor por hora de uma pessoa. Não altera horas já lançadas."""
        with self.abrir() as c:
            if valor_hora is None:
                c.execute("DELETE FROM horas_tarifas WHERE usuario = ?", (usuario,))
                return None
            centavos = _centavos(valor_hora)
            c.execute("INSERT INTO horas_tarifas (usuario, valor_hora_centavos, atualizado_em) VALUES (?, ?, ?) "
                      "ON CONFLICT(usuario) DO UPDATE SET valor_hora_centavos = excluded.valor_hora_centavos, atualizado_em = excluded.atualizado_em",
                      (usuario, centavos, agora().astimezone(timezone.utc).isoformat(timespec="seconds")))
        return centavos / 100

    # -- lançamentos -------------------------------------------------------------------------------
    def obter(self, horas_id: int) -> dict | None:
        with self.abrir() as c:
            linha = c.execute(f"SELECT {_COLUNAS}{_JOIN} WHERE h.id = ?", (horas_id,)).fetchone()
        return _lancamento(linha) if linha else None

    def _conferir_caso(self, c, caso_id):
        if not isinstance(caso_id, str) or not c.execute("SELECT 1 FROM casos WHERE id = ?", (caso_id,)).fetchone():
            raise LookupError("Processo não encontrado.")

    def criar(self, *, caso_id, usuario, data, minutos, descricao=None, faturavel=True, valor_hora=None, agora=_agora) -> dict:
        data, minutos, descricao = _data_iso(data), _minutos(minutos), _descricao(descricao)
        if not isinstance(faturavel, bool):
            raise ValueError("O campo faturável deve ser verdadeiro ou falso.")
        if date.fromisoformat(data) > agora().astimezone(BRASILIA).date():
            raise ValueError("A data não pode ser futura.")
        instante = agora().astimezone(timezone.utc).isoformat(timespec="seconds")
        with self.abrir() as c:
            self._conferir_caso(c, caso_id)
            vh = _centavos(valor_hora) if valor_hora is not None else self.tarifa(usuario)
            novo = c.execute("INSERT INTO horas_lancamentos (caso_id, usuario, data, minutos, descricao, faturavel, valor_hora_centavos, criado_em, atualizado_em) "
                             "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (caso_id, usuario, data, minutos, descricao, int(faturavel), vh, instante, instante)).lastrowid
        return self.obter(novo)

    def _editavel(self, horas_id, ator, administrador):
        atual = self.obter(horas_id)
        if atual is None:
            raise LookupError("Horas não encontradas.")
        if atual["usuario"] != ator and not administrador:
            raise ProibidoHoras("Só quem lançou as horas (ou um administrador) pode alterá-las.")
        if atual["faturado"]:
            raise ConflitoHoras("Horas já faturadas não podem ser alteradas nem excluídas. Exclua antes o lançamento no Financeiro.")
        return atual

    def atualizar(self, horas_id: int, dados: dict, ator: str, administrador=False, agora=_agora) -> dict:
        atual = self._editavel(horas_id, ator, administrador)
        if not isinstance(dados, dict):
            raise ValueError("Informe um objeto JSON.")
        novo = {"caso_id": dados.get("caso_id", atual["caso_id"]), "data": _data_iso(dados.get("data", atual["data"])),
                "minutos": _minutos(dados.get("minutos", atual["minutos"])), "descricao": _descricao(dados.get("descricao", atual["descricao"])),
                "faturavel": dados.get("faturavel", atual["faturavel"])}
        if not isinstance(novo["faturavel"], bool):
            raise ValueError("O campo faturável deve ser verdadeiro ou falso.")
        if date.fromisoformat(novo["data"]) > agora().astimezone(BRASILIA).date():
            raise ValueError("A data não pode ser futura.")
        with self.abrir() as c:
            self._conferir_caso(c, novo["caso_id"])
            if "valor_hora" in dados:
                vh = _centavos(dados["valor_hora"]) if dados["valor_hora"] is not None else self.tarifa(atual["usuario"])
            else:
                vh = None if atual["valor_hora"] is None else round(atual["valor_hora"] * 100)
            c.execute("UPDATE horas_lancamentos SET caso_id=?, data=?, minutos=?, descricao=?, faturavel=?, valor_hora_centavos=?, atualizado_em=? WHERE id=?",
                      (novo["caso_id"], novo["data"], novo["minutos"], novo["descricao"], int(novo["faturavel"]), vh,
                       agora().astimezone(timezone.utc).isoformat(timespec="seconds"), horas_id))
        return self.obter(horas_id)

    def excluir(self, horas_id: int, ator: str, administrador=False) -> None:
        self._editavel(horas_id, ator, administrador)
        with self.abrir() as c:
            c.execute("DELETE FROM horas_lancamentos WHERE id = ?", (horas_id,))

    def listar(self, *, de=None, ate=None, usuario=None, caso_id=None, cliente_id=None, faturavel=None, faturado=None, limite=5000) -> list[dict]:
        filtros, valores = [], []
        if de:
            filtros.append("h.data >= ?"); valores.append(_data_iso(de, "a data inicial"))
        if ate:
            filtros.append("h.data <= ?"); valores.append(_data_iso(ate, "a data final"))
        for campo, valor in (("h.usuario", usuario), ("h.caso_id", caso_id), ("c.cliente_id", cliente_id)):
            if valor:
                filtros.append(f"{campo} = ?"); valores.append(valor)
        if faturavel is not None:
            filtros.append("h.faturavel = ?"); valores.append(int(bool(faturavel)))
        if faturado is not None:
            filtros.append("l.id IS NOT NULL" if faturado else "l.id IS NULL")
        onde = (" WHERE " + " AND ".join(filtros)) if filtros else ""
        with self.abrir() as c:
            linhas = c.execute(f"SELECT {_COLUNAS}{_JOIN}{onde} ORDER BY h.data DESC, h.id DESC LIMIT ?", (*valores, limite)).fetchall()
        return [_lancamento(l) for l in linhas]

    @staticmethod
    def totais(itens: list[dict]) -> dict:
        """Tempo total, tempo faturável e valores (em reais). `a_faturar` = faturável, ainda não faturado e com valor/hora."""
        faturaveis = [i for i in itens if i["faturavel"]]
        com_valor = [i for i in faturaveis if i["valor"] is not None]
        centavos = lambda lista: sum(round(i["valor"] * 100) for i in lista)
        return {"minutos": sum(i["minutos"] for i in itens), "minutos_faturaveis": sum(i["minutos"] for i in faturaveis),
                "valor": centavos(com_valor) / 100, "a_faturar": centavos([i for i in com_valor if not i["faturado"]]) / 100,
                "faturado": centavos([i for i in com_valor if i["faturado"]]) / 100,
                "sem_valor_hora": sum(1 for i in faturaveis if i["valor"] is None)}

    def relatorio(self, **filtros) -> dict:
        itens = self.listar(**filtros)
        grupos = {"usuarios": {}, "processos": {}}
        for i in itens:
            for chave, nome in (("usuarios", i["usuario"]), ("processos", i["caso_id"])):
                g = grupos[chave].setdefault(nome, {"itens": [], "titulo": i["caso_titulo"]})
                g["itens"].append(i)
        saida = {"totais": self.totais(itens)}
        saida["por_usuario"] = [{"usuario": u, **self.totais(g["itens"])} for u, g in sorted(grupos["usuarios"].items())]
        saida["por_processo"] = sorted(
            [{"caso_id": k, "caso_titulo": g["titulo"], **self.totais(g["itens"])} for k, g in grupos["processos"].items()],
            key=lambda x: (-x["minutos"], x["caso_id"]))
        return saida

    # -- cronômetro --------------------------------------------------------------------------------
    def cronometro(self, usuario: str) -> dict | None:
        with self.abrir() as c:
            linha = c.execute("SELECT t.caso_id, k.titulo, t.descricao, t.inicio FROM horas_cronometro t "
                              "LEFT JOIN casos k ON k.id = t.caso_id WHERE t.usuario = ?", (usuario,)).fetchone()
        return {"caso_id": linha[0], "caso_titulo": linha[1], "descricao": linha[2], "inicio": linha[3]} if linha else None

    def iniciar_cronometro(self, usuario: str, caso_id, descricao=None, agora=_agora) -> dict:
        descricao = _descricao(descricao)
        try:
            with self.abrir() as c:
                self._conferir_caso(c, caso_id)
                c.execute("INSERT INTO horas_cronometro (usuario, caso_id, descricao, inicio) VALUES (?, ?, ?, ?)",
                          (usuario, caso_id, descricao, agora().astimezone(timezone.utc).isoformat(timespec="seconds")))
        except sqlite3.IntegrityError:
            raise ConflitoHoras("Você já tem um cronômetro em andamento. Pare ou descarte antes de iniciar outro.") from None
        return self.cronometro(usuario)

    def parar_cronometro(self, usuario: str, faturavel=True, agora=_agora) -> dict:
        """Encerra o cronômetro e lança as horas (arredondadas para cima, mínimo de 1 minuto, máximo de 24 h)."""
        with self.abrir() as c:
            c.execute("BEGIN IMMEDIATE")
            t = c.execute("SELECT caso_id, descricao, inicio FROM horas_cronometro WHERE usuario = ?", (usuario,)).fetchone()
            if t is None:
                raise LookupError("Não há cronômetro em andamento.")
            c.execute("DELETE FROM horas_cronometro WHERE usuario = ?", (usuario,))
        inicio = datetime.fromisoformat(t[2])
        segundos = max(0, (agora() - inicio).total_seconds())
        minutos = max(1, -(-int(segundos) // 60))
        limitado = minutos > MAX_MINUTOS
        try:
            criado = self.criar(caso_id=t[0], usuario=usuario, data=inicio.astimezone(BRASILIA).date().isoformat(),
                                minutos=min(minutos, MAX_MINUTOS), descricao=t[1], faturavel=faturavel, agora=agora)
        except Exception:
            # não perde o tempo medido: devolve o cronômetro
            with self.abrir() as c:
                c.execute("INSERT OR IGNORE INTO horas_cronometro (usuario, caso_id, descricao, inicio) VALUES (?, ?, ?, ?)", (usuario, *t))
            raise
        return {**criado, "limitado": limitado}

    def descartar_cronometro(self, usuario: str) -> bool:
        with self.abrir() as c:
            return c.execute("DELETE FROM horas_cronometro WHERE usuario = ?", (usuario,)).rowcount > 0

    # -- faturamento -------------------------------------------------------------------------------
    def _liberar(self, ids, reserva):
        with self.abrir() as c:
            c.execute(f"UPDATE horas_lancamentos SET lancamento_id = NULL WHERE lancamento_id = ? AND id IN ({','.join('?' * len(ids))})", (reserva, *ids))

    def faturar(self, ids, ator: str, gestao, vencimento, descricao=None, agora=_agora) -> dict:
        """Cria UM lançamento de honorário no Financeiro com as horas escolhidas (de um só processo).
        Reserva as horas antes de criar o lançamento, então duas pessoas faturando ao mesmo tempo nunca
        cobram a mesma hora duas vezes; se algo falhar, a reserva é desfeita."""
        if not isinstance(ids, list) or not ids or len(ids) > MAX_FATURAR or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
            raise ValueError(f"Escolha de 1 a {MAX_FATURAR} lançamentos de horas.")
        ids = sorted(set(ids))
        vencimento = _data_iso(vencimento, "o vencimento")
        descricao = _descricao(descricao)
        reserva = f"{_RESERVA}{int(time.time())}"
        marcas = ",".join("?" * len(ids))
        with self.abrir() as c:
            c.execute("BEGIN IMMEDIATE")
            linhas = c.execute(f"SELECT h.id, h.caso_id, h.minutos, h.faturavel, h.valor_hora_centavos, h.lancamento_id, l.id, h.data "
                               f"FROM horas_lancamentos h LEFT JOIN lancamentos_financeiros l ON l.id = h.lancamento_id WHERE h.id IN ({marcas})", ids).fetchall()
            if len(linhas) != len(ids):
                raise LookupError("Alguma das horas escolhidas não foi encontrada.")
            if any(not l[3] for l in linhas):
                raise ValueError("Há horas marcadas como não faturáveis na seleção.")
            if any(l[6] is not None for l in linhas):
                raise ConflitoHoras("Há horas que já foram faturadas na seleção.")
            for l in linhas:
                ref = l[5] or ""
                if ref.startswith(_RESERVA) and time.time() - int(ref[len(_RESERVA):] or 0) < RESERVA_SEGUNDOS:
                    raise ConflitoHoras("Há horas sendo faturadas neste momento. Atualize a lista e tente de novo.")
            if len({l[1] for l in linhas}) != 1:
                raise ValueError("Fature um processo por vez: a seleção tem horas de processos diferentes.")
            if any(l[4] is None for l in linhas):
                raise ValueError("Há horas sem valor por hora. Defina o valor por hora da pessoa ou informe o valor no lançamento.")
            c.execute(f"UPDATE horas_lancamentos SET lancamento_id = ? WHERE id IN ({marcas})", (reserva, *ids))
        caso_id = linhas[0][1]
        total = sum(valor_em_centavos(l[2], l[4]) for l in linhas)
        minutos = sum(l[2] for l in linhas)
        try:
            caso = gestao.obter_caso(caso_id)
            if not caso or not caso.get("cliente_id"):
                raise ValueError("O processo não tem um cliente para receber o lançamento.")
            if total <= 0:
                raise ValueError("O valor total das horas é zero.")
            datas = sorted(l[7] for l in linhas)
            periodo = datas[0] if datas[0] == datas[-1] else f"{datas[0]} a {datas[-1]}"
            texto = descricao or f"Honorários por hora — {caso.get('titulo') or 'processo'} — {minutos // 60}h{minutos % 60:02d}min ({periodo})"
            lancamento = gestao.criar_lancamento("HONORARIO", vencimento, total / 100, texto, False, caso_id, caso["cliente_id"], ator, agora)
        except Exception:
            self._liberar(ids, reserva)
            raise
        try:
            with self.abrir() as c:
                c.execute(f"UPDATE horas_lancamentos SET lancamento_id = ? WHERE lancamento_id = ? AND id IN ({marcas})", (lancamento["id"], reserva, *ids))
        except Exception:
            log.exception("Horas: falha ao vincular as horas ao lançamento %s; desfazendo o lançamento", lancamento["id"])
            gestao.excluir_lancamento(lancamento["id"])
            self._liberar(ids, reserva)
            raise
        return {"lancamento": lancamento, "horas": len(ids), "minutos": minutos, "valor": total / 100}
