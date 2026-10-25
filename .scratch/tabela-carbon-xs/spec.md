# Padrão reutilizável de tabela Carbon XS

Status: ready-for-agent
Versão: 1.0 — 24/10/2026
Escopo: tabelas de gestão do `/app`; primeira aplicação em Publicações OAB.

### Revisão do perfil Publicações OAB — 24/10/2026

Por solicitação posterior, o perfil Publicações OAB passa a usar Web Components Carbon: `cds-table` com `size="md"` (40 px), `cds-toggletip` com checkboxes para selecionar colunas, `cds-icon-button` com ícone Launch para abrir a publicação e `cds-tag` com texto de 10 px para o status. Essa revisão substitui as medidas XS e a apresentação de status deste perfil. Seleção, expansão, paginação e confirmação inline continuam seguindo os contratos abaixo. O padrão XS permanece disponível como referência para outras tabelas.

### Revisão DT01 a DT05 — 25/10/2026

Mockup aprovado pelo usuário para implementação, PR e merge. No perfil OAB, os contratos abaixo passam a prevalecer sobre as regras gerais anteriores quando houver conflito:

- Expansão vem antes da seleção, no cabeçalho e nas linhas.
- Toolbar e barra de lote usam mínimo de 48 px. Linhas/cabeçalho permanecem M/40 px; paginação mantém o perfil compacto. No toque, as linhas podem crescer para 44 px e a barra pode quebrar controles no móvel.
- Seleção em lote fecha menus e desabilita ações individuais; formulário inline aberto preserva seus valores, mas fica suspenso até cancelar/desmarcar a seleção. Envio inline em andamento impede seleção e operações em lote concorrentes.
- Cabeçalhos extensos usam até duas linhas e reticências, com tooltip completo por hover/foco e fechamento por Escape.
- Uma ou duas ações contextuais executáveis aparecem como ícones inline; três ou mais usam overflow. O link externo de leitura é preservado e também fica bloqueado durante o lote.

Detalhes e validação em `.scratch/dt01-dt05/spec.md`. Esta revisão não padroniza as demais tabelas legadas (DT06).

## Objetivo e estado

Definir um contrato de layout e interação para reutilizar tabelas densas no mesmo projeto. O padrão combina seleção múltipla, expansão de linha, paginação, ações em lote, menu de três pontos e seletor de colunas.

Esta especificação registra o mockup solicitado antes da implementação. A existência deste documento não significa que o padrão já esteja implementado nem que PR ou merge tenham sido executados.

Referência visual: o mockup interativo não faz parte da árvore do projeto; o arquivo original desta conversa é `C:/Users/ariel/.codex/visualizations/2026/10/23/01a168dc-b945-7da3-8e40-f64258954333/publicacoes-carbon-xs.html`. A implementação deve seguir os contratos abaixo, inclusive quando o mockup simplificar uma ação.

