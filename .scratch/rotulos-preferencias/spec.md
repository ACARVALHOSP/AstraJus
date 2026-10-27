# Separação de rótulos DJEN e preferências de colunas

Status: ready-for-agent
Data: 25/10/2026

O PR #76 já removeu o formatador global de textos, uniformizou comandos em frase e definiu as três colunas obrigatórias como padrão sem trocar a chave de preferências. Esta complementação corrige os rótulos de metadados DJEN cujas chaves usam camelCase/PascalCase.

Rótulos são derivados por função exclusiva da interface, com capitalização de frase e preservação das siglas OAB, UF, ID, CNJ, DJEN, URL, API, CPF e CNPJ. Exemplo: dataDaCaptura → Data da captura; URLDocumento → URL documento. Formatação de nomes continua independente, sem alterar valores ou identificadores.

Não mudar nem regravar preferências durante a leitura. As escolhas válidas são exibidas, campos obsoletos não geram colunas e as obrigatórias permanecem visíveis. Novas instalações seguem Tribunal, Processo e Nome do processo.

Aceite: regressão de rótulos verifica o seletor real, os formatadores independentes, dados originais e uma preferência com colunas válidas e obsoletas preservada literalmente no localStorage.

Validação: cinco regressões de interface aprovadas em Chrome com APIs simuladas (rótulos/preferências, nomes e tabela M, persistência, seletor de colunas e vínculo). Sintaxe JavaScript e git diff --check aprovados.
