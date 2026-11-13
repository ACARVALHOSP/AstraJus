# Referência técnica — AstraJus

Inventário de endpoints HTTP, ferramentas MCP, APIs (externas e do frontend) e comandos de shell do projeto. Levantado a partir do código (`server.py`, `usuarios_admin.py`, `integracoes_http.py`, `frontend/src`, workflows e scripts).

> Ao adicionar ou remover rotas, ferramentas ou comandos, atualize este documento.

---

## 1. Endpoints HTTP (backend Python — `server.py`)

Servidor ASGI em `http://<host>:8000` (produção: atrás do Caddy em `https://191-252-110-22.sslip.io`).

### 1.1 Públicos (sem token)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/healthz` | Verificação de saúde (usada pelos deploys) |
| GET, POST | `/cadastro` | Página e envio de autocadastro de usuário (reCAPTCHA) |
| GET | `/app` | Interface legada (HTML/JS vanilla + Carbon) |
| GET | `/novo`, `/novo/assets/*` | Build do frontend React servido pelo backend |
| GET | `/guia` | Guia do usuário (`guia-do-usuario.html`) |
| GET | `/static/*` | JS/CSS da interface legada, bibliotecas vendorizadas e `/static/icons/*` (logos das integrações) |
| GET | `/cep/<cep>` | Proxy para o ViaCEP |
| GET | `/certidoes/<arquivo>?exp=&sig=` | Download de certidão DJEN por link assinado e com validade |
| GET | `/.well-known/oauth-protected-resource` | Metadados OAuth do recurso MCP |
| GET | `/.well-known/oauth-authorization-server` | Metadados do servidor de autorização |
| POST | `/oauth/register` | Registro dinâmico de cliente OAuth |
| GET, POST | `/oauth/authorize` | Página e confirmação de autorização OAuth |
| POST | `/oauth/token` | Emissão de token OAuth |
| GET | `/integracoes/google/callback` | Retorno do OAuth do Google (integrações) |

O frontend Radix (`/radix/`) é servido diretamente pelo Caddy a partir de `/srv/astrajus-radix/`, sem passar pelo backend.

### 1.2 MCP

| Método | Rota | Descrição |
|---|---|---|
| POST (+ GET/DELETE do transporte Streamable HTTP) | `/mcp` | Servidor MCP. Exige `Authorization: Bearer <token>` de usuário ativo, com limite de uso |

### 1.3 Autenticados (`Authorization: Bearer <token>`)

**Usuário e responsáveis**

| Método | Rota | Descrição |
|---|---|---|
| GET, PATCH | `/responsaveis/me` | Perfil da pessoa conectada; PATCH altera só `nome_completo`, `email` e `foto` (data URL JPEG/PNG/WebP de até ~150 mil caracteres; `""` remove). Vale também para o nível Consulta |
| GET | `/responsaveis` | Lista de responsáveis do escritório |

**Contatos (clientes)**

| Método | Rota | Descrição |
|---|---|---|
| GET, POST | `/clientes` | Lista / cria contato |
| GET, PATCH, DELETE | `/clientes/<id>` | Detalhe, atualização e exclusão (recusada se for cliente de algum caso) |
| POST | `/clientes/acoes-em-massa` | Etiquetas e perfil em lote |

**Processos (casos)**

