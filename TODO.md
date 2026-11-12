# TODO — AstraJus

Lista viva do que falta e das melhorias sugeridas. Origem: comparação com o Jurix (jurix.work) e revisão do frontend.
Quando um item for começado, abrir a especificação em `.scratch/<feature>/spec.md` (convenção em `docs/agents/issue-tracker.md`).

Legenda: `[x]` feito · `[ ]` a fazer · **F** só frontend (push na `astrajus-radix`) · **B** exige backend (PR para `main`).

## Feito nesta rodada
- [x] **F** Home: faixa única "Precisa da sua atenção" no topo de "Meu dia" (atrasadas, vencem hoje, publicações por revisar, vencidos a receber) e estado "Tudo em ordem" — `6d10c45`
- [x] **F** Limite de erro por tela com "Tentar novamente", separando falha de download de arquivo de erro de renderização — `1559f15`
- [x] **F** Links diretos e voltar/avançar: parâmetros da tela no hash (`#/casos?id=…&aba=…`), com valores validados; `react-router-dom` removido — `7c8f9ae`

## Frontend — melhorias técnicas

### Dados com React Query (em lotes pequenos, um push e um teste no navegador por lote)
Restam ~26 arquivos com `buscarJson` direto. Ordem sugerida:
- [ ] **F** Lote 1: Home (`Home.tsx`) e Escritório (`home/Escritorio.tsx`)
- [ ] **F** Lote 2: Pagamentos e Histórico
- [ ] **F** Lote 3: Publicações recebidas (`PainelPublicacoes`, `AtividadePublicacao`, `ProcessoPublicacao`)
- [ ] **F** Lote 4: abas do processo (`CapaProcesso`, `MovimentacoesCaso`, `PublicacoesCaso`, `VinculosCaso`, `AtividadesCaso`, `ChecklistAtividade`, `AtividadeModal`, `CadastroCaso`)
- [ ] **F** Lote 5: contatos (`CadastroContato`, `VinculosContato`), `NovoLancamentoModal`, `BuscaGlobal`, `Agenda`/`Atividades`/`Casos` (sobras)
- [ ] **F** Ao final: trocar `EVENTO_DADOS_ALTERADOS` por invalidação de queries

### Qualidade
- [ ] **F** Componentes padrão de estado vazio e de erro (hoje só o carregamento é padronizado, em `Carregamento.tsx`) e uso nas listas
- [ ] **F** Testes ponta a ponta (Playwright) dos fluxos críticos: criar processo, tratar publicação, criar atividade e lançamento
- [ ] **F** Teste automatizado da faixa de atenção e da navegação por hash (hoje só a lógica pura em `hash.ts` tem teste)
- [ ] **F** Filtros das listas na URL (a navegação entre telas já usa o hash; falta o estado de filtros e ordenação)
- [ ] **F** Auditoria de acessibilidade: contraste, foco em diálogos, teclado no Kanban e na Agenda
- [ ] **F** Listas grandes: virtualização e filtros no servidor (`ListaCasos`, `Financeiro`)
- [ ] **F** Dividir arquivos acima de ~450 linhas (`PainelPublicacoes`, `Home`, `ListaCasos`, `Financeiro`) e trocar os ~23 `any` por tipos
- [ ] **F** Medir o tamanho do pacote e o carregamento (Web Vitals) antes de otimizar
- [ ] **B** Login com e-mail e senha (ou OAuth) no lugar do token colado, com sessão que renova

### Experiência de uso
- [ ] **F** PWA: manifest, ícones e service worker simples (instalável, sem app nativo)
- [ ] **F** Celular: barra de navegação inferior com ação central (nova atividade / novo processo)
- [ ] **F** Atalho para "ocultar valores" (olho) na Home e no Financeiro
- [ ] **F** Linha do tempo única do processo (movimentações, publicações, atividades e vínculos em ordem cronológica)
- [ ] **F** Checklist de "Configuração inicial" na Home (Google Drive, Google Agenda, Asaas, OAB para monitorar), com dica contextual curta por tela e "Guia de uso" em cada seção de Integrações
- [ ] **F** Atalhos de teclado e mais ações em lote nas listas
- [ ] **F** "Central de risco" como visão única: prazos fatais ou vencidos, audiências próximas, publicações sem revisão, tarefas atrasadas **e integrações desconectadas** (a aba Escritório já cobre quase tudo, falta o item de integrações)

