# Responsável por regras de distribuição

Status: ready-for-agent
Blocked by: 01
Tamanho: M
Spec: ../spec.md

Ver spec, seção 4. Preenche responsável **só quando vazio**: quem captou → regras do administrador → padrão do
escritório → sem responsável (admin é avisado). Inclui modo simulação (framework de simulação nasce aqui) e evento no caso
com origem `automacao:<chave>`.

Decisão pendente: responsável padrão do escritório.

## Aceite
- Responsável já definido nunca muda; regra de cliente vence a padrão.
- Regra apontando para pessoa inativa/revogada é ignorada com alerta ao administrador.
- Simulação não grava nada.
