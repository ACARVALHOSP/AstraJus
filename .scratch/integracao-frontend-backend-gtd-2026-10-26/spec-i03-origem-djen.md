# I03 — Referência DJEN estruturada

Status: implementado no workspace
Data: 26/10/2026
Natureza: contrato implementado e validado com dados fictícios; sem deploy

## Resultado e evidência atual

Uma atividade conserva sua origem sem depender de observações editáveis. A referência não concede acesso ao conteúdo da publicação.

Hoje app.js usa o marcador `Publicação de origem (DJEN): <hash>` em observacoes e procura o hash em GET /casos/<id>/publicacoes. db.py persiste apenas observacoes; publicacoes_capturadas possui um único caso_id. _publicacoes_do_caso permite vínculo/desvínculo usando vincular_caso. Não presumir que os campos pasta/acesso, por existirem, já fornecem autorização por registro: o código atual autentica por Bearer e os handlers examinados não demonstram essa política completa.

## Modelo e contrato propostos

- Acrescentar a caso_atividades `origem_djen_hash TEXT NULL` e `origem_djen_versao INTEGER NOT NULL DEFAULT 0`. Versão 0 indica entrada ainda não processada pela compatibilidade; 1 indica campo estruturado autoritativo, inclusive quando null.
- A atividade tem zero ou uma origem DJEN; uma publicação pode originar várias atividades. Não impor unicidade do hash por processo.
- Não usar FK com exclusão em cascata para a publicação. O hash deve sobreviver à remoção da publicação ou mudança do vínculo. A atividade continua pertencendo ao seu processo.
- POST/PATCH das rotas de atividades existentes aceitam origem_djen_hash. GET devolve o campo, sem incorporar inteiro teor nem dados da publicação.
- POST com hash explícito exige publicação atualmente vinculada ao mesmo processo e acessível pelo solicitante. Não vincular publicação automaticamente.
- PATCH omitindo o campo preserva origem, mesmo que observacoes seja substituído. PATCH com null remove a referência de forma explícita. Hash vazio/inválido retorna 400; outra origem só é aceita após as mesmas verificações de acesso e vínculo. Negar sem revelar se publicação de outro processo existe.
- Validar formato/tamanho com o contrato de hash já utilizado no projeto; não inferir formato de número CNJ nem criar regra baseada no exemplo de teste.
- Origem informada e observações legadas conflitantes no mesmo pedido: rejeitar com 400 e preservar todos os dados. Nunca escolher silenciosamente entre dois hashes.

## Migração e clientes antigos

1. Migração transacional e idempotente: processar somente versão 0. Reconhecer exatamente uma linha no formato legado conhecido, com hash válido. Copiar o hash, marcar versão 1 e conservar observacoes sem reescrever texto livre. Referência antiga válida é preservada mesmo se a publicação já estiver ausente/desvinculada; isso não a torna acessível.
2. Zero marcadores: hash null e versão 1. Marcadores múltiplos, conflitantes ou malformados: não adivinhar; conservar texto, deixar hash null, marcar versão 1 e produzir relatório local de migração com IDs e motivo, sem inteiro teor. Exigir correção explícita para os casos ambíguos.
3. POST de cliente antigo sem campo estruturado: aceitar marcador único válido pelo adaptador de compatibilidade, verificando vínculo/acesso como na criação nova. Marcador inválido/ambíguo retorna erro explicativo, sem criar atividade parcial.
4. PATCH antigo que só altera observacoes não recria, remove ou troca a origem estruturada. Após a versão 1, o marcador não volta a ser fonte de verdade. Isso também impede que um marcador remanescente desfaça uma remoção explícita por null.
5. Frontend novo lê primeiro o campo estruturado; fallback textual é permitido somente quando o servidor antigo omite o campo, nunca quando retorna null. Com servidor novo, não precisa acrescentar marcador em novos registros. Pode ocultar na edição uma linha legada que corresponda à referência, preservando demais observações.
6. Suporte de rollback: manter texto antigo e adicionar colunas sem destruir dados. Aplicação antiga não compreenderá a origem de atividades criadas apenas com o campo novo; rollback exige exportação de compatibilidade antes de regressar. Não declarar rollback transparente.

