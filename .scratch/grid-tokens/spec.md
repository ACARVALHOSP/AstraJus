# Grid, tokens e escala tipográfica do painel

Status: ready-for-agent
Data: 25/10/2026

## Autorização e decisões

Mockup separado aprovado pelo usuário em 25/10/2026, com a orientação adicional: somente dados de nomes (título, nome e responsável) mantêm primeira letra maiúscula por palavra; o restante segue as specs. Aplicação, PR e merge autorizados explicitamente.

- Grid Carbon vendorizado, HTML/JS vanilla; sem novo bundle ou dependência.
- Grupos de formulário usam 4/8/16 colunas nos breakpoints 320/672/1056 px e calhas de 16 px. Campos padrão ocupam 4/4/8 colunas. Endereço/capa usam campos curtos de quatro colunas; entre lg e xlg usam oito para compensar a navegação lateral.
- Espaçamentos customizados são mapeados para a escala Carbon, inclusive 2/4/12 px. A tabela oficial de spacing prevalece sobre a frase ambígua da spec local que restringia os valores a múltiplos de oito.
- Página: heading-04, 28/36 px, peso 400. Seção: heading-02 real, 16/24 px, peso 600. A descrição de heading-02 como 20 px na spec anterior estava incorreta para a versão vendorizada; 20 px corresponde a heading-03.
- Corpo: body-01; rótulos/ajuda: label-01/helper-text-01. Tabela OAB permanece M/40 px, conteúdo de 12 px e exceções de 10 px para inteiro teor e status.
- Nomes são formatados explicitamente na exibição, sem transformação global de texto nem gravação do formato no servidor. Valores de inputs editáveis e options continuam canônicos. Filtros, salvamento, seleção e integrações mantêm seu contrato.
- Publicações começam com Tribunal, Processo e Nome do processo; preferências existentes válidas são preservadas. Dados nomes/advogados têm tratamento próprio; siglas, identificadores, URLs e inteiro teor permanecem literais.

## Critérios de aceite

1. Grupos têm 4/8/16 colunas e gap de 16 px nos breakpoints previstos.
2. Cadastro não produz overflow global em 320, 390, 672, 768, 1056, 1312, 1440 e 1584 px, em white/g100.
3. Dados como MARIA DA SILVA aparecem como Maria Da Silva; o input conserva o valor original, sem tornar o formulário alterado por apresentação.
4. Comandos como Cadastrar processo e Confirmar vínculo usam frase; nenhuma transformação global altera rótulos ou publicação integral.
5. Seleção, lote, paginação, confirmações inline e proteção contra descarte continuam funcionando.

## Fontes

Referências consultadas via Carbon MCP (Grid e fundamentos de grid, spacing e tipografia); métricas conferidas no CSS @carbon/styles 1.116.0 já vendorizado. Consultar também DESIGN.md e as specs existentes em .scratch/carbon-grid-2x-espacamento, .scratch/carbon-capitalizacao-ux-writing e .scratch/tabela-carbon-xs.

Auditoria automática do novo bloco CSS: “Validate Carbon Grid usage” sugere componentes React, mas o projeto usa as classes Carbon vendorizadas e Web Components. “No custom container widths” reconhece os media queries 672/1056 px como larguras; esses valores são os breakpoints oficiais. Não usar variáveis CSS em condições de media query, pois não são substituídas nessa sintaxe. O limite intermediário foi expresso por min-width 1056/1312 px, sem breakpoint adicional.

## Validação realizada

- Suíte de interface: 52 testes aprovados com Chrome local, Playwright e APIs interceptadas, em 25/10/2026. Nenhum token ou dado real utilizado.
- Novas regressões verificam cadastro/publicações em oito viewports (320–1584 px), ambos os temas, grid 4/8/16 e gap de 16 px, ausência de overflow global, nomes e inputs originais, colunas iniciais, tabela M/40 px e preservação de identificadores.
- Sintaxe JavaScript e `git diff --check` aprovados. Capturas de cadastro/publicações em 390/1440 px foram conferidas nos temas white/g100; artefatos ficam fora do PR.
- Não houve teste manual com leitor de tela nem zoom real do navegador; os viewports são emulados. Não se declara conformidade integral de acessibilidade.
- Alterações locais preexistentes de controles/modais/progresso foram preservadas; implementação preparada em branch/worktree isolada a partir de main.
