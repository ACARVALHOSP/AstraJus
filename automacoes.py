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

# Cada parâmetro: {"tipo": "int", "rotulo", "minimo", "maximo", "padrao"} ou {"tipo": "lista_int", ..., "min_itens", "max_itens"}. `ativo_por_padrao` (omitido = ligada):
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
        "descricao": "Avisa o responsável quando faltam os dias configurados, no dia e após o vencimento (prazos); escala aos "
                     "administradores se ninguém confirma ciência do prazo. Cada faixa avisa uma vez, ao entrar nela.",
        "parametros": {
            "faixas_prazo": {"tipo": "lista_int", "rotulo": "Avisar prazos quando faltarem (dias)",
                             "minimo": 0, "maximo": 30, "min_itens": 1, "max_itens": 6, "padrao": [5, 2, 1, 0]},
            "faixas_audiencia": {"tipo": "lista_int", "rotulo": "Avisar audiências quando faltarem (dias)",
                                 "minimo": 0, "maximo": 30, "min_itens": 1, "max_itens": 6, "padrao": [15, 5, 1, 0]},
        },
    },
    "triagem_publicacoes": {
        "nome": "Triagem de publicações",
        "descricao": "Classifica as publicações novas (tipo de ato e prazo sugerido), quando há classificador configurado.",
        "parametros": {},
    },
    "resumo_publicacoes": {
        "nome": "Resumo diário de publicações",
        "descricao": "Manda um único e-mail por dia com as publicações novas dos monitoramentos de cada pessoa. Cada pessoa escolhe "
                     "em Meu perfil se quer o e-mail de cada lote, só o resumo ou os dois. Dia sem publicação não envia nada.",
        "ativo_por_padrao": False,
        "parametros": {
            "hora": {"tipo": "int", "rotulo": "Enviar a partir das (hora de Brasília)", "minimo": 0, "maximo": 23, "padrao": 8},
        },
    },
    "responsavel_regras": {
        "nome": "Responsável por regras",
        "descricao": "Sugere e define o responsável de processos novos segundo as regras abaixo (quem captou, cliente, classe, "
                     "assunto, tribunal, vara e padrão do escritório). Nunca troca um responsável já definido.",
        "ativo_por_padrao": False,
        "agendada": False,
        "parametros": {},
    },
    "autocadastro_rascunho": {
        "nome": "Autocadastro de processos (rascunho)",
        "descricao": "Para publicação de processo ainda não cadastrado cujas partes reconhecem exatamente um cliente do escritório, cria o "
                     "processo como rascunho, a confirmar em Processos. Nunca cria cliente. Antes de ligar é preciso rodar a simulação.",
        "ativo_por_padrao": False,
        "parametros": {
            "limite_dia": {"tipo": "int", "rotulo": "Máximo de rascunhos por dia", "minimo": 1, "maximo": 200, "padrao": 20},
        },
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
        elif regra["tipo"] == "lista_int":
            if not isinstance(valor, list) or any(isinstance(v, bool) or not isinstance(v, int) for v in valor):
                raise ValueError(f"{rotulo}: informe uma lista de números inteiros.")
            if not regra["min_itens"] <= len(valor) <= regra["max_itens"]:
                raise ValueError(f"{rotulo}: informe de {regra['min_itens']} a {regra['max_itens']} valores.")
            if len(set(valor)) != len(valor):
                raise ValueError(f"{rotulo}: há valores repetidos.")
            if any(not regra["minimo"] <= v <= regra["maximo"] for v in valor):
                raise ValueError(f"{rotulo}: cada valor deve estar entre {regra['minimo']} e {regra['maximo']}.")
            valor = sorted(valor, reverse=True)  # forma única: maior para o menor
        else:  # pragma: no cover - só "int" e "lista_int" existem por enquanto
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
                CREATE TABLE IF NOT EXISTS automacoes_vigencia (
                    chave TEXT NOT NULL, parametro TEXT NOT NULL, desde TEXT NOT NULL, PRIMARY KEY (chave, parametro));
                CREATE TABLE IF NOT EXISTS automacoes_resumo (usuario TEXT PRIMARY KEY, enviado_em TEXT NOT NULL);
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
                "parametros": {n: list(r["padrao"]) if isinstance(r["padrao"], list) else r["padrao"]
                               for n, r in definicao["parametros"].items()}}

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

    def definir(self, chave: str, ator: str, ativo=None, parametros=None, agora: datetime | None = None) -> dict:
        """Liga/desliga e/ou altera parâmetros. Só registra (e grava histórico) quando algo muda de fato.
        Cada parâmetro que mudou guarda desde quando vale o valor novo (`vigencia`)."""
        if chave not in self.catalogo:
            raise LookupError("Rotina desconhecida.")
        if ativo is not None and not isinstance(ativo, bool):
            raise ValueError("Informe 'ativo' como verdadeiro ou falso.")
        novos = _validar_parametros(self.catalogo[chave], parametros) if parametros is not None else {}
        antes = self.estado(chave)
        depois = {"ativo": antes["ativo"] if ativo is None else ativo, "parametros": {**antes["parametros"], **novos}}
        if depois == antes:
            return antes
        instante = (agora or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
        # Só o que difere do padrão do catálogo é gravado: se o padrão mudar no código, quem não mexeu acompanha.
        padrao = self._padrao(chave)["parametros"]
        alterados = {n: v for n, v in depois["parametros"].items() if v != padrao[n]}
        with self._abrir() as c:
            for nome, valor in depois["parametros"].items():
                if valor != antes["parametros"].get(nome):
                    c.execute("INSERT INTO automacoes_vigencia (chave, parametro, desde) VALUES (?,?,?) "
                              "ON CONFLICT(chave, parametro) DO UPDATE SET desde=excluded.desde", (chave, nome, instante))
            c.execute(
                "INSERT INTO automacoes_config (chave, ativo, parametros, atualizado_em, atualizado_por) VALUES (?,?,?,?,?) "
                "ON CONFLICT(chave) DO UPDATE SET ativo=excluded.ativo, parametros=excluded.parametros, "
                "atualizado_em=excluded.atualizado_em, atualizado_por=excluded.atualizado_por",
                (chave, int(depois["ativo"]), json.dumps(alterados, ensure_ascii=False), instante, ator))
            c.execute("INSERT INTO automacoes_config_historico (ocorrido_em, ator, chave, antes, depois) VALUES (?,?,?,?,?)",
                      (instante, ator, chave, json.dumps(antes, ensure_ascii=False), json.dumps(depois, ensure_ascii=False)))
        return depois

    def vigencia(self, chave: str, parametro: str) -> datetime | None:
        """Quando o valor atual do parâmetro passou a valer; None se nunca foi alterado (vale o padrão desde sempre)."""
        with self._abrir() as c:
            linha = c.execute("SELECT desde FROM automacoes_vigencia WHERE chave=? AND parametro=?", (chave, parametro)).fetchone()
        return datetime.fromisoformat(linha[0]) if linha else None

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
                "agendada": definicao.get("agendada", True), "parametros_definidos": definicao["parametros"],
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


# --- Resumo diário de publicações --------------------------------------------------------------------

MODOS_AVISO_PUBLICACAO = ("imediato", "resumo", "ambos")
RETENCAO_RESUMO_HORAS = 36   # o que o resumo não levou nesse prazo sai pelo e-mail normal
LIMITE_ITENS_RESUMO = 40

_TIPOS_ATO = {"exige_manifestacao": "Exige manifestação", "ciencia": "Ciência",
              "despacho_expediente": "Despacho de expediente", "sentenca_ou_decisao": "Sentença ou decisão"}


def preferencia_avisos_publicacao(perfil: dict | None) -> str:
    """Como a pessoa quer receber os e-mails de publicações novas. Sem escolha: os dois."""
    valor = (perfil or {}).get("avisos_publicacao")
    return valor if valor in MODOS_AVISO_PUBLICACAO else "ambos"


def modo_avisos_publicacao(caminho, usuario: str | None) -> str:
    """Modo efetivo: a preferência da pessoa só vale com a rotina do resumo ligada; desligada, todos recebem como antes."""
    if not usuario or not Repositorio(caminho).ativa("resumo_publicacoes"):
        return "imediato"
    return preferencia_avisos_publicacao(db.RegistroUsuarios(caminho).carregar().get(usuario))


def _sugestao_da_triagem(triagem: dict | None) -> tuple[str, str]:
    """(tipo de ato, prazo provável) sugeridos pela triagem; vazio quando ela não classificou ou a confiança é baixa."""
    import triagem as modulo_triagem
    if not triagem:
        return "", ""
    tipo = triagem.get("tipo") or {}
    ato = _TIPOS_ATO.get(tipo.get("valor"), "") if (tipo.get("confianca") or 0) >= modulo_triagem.LIMITE_BAIXO else ""
    prazo = triagem.get("prazo_padrao") or {}
    gera = (triagem.get("gera_prazo") or {}).get("valor")
    rotulo = modulo_triagem.PRAZOS_PADRAO.get(prazo.get("valor"), "") if prazo.get("valor") != "nenhum" else ""
    return ato, (rotulo if gera and (prazo.get("confianca") or 0) >= modulo_triagem.LIMITE_BAIXO else "")


def montar_resumo(grupos: list[dict], total: int, desde: str, hoje: str, base_url: str = "") -> tuple[str, str, str]:
    """Assunto, texto e HTML do resumo. `grupos`: [{titulo, numero, cadastrado, itens: [{data, tribunal, orgao, classe,
    tipo, ato, prazo}]}], já ordenados e limitados. `desde`/`hoje`: datas ISO. Nunca leva o texto das publicações."""
    quando = emails_html.data_br(desde)
    dia = emails_html.data_br(hoje)[:5]
    atrasado = (date.fromisoformat(hoje) - date.fromisoformat(desde)).days > 1  # mais de um dia sem resumo
    assunto = f"AstraJus: {total} publicação(ões) nova(s) ({'desde ' + quando[:5] if atrasado else dia})"
    mostrados = sum(len(g["itens"]) for g in grupos)
    link = f"{base_url}/radix/#/publicacoes-oab" if base_url else ""
    linhas_texto, linhas_html = [f"{total} publicação(ões) nova(s) desde {quando}.", ""], []
    for cadastrado in (True, False):
        blocos = [g for g in grupos if g["cadastrado"] is cadastrado]
        if not blocos:
            continue
        cabecalho = "Processos cadastrados no escritório" if cadastrado else "Sem processo cadastrado"
        linhas_texto += [cabecalho.upper(), ""]
        linhas_html.append(("", cabecalho.upper(), ""))
        for g in blocos:
            rotulo = " · ".join(x for x in (g["titulo"], g["numero"]) if x) or "Processo não identificado"
            linhas_texto.append(rotulo)
            linhas_html.append(("Processo", rotulo, ""))
            for i in g["itens"]:
                partes = [x for x in (i["tribunal"], i["orgao"], i["classe"], i["tipo"]) if x]
                extra = [f"{x} (sugestão)" for x in (i["ato"], i["prazo"]) if x]
                linha = f"  - {emails_html.data_br(i['data'])} · " + " · ".join(partes + extra)
                linhas_texto.append(linha)
                linhas_html.append((emails_html.data_br(i["data"]), " · ".join(partes + extra), "atencao" if extra else ""))
            linhas_texto.append("")
    notas = [f"Mostrando {mostrados} de {total}."] if total > mostrados else []
    if link:
        linhas_texto.append(f"Abrir as publicações: {link}")
    corpo = "\n".join(linhas_texto)
    html = emails_html.montar(
        f"{total} publicação(ões) nova(s)", [f"Resumo das publicações que chegaram desde {quando}. O texto completo está no painel."],
        linhas=linhas_html, botao=("Abrir publicações recebidas", link), notas=notas,
        preheader=f"{total} publicação(ões) nova(s) desde {quando}", rodape="AstraJus · Resumo diário de publicações.")
    return assunto, corpo, html


async def enviar_resumos_publicacoes(registro, gestao, *, agora=lambda: datetime.now(timezone.utc), enviar_email=None,
                                     base_url="") -> bool:
    """Rotina horária. A partir da hora configurada, uma vez por dia por pessoa, manda o resumo do que os monitoramentos
    dela trouxeram desde o último. `enviar_email(destino, assunto, corpo, html)` é uma corrotina injetada."""
    import monitoramento_runtime
    config = Repositorio(gestao.caminho)
    agora_brasilia = agora().astimezone(_BRASILIA)
    if agora_brasilia.hour < config.estado("resumo_publicacoes")["parametros"]["hora"]:
        return True
    hoje = agora_brasilia.date().isoformat()
    entregas = monitoramento_runtime.Repositorio(gestao.caminho)
    usuarios = db.RegistroUsuarios(gestao.caminho).carregar()
    triagens = db.RegistroPublicacoesOAB(gestao.caminho)
    por_pessoa: dict[str, list[str]] = {}
    for mid, mon in registro.carregar().items():
        if mon.get("usuario"):
            por_pessoa.setdefault(mon["usuario"], []).append(mid)
    falhou = False
    for usuario, mids in por_pessoa.items():
        perfil = usuarios.get(usuario) or {}
        modo = preferencia_avisos_publicacao(perfil)
        pendentes = [(mid, i) for mid in mids for i in entregas.pendentes_detalhe(mid, "resumo")]
        if not pendentes:
            continue
        ativo = not perfil.get("revogado") and perfil.get("status", "ativo") == "ativo"
        email = perfil.get("email")
        # "Cada publicação" já recebeu tudo pelo e-mail normal; sem e-mail ou revogada não há como entregar: nada acumula.
        incluir = [(m, i) for m, i in pendentes if modo == "ambos" or (modo == "resumo" and i["email"] == 0)]
        if modo == "imediato" or not (ativo and email) or not incluir:
            for mid in mids:
                entregas.confirmar(mid, "resumo", [i["hash"] for m, i in pendentes if m == mid])
            continue
        enviado = _enviado_em(config, usuario)
        if enviado == hoje or enviar_email is None:
            continue
        itens = sorted({i["hash"]: i for m, i in incluir}.values(), key=lambda i: i["criado_em"])
        grupos = _agrupar_para_resumo(itens, gestao, triagens)
        desde = itens[0]["criado_em"][:10]
        assunto, corpo, html = montar_resumo(grupos, len(itens), desde, hoje, base_url)
        try:
            await enviar_email(email, assunto, corpo, html)
        except Exception:
            falhou = True
            log.exception("Resumo de publicações: falha ao enviar para %s", usuario)
            continue
        for mid in mids:
            do_mid = [i["hash"] for m, i in pendentes if m == mid]
            entregas.confirmar(mid, "resumo", do_mid)
            if modo == "resumo":
                entregas.confirmar(mid, "email", [i["hash"] for m, i in incluir if m == mid])
        _marcar_enviado(config, usuario, hoje)
    return not falhou


def _enviado_em(config: Repositorio, usuario: str) -> str | None:
    with config._abrir() as c:
        linha = c.execute("SELECT enviado_em FROM automacoes_resumo WHERE usuario=?", (usuario,)).fetchone()
    return linha[0] if linha else None


def _marcar_enviado(config: Repositorio, usuario: str, dia: str) -> None:
    with config._abrir() as c:
        c.execute("INSERT INTO automacoes_resumo (usuario, enviado_em) VALUES (?,?) "
                  "ON CONFLICT(usuario) DO UPDATE SET enviado_em=excluded.enviado_em", (usuario, dia))


def _agrupar_para_resumo(itens: list[dict], gestao, triagens) -> list[dict]:
    """Agrupa por processo (cadastrados primeiro), mais urgentes antes, até LIMITE_ITENS_RESUMO publicações."""
    triados = triagens.obter_triagens([i["hash"] for i in itens])
    grupos: dict[str, dict] = {}
    for i in itens[:LIMITE_ITENS_RESUMO]:
        d = i["dados"]
        numero = "".join(ch for ch in str(d.get("numeroprocessocommascara") or "") if ch.isdigit())
        casos = gestao.casos_do_processo(numero) if len(numero) == 20 else []
        titulo = (gestao.obter_caso(casos[0]) or {}).get("titulo") if casos else ""
        ato, prazo = _sugestao_da_triagem(triados.get(i["hash"]))
        urgencia = ((triados.get(i["hash"]) or {}).get("urgencia") or {}).get("nota") or 0
        grupo = grupos.setdefault(numero or d.get("hash") or "?", {
            "titulo": titulo or "", "numero": d.get("numeroprocessocommascara") or "", "cadastrado": bool(casos),
            "itens": [], "urgencia": 0})
        grupo["itens"].append({"data": d.get("data_disponibilizacao") or i["criado_em"][:10], "tribunal": d.get("siglaTribunal") or "",
                               "orgao": d.get("nomeOrgao") or "", "classe": d.get("nomeClasse") or "",
                               "tipo": d.get("tipoComunicacao") or d.get("tipoDocumento") or "", "ato": ato, "prazo": prazo})
        grupo["urgencia"] = max(grupo["urgencia"], urgencia)
    return sorted(grupos.values(), key=lambda g: -g["urgencia"])
