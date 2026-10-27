# Correções das nove falhas de interface

Status: implementação validada; publicação autorizada

O usuário autorizou seguir com frontend e deploy após a investigação das falhas do PR #91. Escopo: remover os erros de renderização do feedback, corrigir o diálogo e o popover em tela pequena e atualizar os testes para os controles Carbon e a apresentação atuais. Sem mudança de backend ou de modelo de dados.

## Implementação

- O shim existente de `CDSProgressBar.updated` apagava o conteúdo de um nó gerenciado pelo Lit (`textContent = ''`). Na renderização seguinte, o Lit tentava atualizar a referência removida e lançava `Cannot set properties of null (setting 'data')`. O shim agora oculta o anúncio inglês com atributos, preservando seus nós e a mensagem em português. O bundle é reconstruído com as dependências Carbon 2.66.0 já instaladas.
- O CSS do diálogo de edição pendente agora alcança `.app-modal-footer`, classe efetivamente usada após conversão em `cds-modal`. Botões podem encolher e ficam empilhados abaixo de 768 px. O CSS legado também tinha `gap: .var(...)`, expressão inválida; corrigido para o token de 0,5 rem.
- Em tela pequena, o conteúdo das notificações é fixado à viewport com margens laterais. O modo tabTip e a sombra/autoalign, que criavam um containing block com a largura do sino, ficam restritos ao desktop. O breakpoint é acompanhado mesmo com o painel aberto.
- Os testes interagem com rótulos/comboboxes públicos Carbon, mantêm a verificação dos valores legados, usam a ordem atual Cards/Tabela para Home/End e a capitalização de apresentação vigente. Não removem a verificação de erros JavaScript.

## Critérios de aceite

1. Cadastro por publicação e atualização de capa terminam sem erro de renderização e mantêm seu feedback.
2. Progresso pode alternar entre ativo, concluído e erro repetidamente sem perder as âncoras de renderização Lit ou os nomes/mensagens acessíveis.
3. Diálogo de saída mantém todas as ações dentro do footer em 1440, 768, 390 e 320 px.
4. Notificações cabem na viewport ao abrir e ao redimensionar o painel aberto; Escape, foco, leitura e paginação continuam disponíveis.
5. Os nove casos antigos passam, além da regressão completa do painel e dos fluxos novos de Clientes/notificações.

## Validação

Os testes de cadastro por publicação, capa, radios, diálogo e paginação já passaram após as correções. Os testes de foco do prazo e revisão por executor também passaram. O teste de limites dos painéis passou em todos os tamanhos verificados.

Verificações Node de progresso e feedback HTTP/MCP e de sintaxe JavaScript passaram. A suíte completa de interface inclui dois novos testes de regressão (progresso reutilizado e notificações abertas durante resize), ações em massa e notificações.

Publicação por PR, merge e workflow de deploy existente, seguida de conferência de saúde e dos assets públicos. Bancos temporários e artefatos de teste não entram no PR.

Resultado final: **93 testes de interface aprovados**, sem falhas, em 315,5 s. Inclui os 83 testes do painel (81 anteriores e dois novos), os cinco fluxos de ações em massa e os cinco fluxos de notificações. Os nove casos que falhavam anteriormente passaram. Temas White/Gray 100 e capturas em 320 px foram inspecionados. Nenhuma alteração de backend foi necessária.
