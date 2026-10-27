# Plano de integração — contratos e etapas

Autorização: “iniciar plano de ação”, em 26/10/2026.

## Escopo desta etapa

Implementar I01 e I02 do relatório. Preservar o filtro de responsável pelo processo, acrescentar filtro independente de responsável pela atividade e exibir ambos na revisão. Reutilizar componentes, APIs e permissões existentes.

## Contrato I01

- POST e PATCH com responsável null, vazio ou espaços significam “Eu mesmo”: usar a identidade autenticada.
- PATCH sem a chave responsável preserva o valor existente.
- Nome explícito continua sendo validado no registro de usuários, quando disponível.
- Sem identidade para resolver “Eu mesmo” na edição, retornar erro de validação e não alterar o registro.
- Não introduzir comando de desatribuição. Atividades legadas sem responsável continuam distinguíveis na revisão; não há promessa de um controle de desatribuição no modal atual.
- Reatribuição para si não envia aviso de delegação; reatribuição para outro usuário continua seguindo o fluxo existente.

## Contrato I02

- Filtros independentes e cumulativos: responsável pelo processo, responsável pela atividade e tipo.
- Opções do executor vêm das atividades abertas efetivamente carregadas; incluir “Sem responsável” sem confundir com o valor de “Todos”.
- Manter filtro ao atualizar enquanto a opção existir. Quando deixar de existir, voltar a Todos.
- Preservar aviso de cobertura parcial e conclusão apenas após sucesso do PATCH.
- Abrir processo continua levando ao detalhe de atividades.

## Validação

Regressão backend com SQLite temporário: reatribuir Bia → usuário autenticado, reler persistência, preservar responsável em PATCH omitido, negar nome inválido e verificar avisos. Regressão de interface com APIs simuladas: filtros cruzados, ausência de responsável, falha parcial, atualização, conclusão e envio “Eu mesmo”. Capturas desktop/móvel, sintaxe JS e checagem de diff.

## Próximas etapas

I01/I02 foram implementados; validação e limites em [acompanhamento.md](acompanhamento.md).

Em 26/10/2026, o usuário pediu especificar I03/I04 e citou I05, interpretado como inclusão da central de notificações nesta etapa documental. Specs propostas, sem implementação:

| Item | Contrato | Triagem necessária antes do código |
|---|---|---|
| I03 | [Origem DJEN estruturada](spec-i03-origem-djen.md) | Implementado após “continuar”; mantém coleção compartilhada autenticada e valida vínculo na gravação |
| I04 | [Agenda/atividade](spec-i04-agenda-atividade.md) | Implementado após “implementar”; ID persistido, ETag, fila, reconciliação, cancelamento e interface |
| I05 | [Central de notificações](spec-i05-notificacoes.md) | Backend e frontend implementados após aprovação da prévia; cinco fluxos UI e 299 testes backend passaram |

Sequência recomendada: resolver política de acesso compartilhada; implementar I03; validar o adaptador e implementar I04; construir persistência/API de I05 antes de ligar o sino. I05 pode avançar em paralelo lógico a I04 após fechar suas próprias dependências; isso não solicita execução por agentes paralelos. I06/ZapSign segue fora desta etapa.

I03 e I04 foram implementados após as instruções seguintes do usuário, com decisões e validação no final das próprias specs. I05 tem backend e frontend integrados após aprovação explícita da prévia Carbon. Tickets separados em issues/03, 04 e 05.
