# Correções da auditoria GTD + UI/UX

Implementação autorizada pelo usuário em 24/10/2026, sobre o relatório desta pasta.

## Escopo

Preservar Carbon white, português brasileiro, APIs, permissões e alterações já existentes. Corrigir estados, recuperação, identificação dos campos e continuidade do trabalho. Sem deploy, alteração de dados reais ou novas regras de delegação.

## Decisões

- A central de notificações permanece explicitamente indisponível. O sino não atesta ausência de publicações ou atividades.
- A consulta global atualiza as duas fontes a cada abertura, distingue erro parcial de ausência e reaplica o termo ao concluir o carregamento. Limita a apresentação a vinte itens e informa o total de correspondências. Falha não reutiliza dados antigos como se fossem atuais.
- Falha de escrita no armazenamento mantém o estado anterior dos favoritos e avisa o usuário; não há persistência fictícia nem fallback silencioso de sessão.
- Campos repetíveis ganham rótulos visíveis, IDs exclusivos e grupos nomeados. Getters existentes continuam lendo os mesmos controles.
- O drawer móvel fecha somente após autorizar a mudança de aba. Escape retorna ao acionador; cancelamento de edição preserva o contexto.
- Integrações distingue acesso, configuração e erro; “Configurado” indica configuração cadastrada, não teste de saúde do serviço externo.
- O alternador Tabela/Cards usa grupo de botões pressionáveis, preservando Tab/Enter/Espaço e acrescentando setas/Home/End.

## Atividades consolidadas (A01)

Nova aba em Escritório, usando `GET /casos` e os endpoints existentes `GET /casos/<id>/atividades`. Até quatro consultas simultâneas. Atividades concluídas não aparecem. Falhas por processo são indicadas como cobertura incompleta e permitem recarga. Filtros: tipo e **responsável pelo processo**. Não há responsável próprio pela atividade no modelo atual; a interface declara essa distinção. Datas são exibidas como cadastradas, sem inventar cálculo, urgência ou prazo jurídico.

Concluir usa o PATCH já existente. Só remove a atividade da visão depois de sucesso; em falha, permite repetir. Abrir processo leva à sub-aba Atividades, que relê os dados.

Limite conhecido: agregação faz uma requisição por processo, com concorrência limitada. Para carteiras grandes, uma futura API agregada reduziria o número de chamadas. Não foi introduzida migração de banco nesta entrega.

## Publicação → atividade (A08)

Publicações monitoradas já vinculadas oferecem “Criar atividade”. O fluxo abre o processo e o formulário de atividade com a referência DJEN. Não altera o status da publicação. Publicações sem processo seguem usando o cadastro/vínculo existente antes de criar uma atividade.

A referência é persistida em uma linha identificada no campo de observações já suportado pela API: `Publicação de origem (DJEN): <hash>`. Ao editar na interface, essa linha é separada das observações livres e recomposta no envio. O botão “Ver publicação de origem” consulta as publicações vinculadas ao processo e mostra o conteúdo integral correspondente. Origem removida/desvinculada e falha de consulta possuem estados próprios.

Essa abordagem evita inventar endpoint, modelo de delegação ou migração. A referência não é chave estrangeira: alterações diretas por outros clientes podem removê-la. Uma relação estruturada pode ser considerada futuramente se houver necessidade de consultas ou integridade referencial sobre essa origem.

## Validação

Critérios de aceite do relatório, regressões de interface com APIs interceptadas e dados fictícios, capturas em desktop/celular, sintaxe JavaScript e compilação Python. Resultados e limites em `acompanhamento.md`. Testes de backend existentes usam ambiente virtual do projeto; o Python global possui MCP incompatível.