Referência Carbon: [Data table — guidelines](https://carbondesignsystem.com/building-blocks/core/components/data-table/guidelines/), consultada pelo Carbon MCP. XS corresponde a 24 px de altura no cabeçalho e nas linhas; toolbar pequena acompanha tabelas XS. Os valores de tipografia e as regras de domínio abaixo são escolhas do projeto.

## Anatomia e medidas

Ordem vertical: título e contagem → toolbar → cabeçalho → linhas e respectivas expansões → paginação → feedback contextual, quando houver.

| Elemento | Contrato |
| --- | --- |
| Fonte | IBM Plex Sans; fallback sans-serif |
| Texto da tabela e controles | 12 px; cabeçalho com peso 600 e células com peso 400 |
| Cabeçalho e linha recolhida | 24 px, mesma altura; conteúdo em uma linha |
| Toolbar normal | Pequena, 32 px; sem botões primários grandes repetidos por linha |
| Barra em lote | Substitui a toolbar; altura de referência 24 px para XS, podendo crescer com quebra dos controles |
| Paginação | Compacta, referência de 40 px |
| Célula de dados | Padding horizontal de 8 px; alinhamento vertical central |
| Seleção, expansão e ações | Três colunas de controle, referência de 32 px cada |
| Separação | Divisórias horizontais sutis; sem grade vertical |
| Nomes longos em XS | Uma linha, reticências e conteúdo completo no hover e foco |
| Expansão | Altura automática; padding de 16–24 px; sem limitar o texto |
| Superfícies | Tabela plana, sem cartões por registro; menu e seletor com fundo opaco |

Usar tokens e funções Carbon para cores, espaçamento e tipografia na implementação. Mapear as medidas deste documento aos tokens disponíveis; evitar cores literais espalhadas e estilos inline. Reutilizar a tecnologia já adotada no `/app`; este padrão não exige migrar o projeto para React.

Estados visuais obrigatórios: normal, hover, selecionado, foco visível, desabilitado e operação em andamento. Seleção precisa de checkbox marcado além da cor. A aparência deve acompanhar o tema do aplicativo.

## Colunas e adaptação a outras tabelas

Ordem horizontal no perfil OAB revisado: expansão → seleção → campos de dados → ações contextuais. Controles não entram no seletor de campos.

Cada tabela declara um catálogo de colunas com chave estável, rótulo, origem do dado, formatador, largura, visibilidade inicial, obrigatoriedade e possibilidade de ordenação. Chaves não dependem do texto do rótulo.

Colunas obrigatórias significam sempre visíveis; não implicam congelamento horizontal. No seletor, aparecem marcadas e desabilitadas com indicação “Sempre visível”. Colunas opcionais podem ser alternadas clicando tanto no checkbox quanto no rótulo, com exatamente uma alteração por clique. Não disparar cliques programáticos recursivos entre label, input e contêiner.

O seletor fica na toolbar, alinhado à direita. Abre por botão “Colunas”, fecha por Escape, clique externo ou repetição do botão e devolve o foco ao botão. Alterações são imediatas, sem confirmação adicional. A lista pode rolar quando longa, mantendo o título identificável. Persistir preferências por tabela e versão de esquema, no mecanismo de preferências já usado pelo projeto; dados desconhecidos ou obsoletos devem cair no padrão inicial e nunca ocultar colunas obrigatórias.

Não adicionar consulta, filtros, ordenação ou exportação sem necessidade da tabela de destino. Caso existam, ficam na toolbar normal e devem definir como afetam seleção e paginação.

## Seleção e tratamento em lote

- Checkbox na coluna de seleção (depois da expansão no perfil OAB) seleciona o registro sem expandir a linha nem abrir ações.
- Checkbox do cabeçalho seleciona somente a página atual. Usa estado intermediário quando parte da página está selecionada e nome acessível “Selecionar publicações desta página”, adaptado à entidade.
- A seleção usa IDs estáveis, nunca índices da página. Navegar entre páginas preserva os IDs selecionados e a contagem total.
- Alterar filtros, contexto da tabela ou tamanho da página limpa a seleção. Atualização de dados remove IDs que deixaram de existir ou não são mais acessíveis.
- Com ao menos um item selecionado, a barra em lote substitui a toolbar e mostra a contagem total, ações permitidas e “Cancelar”. Cancelar apenas limpa a seleção.
- Uma ação em lote atua exatamente nos IDs selecionados, inclusive de outras páginas. Não oferecer “todos os resultados” sem suporte explícito da API e indicação inequívoca desse alcance.
- Durante o envio, desabilitar repetição da ação. Ao concluir, atualizar os registros e mostrar sucesso ou falha real; nenhuma mensagem de sucesso apenas por clique.
- Em sucesso parcial, informar quantos tiveram sucesso e quantos falharam, remover os sucessos da seleção e manter os itens com falha selecionados para revisão ou nova tentativa.
- Confirmação adicional é necessária para exclusão permanente ou ação irreversível. Tratamento e arquivamento seguem a reversibilidade e as permissões efetivas do domínio.

## Expansão

O chevron é um botão separado do checkbox e do nome. Abrir ou fechar não altera seleção, status ou vínculo do registro. Várias linhas podem permanecer expandidas. O painel aparece imediatamente abaixo da linha correspondente e ocupa todas as colunas visíveis, inclusive controles.

Usar `aria-expanded`, `aria-controls` e identificação única do painel. Enter e Espaço acionam o botão. Preservar expansão por ID enquanto o conjunto de dados permanecer válido. Carregamento sob demanda deve exibir estado de carregamento e opção de tentar novamente em caso de falha.

O conteúdo do painel se adapta ao domínio. Não repetir uma segunda tabela completa nem criar rolagem horizontal para o texto da publicação. Dados ausentes devem ser indicados com “—”, sem valores inventados.

## Menu de três pontos e formulários inline

Menu na última coluna, com botão compacto e nome acessível específico do registro. Apenas um menu pode ficar aberto. O menu é um popover ancorado ao botão, com largura suficiente para os rótulos; não vira uma faixa de ações inserida como linha da tabela. Reposicionar perto das bordas e evitar recorte pelo contêiner de rolagem.

Escape fecha e devolve foco ao botão. Clique externo fecha. Navegação por teclado segue o padrão acessível do componente Carbon escolhido. Ações indisponíveis devem ter motivo identificável; esconder apenas as que não se aplicam ao registro ou às permissões do usuário.

Ao escolher uma ação com formulário, fechar o menu e revelar formulário inline associado ao registro. Não efetuar cadastro ou vínculo apenas ao selecionar um resultado. Mostrar resumo e botões de confirmar/cancelar; erros permanecem no contexto sem perder os valores preenchidos. Conclusão bem-sucedida atualiza a linha.

## Paginação

Rodapé informa intervalo exibido, total de registros, página atual e total de páginas. Contém seletor de itens por página e botões anterior/próxima. Valores iniciais propostos: 5, 10 e 20; padrão 5 na primeira aplicação, como no mockup. Cada tabela futura pode definir sua configuração.

Desabilitar anterior na primeira página e próxima na última. Alterar tamanho retorna à primeira página. Após remoção ou alteração que esvazie a página atual, navegar para a última página válida. Nunca paginar apenas os registros carregados quando a API representa um total maior; usar a paginação efetiva da fonte.

Sem dados, mostrar “Nenhuma publicação encontrada”, com ações contextuais aplicáveis e controles de navegação desabilitados. Não exibir intervalo “1–0”. Em erro de carregamento, informar o problema e oferecer nova tentativa sem fingir estado vazio.

## Perfil Publicações OAB

| Campo | Visibilidade inicial | Regra |
| --- | --- | --- |
| Processo | Obrigatória | CNJ com máscara para leitura; valor canônico preservado |
| Tribunal | Obrigatória | Sigla inteiramente em maiúsculas |
| Nome do processo | Obrigatória | Parte ativa X parte passiva; usar dados dos polos, sem inventar partes ausentes |
| Divulgado | Opcional, inicialmente oculta | Data própria, separada de Capturado |
| Capturado | Opcional, inicialmente oculta | Data/hora própria conforme dado disponível |
| Tipo | Opcional, inicialmente oculta | Coluna independente |
| Demais campos DJEN | Opcionais, inicialmente ocultos | Catálogo completo dos campos efetivamente disponibilizados pela integração |

A configuração inicial com apenas Processo, Tribunal e Nome do processo reflete a seleção mais recente do mockup. Preservar preferências existentes válidas na implementação.

Ordem inicial recomendada dos campos obrigatórios: Tribunal → Processo → Nome do processo. Larguras de referência: Tribunal 70 px, Processo 205 px; Nome do processo absorve o espaço restante. Campos opcionais de data usam referência de 90 px. Priorizar legibilidade e rolagem horizontal localizada quando o conjunto de campos não couber.

No seletor, incluir campos como Órgão, Classe, Meio, Advogados, Destinatários e identificadores/metadados presentes na integração. Derivar o catálogo do esquema real e registrar o mapeamento; a lista abreviada do mockup não substitui esse levantamento.

Dados de exibição seguem a capitalização definida para o projeto, com iniciais maiúsculas por palavra quando aplicável. Exceções explícitas: Tribunal em maiúsculas; identificadores, URLs e CNJ preservados; inteiro teor da publicação sem qualquer transformação de capitalização. Nunca regravar o dado original para atender uma regra visual.

Em XS, Nome do processo usa uma linha e tooltip acessível com o nome completo. Essa decisão de densidade substitui a apresentação anterior com até duas linhas nesta tabela; o nome completo também aparece no painel expandido.

O painel expandido substitui a necessidade de “Ler mais” para o mesmo conteúdo. Deve mostrar a publicação inteira, texto original justificado em 10 px e cabeçalho de informações em negrito: partes, processo, tribunal, órgão, datas e tipo, conforme disponíveis. O usuário pode selecionar e copiar o texto. Não transformar o inteiro teor em título com iniciais maiúsculas.

Ações em lote: “Marcar como tratada” e “Arquivar”, respeitando estados e permissões. Não criar vários processos ou vínculos automaticamente em lote.

Menu por registro: “Cadastrar processo”, “Vincular a processo existente”, “Marcar como tratada” e “Arquivar”, conforme aplicabilidade. Cadastros já vinculados devem oferecer o acesso ao processo existente e evitar duplicação.

“Vincular a processo existente” apresenta consulta por número, nome da parte ou cliente. Após escolher o resultado, mostra resumo inline para confirmação explícita. “Cadastrar processo” abre campos de Cliente com consulta e Responsável; confirmar cria o processo preenchido com os dados capturados e vincula a publicação. Usar “Processo” na interface, mantendo nomes técnicos legados somente no código/API.

## Responsividade e acessibilidade

Em desktop com ponteiro preciso, manter a densidade XS de 24 px. Em interação por toque, ampliar alvos para aproximadamente 44 px, permitindo aumento da altura das linhas; não comprimir alvos sobrepostos para sustentar XS.

Em telas estreitas, permitir rolagem horizontal somente na região da tabela; toolbar e paginação se reorganizam sem transbordar a página. Os campos obrigatórios continuam disponíveis. Menus, formulários e expansão devem caber na área visível, sem recorte.

Usar tabela semântica com cabeçalhos associados, controles nativos ou componentes Carbon acessíveis, nomes únicos nos botões e foco visível. Tooltips devem funcionar com hover e foco e não ser a única forma de acessar informação essencial. Feedback e contagens usam região de anúncio discreta; erro de operação deve ser anunciado. Status não pode depender apenas da cor.

## Contrato para reutilizar

Ao aplicar este padrão a outra entidade, registrar:

1. Identificador da tabela e chave de preferência versionada.
2. Fonte de dados, ID estável e estratégia de paginação.
3. Catálogo de colunas e regras de formato, obrigatoriedade e visibilidade inicial.
4. Conteúdo da expansão e política de carregamento.
5. Ações de linha, formulários inline, permissões e confirmações.
6. Ações em lote, alcance da seleção e contrato de sucesso parcial.
7. Estados vazio, carregamento, erro e recuperação.

Reutilizar estrutura, tokens e comportamento; adaptar os rótulos e regras de domínio. Não copiar handlers específicos de publicações para outras entidades.

## Critérios de aceite para implementação

- Cabeçalhos e linhas recolhidas têm 24 px em desktop; campos longos não aumentam a altura inadvertidamente.
- Selecionar checkbox, clicar em seu rótulo e usar teclado produzem uma única alteração e não travam o navegador.
- Checkbox de seleção, expansão, menu e ações têm comportamentos independentes.
- Cabeçalho seleciona somente a página; estado intermediário e contagem global estão corretos.
- Seleção persiste ao paginar, e a ação em lote usa exatamente os IDs selecionados.
- Colunas obrigatórias não podem ser ocultadas, mesmo com preferências antigas ou inválidas.
- Seletor contempla o esquema real da integração; dados ausentes não são inventados.
- Expansão exibe o inteiro teor original, completo, justificado, com texto de 10 px e metadados em negrito.
- Nome longo permite leitura completa por hover, foco e expansão.
- Menu abre como popover, permanece visível nas bordas e funciona com teclado e Escape.
- Cadastro e vínculo inline exigem confirmação e preservam os dados em falha.
- Lote apresenta resultados reais e trata sucesso parcial sem perder itens com falha.
- Paginação respeita a fonte e mantém intervalo, total e botões consistentes.
- Tema, zoom, tela estreita e toque mantêm os controles utilizáveis.
- Nenhuma interação de apresentação altera os dados originais ou o status da publicação.

## Limite do mockup

O mockup é uma prévia com dados ilustrativos. Formulários de cadastro/vínculo e operações de lote são simulados; não demonstram integração de backend. A barra em lote, o catálogo DJEN completo, a persistência, a navegação acessível do menu e os estados de erro devem seguir esta especificação na implementação real.
