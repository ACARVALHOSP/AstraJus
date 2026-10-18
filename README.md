# CNJ Processual

Sistema de gestão processual para escritórios de advocacia brasileiros, combinando um **servidor MCP** (Model Context Protocol) para consulta judicial e um **painel web** completo para gerenciamento de clientes, casos e atividades.

## Visão Geral

Plataforma integrada que conecta as APIs públicas do CNJ (DataJud e DJEN) a um fluxo de trabalho jurídico completo. Permite consultar processos, monitorar publicações no Diário da Justiça Eletrônico, gerenciar clientes e casos, e integrar com Google Drive e Google Calendar — tudo em um único servidor Python leve, implantável via Docker.

## Status de Implementação

### ✅ Funcionalidades Concluídas (Produção)

**Servidor MCP — Consulta Processual**

- Consulta de processos e movimentações via API Pública DataJud (todos os tribunais)
- Consulta de publicações e intimações no DJEN (API Comunica PJe)
- Download de certidão PDF de publicação com retenção de 7 dias
- Busca de feriados forenses do TJSP por município/comarca e ano
- Análise de perfil decisório de magistrado (jurimetria CJPG)

**Monitoramento Automático**

- Monitoramento recorrente de processo ou OAB no DJEN (verificação a cada 6 horas)
- Notificação por e-mail com resumo e link quando surge publicação nova
- Limite de 5 monitoramentos por usuário; expiração automática após 180 dias sem publicação
- Renovação automática do prazo a cada publicação encontrada

**Painel Web (`/app`)**

- Autenticação via token Bearer (sem cookies, compatível com MCP)
- Consulta pontual com histórico local de pesquisas (por dispositivo, não sincronizado)
- Favoritos de processo (tribunal + número) para acesso rápido

**Gestão de Clientes**

- CRUD completo com busca e paginação
- Abertura em modal com Carbon Design System
- Typeahead para seleção de clientes em formulários

**Gestão de Casos**

- CRUD completo com vínculo a cliente
- Preenchimento automático de responsável (usuário logado) ao criar caso
- Busca de ação/tipo e foro/vara via DataJud no modal de criação e na vista de detalhe
- Vista de detalhe com sub-abas: Cadastro | Partes | Atividades
- Edição inline de título, responsável, ação, foro e números de processo
- Partes processuais: autor, réu e advogados
- Gerenciamento de atividades (tarefas) por caso com tipo, status, data, hora e observações

**Integrações Google**

- Google Drive: criação de pasta por caso
- Google Calendar: criação de evento por caso

**Infraestrutura**

- Servidor ASGI Python puro (sem framework web externo)
- SQLite com migrações automáticas via `PRAGMA table_info`
- Usuários com autenticação HMAC-SHA256; criação via CLI
- Transporte MCP via HTTP (Streamable HTTP) e stdio
- Docker com usuário sem privilégios (uid 10001)
- Caddy como proxy reverso com HTTPS automático

### ⏳ Planejado

| Funcionalidade | Status |
|---|---|
| Publicações OAB no DJEN | Backend ✅ / Frontend ⏳ |
| Integração completa Google Drive (upload) | ⏳ |
| Relatórios e métricas de casos | ⏳ |
| Exportação de dados | ⏳ |

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.12, asyncio, ASGI puro |
| Protocolo IA | MCP 1.30+ (Streamable HTTP + stdio) |
| Frontend | HTML/JS vanilla, Carbon Design System (white theme) |
| Banco de dados | SQLite (ephemeral connections) |
| Agendamento | APScheduler 3.x (monitoramentos) |
| HTTP client | httpx |
| Deploy | Docker, Caddy (proxy reverso + HTTPS) |
| APIs externas | DataJud CNJ, DJEN (Comunica PJe), CJPG, Google APIs |

## Pré-requisitos

- **Python** 3.10+
- **Docker** (para deploy em produção)
- **Caddy** (proxy reverso, configurado separadamente no VPS)

## Início Rápido

### Desenvolvimento Local