## Funcionalidades inspiradas no Jurix

### Prioridade alta (reaproveitam muito do que já existe)
- [ ] **B** Caçador de alvarás: varrer o DJEN por alvará/levantamento e avisar (e-mail e sino)
- [ ] **B+F** Consulta de partes e conflito de interesses: CNPJ na Receita, sanções CEIS/CNEP e cruzamento com os clientes do escritório (`polos.py` já reconhece clientes)
- [x] **B+F** **Modelos de prazos por assunto ou classe processual**: sugere os prazos e tarefas do modelo quando a ação, a classe ou o assunto do processo bate (sempre revisado antes de criar). Pendências: datas com feriados locais (hoje só fins de semana e recesso); modelo por tribunal ou município; reaplicar um modelo dispensado; ligar aos modelos de peças
- [x] **B+F** **Alertas de prazo com escalonamento**: confirmação de ciência nas notificações e aviso aos administradores (sino e e-mail) se ninguém confirmar. Reserva = administradores; sem WhatsApp. Pendências: mostrar "Ciente" na lista de atividades e na Central de risco; ciência também por e-mail (link); opção de ligar/desligar o escalonamento
- [ ] **B+F** Importação de outros sistemas (Astrea, ProJuris, Advbox) por planilha ou lista de números CNJ

### Prioridade média
- [ ] **B+F** Horas por caso: cronômetro, lançamento manual, tempo faturável, valor/hora e relatório de horas
- [ ] **B+F** Financeiro: contas/caixas, fluxo de caixa, recorrência de honorários e controle de alvarás
- [ ] **B+F** Contrato de honorários com geração de parcelas e recibo em PDF; lembretes de cobrança (já listado como "ainda não existe" no README)
- [ ] **B+F** Assinatura eletrônica via ZapSign (hoje só configura e testa a API)
- [ ] **B+F** Modelos de peças e documentos: "Nova peça" com modelo opcional e processo vinculado, já nascendo com os dados do processo
- [ ] **B+F** Radar legislativo: listas de palavras-chave sobre Câmara e Senado, com itens pendentes e revisados
- [ ] **B+F** CRM de triagem: atendimento inicial (dados, parte contrária, área e honorários) com pendentes, convertidos e arquivados, antes de virar cliente ou processo

### Prioridade baixa
- [ ] **B+F** Portal do cliente e explicação dos andamentos em linguagem simples (IA, sempre com revisão do advogado)
- [ ] **B+F** Cofre de documentos com hash e marca d'água; documentos por link (estende `/certidoes/<arquivo>`)
- [ ] **B+F** Assistente de IA sobre os dados do escritório (comandos, anexos, voz), com confirmação antes de executar, usando a chave de IA do próprio escritório
- [ ] **?** Aba "Reputação" em Clientes (vi só o nome da aba no Jurix, não explorei o que ela faz)

## Decidido não trazer (por enquanto)
- WhatsApp integrado (infraestrutura e risco de bloqueio): preferir e-mail
- Extensão do Chrome para ePROC, app desktop e criador de sites: produtos à parte
- Reuniões com gravação e ata por IA (custo, consentimento e LGPD)
- Multi-escritório e planos (o AstraJus é uma instalação por escritório)

## Observações
- Dados do Jurix vistos em conta de teste vazia: estrutura e acabamento das telas, não o comportamento com dados reais.
- Todo uso de IA deve manter o que a triagem já faz: anonimizar antes de enviar e tratar o resultado como sugestão para o advogado revisar.
