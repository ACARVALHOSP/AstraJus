"""Modelos de documento (DOCX com {{variáveis}}), geração em DOCX/PDF e envio para assinatura na ZapSign.

Fluxo: o usuário sobe um modelo DOCX com campos {{cliente_nome}}, {{poderes}}...; ao gerar, os campos são
preenchidos com os dados do contato/processo (editáveis antes de gerar) e o resultado vira DOCX e PDF
(LibreOffice). Depois o PDF segue para a ZapSign; o webhook (ou "atualizar") traz o arquivo assinado.
Os arquivos ficam no próprio banco (BLOB), junto do restante do cadastro.
"""
import base64
import io
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

MAX_DOCX = 5 * 1024 * 1024
TIPOS = ("procuracao", "contrato", "outro")
PADRAO = re.compile(r"\{\{\s*([a-z0-9_]+)\s*\}\}")
_CONTROLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
HOSTS = {"producao": "https://api.zapsign.com.br", "sandbox": "https://sandbox.api.zapsign.com.br"}
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


class ErroDocumento(ValueError):
    """Problema com o arquivo, o modelo ou a ZapSign; a mensagem é mostrada ao usuário."""


# Variáveis disponíveis para quem monta o modelo: chave -> (rótulo, origem). "manual" = o usuário preenche.
VARIAVEIS = {
    "cliente_nome": ("Nome do contato", "cliente"), "cliente_cpf_cnpj": ("CPF/CNPJ", "cliente"),
    "cliente_rg": ("RG", "cliente"), "cliente_nacionalidade": ("Nacionalidade", "cliente"),
    "cliente_estado_civil": ("Estado civil", "cliente"), "cliente_profissao": ("Profissão", "cliente"),
    "cliente_email": ("E-mail", "cliente"), "cliente_telefone": ("Telefone", "cliente"),
    "cliente_endereco": ("Endereço completo", "cliente"), "cliente_cidade": ("Cidade", "cliente"),
    "cliente_estado": ("UF", "cliente"),
    "cliente_qualificacao": ("Qualificação completa (nome, estado civil, profissão, RG, CPF, endereço)", "cliente"),
    "caso_titulo": ("Título do caso", "caso"), "caso_numero": ("Número do processo", "caso"),
    "caso_acao": ("Ação", "caso"), "caso_foro": ("Foro/vara", "caso"),
    "caso_autor": ("Autor", "caso"), "caso_reu": ("Réu", "caso"),
    "data_hoje": ("Data de hoje (dd/mm/aaaa)", "sistema"), "data_extenso": ("Data por extenso", "sistema"),
    "poderes": ("Poderes outorgados", "manual"), "objeto": ("Objeto", "manual"),
    "condicoes_pagamento": ("Condições de pagamento", "manual"), "valor_honorarios": ("Valor dos honorários", "manual"),
}

# Poderes usuais de procuração, para marcar e depois editar à vontade.
PODERES = [
    ("ad_judicia", "Poderes gerais da cláusula ad judicia, para o foro em geral"),
    ("ad_extra", "Poderes da cláusula ad judicia et extra, para qualquer instância ou repartição"),
    ("receber_citacao", "Receber citação e intimações"),
    ("confessar", "Confessar"),
    ("reconhecer", "Reconhecer a procedência do pedido"),
    ("transigir", "Transigir e firmar acordos"),
    ("desistir", "Desistir e renunciar ao direito sobre o qual se funda a ação"),
    ("quitacao", "Receber e dar quitação, levantar alvarás e valores"),
    ("assinar_declaracao", "Firmar declaração de hipossuficiência econômica"),
    ("substabelecer", "Substabelecer, com ou sem reserva de poderes"),
]


def extrair_variaveis(docx: bytes) -> list[str]:
    achadas: list[str] = []
    for paragrafo in _paragrafos(_abrir(docx)):
        for nome in PADRAO.findall("".join(r.text for r in paragrafo.runs)):
            if nome not in achadas:
                achadas.append(nome)
    return achadas


