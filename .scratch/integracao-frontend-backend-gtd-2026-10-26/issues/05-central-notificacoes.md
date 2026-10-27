# I05 — Especificar central de notificações

Status: ready-for-agent
Execução: backend e frontend concluídos no workspace; aprovação visual concedida
Grau: S2 provisório

## Contrato

[Spec I05](../spec-i05-notificacoes.md): publicação capturada para titular autorizado e atribuição para responsável autorizado, outbox persistente, feed individual, deduplicação e leitura independente dos estados de trabalho/e-mail.

## Próxima ação

Publicar PR e realizar merge autorizados pelo usuário, após as validações registradas em acompanhamento.md.

## Aceite

Isolamento entre usuários em lista/contagem/leitura, recaptura sem duplicação, nova atribuição legítima notificada, ausência de vazamento após desvinculação/perda de acesso, leitura persistente sem tratar publicação ou concluir atividade e erro distinto de vazio.

## Comments

- 26/10/2026: “I05” no pedido foi interpretado como inclusão desta especificação no mesmo tópico. Nenhuma central foi habilitada.
- 26/10/2026: após “continuar”, backend implementado, com suíte completa de 299 testes aprovada. Revisão automática rejeitou o patch de frontend por falta de mockup aprovado, citando AGENTS.md. Aplicação preservada; prévia isolada preparada e validada em navegador para aprovação concreta. Detalhes e limites em acompanhamento.md.

- 26/10/2026: usuário aprovou a prévia e autorizou implementação, PR e merge. UI/API conectadas e cinco fluxos de navegador aprovados; 299 testes backend aprovados.