```bash
# 1. Criar e ativar ambiente virtual
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 2. Instalar dependências
pip install -e .

# 3. Criar usuário administrador
python server.py --criar-usuario meu-usuario

# 4. Iniciar servidor
python server.py
# Painel web disponível em http://localhost:8000/app
# Servidor MCP disponível em http://localhost:8000/mcp
```

### Docker (Produção)

```bash
# Build da imagem
docker build -t cnj-processual .

# Criar usuário (antes de iniciar o container em produção)
# Gerar token e guardar em segurança
docker run --rm -v /dados:/app/dados \
  -e CNJ_MCP_USUARIOS=/app/dados/usuarios.json \
  cnj-processual python server.py --criar-usuario admin

# Iniciar container
docker run -d --name cnj-processual --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v /dados:/app/dados \
  --env-file .env \
  cnj-processual
```

### Configuração do Claude Desktop (MCP stdio)

```json
{
  "mcpServers": {
    "cnj-processual": {
      "command": "python",
      "args": ["/caminho/para/server.py"]
    }
  }
}
```

## Estrutura do Projeto

```
cnj-processual/
├── server.py              # Servidor MCP + ASGI web, roteamento, autenticação
├── db.py                  # Camada de dados: SQLite, migrações, CRUD
├── google_integracao.py   # Integração Google Drive e Calendar
├── static/
│   ├── app.html           # Painel web (Carbon Design System)
│   ├── app.js             # Lógica frontend (MCP client, casos, clientes)
│   └── cadastro.js        # Formulários de cadastro
├── instalador/
│   ├── instalar-unix.sh   # Instalador para Linux/macOS
│   └── instalar-windows.ps1  # Instalador para Windows
├── pyproject.toml
├── Dockerfile
└── CONTEXT.md             # Glossário de domínio
```

## Ferramentas MCP

| Tool | Descrição |
|---|---|
| `consultar_processo_datajud` | Metadados e movimentações de processo via DataJud |
| `consultar_publicacoes_djen` | Publicações/intimações no DJEN por OAB ou número de processo |
| `baixar_certidao_djen` | Baixa certidão PDF de uma publicação |
| `buscar_feriados_forenses` | Feriados forenses do TJSP por comarca e ano |
| `consultar_jurimetria_cjpg` | Perfil decisório de magistrado (CJPG) |
| `monitorar_publicacoes` | Configura monitoramento recorrente no DJEN |
| `listar_monitoramentos` | Lista monitoramentos ativos do usuário |
| `remover_monitoramento` | Remove um monitoramento |
| `perfil_decisorio_magistrado` | Análise de jurimetria por magistrado |

## Endpoints da API Web

### Autenticação

```
POST /auth/login         Login — retorna token Bearer
```

### Clientes

```
GET    /clientes                  Listar clientes (paginado)
POST   /clientes                  Criar cliente
GET    /clientes/<id>             Obter cliente
PATCH  /clientes/<id>             Atualizar cliente
DELETE /clientes/<id>             Excluir cliente
```

### Casos

```
GET    /casos                     Listar casos (paginado)
POST   /casos                     Criar caso (responsável auto-preenchido)
GET    /casos/<id>                Obter caso
PATCH  /casos/<id>                Atualizar caso (cadastro ou partes)
DELETE /casos/<id>                Excluir caso
```

### Atividades de Caso

```
GET    /casos/<id>/atividades          Listar atividades
POST   /casos/<id>/atividades          Criar atividade
PATCH  /casos/<id>/atividades/<aid>    Atualizar atividade
DELETE /casos/<id>/atividades/<aid>    Excluir atividade
```

### Monitoramentos