| Método | Rota | Descrição |
|---|---|---|
| GET, POST | `/casos` | Lista / cria caso. Cada caso da lista traz também `proximo_compromisso` (atividade aberta com data mais próxima), `publicacoes_a_revisar` (publicações não tratadas vinculadas) e `ultima_movimentacao_data`/`ultima_movimentacao_descricao` (último movimento do DataJud ou última publicação) |
| GET, PATCH, DELETE | `/casos/<id>` | Caso com linha do tempo, atualização e exclusão; o GET traz `contagens` (`atividades_abertas`, `publicacoes_a_revisar`) para as abas. O DELETE devolve 409 com a lista do que falta resolver se o processo ainda tem lançamentos financeiros, horas lançadas ou vínculo ativo de agenda; cronômetro, decisões de modelos e ciências de prazo somem junto |
| GET, POST | `/casos/<id>/atividades` | Lista / cria atividade; cada item traz `checklist` (`{total, concluidos}` ou `null`) |
| PATCH, DELETE | `/casos/<id>/atividades/<aid>` | Atualiza / exclui atividade |
| GET, POST | `/casos/<id>/atividades/<aid>/checklist` | Itens do checklist |
| PATCH, DELETE | `/casos/<id>/atividades/<aid>/checklist/<item>` | Atualiza / exclui item |
| GET, POST, PATCH, DELETE | `/casos/<id>/atividades/<aid>/agenda` | Sincronização da atividade com a agenda Google do usuário |
| GET, POST | `/horas` | Lista (filtros `de`, `ate`, `usuario`, `caso_id`, `cliente_id`, `faturavel`, `faturado`; devolve `horas` e `totais`) / lança horas num processo (só o administrador lança em nome de outra pessoa) |
| PATCH, DELETE | `/horas/<id>` | Corrige / exclui (só quem lançou ou administrador; 409 se já faturadas) |
| GET | `/horas/relatorio` | Totais por pessoa e por processo (mesmos filtros) |
| GET, PUT | `/horas/tarifas[/<usuario>]` | Valor por hora (GET: o administrador vê todos, os demais só o próprio; PUT: só administrador; o valor é gravado em cada lançamento no momento em que ele é criado) |
| GET, POST, DELETE | `/horas/cronometro` | Cronômetro individual: estado / liga (um por pessoa; 409 se já ligado) / descarta |
| POST | `/horas/cronometro/parar` | Para o cronômetro e lança as horas (arredonda para cima, mínimo de 1 minuto, máximo de 24 h) |
| POST | `/horas/faturar` | Cria UM lançamento de honorário no Financeiro com horas faturáveis de um só processo (`ids`, `vencimento`, `descricao`); exige edição em Lançamentos; reserva as horas antes (nunca cobra duas vezes), 409 se já faturadas |
| GET, POST, PATCH, DELETE | `/modelos-prazo[/<id>]` | Modelos de prazos e tarefas por assunto ou classe processual (leitura: atividades ou processos; escrita: atividades) |
| GET | `/casos/<id>/modelos-prazo` | Modelos ativos que combinam com a ação, a classe ou os assuntos do processo e ainda não foram aplicados nem dispensados nele |
| POST | `/casos/<id>/modelos-prazo/<modelo>/aplicar` | Cria as atividades já revisadas (`itens: [{tipo, titulo, data}]`); 409 se o modelo já foi decidido no processo; desfaz tudo se a criação falhar no meio |
| POST | `/casos/<id>/modelos-prazo/<modelo>/dispensar` | Não sugerir mais este modelo neste processo |
| POST | `/casos/<id>/atividades/<aid>/ciencia` | Confirma ciência de um prazo (só `tipo=prazo`; vale a primeira confirmação da data atual do prazo; 404 se não for prazo) |
| POST | `/casos/<id>/evento-calendar` | Cria evento de dia inteiro no Google Calendar |
| GET, POST | `/casos/<id>/publicacoes` | Publicações vinculadas ao caso / vincular |
| DELETE | `/casos/<id>/publicacoes/<hash>` | Desvincula publicação |
| GET, POST | `/casos/<id>/vinculos` | Processos relacionados (`{caso_vinculado_id, tipo}`); a lista traz `criado_em` de cada vínculo |
| DELETE | `/casos/<id>/vinculos/<vid>` | Remove vínculo |
| GET, PATCH | `/casos/<id>/processos/<numero>/capa` | Capa do processo / campos manuais |
| POST | `/casos/<id>/processos/<numero>/capa/atualizar` | Preenche a capa via DataJud + DJEN (`{tribunal}`) |
| POST, DELETE | `/casos/<id>/processos/<numero>/capa/monitorar` | Cria / remove monitoramento do processo |

**Atividades (todas)**

| Método | Rota | Descrição |
|---|---|---|
| GET | `/atividades` | Atividades de todos os processos (telas Atividades e Meu dia). Parâmetros: `situacao` (`abertas` padrão, `concluidas`, `todas`), `tipo`, `responsavel` (`__sem__` = sem responsável), `responsavel_processo`, `busca`. Cada item traz `caso` (id, título, responsável, números), `checklist` (`{total, concluidos}` ou `null`) e `agenda` |

**Financeiro e pagamentos**