def validar_docx(docx: bytes) -> list[str]:
    """Confere o arquivo (tamanho, formato, zip) e devolve as variáveis encontradas."""
    if not docx or len(docx) > MAX_DOCX:
        raise ErroDocumento("O modelo deve ser um arquivo DOCX de até 5 MB.")
    try:
        with zipfile.ZipFile(io.BytesIO(docx)) as z:
            if "word/document.xml" not in z.namelist():
                raise ErroDocumento("O arquivo não é um DOCX válido (salve o modelo como .docx, não .doc).")
    except zipfile.BadZipFile:
        raise ErroDocumento("O arquivo não é um DOCX válido (salve o modelo como .docx, não .doc).") from None
    return extrair_variaveis(docx)


def _abrir(docx: bytes):
    try:
        return Document(io.BytesIO(docx))
    except Exception:
        raise ErroDocumento("Não foi possível ler o DOCX. Abra no Word e salve novamente como .docx.") from None


def _paragrafos_de_tabelas(tabelas):
    """Parágrafos das células de tabelas, descendo nas tabelas aninhadas."""
    for tabela in tabelas:
        for linha in tabela.rows:
            for celula in linha.cells:
                yield from celula.paragraphs
                yield from _paragrafos_de_tabelas(celula.tables)


def _paragrafos_corpo(doc):
    """Parágrafos do corpo e de tabelas (em qualquer nível), na ordem, sem cabeçalho/rodapé."""
    yield from doc.paragraphs
    yield from _paragrafos_de_tabelas(doc.tables)


def _paragrafos(doc):
    """Parágrafos do corpo, de tabelas (em qualquer nível) e de cabeçalhos/rodapés."""
    yield from _paragrafos_corpo(doc)
    for secao in doc.sections:
        for parte in (secao.header, secao.footer, secao.first_page_header, secao.first_page_footer):
            yield from parte.paragraphs
            yield from _paragrafos_de_tabelas(parte.tables)


def texto_do_modelo(docx: bytes) -> list[dict]:
    """Parágrafos do corpo e das tabelas para a prévia ao vivo no diálogo de gerar.

    Mantém os {{campos}} crus (o frontend troca pelos valores), ignora cabeçalho/rodapé e
    devolve só os parágrafos não vazios, com o estilo que dá para reproduzir no navegador."""
    saida = []
    for paragrafo in _paragrafos_corpo(_abrir(docx)):
        texto = "".join(run.text for run in paragrafo.runs)
        if not texto.strip():
            continue
        com_texto = [run for run in paragrafo.runs if run.text.strip()]
        saida.append({
            "texto": texto,
            "negrito": bool(com_texto) and all(run.bold for run in com_texto),
            "centralizado": paragrafo.alignment == WD_ALIGN_PARAGRAPH.CENTER,
        })
        if len(saida) >= 400:
            break
    return saida


def preencher(docx: bytes, valores: dict) -> bytes:
    """Troca cada {{variável}} pelo valor (vazio vira ________), mantendo a formatação do trecho."""
    doc = _abrir(docx)
    limpos = {k: _CONTROLE.sub("", str(v or "")).strip() or "________" for k, v in valores.items()}
    for paragrafo in _paragrafos(doc):
        runs = paragrafo.runs
        texto = "".join(r.text for r in runs)
        for achado in reversed(list(PADRAO.finditer(texto))):
            inicio, fim = achado.span()
            novo = limpos.get(achado.group(1), "________")
            posicao, primeiro = 0, True
            for run in runs:
                trecho = run.text
                a, b = posicao, posicao + len(trecho)
                posicao = b
                if b <= inicio or a >= fim:
                    continue
                run.text = trecho[: max(inicio, a) - a] + (novo if primeiro else "") + trecho[min(fim, b) - a:]
                primeiro = False
    saida = io.BytesIO()
    doc.save(saida)
    return saida.getvalue()


