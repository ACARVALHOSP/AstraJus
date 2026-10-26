# Correção das barras de progresso

Prévia visual separada aprovada pelo usuário em 26/10/2026: aplicar, PR e merge.

Corrigidos: falhas resolvidas como {ok:false}; rótulo estável por contexto; largura delimitada; espaçamento por tokens; aria-busy e aria-describedby na região; nome e descrição dentro do Shadow DOM; anúncios de término/erro em português. O adaptador Carbon é documentado e deve ser reavaliado ao atualizar a versão 2.66.0.

Validação: 238 testes unitários; test_progress_controls.cjs passou; inspeção real no navegador dos estados ativo concorrente e erro, com nome acessível e sem anúncios ingleses. Testes adicionais incluídos em test_interface.py; a suíte Playwright completa não foi executada. Sem teste com NVDA/JAWS.

Mantida a decisão de produto de ProgressBar indeterminada para acessos externos, inclusive curtos, sem spinner.