| Método | Rota | Descrição |
|---|---|---|
| GET, POST | `/lancamentos` | Lista / cria lançamentos (parcelados ou não) |
| PATCH, DELETE | `/lancamentos/<id>` | Marca como pago/recebido / exclui |
| POST | `/lancamentos/<id>/cobranca` | Emite boleto no Asaas para o lançamento |
| GET, POST | `/pagamentos` | Lista (`?cliente_id=&status=&offset=`) / cria cobrança Asaas. Com `?situacao=a_receber\|vencidas\|recebidas\|todas` (e `forma`, `vencimento_de`, `vencimento_ate`, `busca`, `offset`, `atualizar=1`) devolve o painel a partir da cópia local das cobranças (refeita a cada 30 min ou com `atualizar=1`; mantida pelo webhook): `resumo`, `contagens`, `cobrancas` (20 por página), `totalCount`, `hasMore`, `truncado`, `atualizado_em`, `aviso` |
| DELETE | `/pagamentos/<id>` | Cancela cobrança ainda não paga |
| POST | `/asaas/webhook` | Avisos do Asaas sobre cobranças (sem token de usuário; exige o cabeçalho `asaas-access-token` igual a `ASAAS_WEBHOOK_TOKEN`). Atualiza a cópia local usada pela tela Pagamentos |
| GET | `/preferencias` | Favoritos e histórico do usuário (`favoritos_casos`, `favoritos_consultas`, `historico_consultas`) |
| PUT | `/preferencias/<chave>` | Substitui uma dessas listas (`{"valor": [...]}`, até 500 itens) |

**Publicações OAB, pendências e automações**

| Método | Rota | Descrição |
|---|---|---|
| GET | `/publicacoes-oab` | Publicações capturadas por OAB. Parâmetros: `status`, `tipo`, `desde`/`ate` (AAAA-MM-DD), `busca`, `ordem` (`divulgado_desc`, `divulgado_asc`, `capturado_desc`, `capturado_asc`), `pagina`, `tamanho`. Devolve também `contagem_status`, `tipos_disponiveis` e `caso_titulo` em cada publicação |
| POST | `/publicacoes-oab/status` | Atualização de status em lote (`{hashes, status}`) |
| POST | `/publicacoes-oab/capturar-manual` | Captura sob demanda por OAB + intervalo de datas |
| POST | `/publicacoes-oab/<hash>/criar-caso` | Cria caso a partir da publicação |
| GET | `/pendentes` | Processos pendentes de cadastro |
| POST | `/pendentes/<numero>/descartar` | Descarta pendência |
| GET | `/automacoes` | Histórico das rotinas automáticas de monitoramento |

**Notificações**

| Método | Rota | Descrição |
|---|---|---|
| GET | `/notificacoes` | Lista notificações do usuário |
| PATCH | `/notificacoes/<id>` | Marca como lida |
| GET | `/notificacoes/<id>/destino` | Destino de navegação da notificação |

**Integrações e jurimetria**

| Método | Rota | Descrição |
|---|---|---|
| GET | `/integracoes/status` | Estado das integrações (Google, Asaas, ZapSign) |
| GET | `/integracoes/calendar/status` | Estado da agenda Google do usuário |
| POST | `/integracoes/calendar/conectar` | Inicia a conexão da agenda individual |
| POST | `/integracoes/calendar/desconectar` | Desconecta a agenda |
| GET | `/cjpg-arvore/filhos` | Árvore Vara/Classe/Assunto do CJPG (autocomplete) |
| GET | `/cjpg-arvore/buscar` | Busca na árvore do CJPG |
| GET | `/cjpg-arvore/resolver` | Casa `numero` (CNJ), `vara`, `classe` e `assunto` da capa com os códigos do CJPG: foro pelos 4 últimos dígitos do número, vara dentro do foro (variantes agrupadas), classe e assunto por nome com o ramo; devolve candidatos e `escolhido` só quando a confiança é alta e sem ambiguidade. Só TJSP (`{"tjsp": false}` nos demais) |
| GET | `/cjpg-arvore/magistrados` | Lista de magistrados do CJPG |

