"""Layout HTML dos e-mails do AstraJus (token, avisos de monitoramento, atividades e prazos).

Feito para clientes de e-mail, não para navegador: tabelas, estilos inline, largura fixa de 560 px,
botão "à prova de Outlook" e modo escuro via media query (Apple Mail, Gmail, Outlook.com). O texto puro
continua indo junto, como alternativa (multipart/alternative).
"""
from datetime import datetime
from html import escape

ACENTO = "#3a5bc7"       # índigo do painel, com contraste 5,9:1 sobre branco
_FONTE = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"
_MONO = "'SFMono-Regular',Consolas,Menlo,monospace"
_TONS = {"": "#1c2024", "urgente": "#cd2b31", "atencao": "#ab6400"}

_CSS = """
@media (prefers-color-scheme: dark) {
  .fundo { background:#111113 !important; }
  .cartao { background:#18191b !important; border-color:#2e3135 !important; }
  .tx { color:#edeef0 !important; }
  .mudo { color:#b0b4ba !important; }
  .linha { border-color:#2e3135 !important; }
  .codigo { background:#212225 !important; color:#edeef0 !important; }
  .urgente { color:#ff9592 !important; }
  .atencao { color:#ffca16 !important; }
}
@media only screen and (max-width:600px) {
  .miolo { padding:24px 20px !important; }
  .rotulo { display:block !important; width:auto !important; padding-bottom:2px !important; }
  .valor { display:block !important; }
}
"""


def data_br(texto):
    """'2026-11-20' (ou data ISO com hora) vira '20/11/2026'; qualquer outra coisa volta como veio."""
    try:
        return datetime.fromisoformat(str(texto)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return str(texto)


def _paragrafo(texto, mudo=False):
    classe = "mudo" if mudo else "tx"
    cor = "#60646c" if mudo else "#1c2024"
    tamanho = "14px" if mudo else "15px"
    return (f'<p class="{classe}" style="margin:0 0 16px;font:{tamanho}/22px {_FONTE};color:{cor};">'
            f'{escape(texto)}</p>')


def _linhas(linhas):
    celulas = []
    for rotulo, valor, *tom in linhas:
        tom = tom[0] if tom else ""
        classe = f"valor {tom}".strip() if tom else "valor tx"
        celulas.append(
            '<tr><td class="rotulo linha mudo" valign="top" width="120" style="padding:10px 12px 10px 0;'
            f'border-top:1px solid #e8e8ec;font:13px/20px {_FONTE};color:#60646c;">{escape(rotulo)}</td>'
            f'<td class="{classe} linha" valign="top" style="padding:10px 0;border-top:1px solid #e8e8ec;'
            f'font:15px/20px {_FONTE};color:{_TONS[tom]};">{escape(valor)}</td></tr>')
    return ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:0 0 20px;border-bottom:1px solid #e8e8ec;" class="linha">{"".join(celulas)}</table>')


def _codigo(texto):
    return (f'<div class="codigo" style="margin:0 0 20px;padding:14px 16px;background:#f0f0f3;border-radius:8px;'
            f'font:14px/22px {_MONO};color:#1c2024;word-break:break-all;">{escape(texto)}</div>')


def _botao(rotulo, url):
    return ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;"><tr>'
            f'<td bgcolor="{ACENTO}" style="border-radius:8px;"><a href="{escape(url, quote=True)}" '
            f'style="display:inline-block;padding:12px 22px;font:600 15px/20px {_FONTE};color:#ffffff;'
            f'text-decoration:none;border-radius:8px;">{escape(rotulo)}</a></td></tr></table>')


def montar(titulo, intro=(), *, linhas=(), codigo=None, botao=None, notas=(), preheader="", rodape=""):
    """Devolve o HTML completo.

    intro/notas: parágrafos de texto (notas em cinza, depois do botão). linhas: (rótulo, valor[, tom]) com
    tom '', 'urgente' ou 'atencao'. botao: (rótulo, url); só aparece com url absoluta (http/https), porque
    um link relativo não funciona dentro de um e-mail.
    """
    partes = [_paragrafo(p) for p in intro]
    if codigo:
        partes.append(_codigo(codigo))
    if linhas:
        partes.append(_linhas(linhas))
    if botao and botao[1].startswith(("http://", "https://")):
        partes.append(_botao(*botao))
    partes += [_paragrafo(n, mudo=True) for n in notas]
    return f"""<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>{escape(titulo)}</title>
<style>{_CSS}</style>
</head>
<body class="fundo" style="margin:0;padding:0;background:#f1f2f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" class="fundo" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f2f4" style="background:#f1f2f4;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 4px 14px;font:600 16px/20px {_FONTE};color:{ACENTO};">AstraJus</td></tr>
<tr><td class="cartao miolo" style="background:#ffffff;border:1px solid #dfe1e6;border-radius:12px;padding:32px 36px;">
<h1 class="tx" style="margin:0 0 16px;font:600 22px/28px {_FONTE};color:#1c2024;">{escape(titulo)}</h1>
{"".join(partes)}
</td></tr>
<tr><td class="mudo" style="padding:16px 4px 0;font:12px/18px {_FONTE};color:#60646c;">{escape(rodape)}</td></tr>
</table>
</td></tr></table>
</body></html>"""
