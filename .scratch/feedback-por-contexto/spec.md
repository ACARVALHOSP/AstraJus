# Feedback por contexto

Prévia aprovada em 26/10/2026, com autorização para aplicar, PR e merge.

- Navegação para páginas e detalhes: Skeleton Carbon para os dados obtidos no servidor.
- Ações manuais internas: InlineLoading Carbon, com sucesso e erro.
- Ações manuais externas: ProgressBar indeterminada Carbon. A classificação inclui proxies locais: DJEN/DataJud, ViaCEP, Asaas, Calendar e atualização de capa. Criação de processo pode também criar pasta no Drive e é tratada como externa.
- Árvores CJPG são dados locais de referência e usam Loading nas interações manuais; ferramentas de consulta CJPG são externas.
- Abertura de páginas passa metadados explícitos; atualizações manuais mantêm Loading ou ProgressBar conforme a origem. Handshake MCP não cria uma segunda indicação sobre a consulta.
- Concorrência entre os três tipos compartilha a contagem de ocupação da região sem retirar aria-busy antes da última operação. Erros continuam visíveis; skeleton desaparece após o carregamento e o conteúdo apresenta o resultado.

Validação: 238 testes unitários passaram; test_progress_controls.cjs e test_feedback_requests.cjs passaram; sintaxe JS/Python validada. Verificação no navegador dos três componentes, término, falha e ausência de erros JS. Suíte Playwright completa não executada nesta rodada.