### 1.4 Administração (token administrativo)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin` | Painel administrativo |
| POST | `/admin/acao` | Ações `criar` / `revogar` usuário |
| POST | `/admin/google/iniciar` | Inicia OAuth da conta Google institucional |
| GET | `/admin/google/callback` | Retorno do OAuth Google |
| POST | `/admin/google/desconectar` | Desconecta a conta Google institucional |
| GET, POST | `/admin/usuarios/api` | Lista / cria usuário |
| PATCH | `/admin/usuarios/api/<login>` | Atualiza usuário |
| DELETE | `/admin/usuarios/api/<login>` | Apaga o usuário: processos, atividades e lançamentos financeiros ficam sem responsável; remove monitoramentos, notificações e preferências; mantém horas. Recusa a própria conta, o último administrador e quem tem Google Agenda sincronizada |
| GET | `/admin/usuarios/api/<login>/vinculos` | Contagem do que a exclusão afeta (para a confirmação) |
| POST | `/admin/usuarios/api/<login>/token` | Gera novo token (invalida o anterior); corpo `{"enviar_email": bool}`; devolve o token uma única vez e o resultado do e-mail |
| GET | `/admin/usuarios/historico` | Histórico administrativo |
| GET | `/admin/usuarios/acessos` | Últimos acessos |
| GET | `/admin/banco/api` | Estatísticas do banco |
| POST | `/admin/banco/integridade` | Verificação de integridade |
| POST | `/admin/banco/limpar` | Limpeza de dados antigos |
| POST | `/admin/banco/backup` | Gera backup do banco |
| GET | `/admin/integracoes` | Página de integrações |
| GET | `/admin/integracoes/api` | Estado das credenciais |
| POST | `/admin/integracoes/candidato` | Cadastra credencial candidata |
| POST | `/admin/integracoes/testar` | Testa credencial candidata |
| POST | `/admin/integracoes/ativar` | Ativa credencial testada |
| POST | `/admin/integracoes/ambiente` | Alterna ambiente (ex.: Asaas sandbox/produção) |
| POST | `/admin/integracoes/desativar` | Desativa integração |
| POST | `/admin/integracoes/rotacionar` | Rotaciona a chave de criptografia do cofre |
| POST | `/admin/integracoes/google` | Configura OAuth Google |
| POST | `/admin/integracoes/google/desconectar` | Desconecta Google |
| POST | `/admin/integracoes/administrador` | Define o administrador das integrações |

---

## 2. Ferramentas MCP (`@mcp.tool()` em `server.py`)

Servidor MCP `cnj-processual` (FastMCP), via `stdio` ou `http` (`/mcp`).

| Ferramenta | Parâmetros | Descrição |
|---|---|---|
| `status_apis` | — | Estado dos circuit breakers do DataJud e do DJEN |
| `consultar_processo_datajud` | `tribunal`, `numero_processo` | Capa e movimentações no DataJud (CNJ) |
| `consultar_publicacoes_djen` | `numero_processo`, `sigla_tribunal`, `numero_oab`, `uf_oab`, `data_disponibilizacao_inicio`, `data_disponibilizacao_fim`, `pagina`, `itens_por_pagina` | Publicações e intimações no DJEN |
| `consultar_processo_unificado` | `tribunal`, `numero_processo` | DataJud (capa + movimentos) + DJEN (partes e advogados) |
| `buscar_feriados_forenses` | `municipio`, `ano`, `tribunal` | Feriados forenses por comarca/ano, para cálculo de prazos |
| `consultar_jurimetria_cjpg` | `termo`, `classe_codigo`, `classe_nome`, `assunto_codigo`, `assunto_nome`, `vara_codigo`, `magistrado_codigo`, `magistrado_nome`, `data_inicio`, `data_fim`, `paginas` | Julgados de 1º grau do TJSP (CJPG) com estatísticas de valor/desfecho |
| `consultar_jurisprudencia_tjsp` | `termo`, `buscar_em`, `data_julgamento_inicio`, `data_julgamento_fim`, `relator`, `relatores`, `classe`, `classes`, `comarcas`, `orgao_julgador`, `orgaos_julgadores`, `ordenacao`, `pagina` | Acórdãos da base "Jurisprudência Selecionada" do TJSP |
| `perfil_decisorio_magistrado` | `magistrado_codigo`, `magistrado_nome`, `termo`, `classe_codigo`, `assunto_codigo`, `vara_codigo`, `data_inicio`, `data_fim`, `paginas` | Perfil decisório de um magistrado no CJPG |
| `baixar_certidao_djen` | `hash` | Baixa a certidão PDF de uma publicação do DJEN (link assinado) |
| `monitorar_publicacoes` | `numero_processo`, `sigla_tribunal`, `numero_oab`, `uf_oab`, `nome` | Cria monitoramento de processo/OAB com aviso por e-mail |
| `listar_monitoramentos` | — | Monitoramentos ativos do usuário |
| `renovar_monitoramento` | `id` | Renova por 180 dias |
| `remover_monitoramento` | `id` | Remove monitoramento |

