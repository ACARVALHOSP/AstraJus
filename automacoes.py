"""Configuração das rotinas automáticas: interruptor, parâmetros e histórico de alterações.

O catálogo (`CATALOGO`) lista as rotinas que o agendador conhece, com os padrões. Só o que o administrador
muda fica gravado em `automacoes_config`; sem registro vale o padrão do catálogo (rotina ligada, parâmetros
padrão). Toda alteração entra em `automacoes_config_historico` (quem, quando, antes e depois).

A execução em si continua em `monitoramento_runtime.Repositorio.executar`, que consulta `ativa`.
As rotinas novas (a partir da Onda 1) moram aqui também, para não crescer o `server.py`.
"""
import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

import db
import emails_html
import notificacoes

log = logging.getLogger("cnj-processual")

# Cada parâmetro: {"tipo": "int", "rotulo", "minimo", "maximo", "padrao"}. `ativo_por_padrao` (omitido = ligada):
# as rotinas que já existiam seguem ligadas; as novas nascem desligadas até um administrador ligar.
CATALOGO: dict[str, dict] = {
    "monitoramentos": {
        "nome": "Monitoramento de publicações",
        "descricao": "Busca publicações novas dos processos e OABs monitorados e avisa por e-mail.",
        "parametros": {},
    },
    "captura_oab": {
        "nome": "Captura por OAB",
        "descricao": "Captura as publicações de cada OAB cadastrada, uma vez por dia.",
        "parametros": {},
    },
    "movimentos": {
        "nome": "Movimentos dos processos",
        "descricao": "Atualiza a capa e os movimentos dos processos cadastrados (DataJud e DJEN).",
        "parametros": {},
    },
    "alertas_prazo": {
        "nome": "Alertas de prazos e audiências",
        "descricao": "Avisa responsáveis a 5, 2 e 1 dia, no dia e após o vencimento; escala aos administradores se ninguém confirma ciência.",
        "parametros": {},
    },
    "triagem_publicacoes": {
        "nome": "Triagem de publicações",
        "descricao": "Classifica as publicações novas (tipo de ato e prazo sugerido), quando há classificador configurado.",
        "parametros": {},
    },
    "processo_parado": {
        "nome": "Processo parado",
        "descricao": "Avisa o responsável (ou os administradores) quando um processo ativo fica muitos dias sem movimentação. "
                     "Usa a última movimentação que o sistema já conhece (andamento do tribunal ou publicação); não consulta nada novo.",
        "ativo_por_padrao": False,
        "parametros": {
            "dias": {"tipo": "int", "rotulo": "Dias sem movimentação", "minimo": 15, "maximo": 365, "padrao": 60},
        },
    },
}


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validar_parametros(catalogo_rotina: dict, enviados) -> dict:
    """Confere os parâmetros enviados contra o catálogo e devolve só os informados, já convertidos."""
    if not isinstance(enviados, dict):
        raise ValueError("Informe os parâmetros como um objeto.")
    definidos = catalogo_rotina["parametros"]
    resultado = {}
    for nome, valor in enviados.items():
        regra = definidos.get(nome)
        if regra is None:
            raise ValueError(f"Parâmetro desconhecido: {nome}.")
        rotulo = regra.get("rotulo", nome)
        if regra["tipo"] == "int":
            if isinstance(valor, bool) or not isinstance(valor, int):
                raise ValueError(f"{rotulo}: informe um número inteiro.")
            if not regra["minimo"] <= valor <= regra["maximo"]:
                raise ValueError(f"{rotulo}: informe um valor entre {regra['minimo']} e {regra['maximo']}.")
        else:  # pragma: no cover - só "int" existe por enquanto
            raise ValueError(f"{rotulo}: tipo de parâmetro não suportado.")
        resultado[nome] = valor
    return resultado


