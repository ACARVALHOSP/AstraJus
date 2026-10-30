# Publicações OAB: tabela, ações e atividade com prazo

Status: ready-for-agent
Data: 30/10/2026
Autorização: prévia apresentada antes de alterar o frontend; usuário definiu ações, confirmou comportamentos e solicitou “começar”. A discussão posterior substitui as propostas iniciais incompatíveis.

## Comportamento aprovado

- Tribunal, Processo e Nome do processo sempre visíveis. Seletor com demais campos reais, IDs estáveis, preferências versionadas e migração das preferências legadas válidas. Dados ausentes não recebem nomes inventados.
- DJEN exposto por ícone oficial Launch, nova aba com noopener/noreferrer; sem URL HTTP(S) válida, ação indisponível.
- Demais ações em OverflowMenu Carbon de três pontos: Criar/vincular ou Abrir processo; Criar atividade; Marcar como tratada; Arquivar; Reabrir como não tratada para registros tratados/arquivados.
- Consultar CNJ antes da criação. Processo existente exige confirmação do vínculo e preserva sua capa. Processo novo usa dados da publicação e enriquece automaticamente a capa com DataJud + DJEN. Falha preserva cadastro e permite retomar sem nova criação.
- Criar atividade exige processo vinculado. Título e referência da publicação preenchidos. Responsável selecionável. Após criação, marcar publicação como tratada. Repetir após falha de status não cria outra atividade.
- Arquivar é mudança reversível de status e não apaga dados/vínculos.
- Seleção por hash entre páginas, cabeçalho limitado à página atual, troca de filtro/tamanho limpa seleção. Sucesso parcial remove sucessos e mantém falhas disponíveis selecionadas. Ações individuais bloqueadas durante seleção/lote.
- Paginação real do servidor, 5/10/20 itens, intervalo e total. Ordenação explicitamente limitada à página carregada, sem afirmar ordenação global.

## Cálculo e revisão de prazo

Modelo de interação: https://pgmprazos.prefeitura.sp.gov.br/ — campos de data, prazo e tipo; contagem com calendário. O calendário específico de São Paulo–Capital não é aplicado implicitamente a outras localidades.

Mostrar data final, quantidade de dias, termo inicial e regra aplicada. Permitir edição antes da confirmação. Quantidade sugerida somente quando existir prazo numérico explícito e único no inteiro teor; ausência, ambiguidade ou menção a dias corridos mantém a duração para revisão. Não inferir prazo pelo tipo de comunicação.

Regras iniciais: dias úteis a partir de disponibilização DJEN (publicação no próximo dia útil; contagem a partir do útil seguinte) ou primeiro dia de contagem informado. Suspensão de 20/12 a 20/01 somente quando selecionada. Não confundir suspensão da contagem com inexistência de expediente para publicação.

Consultar calendário já disponível por MCP, município/comarca e tribunal, cobrindo todos os anos atravessados pelo prazo. Não assumir que lista de feriados prova cobertura de suspensões e provimentos. Exibir fonte e município efetivamente consultado. Cobertura incompleta ou falha mantém prazo pendente de revisão.

Ao confirmar atividade sem revisar, salvar sem data de vencimento, com indicação explícita de pendência e memória resumida em observações. Ao revisar os critérios e confirmar data final, salvar vencimento editado e registrar ajuste manual. Salvar somente metadados resumidos do calendário: o backend limita o corpo a 4096 bytes.

`ProvedorCalendario` recebe município, tribunal e anos; devolve origem, data da consulta, cobertura e intervalos de feriado/suspensão. `AtividadePublicacao` aceita provedor substituível. A futura consulta automática de feriados municipais e provimentos/suspensões é escopo reservado em issue própria, sem afirmar que já foi implementada.

## Referências oficiais consultadas

- https://pgmprazos.prefeitura.sp.gov.br/
- https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense
- https://www2.camara.leg.br/legin/fed/lei/2006/lei-11419-19-dezembro-2006-548410-normaatualizada-pl.html — art. 4º, §§ 3º e 4º
- https://www2.camara.leg.br/legin/fed/lei/2015/lei-13105-16-marco-2015-780273-normaatualizada-pl.html — arts. 219 e 220
- Carbon MCP: Data table, Toggletip, Checkbox, Modal, Pagination, Grid, Button, Select, TextInput, OverflowMenu e ícones oficiais.

## Validação

Build, lint, auditoria Carbon com revisão contextual dos falsos positivos, testes determinísticos do cálculo e interface com APIs simuladas. Conferir temas, teclado, seleção entre páginas, erro parcial, retry sem duplicação, revisão do vencimento e ausência de overflow global. Não há teste em dados jurídicos reais nem alegação de verificação manual com leitor de tela.
