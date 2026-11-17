"""Configuração das rotinas automáticas: interruptor, parâmetros e histórico de alterações.

O catálogo (`CATALOGO`) lista as rotinas que o agendador conhece, com os padrões. Só o que o administrador
muda fica gravado em `automacoes_config`; sem registro vale o padrão do catálogo (rotina ligada, parâmetros
padrão). Toda alteração entra em `automacoes_config_historico` (quem, quando, antes e depois).

A execução em si continua em `monitoramento_runtime.Repositorio.executar`, que consulta `rotina_ativa`.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

# Cada parâmetro: {"tipo": "int", "rotulo", "minimo", "maximo", "padrao"}. As rotinas que já existiam
# não têm parâmetros; os tickets seguintes (processo parado, faixas de alerta...) acrescentam os seus.
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
        return {"ativo": True, "parametros": {n: r["padrao"] for n, r in self.catalogo[chave]["parametros"].items()}}

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
