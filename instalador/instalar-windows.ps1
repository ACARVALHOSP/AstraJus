# Instala o MCP cnj-processual no Claude Code e/ou no Claude Desktop (Windows).
#
# Uso (PowerShell):
#   .\instalar-windows.ps1
#   .\instalar-windows.ps1 -Url https://outro-servidor/mcp
#
# O token é pedido sem eco na tela. Também é possível passar pela variável CNJ_TOKEN.
# O script valida o token no servidor antes de gravar qualquer configuração.

[CmdletBinding()]
param(
    [string]$Url = "https://191-252-110-22.sslip.io/mcp",
    [string]$ArquivoDesktop = "$env:APPDATA\Claude\claude_desktop_config.json",
    [switch]$SemClaudeCode,
    [switch]$SemClaudeDesktop
)

$ErrorActionPreference = "Stop"
$NomeServidor = "cnj-processual"

function Ler-Token {
    if ($env:CNJ_TOKEN) { return $env:CNJ_TOKEN.Trim() }
    $seguro = Read-Host "Cole o seu token do cnj-processual" -AsSecureString
    $ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
}

function Testar-Token([string]$endereco, [string]$token) {
    $base = $endereco -replace '/mcp$', ''
    try {
        Invoke-RestMethod -Uri "$base/healthz" -TimeoutSec 20 | Out-Null
    } catch {
        throw "Servidor inacessível em $base. Verifique a URL e a sua conexão."
    }

    $corpo = @{
        jsonrpc = "2.0"; id = 1; method = "initialize"
        params = @{ protocolVersion = "2025-06-18"; capabilities = @{}; clientInfo = @{ name = "instalador"; version = "1" } }
    } | ConvertTo-Json -Depth 6
    try {
        Invoke-WebRequest -Uri $endereco -Method Post -Body $corpo -ContentType "application/json" `
            -Headers @{ Authorization = "Bearer $token"; Accept = "application/json, text/event-stream" } `
            -UseBasicParsing -TimeoutSec 30 | Out-Null
    } catch {
        $codigo = [int]$_.Exception.Response.StatusCode
        if ($codigo -eq 401) { throw "Token recusado pelo servidor (HTTP 401). Confirme o token com quem o enviou." }
        if ($codigo -eq 429) { throw "Limite de uso atingido agora (HTTP 429). Tente de novo em alguns minutos." }
        throw "Falha ao validar o token (HTTP $codigo)."
    }
    Write-Host "Token validado no servidor." -ForegroundColor Green
}

function Instalar-ClaudeCode([string]$endereco, [string]$token) {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Host "Claude Code não encontrado: pulando." -ForegroundColor Yellow
        return
    }
    # Remove uma configuração anterior, se existir. Erro aqui é esperado quando não há nada para remover.
    cmd /c "claude mcp remove $NomeServidor --scope user >nul 2>&1"
    & claude mcp add --transport http --scope user $NomeServidor $endereco --header "Authorization: Bearer $token"
    if ($LASTEXITCODE -ne 0) { throw "O comando 'claude mcp add' falhou (código $LASTEXITCODE)." }
    Write-Host "Claude Code configurado (escopo do usuário)." -ForegroundColor Green
}

function Instalar-ClaudeDesktop([string]$endereco, [string]$token, [string]$arquivo) {
    $pasta = Split-Path $arquivo
    if (-not (Test-Path $pasta)) {
        Write-Host "Claude Desktop não encontrado em ${pasta}: pulando." -ForegroundColor Yellow
        return
    }
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw "O Claude Desktop usa Node.js (npx). Instale o Node.js LTS em https://nodejs.org e rode o instalador de novo."
    }

    if (Test-Path $arquivo) {
        $backup = "$arquivo.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item $arquivo $backup
        Write-Host "Backup da configuração anterior: $backup"
        $config = Get-Content -Raw $arquivo | ConvertFrom-Json
    } else {
        $config = [pscustomobject]@{}
    }

    if (-not $config.PSObject.Properties["mcpServers"]) {
        $config | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
    }
    $entrada = [pscustomobject]@{
        command = "npx"
        args    = @("mcp-remote", $endereco, "--header", "Authorization: Bearer $token")
    }
    $config.mcpServers | Add-Member -NotePropertyName $NomeServidor -NotePropertyValue $entrada -Force

    $json = $config | ConvertTo-Json -Depth 10
    # UTF-8 sem BOM, que é o formato esperado pelo Claude Desktop.
    [IO.File]::WriteAllText($arquivo, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Host "Claude Desktop configurado. Reinicie o aplicativo por completo." -ForegroundColor Green
}

# --- execução ---------------------------------------------------------------

$token = Ler-Token
if (-not $token) { throw "Token vazio." }

Testar-Token $Url $token
if (-not $SemClaudeCode) { Instalar-ClaudeCode $Url $token }
if (-not $SemClaudeDesktop) { Instalar-ClaudeDesktop $Url $token $ArquivoDesktop }

Write-Host ""
Write-Host "Pronto. Teste pedindo algo como: consulte o processo 1006314-27.2023.8.26.0005 no tjsp." -ForegroundColor Cyan
