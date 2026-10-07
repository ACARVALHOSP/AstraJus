#!/usr/bin/env bash
# Instala o MCP cnj-processual no Claude Code e/ou no Claude Desktop (macOS e Linux).
#
# Uso:
#   bash instalar-unix.sh
#   bash instalar-unix.sh --url https://outro-servidor/mcp
#
# O token é pedido sem eco na tela. Também é possível passar pela variável CNJ_TOKEN.
# O script valida o token no servidor antes de gravar qualquer configuração.

set -euo pipefail

URL="https://191-252-110-22.sslip.io/mcp"
ARQUIVO_DESKTOP=""
SEM_CLAUDE_CODE=0
SEM_CLAUDE_DESKTOP=0
NOME="cnj-processual"

while [ $# -gt 0 ]; do
    case "$1" in
        --url) URL="$2"; shift 2 ;;
        --arquivo-desktop) ARQUIVO_DESKTOP="$2"; shift 2 ;;
        --sem-claude-code) SEM_CLAUDE_CODE=1; shift ;;
        --sem-claude-desktop) SEM_CLAUDE_DESKTOP=1; shift ;;
        *) echo "Opção desconhecida: $1"; exit 1 ;;
    esac
done

if [ -z "$ARQUIVO_DESKTOP" ]; then
    case "$(uname -s)" in
        Darwin) ARQUIVO_DESKTOP="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
        *) ARQUIVO_DESKTOP="${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json" ;;
    esac
fi

# --- token -------------------------------------------------------------------

if [ -n "${CNJ_TOKEN:-}" ]; then
    TOKEN="$CNJ_TOKEN"
else
    read -r -s -p "Cole o seu token do cnj-processual: " TOKEN
    echo
fi
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -n "$TOKEN" ] || { echo "Token vazio."; exit 1; }

# --- validação no servidor ---------------------------------------------------

BASE="${URL%/mcp}"
if ! curl -fsS -m 20 "$BASE/healthz" >/dev/null; then
    echo "Servidor inacessível em $BASE. Verifique a URL e a sua conexão."
    exit 1
fi

CODIGO=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$URL" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/json, text/event-stream" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"instalador","version":"1"}}}')
case "$CODIGO" in
    200) echo "Token validado no servidor." ;;
    401) echo "Token recusado pelo servidor (HTTP 401). Confirme o token com quem o enviou."; exit 1 ;;
    429) echo "Limite de uso atingido agora (HTTP 429). Tente de novo em alguns minutos."; exit 1 ;;
    *) echo "Falha ao validar o token (HTTP $CODIGO)."; exit 1 ;;
esac

# --- Claude Code -------------------------------------------------------------

if [ "$SEM_CLAUDE_CODE" -eq 0 ] && command -v claude >/dev/null 2>&1; then
    # Remove uma configuração anterior, se existir. Falha aqui é esperada quando não há nada para remover.
    claude mcp remove "$NOME" --scope user >/dev/null 2>&1 || true
    claude mcp add --transport http --scope user "$NOME" "$URL" --header "Authorization: Bearer $TOKEN"
    echo "Claude Code configurado (escopo do usuário)."
elif [ "$SEM_CLAUDE_CODE" -eq 0 ]; then
    echo "Claude Code não encontrado: pulando."
fi

# --- Claude Desktop ----------------------------------------------------------

if [ "$SEM_CLAUDE_DESKTOP" -eq 0 ]; then
    PASTA="$(dirname "$ARQUIVO_DESKTOP")"
    if [ ! -d "$PASTA" ]; then
        echo "Claude Desktop não encontrado em $PASTA: pulando."
    else
        command -v npx >/dev/null 2>&1 || {
            echo "O Claude Desktop usa Node.js (npx). Instale o Node.js LTS em https://nodejs.org e rode o instalador de novo."
            exit 1
        }
        command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado."; exit 1; }

        if [ -f "$ARQUIVO_DESKTOP" ]; then
            BACKUP="$ARQUIVO_DESKTOP.bak-$(date +%Y%m%d-%H%M%S)"
            cp "$ARQUIVO_DESKTOP" "$BACKUP"
            echo "Backup da configuração anterior: $BACKUP"
        fi

        # Mescla a entrada no JSON existente, sem tocar nas outras chaves. O token entra por variável de ambiente.
        CNJ_URL="$URL" CNJ_AUTH="Authorization: Bearer $TOKEN" CNJ_ARQUIVO="$ARQUIVO_DESKTOP" CNJ_NOME="$NOME" \
        node -e '
const fs = require("fs");
const arquivo = process.env.CNJ_ARQUIVO;
let config = {};
if (fs.existsSync(arquivo)) config = JSON.parse(fs.readFileSync(arquivo, "utf8") || "{}");
config.mcpServers = config.mcpServers || {};
config.mcpServers[process.env.CNJ_NOME] = {
  command: "npx",
  args: ["mcp-remote", process.env.CNJ_URL, "--header", process.env.CNJ_AUTH],
};
fs.writeFileSync(arquivo, JSON.stringify(config, null, 2) + "\n", "utf8");
'
        echo "Claude Desktop configurado. Reinicie o aplicativo por completo."
    fi
fi

echo
echo "Pronto. Teste pedindo algo como: consulte o processo 1006314-27.2023.8.26.0005 no tjsp."
