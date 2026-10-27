# I04 — Definir vínculo opcional agenda/atividade

Status: ready-for-agent
Execução: concluída no workspace
Grau: S2 provisório

## Contrato

[Spec I04](../spec-i04-agenda-atividade.md): atividade como fonte da data, eventos avulsos preservados, vínculo opcional de dia inteiro, estados persistidos, reconciliação e cancelamento independentes da conclusão.

## Próxima ação

Estratégia verificada na documentação oficial e implementada: ID persistido, reconciliação por ID/calendário, ETag, fila persistida e lease. Acesso compartilhado autenticado preservado; vínculo inicial apenas de dia inteiro sem hora; exclusão bloqueada enquanto ativo/incerto. Rotas específicas precedem o fallback de atividades. Resultado detalhado na spec e no acompanhamento.

## Aceite

Repetições/restarts/concorrência não duplicam evento; pedido conflitante retorna 409; alteração externa gera divergência; cancelamento não conclui atividade nem causa recriação automática. Não declarar garantia remota sem validação do adaptador.

## Comments

- 26/10/2026: especificação solicitada antes da implementação. APIs, schema e sincronização atuais preservados.
- 26/10/2026: usuário instruiu “implementar” e “continuar”. Implementados persistência, adaptador, rotas, job, controles de interface e testes offline. Nenhuma conta Google real ou banco de produção foi utilizado. A migração ocorrerá na próxima abertura do banco pela aplicação atualizada.
- 26/10/2026: validação final: 281 testes de backend aprovados, quatro testes focados de interface aprovados e confirmação das capturas responsivas aprovada. Spec e acompanhamento atualizados; sem deploy.