---

## 3. APIs

### 3.1 APIs externas consumidas pelo backend

| Serviço | Base | Uso |
|---|---|---|
| DataJud (CNJ) | `https://api-publica.datajud.cnj.jus.br` | Capa e movimentações (`DATAJUD_API_KEY`) |
| DJEN / Comunica PJe | `https://comunicaapi.pje.jus.br/api/v1/comunicacao` | Publicações, intimações e certidões |
| TJSP — CJPG | `https://esaj.tjsp.jus.br/cjpg` | Jurimetria 1º grau (scraping) |
| TJSP — Jurisprudência | `https://esaj.tjsp.jus.br` | Acórdãos (API interna não oficial) |
| TJSP — Feriados | `https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense` | Feriados forenses |
| Asaas | `https://api.asaas.com/v3` (sandbox: `https://api-sandbox.asaas.com/v3`) | Cobranças (boleto/Pix) |
| Google OAuth | `accounts.google.com`, `oauth2.googleapis.com/token` | Autorização Drive/Calendar |
| Google Calendar | `https://www.googleapis.com/calendar/v3` | Eventos de atividades |
| Google Drive | `https://www.googleapis.com/drive/v3/files` | Pastas e arquivos do escritório |
| ZapSign | `https://api.zapsign.com.br/api/v1/docs/` | Assinatura digital (teste de conexão) |
| ViaCEP | `https://viacep.com.br/ws/` | Endereço por CEP |
| Google reCAPTCHA | `https://www.google.com/recaptcha/api/siteverify` | Proteção do autocadastro |

### 3.2 Funções de API do frontend React (`frontend/src`)

| Função | Arquivo | Descrição |
|---|---|---|
| `ClienteMCP.iniciar()` | `api/mcpClient.ts` | Handshake `initialize` com `/mcp` |
| `ClienteMCP.chamarFerramenta(nome, args)` | `api/mcpClient.ts` | `tools/call` para as ferramentas da seção 2 |
| `buscarJson(cliente, url, signal?)` | `api/rest.ts` | GET autenticado nos endpoints da seção 1.3 |
| `enviarJson(cliente, url, metodo, corpo)` | `api/rest.ts` | POST/PATCH/DELETE autenticado |
| `ClienteProvider` / `useCliente()` | `api/ClienteContext.tsx` | Token, estado de conexão e cliente MCP compartilhados |
| `NavegacaoProvider` / `useNavegacao()` | `api/NavegacaoContext.tsx` | Navegação por hash (`#/<aba>`) e payloads entre telas |

Ferramentas MCP chamadas pelo frontend: `consultar_processo_datajud`, `consultar_publicacoes_djen`, `consultar_jurisprudencia_tjsp`, `consultar_jurimetria_cjpg`, `perfil_decisorio_magistrado`, `buscar_feriados_forenses`, `baixar_certidao_djen`, `monitorar_publicacoes`, `listar_monitoramentos`, `renovar_monitoramento`, `remover_monitoramento`.

Utilitários: `utils/formatadores.ts` (datas, CNJ, moeda, nomes), `utils/listasRapidas.ts` (histórico e favoritos no `localStorage`), `utils/mascaras.ts`, `utils/parcelas.ts`, `utils/tribunalPorNumero.ts`.

---

## 4. Comandos de shell

### 4.1 Servidor (`server.py`)

```bash
python server.py                                   # MCP via stdio (padrão, uso local)
python server.py --transport http                  # HTTP: painel /app e MCP em /mcp
python server.py --transport http --host 0.0.0.0 --port 8000
python server.py --criar-usuario NOME              # cria usuário e mostra o token uma vez
python server.py --revogar-usuario NOME
python server.py --listar-usuarios
python server.py --gerar-token-admin               # novo token admin (só o hash vai ao banco)
python server.py --atualizar-arvores-cjpg          # baixa árvores Vara/Classe/Assunto/Magistrado do CJPG
```

