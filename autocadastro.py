"""Autocadastro de processos como rascunho: para publicação de processo ainda não cadastrado cujas partes reconhecem
EXATAMENTE um cliente do escritório (polos.py), cria o processo com situação 'rascunho' para alguém confirmar.

Nunca cria cliente, nunca mexe em processo já cadastrado. Uma publicação (e um número de processo) gera no máximo um
rascunho; descartar não é desfeito pela rotina. Rascunho fica fora de listas, buscas e alertas (db.listar_casos).
"""
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import db
import notificacoes
import polos

log = logging.getLogger("cnj-processual")
_BRASILIA = timezone(timedelta(hours=-3))
LIMITE_TELA = 200


class Autocadastro:
    def __init__(self, caminho: str | Path):
        self.caminho = Path(caminho)
        with self._abrir() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS autocadastro_publicacoes (
                hash TEXT PRIMARY KEY, numero TEXT NOT NULL, caso_id TEXT, estado TEXT NOT NULL, motivo TEXT, criado_em TEXT NOT NULL)""")
            c.execute("CREATE TABLE IF NOT EXISTS autocadastro_simulacao (id INTEGER PRIMARY KEY CHECK (id=1), feita_em TEXT NOT NULL)")

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    # --- simulação obrigatória antes de ligar ---------------------------------------------------------------------
    def simulou_em(self) -> str | None:
        with self._abrir() as c:
            linha = c.execute("SELECT feita_em FROM autocadastro_simulacao WHERE id=1").fetchone()
        return linha[0] if linha else None

    def marcar_simulacao(self, agora: datetime) -> None:
        with self._abrir() as c:
            c.execute("INSERT INTO autocadastro_simulacao (id, feita_em) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET feita_em=excluded.feita_em",
                      (agora.isoformat(),))

    # --- candidatas -----------------------------------------------------------------------------------------------
    def criados_hoje(self, agora: datetime) -> int:
        inicio = agora.astimezone(_BRASILIA).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
        with self._abrir() as c:
            return c.execute("SELECT count(*) FROM autocadastro_publicacoes WHERE criado_em >= ?", (inicio,)).fetchone()[0]

    def _bloqueados(self) -> tuple[set[str], set[str]]:
        with self._abrir() as c:
            linhas = c.execute("SELECT hash, numero, estado FROM autocadastro_publicacoes").fetchall()
        return {h for h, _n, _e in linhas}, {n for _h, n, e in linhas if e == "descartado"}

    @staticmethod
    def _motivo(destinatarios: list[dict], cliente_id: str, indice: dict) -> str:
        for parte in destinatarios:
            if polos.cliente_da_parte(parte, indice) == cliente_id:
                return "CPF/CNPJ igual" if len(polos.so_digitos(parte.get("cpf_cnpj"))) in (11, 14) else "nome igual"
        return "nome igual"

    def candidatas(self, gestao, publicacoes, registro_monitoramentos) -> list[dict]:
        """Publicações que podem gerar rascunho agora, da mais antiga para a mais nova (uma por processo)."""
        indice = polos.montar_indice(gestao.listar_clientes())
        monitoramentos = registro_monitoramentos.carregar()
        vistos, numeros_descartados = self._bloqueados()
        resultado, numeros = [], set()
        for pub in sorted(publicacoes.listar(status="nao_tratada", limite=2000), key=lambda p: p.get("criado_em") or ""):
            if pub.get("caso_id") or pub["hash"] in vistos or not pub.get("numero_processo"):
                continue
            if not (monitoramentos.get(pub.get("monitoramento_id") or "", {}).get("criterio") or {}).get("numero_oab"):
                continue
            try:
                numero = db.normalizar_numero_processo([pub["numero_processo"]])[0]
            except (ValueError, IndexError):
                continue
            if numero in numeros or numero in numeros_descartados or gestao.caso_do_numero(numero):
                continue
            destinatarios = (pub.get("dados") or {}).get("destinatarios") or []
            destino = polos.destino_da_publicacao(destinatarios, indice)
            clientes = (destino or {}).get("clientes") or []
            if (destino or {}).get("tipo") != "cliente" or len(clientes) != 1:
                continue          # nenhum ou mais de um cliente reconhecido: segue na fila manual
            numeros.add(numero)
            resultado.append({"publicacao": pub, "numero": numero, "cliente_id": clientes[0]["id"], "cliente": clientes[0]["nome"],
                              "motivo": self._motivo(destinatarios, clientes[0]["id"], indice)})
        return resultado

    def simular(self, gestao, publicacoes, registro_monitoramentos, limite_dia: int, agora: datetime) -> dict:
        achadas = self.candidatas(gestao, publicacoes, registro_monitoramentos)
        restante = max(limite_dia - self.criados_hoje(agora), 0)
        self.marcar_simulacao(agora)
        return {"itens": [{"numero": a["numero"], "cliente": a["cliente"], "motivo": a["motivo"]} for a in achadas[:LIMITE_TELA]],
                "total": len(achadas), "criaria": min(len(achadas), restante), "limite_dia": limite_dia, "restante_hoje": restante}

    # --- execução -------------------------------------------------------------------------------------------------
    def executar(self, gestao, publicacoes, registro_monitoramentos, criar, limite_dia: int, agora: datetime) -> dict:
        """`criar(publicacao, cliente_id) -> (caso, erro)` é injetada pelo server (monta caso e capa em rascunho)."""
        restante = max(limite_dia - self.criados_hoje(agora), 0)
        criados = falhas = 0
        avisos = notificacoes.Repositorio(gestao.caminho, agora=lambda: agora)
        for cand in self.candidatas(gestao, publicacoes, registro_monitoramentos)[:restante]:
            hash_pub = cand["publicacao"]["hash"]
            with self._abrir() as c:   # reserva: repetir ou concorrer não duplica
                reservou = c.execute("INSERT OR IGNORE INTO autocadastro_publicacoes (hash, numero, estado, motivo, criado_em) VALUES (?,?,?,?,?)",
                                     (hash_pub, cand["numero"], "criado", cand["motivo"], agora.isoformat())).rowcount
            if not reservou:
                continue
            try:
                caso, erro = criar(cand["publicacao"], cand["cliente_id"])
            except Exception:
                log.exception("Autocadastro: falha ao criar rascunho de %s", cand["numero"])
                caso, erro = None, "falha"
            if erro or not caso:
                self._desfazer_parcial(gestao, hash_pub, cand["numero"])
                falhas += 1
                continue
            with self._abrir() as c:
                c.execute("UPDATE autocadastro_publicacoes SET caso_id=? WHERE hash=?", (caso["id"], hash_pub))
            for usuario in self._destinatarios(gestao, caso):
                avisos.registrar_processo_rascunho(caso["id"], usuario)
            criados += 1
        return {"criados": criados, "falhas": falhas}

    def _desfazer_parcial(self, gestao, hash_pub: str, numero: str) -> None:
        """Falha no meio: remove o que sobrou (só rascunho) e libera a publicação para uma próxima rodada."""
        caso_id = gestao.caso_do_numero(numero)
        if caso_id and (gestao.obter_caso(caso_id) or {}).get("status") == "rascunho":
            gestao.excluir_caso(caso_id)
        with self._abrir() as c:
            c.execute("DELETE FROM autocadastro_publicacoes WHERE hash=? AND caso_id IS NULL", (hash_pub,))

    @staticmethod
    def _destinatarios(gestao, caso: dict) -> list[str]:
        usuarios = db.RegistroUsuarios(gestao.caminho).carregar()
        ativos = [n for n, u in usuarios.items() if not u.get("revogado") and u.get("status", "ativo") == "ativo"]
        if caso.get("responsavel") in ativos:
            return [caso["responsavel"]]
        return [n for n in ativos if usuarios[n].get("nivel_acesso") == "administrador"]

    # --- tela "Processos a confirmar" -----------------------------------------------------------------------------
    def listar(self, gestao) -> list[dict]:
        nomes = {c["id"]: c.get("nome") for c in gestao.listar_clientes()}
        with self._abrir() as c:
            origem = {r[0]: (r[1], r[2]) for r in c.execute("SELECT caso_id, hash, motivo FROM autocadastro_publicacoes WHERE estado='criado' AND caso_id IS NOT NULL")}
        return [{"id": caso["id"], "titulo": caso.get("titulo"), "responsavel": caso.get("responsavel"), "cliente_id": caso["cliente_id"],
                 "cliente": nomes.get(caso["cliente_id"], ""), "processos": caso.get("processos") or [], "criado_em": caso.get("criado_em"),
                 "publicacao": (origem.get(caso["id"]) or (None, None))[0], "motivo": (origem.get(caso["id"]) or (None, None))[1]}
                for caso in gestao.listar_casos("rascunhos")]

    def confirmar(self, gestao, caso_id: str) -> bool:
        if not gestao.confirmar_rascunho(caso_id):
            return False
        with self._abrir() as c:
            c.execute("UPDATE autocadastro_publicacoes SET estado='confirmado' WHERE caso_id=?", (caso_id,))
        return True

    def descartar(self, gestao, caso_id: str) -> bool:
        """Apaga o rascunho (as publicações voltam à fila sem vínculo) e lembra que foi descartado, para não recriar."""
        caso = gestao.obter_caso(caso_id)
        if not caso or caso.get("status") != "rascunho":
            return False
        with self._abrir() as c:
            c.execute("UPDATE autocadastro_publicacoes SET estado='descartado' WHERE caso_id=?", (caso_id,))
        gestao.excluir_caso(caso_id)
        return True