class Repositorio:
    def __init__(self, caminho, catalogo: dict[str, dict] | None = None):
        self.caminho = caminho
        self.catalogo = CATALOGO if catalogo is None else catalogo
        with self._abrir() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS automacoes_config (
                    chave TEXT PRIMARY KEY, ativo INTEGER NOT NULL DEFAULT 1,
                    parametros TEXT NOT NULL DEFAULT '{}', atualizado_em TEXT NOT NULL, atualizado_por TEXT);
                CREATE TABLE IF NOT EXISTS automacoes_silenciados (
                    rotina TEXT NOT NULL, caso_id TEXT NOT NULL, criado_em TEXT NOT NULL, criado_por TEXT,
                    PRIMARY KEY (rotina, caso_id));
                CREATE TABLE IF NOT EXISTS automacoes_config_historico (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrido_em TEXT NOT NULL, ator TEXT NOT NULL,
                    chave TEXT NOT NULL, antes TEXT NOT NULL, depois TEXT NOT NULL);
            """)

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        try:
            with c:
                yield c
        finally:
            c.close()

    def _padrao(self, chave: str) -> dict:
        definicao = self.catalogo[chave]
        return {"ativo": definicao.get("ativo_por_padrao", True),
                "parametros": {n: r["padrao"] for n, r in definicao["parametros"].items()}}

    def estado(self, chave: str) -> dict:
        """Estado efetivo da rotina: o gravado sobre o padrão do catálogo."""
        if chave not in self.catalogo:
            raise LookupError("Rotina desconhecida.")
        efetivo = self._padrao(chave)
        with self._abrir() as c:
            linha = c.execute("SELECT ativo, parametros FROM automacoes_config WHERE chave=?", (chave,)).fetchone()
        if linha:
            efetivo["ativo"] = bool(linha[0])
            efetivo["parametros"].update(json.loads(linha[1]))
        return efetivo

    def ativa(self, chave: str) -> bool:
        """Rotina desconhecida do catálogo segue ligada: o catálogo é para configurar, não para impedir."""
        if chave not in self.catalogo:
            return True
        return self.estado(chave)["ativo"]

    def definir(self, chave: str, ator: str, ativo=None, parametros=None) -> dict:
        """Liga/desliga e/ou altera parâmetros. Só registra (e grava histórico) quando algo muda de fato."""
        if chave not in self.catalogo:
            raise LookupError("Rotina desconhecida.")
        if ativo is not None and not isinstance(ativo, bool):
            raise ValueError("Informe 'ativo' como verdadeiro ou falso.")
        novos = _validar_parametros(self.catalogo[chave], parametros) if parametros is not None else {}
        antes = self.estado(chave)
        depois = {"ativo": antes["ativo"] if ativo is None else ativo, "parametros": {**antes["parametros"], **novos}}
        if depois == antes:
            return antes
        agora = _agora()
        with self._abrir() as c:
            c.execute(
                "INSERT INTO automacoes_config (chave, ativo, parametros, atualizado_em, atualizado_por) VALUES (?,?,?,?,?) "
                "ON CONFLICT(chave) DO UPDATE SET ativo=excluded.ativo, parametros=excluded.parametros, "
                "atualizado_em=excluded.atualizado_em, atualizado_por=excluded.atualizado_por",
                (chave, int(depois["ativo"]), json.dumps(depois["parametros"], ensure_ascii=False), agora, ator))
            c.execute("INSERT INTO automacoes_config_historico (ocorrido_em, ator, chave, antes, depois) VALUES (?,?,?,?,?)",
                      (agora, ator, chave, json.dumps(antes, ensure_ascii=False), json.dumps(depois, ensure_ascii=False)))
        return depois

    def silenciados(self, rotina: str) -> set[str]:
        """Processos em que a pessoa pediu para a rotina não avisar."""
        with self._abrir() as c:
            return {linha[0] for linha in c.execute("SELECT caso_id FROM automacoes_silenciados WHERE rotina=?", (rotina,))}

    def silenciar(self, rotina: str, caso_id: str, ator: str, silenciar: bool = True) -> bool:
        """Liga/desliga o silêncio de um processo. Devolve o estado final (True = silenciado)."""
        if rotina not in self.catalogo:
            raise LookupError("Rotina desconhecida.")
        with self._abrir() as c:
            if silenciar:
                c.execute("INSERT OR IGNORE INTO automacoes_silenciados (rotina, caso_id, criado_em, criado_por) VALUES (?,?,?,?)",
                          (rotina, caso_id, _agora(), ator))
            else:
                c.execute("DELETE FROM automacoes_silenciados WHERE rotina=? AND caso_id=?", (rotina, caso_id))
        return silenciar

    def historico(self, limite: int = 20) -> list[dict]:
        with self._abrir() as c:
            linhas = c.execute("SELECT ocorrido_em, ator, chave, antes, depois FROM automacoes_config_historico "
                               "ORDER BY id DESC LIMIT ?", (limite,)).fetchall()
        return [{"ocorrido_em": o, "ator": a, "chave": k, "antes": json.loads(b), "depois": json.loads(d)}
                for o, a, k, b, d in linhas]

    def listar(self, execucoes) -> list[dict]:
        """Catálogo completo com estado e última execução. `execucoes(chave)` devolve o histórico recente
        da rotina (mais nova primeiro), no formato de `monitoramento_runtime.Repositorio.historico`."""
        itens = []
        for chave, definicao in self.catalogo.items():
            ultima = (execucoes(chave) or [None])[0]
            itens.append({
                "chave": chave, "nome": definicao["nome"], "descricao": definicao["descricao"],
                "parametros_definidos": definicao["parametros"],
                **self.estado(chave), "ultima_execucao": ultima,
            })
        return itens


# --- Processo parado ---------------------------------------------------------------------------------

_BRASILIA = timezone(timedelta(hours=-3))


def _encerrado_no_tribunal(capa: dict | None) -> bool:
    """Processo baixado ou arquivado, pelo que a capa diz (fase ou situação)."""
    if not capa:
        return False
    texto = f"{capa.get('fase') or ''} {capa.get('status_processo') or ''}".lower()
    return "arquiv" in texto or "baix" in texto


def processos_parados(gestao, dias: int, silenciados: set[str], hoje: date) -> list[dict]:
    """Casos ativos cuja última movimentação conhecida (andamento na capa ou publicação vinculada, a mesma
    que a lista de Processos mostra) tem `dias` ou mais. Sem movimentação conhecida, caso silenciado e caso
    cujos processos estão todos baixados/arquivados ficam de fora.

    `rodada` = quantos períodos de `dias` já se passaram além do primeiro: o aviso se repete uma vez a cada
    novo período em que o processo continua parado, e recomeça do zero com qualquer movimento novo."""
    achados = []
    for caso in gestao.listar_casos():
        if caso.get("status") != "ativo" or caso["id"] in silenciados:
            continue
        ultima = (caso.get("ultima_movimentacao_data") or "")[:10]
        try:
            parado_ha = (hoje - date.fromisoformat(ultima)).days
        except ValueError:
            continue  # sem movimentação conhecida: sem dado, sem aviso
        if parado_ha < dias:
            continue
        capas = [c for c in (gestao.obter_capa_processo(caso["id"], n) for n in caso.get("processos") or []) if c]
        if capas and all(_encerrado_no_tribunal(c) for c in capas):
            continue
        achados.append({
            "caso_id": caso["id"], "titulo": caso.get("titulo") or "", "numero": (caso.get("processos") or [""])[0],
            "ultima": ultima, "dias_parado": parado_ha, "rodada": (parado_ha - dias) // dias,
        })
    return achados


async def avisar_processos_parados(gestao, *, agora=lambda: datetime.now(timezone.utc), enviar_email=None, base_url="") -> bool:
    """Rotina diária: registra o aviso (sino) e manda o e-mail, uma vez por período de inatividade.
    `enviar_email(destino, assunto, corpo, html)` é uma corrotina injetada (o `server.py` passa o envio SMTP/Brevo);
    sem ela só vai o sino. Falha de e-mail não derruba a rotina, mas faz ela contar como falha."""
    config = Repositorio(gestao.caminho)
    dias = config.estado("processo_parado")["parametros"]["dias"]
    hoje = agora().astimezone(_BRASILIA).date()
    achados = processos_parados(gestao, dias, config.silenciados("processo_parado"), hoje)
    if not achados:
        return True
    repo = notificacoes.Repositorio(gestao.caminho, agora=agora)
    emails = {nome: dados.get("email") for nome, dados in db.RegistroUsuarios(gestao.caminho).carregar().items()}
    falhou = False
    for item in achados:
        chave = f"{item['caso_id']}:{item['ultima']}:{item['rodada']}"
        novos = repo.registrar_processo_parado(item["caso_id"], chave)
        if not (novos and enviar_email):
            continue
        quando = emails_html.data_br(item["ultima"])
        link = f"{base_url}/radix/#/casos?id={item['caso_id']}&aba=atividades" if base_url else ""
        corpo = (f"Processo sem movimentação: {item['titulo'] or item['numero']}\n"
                 f"Sem movimentação há {item['dias_parado']} dias (última em {quando}).\n"
                 + (f"Processo: {item['numero']}\n" if item["numero"] else "")
                 + (f"\nAbrir o processo e criar uma atividade para conferir o andamento: {link}\n" if link else ""))
        html = emails_html.montar(
            "Processo sem movimentação", [item["titulo"] or item["numero"], f"Sem movimentação há {item['dias_parado']} dias."],
            linhas=[("Última movimentação", quando, "atencao"), ("Processo", item["numero"] or "—")],
            botao=("Abrir o processo", link), preheader=f"Processo sem movimentação há {item['dias_parado']} dias",
            rodape="AstraJus · Aviso de processo parado.")
        for usuario in novos:
            email = emails.get(usuario)
            if not email:
                continue
            try:
                await enviar_email(email, f"Processo sem movimentação: {item['titulo'] or item['numero']}", corpo, html)
            except Exception:
                falhou = True
                log.exception("Processo parado: falha ao enviar e-mail para %s", usuario)
    return not falhou
