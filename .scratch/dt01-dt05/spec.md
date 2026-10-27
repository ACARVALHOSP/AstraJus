# Publicações OAB — DT01 a DT05

Status: ready-for-agent
Data: 25/10/2026

Mockup separado aprovado pelo usuário com pedido explícito de PR e merge. Escopo: Publicações monitoradas, preservando dados originais, capitalização de nomes, preferências e fluxos existentes. DT06 não integra esta entrega.

## Contratos implementados

1. **DT01:** seleção ativa fecha menus e bloqueia ícones/ações individuais por atributo e guarda de execução. Formulários inline preservam os valores e ficam inert durante seleção. Envio inline em andamento bloqueia checkbox/paginação/lote e outras ações de linha; falha restaura os controles e conserva o formulário para repetir. O bloqueio se aplica também aos itens que ficam selecionados após falha parcial.
2. **DT02:** expansão antes da seleção no cabeçalho e em cada registro. Identificadores, eventos independentes e colspan mantidos.
3. **DT03:** toolbar e barra de lote com mínimo de 48 px, conforme o mockup e tamanho alto do CSS Carbon local; cabeçalho e linhas M/40 px preservados, incluindo adaptação de toque. Não generalizar a exceção periférica para outras tabelas.
4. **DT04:** texto do cabeçalho limitado a duas linhas de 16 px, com reticências, nome completo e tooltip por hover/foco; Escape fecha. O alvo é um span focável, sem papel de botão ou ordenação inexistente.
5. **DT05:** catálogo único de ações contextuais determina disponibilidade, execução e apresentação. Uma/duas executáveis usam IconButton; três ou mais usam overflow. Motivos de indisponibilidade permanecem identificáveis. Ícones Link16 e Archive16 são dados oficiais do pacote @carbon/icons, sob Apache-2.0 (licença já vendorizada em static/carbon/LICENSE-web-components.txt); não há dependência de CDN nem bundle novo.

## Validação

Regressões novas cobrem menu → seleção, bloqueio por evento, formulário preenchido → lote → cancelar, envio pendente → falha, ordem dos controles, medidas, truncamento/tooltip, temas/mobile e ícones inline com execução dos mesmos handlers. As regressões existentes continuam cobrindo seleção entre páginas, sucesso parcial, preferências e conteúdo integral.

Os testes usam Chrome/Playwright e APIs interceptadas, sem dados reais. Capturas ficam fora do PR. Não há alegação de teste manual com leitor de tela.

Resultado: 59 testes de interface aprovados, incluindo as cinco novas regressões. Capturas da implementação conferidas em 1440/390 px, white/g100, com e sem seleção: sem overflow global ou erros JS, cabeçalho/linha de 40 px e toolbar/barra de lote de 48 px. Sintaxe JavaScript e git diff --check aprovados.
