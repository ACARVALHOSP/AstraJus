# Normalizar nomes

Status: ready-for-agent
Blocked by: —
Tamanho: P
Spec: ../spec.md

Ver spec, seção 5. Função única de normalização (frontend e servidor) + saneamento em lote com prévia e desfazer.
Não altera CPF/CNPJ, OAB, número CNJ nem partes/advogados da capa.

## Aceite
- Conjunto de teste (siglas, partículas, razões sociais, algarismos romanos) normaliza como esperado; idempotente.
- Desfazer restaura o valor anterior; nome já em caixa mista não é tocado.
