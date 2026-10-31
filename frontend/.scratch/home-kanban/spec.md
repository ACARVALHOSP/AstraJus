# Home Meu dia com Kanban

Implementação validada; mockup aprovado.

Mockup aprovado explicitamente pelo usuário em 30/10/2026 antes de qualquer alteração no frontend.

## Escopo aprovado

- Entrada Início e home padrão Meu dia.
- Resumos de atrasadas, vencimentos de hoje, próximos sete dias e publicações não tratadas.
- Filtros por executor, responsável pelo processo, tipo e período.
- Quatro colunas: A fazer, Em andamento, Aguardando retorno e Concluídas.
- Cartões com processo, executor, data e checklist, abrindo a atividade existente.
- Alteração de status por arraste ou seletor acessível, persistida via PATCH existente.
- Criação de atividade reutilizando o modal atual, após selecionar o processo.
- Celular com uma coluna por vez; temas e movimento conforme Carbon.
- Falhas parciais explícitas e isolamento dos dados ao mudar de conexão.

## Decisões

- A API e a coluna SQLite de status aceitam os quatro valores sem migração: pendente, em_andamento, aguardando, concluida.
- Datas seguem o cadastro e o dia local; não há cálculo de prazo jurídico.
- Próximos sete dias abrangem amanhã até hoje + sete dias, sem duplicar o indicador de hoje.
- Resumos de atividades respeitam executor, responsável e tipo; o período selecionado afeta o quadro.
- Concluídas exibem até dez cartões por padrão, com opção de ver todas. Não há data de conclusão disponível na API para afirmar recência.
- Carregamento limitado a quatro requisições simultâneas; falhas em checklist não ocultam a atividade.
- Publicações são consultadas independentemente; contagem indisponível nunca é apresentada como zero.
- PR destinado a astrajus-react, branch que contém este frontend.

## Validação

Os resultados finais são registrados em validacao.md.