## Acesso e desvinculação

“Ver publicação de origem” continua usando a coleção autorizada do mesmo processo. Não adicionar fallback por hash global, consulta pública DJEN, certidão ou cópia do inteiro teor em atividade/notificação.

| Situação | Referência | Conteúdo pelo fluxo de origem |
|---|---|---|
| Publicação vinculada e solicitante autorizado | Preservada | Exibir usando contrato atual autorizado |
| Desvinculada, excluída ou vinculada a outro processo | Preservada | Indisponível; não revelar destino nem metadados adicionais |
| Solicitante perdeu acesso ao processo/publicação | Não retornar dados fora do acesso permitido | Negar; não usar referência como credencial |
| Mesmo hash novamente vinculado ao processo e acessível | Preservada | Volta a ser recuperável sem recriar atividade |

DELETE /casos/<id>/publicacoes/<hash> deve verificar que o vínculo atual pertence ao id da rota antes de remover. Não usar somente uma atualização global por hash. A verificação e a alteração precisam ocorrer atomicamente para evitar desvincular publicação movida por outro pedido.

Ausência e falta de acesso devem produzir resposta externa indistinguível no fluxo de origem. Não cachear inteiro teor como alternativa de acesso; ao desvincular, invalidar visualização da origem já carregada no painel. Não há como revogar conteúdo que o usuário já leu, copiou ou obteve por outra rota autorizada.

## Aceites e próxima ação

- Migração repetida não duplica nem modifica observações; marcador único, ausente, inválido e conflitante têm resultados acima.
- Editar observações via cliente antigo preserva origem; null explícito a remove sem ressurreição pelo marcador.
- Desvincular mantém hash e atividade; recuperação de origem fica indisponível. Desvincular pela rota de outro processo não altera registro algum.
- Sem vínculo/permissão, criação e consulta da origem não expõem inteiro teor nem confirmam existência global.
- Falha de validação conserva formulário; criar atividade continua sem tratar a publicação automaticamente.

Grau original S2 provisório; esforço médio. Lente GTD: capturar e revisar a origem com confiança.

## Decisões de implementação e validação

- A política efetiva é a coleção compartilhada de processos/publicações sob autenticação Bearer. A referência não cria nova rota de leitura ou fallback por hash. Campos acesso/responsavel não foram reinterpretados como ACL, e não se afirma isolamento privado por processo que hoje não existe nesses handlers.
- O contrato novo de entrada aceita identificador opaco com 1–512 caracteres ASCII alfanuméricos, hífen ou sublinhado; rejeita espaço, controle e separadores de caminho. O limite é uma decisão de validação deste recurso, não uma alteração do contrato de certidões nem uma alegação de limite da API DJEN. O armazenamento antigo não tinha limite comum formalizado.
- A validação de vínculo ocorre sob BEGIN IMMEDIATE na mesma transação que cria/troca a referência. Omissão e manutenção de uma origem já existente não exigem reabrir a publicação após desvinculação.
- Pendências de migração são persistidas localmente em origem_djen_migracao_pendencias, somente atividade_id/motivo. Consulta de inspeção: SELECT atividade_id, motivo FROM origem_djen_migracao_pendencias. O relatório não contém inteiro teor. Remoção/troca explícita da origem resolve a pendência daquela atividade.
- GET de atividades anuncia origem_djen_estruturada: true, inclusive em lista vazia. Frontend usa campo estruturado quando disponível; mantém marcador na criação/edição com servidor antigo. Edição comum em servidor novo omite o campo de origem para preservar o valor, sem conflito com marcadores remanescentes.
- Desvinculação invalida conteúdo exibido e a geração de requisições em andamento, impedindo que resposta antiga repovoe o painel. Não há push para invalidar telas de outros dispositivos; uma consulta posterior sempre usa o vínculo atual. Conteúdo já recebido não pode ser revogado retroativamente.
- Migração exercitada apenas em bancos temporários: nenhuma alteração em cnj.db foi executada nesta etapa. Migração real ocorrerá quando a aplicação atualizada abrir seu banco; rollback mantém a ressalva acima.
- Validação: 259 testes de backend aprovados; seis testes focados de interface aprovados. Evidências e limites em acompanhamento.md.