```
GET    /monitoramentos            Listar monitoramentos do usuário
POST   /monitoramentos            Criar monitoramento
DELETE /monitoramentos/<id>       Remover monitoramento
```

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `CNJ_MCP_TRANSPORT` | `http` | Transporte MCP (`http` ou `stdio`) |
| `CNJ_MCP_HOST` | `0.0.0.0` | Host de escuta |
| `CNJ_MCP_PORT` | `8000` | Porta de escuta |
| `CNJ_MCP_USUARIOS` | `./usuarios.json` | Caminho do arquivo de usuários |
| `CNJ_MCP_BANCO` | `<dir_usuarios>/cnj.db` | Caminho do banco SQLite |
| `CNJ_MCP_ARVORES_CJPG_DIR` | `./arvores_cjpg` | Cache de árvores CJPG |
| `CNJ_MCP_FERIADOS_DIR` | `./feriados_forenses` | Cache de feriados |
| `DATAJUD_API_KEY` | *(chave pública CNJ)* | Chave da API DataJud |
| `CNJ_SMTP_HOST` | — | Host SMTP para notificações |
| `CNJ_SMTP_PORT` | `587` | Porta SMTP |
| `CNJ_SMTP_USER` | — | Usuário SMTP |
| `CNJ_SMTP_PASSWORD` | — | Senha SMTP |
| `CNJ_SMTP_FROM` | — | E-mail remetente das notificações |

## Gestão de Usuários (CLI)

```bash
# Criar usuário e obter token
python server.py --criar-usuario nome-do-usuario

# Listar usuários cadastrados
python server.py --listar-usuarios
```

> **Docker:** use `docker exec cnj-processual python server.py --criar-usuario nome`

## Schema do Banco de Dados

```
usuarios          — autenticação e tokens
clientes          — pessoas físicas ou jurídicas atendidas
casos             — processos vinculados a clientes
  └ caso_atividades — tarefas e eventos do caso
monitoramentos    — acompanhamentos recorrentes no DJEN
publicacoes_oab   — publicações encontradas por monitoramento
integracao_google — tokens OAuth2 por usuário
```

## Arquitetura

```
Claude Desktop / qualquer cliente MCP
        │  MCP (stdio ou HTTP)
        ▼
   server.py  ──── FastMCP (tools de consulta judicial)
        │
        ├── ASGI handler (/app, /auth, /clientes, /casos, /monitoramentos)
        │       └── db.py (SQLite — migrações automáticas)
        │
        ├── APScheduler (verificação de monitoramentos a cada 6h)
        │       └── DJEN API → e-mail SMTP
        │
        └── APIs externas
                ├── DataJud CNJ (processos)
                ├── DJEN / Comunica PJe (publicações)
                ├── CJPG (jurimetria)
                └── Google Drive + Calendar
```

## Desenvolvimento

```bash
# Testes unitários
python -m pytest test_unit.py

# Testes manuais de integração
python test_manual.py
```

## Deploy em Produção (VPS + Caddy)

O servidor escuta em `127.0.0.1:8000`; o Caddy faz o proxy reverso com HTTPS automático.

```bash
# Configuração mínima do Caddyfile
seu-dominio.com {
    reverse_proxy 127.0.0.1:8000
}
```

### Deploy automático (GitHub Actions)

Todo push na branch `main` dispara `.github/workflows/deploy.yml`: valida a sintaxe
(Python + JS), conecta na VPS via SSH com uma deploy key dedicada, dá `git pull`,
reconstrói a imagem Docker, reinicia o container e confere `/healthz`. A pasta
`/root/apps/cnj-processual` na VPS é um clone git (remote `origin`, acessado por uma
deploy key própria, somente leitura). Segredos usados pelo workflow (`VPS_SSH_KEY`,
`VPS_HOST`, `VPS_USER`) ficam em Settings → Secrets and variables → Actions do repositório.

Acompanhar/disparar manualmente: aba **Actions** do GitHub, ou `gh workflow run deploy.yml`.

### Rebuild e restart manual (fallback)

Só necessário se o deploy automático estiver indisponível - normalmente já roda sozinho.

```bash
ssh admin@<host-vps>
sudo git -C /root/apps/cnj-processual pull --ff-only origin main
sudo docker build -t cnj-processual /root/apps/cnj-processual
sudo docker rm -f cnj-processual
sudo docker run -d --name cnj-processual --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v /root/apps/cnj-processual/dados:/app/dados \
  --env-file /root/apps/cnj-processual/.env \
  cnj-processual
```

## Licença

Veja [LICENSE.md](LICENSE.md).
