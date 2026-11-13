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
- [x] **F** Lote 1: Home (`Home.tsx`) e Escritório (`home/Escritorio.tsx`). Testado no navegador local
- [x] **F** Lote 2: Pagamentos e Histórico. Testado no navegador local
- [x] **F** Lote 3: Publicações recebidas (`PainelPublicacoes`, `AtividadePublicacao`, `ProcessoPublicacao`) — sem teste no navegador; ficam com busca imperativa só as ações em lote (varrer todas as páginas, criar/vincular)
- [x] **F** Lote 4: abas do processo. Testado no navegador local (Home, Pagamentos, Histórico, Publicações, abas do processo, busca global, novo lançamento). Vínculos, Publicações, Atividades, Checklist e Movimentações usam a consulta; Cadastro e Capa ficam com a busca do próprio processo (preenchem formulário, uma recarga apagaria a edição) e só usam responsáveis e clientes em cache
- [x] **F** Lote 5: BuscaGlobal, VinculosContato, NovoLancamentoModal e contagens das abas do processo. Testado no navegador local (Home, Pagamentos, Histórico, Publicações, abas do processo, busca global, novo lançamento). Ficam com busca direta: CadastroContato (preenche formulário), useNotificacoes (polling) e as ações em lote das publicações
- [x] **F** Ao final: `EVENTO_DADOS_ALTERADOS` trocado por `avisarDadosAlterados()` em `api/queryClient.ts` (invalida direto no cliente de consultas, sem evento no `window`)

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
- [x] **F** Menu da conta em lista (Meu perfil, Administração para administradores, Acesso e token, tema e cor de destaque dentro, Sair); "Meu perfil" mostra o acesso por área. "Meu perfil" edita foto (reduzida no navegador), nome de exibição e e-mail. Pendência: preferências de notificação por tipo
- [ ] **F** Atalho para "ocultar valores" (olho) na Home e no Financeiro
- [x] **F** Linha do tempo única do processo: aba "Linha do tempo" com movimentações, publicações, atividades e vínculos (processos ligados) por dia, filtro por tipo, busca e "mostrar mais antigos"; só leitura e só o que já aconteceu (futuros ficam em Atividades). Pendências: lançamentos financeiros, horas e documentos do Drive no mesmo eixo; filtros na URL; atividade sem data fica de fora
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
- [x] **B+F** Horas por caso: cronômetro, lançamento manual, tempo faturável, valor por hora (por pessoa, gravado em cada lançamento), relatório (totais e CSV) e faturamento em um lançamento de honorário. Pendências: indicador do cronômetro na barra superior (hoje só na tela Horas); horas na ficha do processo; valor por hora por processo ou cliente (contrato); faturar vários processos do mesmo cliente de uma vez; relatório em PDF; aprovação de horas; horas no resumo do Escritório
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
- [ ] **B+F** Jurimetria na ficha do processo (desfecho e valor de condenação por vara e assunto, TJSP): especificação em `.scratch/jurimetria-processo/spec.md`; fases 0 e 1 feitas (aba "Jurimetria" com filtros resolvidos pela capa, dois cartões e texto-resumo; resolvedor `GET /cjpg-arvore/resolver`); faltam a fase 2 (perfil do magistrado, lembrar a escolha por processo, link para a tela de Jurimetria com filtros) e a fase 3. A ferramenta de jurimetria agora recusa períodos acima de 364 dias e mostra a mensagem do e-SAJ em vez de devolver vazio
- [ ] **?** Aba "Reputação" em Clientes (vi só o nome da aba no Jurix, não explorei o que ela faz)

## Administração (inspirado no Jurix)
- [x] **F** Abre já carregada quando a pessoa conectada é administradora (sem o passo do token) e as abas Banco, Histórico e Acessos carregam sozinhas
- [x] **F** Legenda de níveis, selos coloridos (nível e status), "Você", último acesso relativo e descrição do nível no diálogo
- [x] **F** Perfis prontos de acesso (Advogado, Secretaria, Financeiro, Somente consulta e Administrador), que preenchem a matriz por área sem criar níveis no servidor; a tabela mostra o perfil reconhecido ou "Acesso personalizado"
- [x] **F** Valor por hora no cadastro do usuário (coluna na tabela e campo no diálogo; some se a conexão não for de administrador)
- [x] **B+F** Novo token de um usuário (invalida o anterior) com envio opcional por e-mail; "Último acesso" logo abaixo do nome. Pendência: link de redefinição em vez do token no e-mail
- [ ] **B+F** OAB por usuário, cadastrando a captura de publicações daquele advogado automaticamente
- [ ] **B+F** Painel de saúde: disjuntores e cache do `/healthz`, resultado das rotinas (`/automacoes`) e botão "enviar e-mail de teste" para conferir o SMTP
- [ ] **B+F** Perfil do escritório (nome, CNPJ, OAB, e-mails, endereço, logo), base para assinatura de e-mail, cabeçalho de PDFs e recibos
- [ ] **B** Backup agendado e restauração (hoje só download manual)
- [x] **F** Integrações dentro da Administração (aba própria: lista de serviços, teste → ativação, desativar, ambiente do Asaas, Google; `#/integracoes` e a Central de risco levam para lá; "Minha agenda Google" foi para Meu perfil). Pendências: reCAPTCHA (desafio), reencriptação com a chave mestra e permissão de administrador de integrações continuam só no painel avançado `/admin/integracoes`; depois disso, aposentar o painel legado
- [x] **B+F** Exclusão de usuário com confirmação (digitar APAGAR): processos, atividades e lançamentos ficam sem responsável; monitoramentos e notificações pessoais são removidos; horas mantidas. Pendência: usuário com Google Agenda sincronizada precisa desconectar antes

## Decidido não trazer (por enquanto)
- WhatsApp integrado (infraestrutura e risco de bloqueio): preferir e-mail
- Extensão do Chrome para ePROC, app desktop e criador de sites: produtos à parte
- Reuniões com gravação e ata por IA (custo, consentimento e LGPD)
- Multi-escritório e planos (o AstraJus é uma instalação por escritório)

## Observações
- Dados do Jurix vistos em conta de teste vazia: estrutura e acabamento das telas, não o comportamento com dados reais.
- Todo uso de IA deve manter o que a triagem já faz: anonimizar antes de enviar e tratar o resultado como sugestão para o advogado revisar.
