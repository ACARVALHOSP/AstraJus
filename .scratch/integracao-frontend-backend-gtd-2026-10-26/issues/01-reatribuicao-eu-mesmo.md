# I01 — Corrigir reatribuição para “Eu mesmo”

Status: ready-for-agent
Execução: concluída no workspace
Grau: S2

## Trabalho

Resolver responsável vazio/null para a identidade autenticada também no PATCH. Preservar PATCH omitido, validação de usuário e política de avisos. Contrato e aceites em ../spec.md.

## Comments

- 26/10/2026: iniciada implementação autorizada no chat; reproduzir por teste de regressão antes da correção.
- 26/10/2026: regressão reproduziu preservação indevida para null, vazio e espaços. PATCH corrigido e persistência conferida com banco temporário; sem identidade, há erro explícito. Lista de usuários indisponível preserva o responsável atual no modal. Suíte de backend: 247 testes aprovados. Detalhes em ../acompanhamento.md.
