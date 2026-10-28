# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Advogados membros de pequenos e médios escritórios de advocacia brasileiros (2–10 advogados), que compartilham clientes e processos com colegas de equipe. Uso predominantemente em desktop com tela larga; acesso móvel eventual mas não o cenário principal.

Contexto real de uso: o advogado alterna entre o painel e audiências, petições e o Claude Desktop — o AstraJus é a fonte de verdade do escritório para clientes, processos e publicações do DJEN.

## Product Purpose

Plataforma integrada de gestão processual para escritórios de advocacia brasileiros. Conecta as APIs públicas do CNJ (DataJud e DJEN) a um fluxo de trabalho jurídico completo: consulta e monitoramento de processos e publicações, gestão de clientes e processos (com partes, atividades, movimentações), e integração com Google Drive e Calendar. Expõe os mesmos dados ao Claude Desktop via MCP, eliminando a cópia-cola entre sistemas.

Sucesso: o escritório acompanha todos os processos ativos, recebe alertas de novas publicações antes do prazo, e mantém o histórico de cada processo num único lugar — sem depender de planilhas ou e-mail.

## Positioning

Plataforma auto-hospedada com controle total dos dados: roda no VPS do próprio escritório, sem SaaS, sem dependência de fornecedor, sem cobrança por assento. O escritório é dono do banco de dados, das credenciais e do servidor — as integrações habilitadas enviam os dados necessários às respectivas APIs externas, como Google Drive e Calendar.

**Undecided:** Evolução para modelo SaaS com subscrição e per-seat pricing está prevista no futuro; não há prazo nem decisões de arquitetura confirmadas para essa transição.

## Operating Context

- Sistema judiciário federal brasileiro (CNJ): DataJud (processos e movimentações), DJEN / Comunica PJe (publicações e intimações), CJPG (jurimetria de magistrados)
- Números de processo CNJ (20 dígitos) e registro OAB como identificadores primários
- Prazos processuais: feriados forenses do TJSP por comarca, monitoramento com expiração de 180 dias
- Claude Desktop como cliente MCP para consultas assistidas por IA sem cópia-cola
- Google Drive (pasta por processo) e Google Calendar (eventos) como integrações externas opcionais
- Deploy via Docker + Caddy no VPS do escritório; deploy automático por GitHub Actions

## Capabilities and Constraints

**Painel web (`/app`):**
- Autenticação Bearer token (sem cookies; compatível com MCP)
- Consulta pontual com histórico local por dispositivo (localStorage, não sincronizado)
- Favoritos de processo (tribunal + número)
- CRUD de clientes (pessoa física ou jurídica) com paginação, typeahead e ações em massa de etiquetas e perfil com prévia
- CRUD de processos vinculados a clientes; sub-abas: Cadastro (capa com partes e advogados automáticos, somente leitura, e seleção de responsável), Atividades, Publicações, Movimentações, Vínculos
- Atividades com checklist, lançamento em modal e vínculo opcional a evento de dia inteiro no Google Calendar
- Central individual de notificações com leitura e acesso ao registro de origem
- Publicações por OAB: painel dedicado, gestão de status em lote, captura manual, vinculação a processo
- Máximo 5 monitoramentos por usuário; expiração automática após 180 dias sem publicação nova

**Servidor MCP (tools):**
`consultar_processo_datajud`, `consultar_publicacoes_djen`, `baixar_certidao_djen`, `buscar_feriados_forenses`, `consultar_jurimetria_cjpg`, `monitorar_publicacoes`, `listar_monitoramentos`, `remover_monitoramento`, `perfil_decisorio_magistrado`

**Stack:** Python 3.12 ASGI puro, HTML/JS vanilla, Carbon Design System (white e g100), SQLite, Docker

**Constraints:**
- Frontend obrigatoriamente em Carbon Design System (white e g100) — sem frameworks CSS externos, sem diálogos nativos soltos
- Idioma da interface: português brasileiro
- SQLite local; sem banco externo

## Brand Commitments

- **Nome do produto:** AstraJus
- **Componentes:** Carbon Design System (white e g100) — regra obrigatória para todo o painel web; sem exceções
- **Idioma:** português brasileiro em toda a interface
- **Vocabulário de domínio (CONTEXT.md — vinculante):**
  - *Consulta* — busca pontual manual via API; evitar: Busca, Pesquisa
  - *Histórico* — registro automático local das últimas consultas; evitar: Log, cache de busca
  - *Favorito* — processo marcado manualmente; evitar: Salvo, Marcado
  - *Monitoramento* — acompanhamento recorrente configurado pelo usuário; evitar: Alerta, Assinatura, Inscrição

## Evidence on Hand

- Implementação completa e em produção: `static/app.html`, `static/app.js`, `static/cadastro.js`
- Glossário de domínio: `CONTEXT.md`
- Documentação de features e arquitetura: `README.md`
- Porta HTTP padrão 8000; painel disponível com `python server.py --transport http`
- Sem ativos de branding visual (logo, paleta própria, tipografia customizada) além do Carbon white/g100 theme

## Product Principles

1. **Dados no controle do escritório** — o escritório controla o banco, as credenciais e o servidor, além de escolher quais integrações externas habilitar.
2. **Consulta como ponto de partida** — o fluxo começa pelos tribunais (DataJud, DJEN), não por preenchimento manual; os dados chegam do judiciário, não são digitados pelo usuário.
3. **Vocabulário preciso** — Consulta, Monitoramento, Histórico e Favorito têm definições distintas que a interface deve reforçar, não diluir.
4. **IA sem atrito** — o servidor MCP expõe os mesmos dados do painel ao Claude Desktop; o advogado não precisa copiar e colar entre sistemas.
5. **Implantação leve** — um único processo Python serve MCP e painel; sem banco externo, sem serviço gerenciado, sem dependência de runtime além do Python e do Docker.