def converter_pdf(docx: bytes, tempo: int = 90) -> bytes:
    """DOCX -> PDF com o LibreOffice (soffice) instalado no servidor."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise ErroDocumento("A conversão para PDF não está disponível neste servidor (LibreOffice ausente). Baixe o DOCX.")
    with tempfile.TemporaryDirectory() as pasta:
        origem = Path(pasta) / "documento.docx"
        origem.write_bytes(docx)
        perfil = Path(pasta) / "perfil"
        try:
            subprocess.run(
                [soffice, f"-env:UserInstallation={perfil.as_uri()}", "--headless", "--convert-to", "pdf", "--outdir", pasta, str(origem)],
                capture_output=True, timeout=tempo, check=True,
            )
        except (subprocess.SubprocessError, OSError):
            raise ErroDocumento("Não foi possível converter o documento para PDF.") from None
        destino = Path(pasta) / "documento.pdf"
        if not destino.exists():
            raise ErroDocumento("Não foi possível converter o documento para PDF.")
        return destino.read_bytes()


def valores_automaticos(cliente: dict | None, caso: dict | None, hoje: datetime | None = None) -> dict:
    """Valores que o sistema já sabe. Chaves sem dado ficam de fora. Novas fontes (proposta do CRM...)
    entram aqui, devolvendo o mesmo formato chave -> texto."""
    hoje = hoje or datetime.now(timezone.utc)
    valores = {"data_hoje": hoje.strftime("%d/%m/%Y"), "data_extenso": f"{hoje.day} de {MESES[hoje.month - 1]} de {hoje.year}"}
    c = cliente or {}
    rua = ", ".join(p for p in (c.get("endereco_rua"), c.get("endereco_numero")) if p)
    cidade_uf = "/".join(p for p in (c.get("endereco_cidade"), c.get("endereco_estado")) if p)
    endereco = ", ".join(p for p in (rua, c.get("endereco_complemento"), c.get("endereco_bairro"), cidade_uf) if p)
    rg = " ".join(p for p in (c.get("rg_numero"), c.get("rg_emissor")) if p)
    doc = c.get("cpf_cnpj")
    qualificacao = ", ".join(p for p in (
        c.get("nome"), c.get("nacionalidade"), c.get("estado_civil"), c.get("profissao"),
        f"RG {rg}" if rg else None, f"CPF/CNPJ {doc}" if doc else None,
        f"residente em {endereco}" if endereco else None) if p)
    valores.update({
        "cliente_nome": c.get("nome"), "cliente_cpf_cnpj": doc, "cliente_rg": rg,
        "cliente_nacionalidade": c.get("nacionalidade"), "cliente_estado_civil": c.get("estado_civil"),
        "cliente_profissao": c.get("profissao"), "cliente_email": c.get("email"), "cliente_telefone": c.get("telefone"),
        "cliente_endereco": endereco, "cliente_cidade": c.get("endereco_cidade"), "cliente_estado": c.get("endereco_estado"),
        "cliente_qualificacao": qualificacao,
    })
    k = caso or {}
    valores.update({
        "caso_titulo": k.get("titulo"), "caso_numero": k.get("numero") or ((k.get("processos") or [{}])[0].get("numero") if k.get("processos") else None),
        "caso_acao": k.get("acao"), "caso_foro": k.get("foro"), "caso_autor": k.get("autor"), "caso_reu": k.get("reu"),
    })
    return {chave: str(valor) for chave, valor in valores.items() if valor}


# ---------------------------------------------------------------- ZapSign

def _ambiente(valor) -> str:
    return "sandbox" if str(valor or "").strip().lower() == "sandbox" else "producao"


def signatarios_zapsign(signatarios, canal: str) -> list[dict]:
    """Converte [{nome, email, telefone}] no formato da ZapSign, validando o mínimo."""
    if not isinstance(signatarios, list) or not 1 <= len(signatarios) <= 10:
        raise ErroDocumento("Informe de 1 a 10 signatários.")
    saida = []
    for s in signatarios:
        nome = str((s or {}).get("nome") or "").strip()
        email = str((s or {}).get("email") or "").strip()
        telefone = re.sub(r"\D", "", str((s or {}).get("telefone") or ""))
        if telefone.startswith("55") and len(telefone) > 11:
            telefone = telefone[2:]
        if not nome:
            raise ErroDocumento("Todo signatário precisa de nome.")
        if canal == "whatsapp" and len(telefone) not in (10, 11):
            raise ErroDocumento(f"Informe o telefone com DDD de {nome} para enviar por WhatsApp.")
        if canal == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ErroDocumento(f"Informe um e-mail válido para {nome}.")
        item = {"name": nome, "auth_mode": "assinaturaTela", "send_automatic_email": canal == "email",
                "send_automatic_whatsapp": canal == "whatsapp"}
        if email:
            item["email"] = email
        if telefone:
            item.update(phone_country="55", phone_number=telefone)
        saida.append(item)
    return saida


async def _zapsign(metodo: str, caminho: str, chave: str, ambiente: str, corpo=None):
    if not chave:
        raise ErroDocumento("Configure a chave da ZapSign em Integrações.")
    try:
        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.request(metodo, HOSTS[_ambiente(ambiente)] + caminho, json=corpo,
                                   headers={"Authorization": "Bearer " + chave})
    except httpx.HTTPError:
        raise ErroDocumento("Não foi possível falar com a ZapSign agora. Tente novamente.") from None
    if r.status_code == 402:
        raise ErroDocumento("A conta da ZapSign está sem plano de API ativo.")
    if r.status_code in (401, 403):
        raise ErroDocumento("A ZapSign recusou a chave. Confira a chave e o ambiente (produção ou sandbox) em Integrações.")
    if r.status_code == 429:
        raise ErroDocumento("Limite de requisições da ZapSign atingido. Aguarde um minuto.")
    if r.status_code >= 400:
        raise ErroDocumento(f"A ZapSign recusou o pedido (HTTP {r.status_code}).")
    return r.json()


async def enviar_para_assinatura(pdf: bytes, nome: str, signatarios: list[dict], chave: str, ambiente: str,
                                 external_id: str, prazo: str | None = None) -> dict:
    corpo = {"name": nome[:255], "base64_pdf": base64.b64encode(pdf).decode(), "lang": "pt-br",
             "signers": signatarios, "external_id": external_id}
    if prazo:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", prazo):
            raise ErroDocumento("Informe o prazo no formato AAAA-MM-DD.")
        corpo["date_limit_to_sign"] = prazo
    return await _zapsign("POST", "/api/v1/docs/", chave, ambiente, corpo)


async def detalhar(token: str, chave: str, ambiente: str) -> dict:
    return await _zapsign("GET", f"/api/v1/docs/{token}/", chave, ambiente)


async def baixar(url: str) -> bytes:
    """Baixa o PDF assinado (link temporário da ZapSign, válido por 60 minutos)."""
    if not url.startswith("https://"):
        raise ErroDocumento("Link do arquivo assinado inválido.")
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as http:
            r = await http.get(url)
            r.raise_for_status()
            return r.content
    except httpx.HTTPError:
        raise ErroDocumento("Não foi possível baixar o arquivo assinado.") from None


# ---------------------------------------------------------------- banco

def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def criar_tabelas(conexao):
    """Garante o schema de documentos. Bases antigas recebem as colunas novas por migração idempotente."""
    conexao.executescript("""
    CREATE TABLE IF NOT EXISTS documento_modelos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL,
        docx BLOB NOT NULL, variaveis TEXT NOT NULL, criado_em TEXT NOT NULL, criado_por TEXT);
    CREATE TABLE IF NOT EXISTS documentos_gerados (
        id INTEGER PRIMARY KEY AUTOINCREMENT, modelo_id INTEGER, nome TEXT NOT NULL,
        cliente_id TEXT, caso_id TEXT, valores TEXT NOT NULL, docx BLOB NOT NULL, pdf BLOB,
        status TEXT NOT NULL DEFAULT 'gerado', zap_token TEXT, signatarios TEXT,
        assinado BLOB, visualizado_em TEXT, alerta TEXT,
        criado_em TEXT NOT NULL, criado_por TEXT, atualizado_em TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS documentos_zap ON documentos_gerados(zap_token);
    """)
    existentes = {linha[1] for linha in conexao.execute("PRAGMA table_info(documentos_gerados)")}
    for coluna in ("visualizado_em", "alerta"):
        if coluna not in existentes:
            conexao.execute(f"ALTER TABLE documentos_gerados ADD COLUMN {coluna} TEXT")


class Repositorio:
    def __init__(self, caminho):
        self.caminho = str(caminho)
        with self._abrir() as c:
            criar_tabelas(c)

    @contextmanager
    def _abrir(self):
        c = sqlite3.connect(self.caminho, timeout=30)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    # modelos
    def criar_modelo(self, nome, tipo, docx, usuario):
        nome = str(nome or "").strip()
        if not 1 <= len(nome) <= 120:
            raise ErroDocumento("Dê um nome de até 120 caracteres ao modelo.")
        if tipo not in TIPOS:
            raise ErroDocumento("Tipo de modelo inválido.")
        variaveis = validar_docx(docx)
        if not variaveis:
            raise ErroDocumento("O modelo não tem nenhum campo {{variável}}. Insira campos como {{cliente_nome}} no Word.")
        with self._abrir() as c:
            i = c.execute("INSERT INTO documento_modelos (nome,tipo,docx,variaveis,criado_em,criado_por) VALUES (?,?,?,?,?,?)",
                          (nome, tipo, docx, json.dumps(variaveis), _agora(), usuario)).lastrowid
        return self.modelo(i)

    def modelos(self):
        with self._abrir() as c:
            return [self._modelo(l) for l in c.execute("SELECT id,nome,tipo,variaveis,criado_em FROM documento_modelos ORDER BY nome")]

    def modelo(self, modelo_id):
        with self._abrir() as c:
            l = c.execute("SELECT id,nome,tipo,variaveis,criado_em FROM documento_modelos WHERE id=?", (modelo_id,)).fetchone()
        if not l:
            raise LookupError("Modelo não encontrado.")
        return self._modelo(l)

    @staticmethod
    def _modelo(l):
        return {"id": l["id"], "nome": l["nome"], "tipo": l["tipo"], "variaveis": json.loads(l["variaveis"]), "criado_em": l["criado_em"]}

    def docx_do_modelo(self, modelo_id) -> bytes:
        with self._abrir() as c:
            l = c.execute("SELECT docx FROM documento_modelos WHERE id=?", (modelo_id,)).fetchone()
        if not l:
            raise LookupError("Modelo não encontrado.")
        return l["docx"]

    def excluir_modelo(self, modelo_id):
        with self._abrir() as c:
            if not c.execute("DELETE FROM documento_modelos WHERE id=?", (modelo_id,)).rowcount:
                raise LookupError("Modelo não encontrado.")

    # documentos gerados
    def excluir_documento(self, doc_id):
        with self._abrir() as c:
            if not c.execute("DELETE FROM documentos_gerados WHERE id=?", (doc_id,)).rowcount:
                raise LookupError("Documento não encontrado.")

    def criar_documento(self, modelo_id, nome, cliente_id, caso_id, valores, docx, pdf, usuario):
        with self._abrir() as c:
            i = c.execute("INSERT INTO documentos_gerados (modelo_id,nome,cliente_id,caso_id,valores,docx,pdf,criado_em,criado_por,atualizado_em) "
                          "VALUES (?,?,?,?,?,?,?,?,?,?)",
                          (modelo_id, nome, cliente_id, caso_id, json.dumps(valores), docx, pdf, _agora(), usuario, _agora())).lastrowid
        return self.documento(i)

    _COLUNAS = "id,modelo_id,nome,cliente_id,caso_id,status,zap_token,signatarios,criado_em,criado_por,atualizado_em,visualizado_em,alerta,(pdf IS NOT NULL) AS tem_pdf,(assinado IS NOT NULL) AS tem_assinado"

    def documentos(self, cliente_id=None, caso_id=None):
        filtros, args = [], []
        for coluna, valor in (("cliente_id", cliente_id), ("caso_id", caso_id)):
            if valor:
                filtros.append(f"{coluna}=?")
                args.append(valor)
        onde = ("WHERE " + " AND ".join(filtros)) if filtros else ""
        with self._abrir() as c:
            return [self._doc(l) for l in c.execute(f"SELECT {self._COLUNAS} FROM documentos_gerados {onde} ORDER BY id DESC LIMIT 200", args)]

    def documento(self, doc_id):
        with self._abrir() as c:
            l = c.execute(f"SELECT {self._COLUNAS} FROM documentos_gerados WHERE id=?", (doc_id,)).fetchone()
        if not l:
            raise LookupError("Documento não encontrado.")
        return self._doc(l)

    @staticmethod
    def _doc(l):
        return {"id": l["id"], "modelo_id": l["modelo_id"], "nome": l["nome"], "cliente_id": l["cliente_id"], "caso_id": l["caso_id"],
                "status": l["status"], "signatarios": json.loads(l["signatarios"]) if l["signatarios"] else [],
                "visualizado_em": l["visualizado_em"], "alerta": l["alerta"],
                "tem_pdf": bool(l["tem_pdf"]), "tem_assinado": bool(l["tem_assinado"]),
                "criado_em": l["criado_em"], "criado_por": l["criado_por"], "atualizado_em": l["atualizado_em"]}

    def arquivo(self, doc_id, coluna) -> bytes | None:
        if coluna not in ("docx", "pdf", "assinado"):
            raise ValueError(coluna)
        with self._abrir() as c:
            l = c.execute(f"SELECT {coluna} FROM documentos_gerados WHERE id=?", (doc_id,)).fetchone()
        if not l:
            raise LookupError("Documento não encontrado.")
        return l[0]

    def token_zap(self, doc_id):
        with self._abrir() as c:
            l = c.execute("SELECT zap_token FROM documentos_gerados WHERE id=?", (doc_id,)).fetchone()
        return l["zap_token"] if l else None

    def marcar_enviado(self, doc_id, token, signatarios):
        with self._abrir() as c:
            c.execute("UPDATE documentos_gerados SET status='enviado', zap_token=?, signatarios=?, atualizado_em=? WHERE id=?",
                      (token, json.dumps(signatarios), _agora(), doc_id))

    def aplicar_estado(self, token, status, signatarios=None, assinado=None) -> bool:
        """Atualiza pelo token da ZapSign. Idempotente: repetir o mesmo aviso não muda nada além da data."""
        with self._abrir() as c:
            l = c.execute("SELECT id, status, assinado FROM documentos_gerados WHERE zap_token=?", (token,)).fetchone()
            if not l:
                return False
            if l["status"] == "assinado":  # estado final: aviso atrasado não desfaz a assinatura
                status = "assinado"
            c.execute("UPDATE documentos_gerados SET status=?, signatarios=COALESCE(?,signatarios), assinado=COALESCE(?,assinado), atualizado_em=? WHERE id=?",
                      (status, json.dumps(signatarios) if signatarios is not None else None, assinado, _agora(), l["id"]))
        return True

    def registrar_aviso(self, token, evento, signatarios=None) -> dict | None:
        """Aplica o aviso da ZapSign (visualização, e-mail devolvido, prazo acabando).

        Devolve os dados do documento quando o aviso é novo e o documento ainda aceita avisos;
        None quando o token não existe, o estado já é final ou o aviso já tinha sido registrado."""
        with self._abrir() as c:
            l = c.execute("SELECT id,nome,criado_por,caso_id,status,visualizado_em,alerta "
                          "FROM documentos_gerados WHERE zap_token=?", (token,)).fetchone()
            if not l or l["status"] in ("assinado", "recusado", "expirado"):
                return None
            agora = _agora()
            campos = {"atualizado_em": agora}
            novo = False
            if evento == "doc_viewed":
                if not l["visualizado_em"]:
                    campos["visualizado_em"] = agora
                    novo = True
            elif evento == "email_bounce":
                if l["alerta"] != "email_devolvido":
                    campos["alerta"] = "email_devolvido"
                    novo = True
            elif evento == "doc-expiration-alert":
                if l["alerta"] != "prazo_acabando":
                    campos["alerta"] = "prazo_acabando"
                    novo = True
            else:
                return None
            sets = ", ".join(f"{campo}=?" for campo in campos)
            argumentos = [*campos.values()]
            if signatarios is not None:
                sets += ", signatarios=?"
                argumentos.append(json.dumps(signatarios))
            argumentos.append(l["id"])
            c.execute(f"UPDATE documentos_gerados SET {sets} WHERE id=?", argumentos)
        if not novo:
            return None
        return {"id": l["id"], "nome": l["nome"], "criado_por": l["criado_por"], "caso_id": l["caso_id"]}


def signatarios_do_retorno(zap: dict) -> list[dict]:
    return [{"nome": s.get("name"), "email": s.get("email"), "status": s.get("status"),
             "assinou_em": s.get("signed_at"), "link": s.get("sign_url")} for s in zap.get("signers") or []]


def status_do_retorno(zap: dict, evento: str | None = None) -> str:
    if evento == "doc_refused" or zap.get("status") in ("refused", "rejected"):
        return "recusado"
    if evento == "doc-expired":
        return "expirado"
    return "assinado" if zap.get("status") == "signed" else "enviado"