### 4.2 Desenvolvimento local

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
cd frontend && npm ci
npm run dev          # Vite em http://localhost:5174/radix/ (proxy para o backend na :8000)
npm run build        # tsc -b && vite build
npm run lint         # oxlint
npm run preview
```

### 4.3 Testes

```bash
python -m pytest test_unit.py test_processos.py test_origem_djen.py test_agenda_atividades.py test_notificacoes.py test_clientes_lote.py
python -m pytest test_interface.py test_*_interface.py   # interface legada; exige navegador
python test_manual.py                                     # integração real com APIs externas
node --test frontend/tests/                               # testes do frontend
node test_feedback_requests.cjs                            # static/app.js (legado)
node test_progress_controls.cjs
```

### 4.4 Docker

```bash
docker build -t cnj-processual .
docker run -d --name cnj-processual --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v /dados:/app/dados --env-file .env cnj-processual
docker exec cnj-processual python server.py --criar-usuario NOME
```

### 4.5 Instaladores do cliente MCP (Claude Code / Claude Desktop)

```bash
bash instalador/instalar-unix.sh
bash instalador/instalar-unix.sh --url https://outro-servidor/mcp
```

```powershell
.\instalador\instalar-windows.ps1
.\instalador\instalar-windows.ps1 -Url https://outro-servidor/mcp
```

O token é pedido sem eco ou lido de `CNJ_TOKEN`.

### 4.6 Deploy (GitHub Actions)

| Workflow | Disparo | O que executa |
|---|---|---|
| `deploy-radix.yml` | push na `astrajus-radix` | `npm ci && npm run build` → rsync de `frontend/dist/` para `/srv/astrajus-radix/` → `systemctl reload caddy` → `curl /radix/` |
| `deploy.yml` | push/merge na `main` | `py_compile` + `node --check` → SSH: `git pull --ff-only`, `docker build`, `docker run`, `python3 deploy_token_admin.py` → `/healthz` |
| `deploy-frontend.yml` | push na `astrajus-react` | build + `frontend/deploy/publish.sh` (release atômico em `/srv/astrajus-frontend`) |

Scripts usados no VPS:

```bash
sudo python3 /root/apps/cnj-processual/deploy_token_admin.py   # migra/valida a credencial admin
sudo -n bash /tmp/publish.sh <SHA>                             # publica release do frontend /novo (enviado pelo workflow)
sudo python3 frontend/deploy/configure_proxy.py                # provisionamento inicial do Caddy
```

---

## 5. Variáveis de ambiente

| Variável | Uso |
|---|---|
| `CNJ_MCP_TRANSPORT`, `CNJ_MCP_HOST`, `CNJ_MCP_PORT` | Transporte e endereço do servidor |
| `CNJ_MCP_USUARIOS`, `CNJ_MCP_BANCO` | Diretório de dados e nome do banco SQLite (`cnj.db`) |
| `CNJ_MCP_ARVORES_CJPG_DIR`, `CNJ_MCP_FERIADOS_DIR` | Caches persistentes |
| `CNJ_MCP_URL_PUBLICA`, `CNJ_MCP_HOSTS_PERMITIDOS` | URL pública e hosts aceitos pelo MCP |
| `CNJ_MCP_SEGREDO`, `CNJ_MCP_ADMIN_TOKEN` (legado) | Assinatura de links e token admin antigo |
| `CNJ_INTEGRACOES_CHAVE`, `CNJ_INTEGRACOES_CHAVES_ANTERIORES` | Chave do cofre de credenciais |
| `DATAJUD_API_KEY` | Chave do DataJud |
| `ASAAS_API_KEY`, `ASAAS_API_KEY_SANDBOX`, `ASAAS_AMBIENTE` | Asaas |
| `CNJ_GOOGLE_CLIENT_ID`, `CNJ_GOOGLE_CLIENT_SECRET`, `CNJ_GOOGLE_DRIVE_PASTA_RAIZ` | Google |
| `CNJ_SMTP_HOST`, `CNJ_SMTP_PORTA`, `CNJ_SMTP_USUARIO`, `CNJ_SMTP_SENHA`, `CNJ_SMTP_REMETENTE` | E-mail dos monitoramentos |
| `CNJ_RECAPTCHA_SITE_KEY`, `CNJ_RECAPTCHA_SECRET`, `CNJ_CADASTRO_TEMPO_MINIMO_S` | Proteção do autocadastro |
