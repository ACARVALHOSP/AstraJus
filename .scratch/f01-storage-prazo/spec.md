# F01 — Armazenamento local não pode interromper cálculo de prazo

Status: ready-for-agent
Data: 25/10/2026

Leitura e gravação da preferência de município devem ser protegidas separadamente da operação de cálculo. Acesso a localStorage pode falhar no próprio getter, em getItem ou em setItem.

- Em falha de leitura, o painel abre com o padrão já adotado (São Paulo) e orienta conferir o município antes de calcular.
- Em falha de gravação, informa que não pôde lembrar o município e calcula com o valor preenchido. Não apresenta a preferência como salva.
- O aviso pertence à preferência, fica associado ao campo e separado do resultado do cálculo. Uma gravação posterior bem-sucedida limpa o aviso anterior.
- Campos, regra de cálculo, consulta de feriados, valores iniciais e IDs/rótulos de F02 são preservados. Erros reais de cálculo continuam visíveis e não geram resultado fictício de sucesso.

Aceite: simular SecurityError em getItem, QuotaExceededError em setItem e exceção no getter de localStorage. O painel deve abrir, preservar dias e município, consultar feriados com o município informado e permitir repetir. Conferir recuperação do armazenamento e falha real da consulta de feriados.

Validação: quatro testes Chrome/Playwright aprovados, incluindo os três cenários de F01 e a regressão F02 de dois painéis. O cálculo usa a implementação existente, com API de feriados simulada; não é uma validação jurídica da regra de contagem. Sintaxe JavaScript e git diff --check aprovados. Sem dados ou serviços reais.
