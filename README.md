# AstraJus

**Gestão de processos, prazos e financeiro para escritórios de advocacia, com as publicações do Diário de Justiça e os dados do CNJ dentro do próprio sistema.**

O AstraJus reúne num só lugar o que o advogado costuma espalhar entre planilhas, e-mails, agendas e consultas em sites de tribunais: cadastro de clientes e processos, publicações do DJEN, andamentos do DataJud, atividades e prazos, agenda, cobranças e financeiro. Também é um **servidor MCP**, o que permite consultar tribunais e publicações a partir de assistentes de IA compatíveis, como o Claude.

> Licença **PolyForm Noncommercial 1.0.0**: o uso comercial (inclusive hospedar o serviço para terceiros) exige licença separada. Veja [LICENSE.md](LICENSE.md).

## Sumário

- [Destaques](#destaques)
- [Funcionalidades](#funcionalidades)
  - [Início](#início)
  - [Publicações recebidas](#publicações-recebidas)
  - [Processos](#processos)
  - [Atividades, prazos e agenda](#atividades-prazos-e-agenda)
  - [Contatos e clientes](#contatos-e-clientes)
  - [Financeiro e pagamentos](#financeiro-e-pagamentos)
  - [Pesquisa](#pesquisa)
  - [Notificações e busca](#notificações-e-busca)
  - [Administração, acesso e permissões](#administração-acesso-e-permissões)
- [Automações em segundo plano](#automações-em-segundo-plano)
- [Integrações](#integrações)
- [Servidor MCP](#servidor-mcp)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Stack e arquitetura](#stack-e-arquitetura)
- [Início rápido](#início-rápido)
- [Configuração](#configuração)
- [Testes](#testes)
- [Deploy](#deploy)
- [O que ainda não existe](#o-que-ainda-não-existe)
- [Documentação adicional](#documentação-adicional)

## Destaques

- **Publicações do DJEN capturadas sozinhas** por OAB, com aviso quando a publicação é destinada a um cliente do escritório.
- **Capa do processo preenchida automaticamente** (DataJud + DJEN): classe, assuntos, órgão julgador, município, sigilo, partes, advogados e movimentações.
- **Prazos processuais calculados** em dias úteis ou corridos, com feriados, suspensão de 20/12 a 20/01 e prazo em dobro, sempre como sugestão a ser revisada pelo advogado.
- **Alertas de vencimento** de prazos e audiências no sino do sistema e por e-mail, com confirmação de ciência e aviso aos administradores quando ninguém confirma.
- **Agenda** em mês, semana e dia, com sincronização opcional com o Google Agenda.
- **Financeiro jurídico:** honorários, êxito, custas reembolsáveis, repasses, parcelamento, inadimplência por faixa de atraso e saldo por processo.
- **Cobranças por boleto e Pix** via Asaas.
- **Permissões por área** para cada pessoa da equipe.
- **Sem duplicação:** a mesma publicação ou movimentação não aparece duas vezes, mesmo com captura manual.
- **Servidor MCP** com 13 ferramentas de consulta judicial para assistentes de IA.

## Funcionalidades

### Início

Duas visões:

- **Meu dia:** quadro de atividades da pessoa (a fazer, em andamento, aguardando, concluídas), com filtros e arrastar entre colunas.
- **Escritório:** resumo do escritório inteiro: prazos da semana, atividades atrasadas, publicações por revisar (com quantas são de clientes) e valores vencidos a receber; lista dos prazos e audiências dos próximos 7 dias e dos maiores valores vencidos. Os blocos financeiros só aparecem para quem tem acesso ao Financeiro.

### Publicações recebidas

- Captura automática de publicações do DJEN por **OAB** (a cada 24 horas) e **captura manual** por OAB e período.
- Tabela com filtros por situação (não tratadas, tratadas, arquivadas), tipo, período, busca por número, parte ou advogado, ordenação, colunas opcionais, seleção em lote e atalhos de teclado.
- **Destino da publicação:** se algum destinatário é cliente do escritório, a linha ganha o selo "❗ Cliente (parte passiva): Nome" e uma faixa vermelha; se é a parte contrária, o selo "Parte contrária". Há ordenação "Prioridade: clientes primeiro" e um aviso com a contagem.
- Reconhecimento **estrito** de clientes: CPF/CNPJ igual ou nome completo igual; nome parcial, homônimo ou dois cadastros iguais não geram alerta.
- **Criar ou vincular processo** direto da publicação: cria o processo e a pasta no Drive, preenche a capa e acompanha o andamento da operação.
- **Criar atividade com prazo** a partir da publicação (veja [Atividades, prazos e agenda](#atividades-prazos-e-agenda)).
- **Sem duplicadas:** além do identificador do DJEN, cada publicação tem uma identidade pelo conteúdo (processo, data, tribunal, tipo e texto); a mesma intimação que chega de novo com outro identificador não é gravada outra vez.
- **Triagem opcional (experimental, desligada por padrão):** sugere tipo, "abre prazo", prazo provável e urgência (1 a 10), com selos de confiança e ordenação por urgência. O texto vai ao classificador **sem nomes**, CPF/CNPJ, e-mails, telefones, OAB e números de processo. Modos: `desligado`, `simulado` (demonstração) e `jev` (API da TypeSafe AI, ainda não exercitada com chave real). Veja [docs/integracoes.md](docs/integracoes.md).
- **Monitoramentos** como segunda aba: acompanhamento de processo ou OAB no DJEN com aviso por e-mail.

### Processos

- Lista com busca, filtros (responsável, tribunal, situação), atalhos (em andamento, publicação a revisar, prazo atrasado, parado, encerrados, favoritos), ordenação por coluna, escolha de colunas, paginação e **exportação em CSV**.
- **Cadastro** com cliente principal e adicionais, responsável, ação, foro, partes, desfecho e pasta. O cliente é escolhido por busca de nome ou CPF/CNPJ.
- **Capa do processo** (DataJud + DJEN): tribunal, classe, assuntos, grau, distribuição, órgão julgador, município e UF, nível de sigilo, partes e advogados. Considera todas as instâncias (assuntos de todas, município do 1º grau, maior sigilo). Atualização manual e automática.
- **Posição do cliente no processo:** parte ativa, passiva ou terceiro, deduzida da capa e das publicações e corrigível no cabeçalho do processo. Aparece também na ficha do contato.
- **Abas:** Cadastro, Atividades, Publicações, Movimentações e Vínculos.
- **Movimentações** com a instância de cada andamento, destaque dos atos do juízo e sem linhas repetidas; consulta direta ao DataJud sob demanda.
- **Vínculos entre processos** (recursos, apensos, execuções), com busca por título, parte ou número e desfazer ao remover.
- **Pasta no Google Drive** criada automaticamente: `CLIENTES / Nome do cliente / Título do processo`, com botão para abrir ou criar quando faltar.
- **Aviso de novo andamento:** quando o DataJud traz um andamento novo, o responsável é notificado.

### Atividades, prazos e agenda

- **Atividades** globais com tipos (tarefa, prazo, audiência, reunião, outro), situação, responsável, data, hora, observações e **checklist**; ações em lote e criação a partir de qualquer processo.
- **Calculadora de prazos processuais** (Agenda → *Calcular prazo*, ou a partir de uma publicação):
  - 15 prazos-padrão do CPC e da Lei 9.099/95 com a base legal (contestação, réplica, apelação, embargos de declaração, agravos, cumprimento de sentença e outros);
  - contagem em **dias úteis** ou **corridos** (com prorrogação para o primeiro dia útil), **prazo em dobro** (CPC arts. 180, 183, 186 e 229), publicação no primeiro dia útil seguinte à disponibilização e suspensão de 20/12 a 20/01 (art. 220);
  - feriados nacionais e estaduais, e municipais do TJSP;
  - demonstrativo dia a dia com impressão/PDF e **revisão obrigatória** antes de confirmar a data.
- **Alertas de vencimento:** prazos e audiências a 5, 2 e 1 dia, no dia e, para prazos, até 3 dias depois de vencer, no sino e por e-mail (com SMTP configurado). Cada aviso sai uma vez por pessoa e some quando a atividade é concluída.
- **Confirmação de ciência e escalonamento (só prazos):** nas notificações de prazo há o botão "Confirmar ciência". Se, com 1 dia para vencer, no dia ou já vencido, ninguém confirmou até a execução seguinte ao primeiro aviso, os administradores que ainda não foram avisados recebem "Prazo sem confirmação de ciência" (sino e e-mail), uma vez por prazo. A confirmação vale para a data do prazo: se a data mudar, ela deixa de valer.
- **Agenda** em visão de mês, semana e dia, com filtros por tipo e responsável, **arrastar para remarcar** (com desfazer), criação a partir do dia escolhido e **exportação .ics**.
- **Google Agenda:** vínculo opcional de uma atividade com evento de dia inteiro, com reconciliação persistida e tratamento de conflitos.

> As datas calculadas são **sugestões**. Feriados municipais fora do TJSP, portarias e suspensões específicas do tribunal precisam ser conferidos pelo advogado.

### Contatos e clientes

- Cadastro de **pessoa física e jurídica**, com perfil cliente ou contato, vários telefones, e-mails, sites e endereços (busca de CEP), documentos e dados complementares.
- **Preenchimento automático pelo CNPJ** (Receita Federal, via BrasilAPI): razão social, nome fantasia, telefones, e-mail e endereço, com situação cadastral e aviso quando a empresa não está ativa.
- Validação de CPF/CNPJ, máscaras de telefone, conferência de e-mail e bloqueio de cadastro duplicado.
- Ficha com abas **Cadastro**, **Processos vinculados** (com a posição do cliente em cada um) e **Financeiro** do cliente.
- Etiquetas, ações em massa com prévia e importação em lote.
- Pasta do cliente no Drive.

### Financeiro e pagamentos

- **Lançamentos** de receita e despesa com categorias: honorário contratual, honorário de êxito, custas e despesas do processo, repasse e outros.
- **Parcelamento** feito de uma vez no servidor (centavos exatos, até 120 parcelas), repetição mensal, baixa com a data do pagamento e ações em lote.
- **Custas reembolsáveis:** a custa adiantada pode gerar a cobrança de reembolso ao cliente, uma por custa.
- **Repasses** ao cliente ou a terceiros, ligados ao valor recebido de origem.
- **Por processo:** honorários previstos, recebidos, em aberto e vencidos, custas gastas e a cobrar, repasses pendentes e saldo.
- **Inadimplência:** total vencido, taxa, valor por faixa de atraso (1–30, 31–60, 61–90 e mais de 90 dias) e devedores por cliente, com geração de cobrança e lembrete pronto para copiar.
- **Pagamentos (Asaas):** cobranças por boleto e Pix, status, parcelamento e recebimento atualizado por webhook, com ambiente de homologação separado do de produção.
- **Exportação em CSV** (abre no Excel em português) de Lançamentos, Processos e Inadimplência, com a lista como está filtrada na tela.

### Pesquisa

- **Consultar processo:** DataJud (todos os tribunais) com junção do DJEN, por número CNJ.
- **Buscar no DJEN:** campo único que aceita número de processo, nome ou OAB.
- **Jurisprudência do TJSP** e **Jurimetria** (CJPG): perguntas guiadas, perfil decisório de magistrado e árvores de referência de varas, classes e assuntos.
- **Histórico e favoritos** de consultas, guardados no servidor e válidos em qualquer navegador.
- **Certidão da publicação** em PDF por link assinado e com validade.

### Notificações e busca

- **Central de notificações** (sino): atividade atribuída, publicação monitorada, novo andamento e prazo vencendo; filtro, "marcar todas como lidas" e abrir direto no destino. Retenção de 180 dias.
- **Busca global** (Ctrl+K ou ⌘K): telas, clientes e processos.
- **Avisos com desfazer**, alerta de **alterações não salvas** e tema claro/escuro com cor de destaque à escolha.
- Interface responsiva, com tabelas que viram cartões no celular, e atenção à acessibilidade (rótulos, foco, leitores de tela).

### Administração, acesso e permissões

- **Usuários** com nível de acesso (administrador, operador, consulta) e status (ativo, pendente, bloqueado, revogado), criados pelo administrador, por linha de comando ou por autocadastro com e-mail.
- **Permissões por área** por pessoa: Processos, Atividades, Publicações recebidas, Contatos, Pesquisa, Lançamentos, Pagamentos e Integrações, cada uma como "ver e alterar", "somente ver" ou "sem acesso". O servidor recusa o acesso de verdade, e o menu esconde o que a pessoa não pode usar.
- Histórico de alterações de usuários e registro de acessos (sem IP e sem conteúdo consultado).
- **Banco de dados:** backup, verificação de integridade e limpeza de categorias técnicas pela administração.
- **Integrações** configuráveis pelo painel, com credenciais cifradas (veja [Integrações](#integrações)).

## Automações em segundo plano

| Rotina | Frequência | O que faz |
|---|---|---|
| Monitoramentos | a cada 6 horas | Consulta o DJEN por processo ou OAB e avisa por e-mail quando há publicação nova |
| Captura por OAB | a cada 24 horas | Grava as publicações do DJEN encontradas por OAB |
| Andamentos | a cada 12 horas | Reconsulta os processos no DataJud, atualiza a capa e avisa o responsável de andamento novo |
| Alertas de prazo | a cada 6 horas | Avisa prazos e audiências próximos do vencimento |
| Triagem de publicações | a cada hora (se ligada) | Classifica as publicações novas |
| Google Agenda | a cada hora (se conectado) | Sincroniza atividades vinculadas |

## Integrações

| Integração | Uso |
|---|---|
| **DataJud** (CNJ) | Metadados e movimentações de processos de todos os tribunais |
| **DJEN** (Comunica PJe) | Publicações e intimações por OAB ou número de processo |
| **Google Drive** | Pastas de cliente e de processo, na conta institucional do escritório |
| **Google Agenda** | Evento de dia inteiro por atividade, conectado por cada pessoa |
| **Asaas** | Cobranças por boleto e Pix, com homologação e produção |
| **BrasilAPI** | Dados cadastrais de CNPJ |
| **ViaCEP** | Endereço pelo CEP |
| **TJSP** | Feriados forenses por comarca, jurisprudência e CJPG |
| **ZapSign** | Configuração, teste e ativação da API (o envio para assinatura ainda não faz parte do sistema) |
| **TypeSafe AI (Jev)** | Triagem de publicações, opcional e experimental |
| **SMTP** | E-mails de monitoramento e de alerta de prazo |

As credenciais ficam **cifradas no banco** (Fernet), com cadastro, teste e ativação pelo painel, sem reiniciar o serviço. Veja [docs/integracoes.md](docs/integracoes.md).

## Servidor MCP

O endpoint `/mcp` (Streamable HTTP) e o modo `stdio` expõem estas ferramentas a assistentes de IA compatíveis:

| Ferramenta | Descrição |
|---|---|
| `status_apis` | Estado das APIs externas e dos circuitos de proteção |
| `consultar_processo_datajud` | Metadados e movimentações de um processo no DataJud |
| `consultar_publicacoes_djen` | Publicações e intimações no DJEN por OAB ou número de processo |
| `consultar_processo_unificado` | DataJud e DJEN combinados, com partes e advogados |
| `baixar_certidao_djen` | Certidão em PDF de uma publicação |
| `buscar_feriados_forenses` | Feriados forenses por comarca, ano e tribunal |
| `consultar_jurimetria_cjpg` | Decisões de 1º grau do TJSP para jurimetria |
| `consultar_jurisprudencia_tjsp` | Jurisprudência do TJSP |
| `perfil_decisorio_magistrado` | Perfil decisório de um magistrado |
| `monitorar_publicacoes` | Cria um monitoramento recorrente no DJEN |
| `listar_monitoramentos` | Lista os monitoramentos do usuário |
| `renovar_monitoramento` | Renova o prazo de um monitoramento |
| `remover_monitoramento` | Remove um monitoramento |

Usuários com nível "consulta" só acessam as ferramentas de leitura. Há autenticação por token e também OAuth, para clientes que o exigem (como o Claude).

## Segurança e privacidade

- Autenticação por **token Bearer** (sem cookies); o banco guarda apenas o hash dos tokens, e o token é mostrado uma única vez.
- **Permissões por área** aplicadas no servidor, além do nível de acesso (administrador, operador, consulta).
- **Limites de uso** por usuário, proteção contra tentativas repetidas de acesso e limite de tamanho das requisições.
- **Credenciais de integrações cifradas**, com chave mestra fora do banco e rotação de chaves.
- **Proteção contra indisponibilidade** das APIs externas (disjuntores para DataJud e DJEN, cache e novas tentativas), para que o sistema continue funcionando quando um tribunal cai.
- O processo roda no contêiner **sem privilégios de administrador**.
- **Triagem por IA com anonimização:** nomes, documentos, contatos, OAB e números de processo são retirados antes de qualquer envio, e a função é opcional.
- Dados de clientes e processos ficam no **seu** servidor (SQLite), não em um serviço de terceiros.

## Stack e arquitetura

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.12, asyncio, servidor ASGI próprio |
| Protocolo para IA | MCP (Streamable HTTP e stdio) |
| Painel web | React 19, TypeScript, Radix Themes, Vite (servido em `/radix/`) |
| Interface legada | HTML/JS e Carbon Design System (`/app`) |
| Banco de dados | SQLite, com migrações automáticas |
| Agendamento | APScheduler |
| HTTP | httpx |
| Deploy | Docker, Caddy (proxy reverso com HTTPS) e GitHub Actions |

```
Navegador (painel React)         Assistente de IA (MCP)
        │ REST + token                  │ MCP (HTTP ou stdio)
        ▼                               ▼
                    server.py (ASGI)
        ├── db.py ............ SQLite: clientes, processos, atividades, publicações, financeiro
        ├── polos.py ......... reconhecimento de clientes e posição no processo
        ├── financeiro_juridico.py  resumos por processo e inadimplência
        ├── triagem.py ....... triagem opcional de publicações
        ├── notificacoes.py .. central de notificações
        ├── integracoes*.py .. cofre cifrado e administração das integrações
        └── APScheduler ...... monitoramentos, captura, andamentos, alertas de prazo
                    │
       DataJud · DJEN · Google (Drive/Agenda) · Asaas · BrasilAPI · ViaCEP · TJSP · SMTP
```

Estrutura principal:

```
server.py                 Servidor ASGI, rotas, MCP e rotinas agendadas
db.py                     Camada de dados SQLite e migrações
usuarios_admin.py         Usuários, permissões por área e administração do banco
financeiro_juridico.py    Resumos financeiros
polos.py                  Clientes e polos em processos e publicações
triagem.py                Triagem de publicações (opcional)
notificacoes.py           Notificações
google_integracao.py      Drive e Agenda
asaas_integracao.py       Cobranças
integracoes.py            Cofre de credenciais
frontend/                 Painel React (Vite)
static/                   Interface legada (/app)
docs/                     Documentação técnica
instalador/               Instaladores para Linux/macOS e Windows
```

## Início rápido

### Backend

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .

# cria um usuário e mostra o token (uma única vez)
python server.py --criar-usuario meu-usuario

# inicia o servidor HTTP
python server.py --transport http
# MCP:      http://localhost:8000/mcp
# Healthz:  http://localhost:8000/healthz
```

Sem `--transport http`, o padrão é `stdio`, para clientes MCP locais.

### Painel web (desenvolvimento)

```bash
cd frontend
npm ci
npm run dev      # http://localhost:5173/radix/ , com as chamadas da API encaminhadas para a porta 8000
```

Abra o painel, vá em **Acesso** e informe o token do usuário criado.

### Cliente MCP local (stdio)

```json
{
  "mcpServers": {
    "astrajus": {
      "command": "python",
      "args": ["/caminho/para/server.py"]
    }
  }
}
```

### Docker

```bash
docker build -t astrajus .

# cria o usuário (o token aparece uma única vez; guarde em segurança)
docker run --rm -v astrajus-dados:/data astrajus python server.py --criar-usuario admin

docker run -d --name astrajus --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v astrajus-dados:/data \
  --env-file .env \
  astrajus
```

O volume `/data` guarda o banco e os caches. Variáveis de ambiente só são lidas na criação do contêiner: depois de editar o `.env`, remova e recrie o contêiner.

## Configuração

Todas as variáveis são opcionais; os valores padrão servem para desenvolvimento.

| Variável | Para que serve |
|---|---|
| `CNJ_MCP_TRANSPORT`, `CNJ_MCP_HOST`, `CNJ_MCP_PORT` | Transporte (`http` ou `stdio`), endereço e porta |
| `CNJ_MCP_USUARIOS`, `CNJ_MCP_BANCO` | Pasta de dados e nome do arquivo SQLite |
| `CNJ_MCP_URL_PUBLICA` | Endereço público (links de e-mail e OAuth) |
| `CNJ_MCP_HOSTS_PERMITIDOS` | Hosts aceitos pelo servidor |
| `CNJ_MCP_SEGREDO` | Segredo dos links assinados de certidão |
| `CNJ_MCP_ADMIN_TOKEN` | Token administrativo de recuperação |
| `DATAJUD_API_KEY` | Chave do DataJud (há uma chave pública do CNJ como padrão) |
| `CNJ_SMTP_HOST`, `CNJ_SMTP_PORTA`, `CNJ_SMTP_USUARIO`, `CNJ_SMTP_SENHA`, `CNJ_SMTP_REMETENTE` | E-mails de monitoramento e de alerta de prazo |
| `CNJ_GOOGLE_CLIENT_ID`, `CNJ_GOOGLE_CLIENT_SECRET` | OAuth do Google (Drive e Agenda) |
| `CNJ_GOOGLE_DRIVE_PASTA_RAIZ`, `CNJ_GOOGLE_DRIVE_PASTA_CLIENTES` | Pasta raiz do Drive e pasta `CLIENTES` já existente |
| `ASAAS_AMBIENTE`, `ASAAS_API_KEY`, `ASAAS_API_KEY_SANDBOX`, `ASAAS_WEBHOOK_TOKEN` | Cobranças (homologação ou produção) |
| `CNJ_INTEGRACOES_CHAVE`, `CNJ_INTEGRACOES_CHAVES_ANTERIORES` | Chave mestra (Fernet) do cofre de credenciais e chaves em rotação |
| `CNJ_RECAPTCHA_SITE_KEY`, `CNJ_RECAPTCHA_SECRET` | reCAPTCHA do autocadastro |
| `CNJ_TRIAGEM_MODO`, `TYPESAFE_API_KEY`, `CNJ_TRIAGEM_MODELO` | Triagem de publicações: `desligado` (padrão), `simulado` ou `jev` |

Gerenciamento de usuários:

```bash
python server.py --criar-usuario NOME       # cria e mostra o token
python server.py --listar-usuarios
python server.py --revogar-usuario NOME
python server.py --gerar-token-admin        # novo token administrativo
```

## Testes

```bash
# testes do servidor
python -m pytest

# cálculo de prazos (usa o TypeScript do frontend)
node test_prazos.mjs

# verificação de tipos e build do painel
cd frontend && npx tsc -b --noEmit && npm run build
```

Os testes que consultam APIs externas (`test_manual.py`) e os de interface (`test_interface.py` e afins) exigem rede, servidor e navegador configurados.

## Deploy

O servidor escuta em `127.0.0.1:8000`; o Caddy faz o proxy reverso com HTTPS automático:

```
seu-dominio.com {
    reverse_proxy 127.0.0.1:8000
}
```

O repositório tem dois fluxos do GitHub Actions:

- **`deploy.yml`**: a cada push na `main`, valida a sintaxe, acessa a VPS por SSH, atualiza o código, reconstrói a imagem Docker, reinicia o contêiner e confere `/healthz`.
- **`deploy-radix.yml`**: a cada push na branch `astrajus-radix`, compila o painel React e publica os arquivos estáticos em `/radix/`, sem reiniciar contêiner.

Os segredos usados (`VPS_SSH_KEY`, `VPS_HOST`) ficam em *Settings → Secrets and variables → Actions*.

## O que ainda não existe

Ideias que **não** fazem parte do sistema hoje:

- modelos de documento (procuração, contrato) e assinatura eletrônica integrada;
- contrato de honorários com geração automática de parcelas e recibo em PDF;
- lembretes automáticos de cobrança ao cliente;
- portal do cliente;
- uso por vários escritórios na mesma instalação (hoje, cada escritório usa a sua);
- aplicativo nativo para celular (o painel é responsivo).

## Documentação adicional

- [docs/referencia-tecnica.md](docs/referencia-tecnica.md): inventário de rotas, ferramentas MCP e comandos.
- [docs/integracoes.md](docs/integracoes.md): operação das integrações, cofre de credenciais e triagem.
- [CONTEXT.md](CONTEXT.md): glossário do domínio e regras de negócio.
- [guia-do-usuario.html](guia-do-usuario.html): guia para quem usa o sistema.

## Licença

[PolyForm Noncommercial 1.0.0](LICENSE.md). Para uso comercial, entre em contato pelo endereço indicado em [LICENSE.md](LICENSE.md).
