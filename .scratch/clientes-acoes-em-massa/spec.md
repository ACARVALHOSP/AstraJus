# Clientes: etiquetas e atualização de perfil em massa

Status: implementação aprovada; validação e publicação em andamento

## Escopo e aprovação

Solicitação: implementar as duas ações escolhidas pelo usuário — aplicar/remover etiquetas e atualizar perfil com prévia. O mockup separado foi apresentado antes das alterações. A instrução “após fazer as ações em massa fazer pr, merge e deploy de tudo já feito” aprovou a implementação e a publicação.

Usadas as referências Carbon Data table, UI/UX Pro Max e o fluxo GTD de esclarecer antes de engajar já adotado na auditoria. O mockup é HTML independente, não integração de componentes Carbon de produção.

## Contexto confirmado no código

- `static/app.html`: Perfil já oferece Contato (`contato`) e Cliente (`cliente`). Perfil não é pessoa física/jurídica; `tipo_pessoa` permanece independente.
- `db.py`: perfil é persistido em clientes; não foi encontrado suporte a etiquetas de clientes.
- `server.py`, `_cliente_detalhe`: PATCH exige nome e encaminha campos e listas completos para atualizar_cliente. Não usar esse endpoint para enviar apenas perfil, pois campos omitidos podem ser esvaziados.
- A lista atual não tem paginação; não apresentar seleção de “todas as páginas”.

## Fluxo proposto

1. Checkbox por linha e checkbox no cabeçalho para todos os resultados atualmente exibidos. Cabeçalho tem estado misto para seleção parcial.
2. Ao selecionar, mostrar barra Carbon de ações em lote com quantidade, Etiquetas, Atualizar perfil e Cancelar seleção. Ações indisponíveis sem seleção.
3. Alterar consulta/filtro limpa a seleção para não conservar clientes ocultos. Informar essa limpeza em região de status. Retornar do detalhe pode manter a seleção somente se o conjunto exibido não mudou; identificadores removidos nunca permanecem selecionados.
4. Etiquetas: escolher Aplicar ou Remover, selecionar etiquetas existentes e, ao aplicar, permitir digitar uma nova. Aplicar acrescenta sem substituir as anteriores; remover só retira as escolhidas.
5. Perfil: escolher exatamente Contato ou Cliente. Não criar opções extras nem alterar tipo de pessoa.
6. Revisar alterações apresenta nome, estado atual e resultado de cada selecionado. Mostrar quantos serão alterados e quantos permanecerão iguais. Remover etiqueta ausente ou aplicar etiqueta já presente não é erro.
7. Confirmar só fica disponível com mudança efetiva. É possível voltar à configuração ou cancelar sem gravar. A confirmação usa o conjunto revisado, não uma nova interpretação dos filtros.
8. Após sucesso, atualizar lista, anunciar resultado e limpar seleção. Após erro, manter seleção e configuração para nova tentativa. Enquanto envia, impedir submissão repetida.

## Persistência e contrato propostos

- Migração aditiva de etiquetas e vínculos cliente–etiqueta, sem reescrever cadastros existentes. Etiquetas pertencem ao mesmo escopo dos clientes visíveis ao usuário autenticado. Exclusão de cliente remove só seus vínculos.
- Rótulos: remover espaços nas pontas, colapsar espaços internos, normalizar Unicode NFC e comparar sem diferença de maiúsculas/minúsculas. Preservar acentos e grafia para apresentação. Não fundir etiquetas apenas porque diferem por acento.
- Limites iniciais propostos: até 200 clientes por operação, 20 etiquetas por cliente, 40 caracteres por rótulo. Validar no servidor e explicar o limite antes de confirmar. Esses limites são decisões de implementação, não requisitos Carbon.
- Endpoint dedicado para operações em massa, roteado antes de `/clientes/<id>`, com as mesmas regras de autenticação/autorização da gestão atual. Validar JSON, ação, enum, IDs únicos, existência e visibilidade de todos os clientes.
- Atualização de perfil usa SQL direcionado a perfil; alteração de etiquetas usa vínculos. Não chamar o salvamento completo com dados parciais e não fazer um loop de PATCH do formulário no navegador.
- Transação única: ou todas as mudanças válidas são gravadas ou nenhuma. Evitar resultado parcial silencioso.
- Concorrência: a confirmação leva o estado esperado dos campos que serão alterados. Comparar dentro da transação; se mudou desde a prévia, responder conflito e pedir revisão dos valores atuais. Não sobrescrever alteração de outro usuário silenciosamente.
- Retorno identifica quantidade alterada, quantidade sem alteração e registros atualizados; erros não expõem registros fora do escopo autorizado.

## Critérios de aceite

- Selecionar 2 de 3 linhas mostra 2 selecionados e estado misto no cabeçalho; cancelar limpa tudo.
- Alterar filtro remove seleção e anuncia o ocorrido; nenhum registro oculto é alterado.
- Aplicar Previdenciário a um cliente com Prioritário conserva Prioritário; aplicar novamente não duplica.
- Remover Prioritário não exclui outras etiquetas; ausência da etiqueta conta como sem alteração.
- Reclassificar Cliente para Contato preserva nome, telefone, e-mail, documentos, pessoa física/jurídica, processos e financeiro.
- Prévia distingue mudança efetiva de registro já classificado; nenhuma mudança efetiva impede submissão desnecessária.
- Falha de validação, ID inexistente/sem acesso ou conflito não deixa gravação parcial.
- Falha de rede preserva configuração e seleção; repetir a operação não duplica etiquetas.
- Teclado acessa seleção, modal, campos, revisão e confirmação; Escape cancela, foco retorna ao acionador; estado de seleção e resultado têm anúncio acessível.
- Verificar lista, barra e revisão em 1440/768/390/320 px e zoom; dados longos não ocultam os nomes ou resultados.

## Referências

- [Carbon Data table — guidelines](https://carbondesignsystem.com/building-blocks/core/components/data-table/guidelines/), especialmente seleção e ações em lote.
- `static/app.html`: seletor contato-perfil.
- `server.py`: `_cliente_detalhe`, `_detalhes_cliente_de`.
- `db.py`: `atualizar_cliente` e schema de clientes.

## Estado do mockup

`mockup.html` permite selecionar linhas e testar ambas as ações com prévia e confirmação **somente em memória**, usando dados fictícios. Não conecta API, não grava banco e não persiste após recarregar. O fluxo foi aprovado para implementação.

Validação da prévia: executada em Chromium com dados fictícios; verificados seleção, aplicação aditiva de etiquetas, atualização de perfil, confirmação, contagem de registros sem alteração e ausência de overflow da página em 390 px. As capturas de revisão de etiquetas e perfil foram inspecionadas visualmente. Isso não valida backend, concorrência ou acessibilidade integral da implementação futura.

## Implementação

- POST autenticado `/clientes/acoes-em-massa`, com `confirmar=false` para prévia e `confirmar=true` + `esperado` para gravação. Ações: `perfil`, `aplicar_etiquetas`, `remover_etiquetas`.
- Tabelas aditivas `etiquetas_clientes` e `cliente_etiquetas`, mantendo cadastro e vínculos existentes.
- Confirmação com transação `BEGIN IMMEDIATE`, comparação de estado e resposta 409 para conflito; nenhuma gravação parcial.
- Seleção individual, estado misto, selecionar todos os exibidos, cancelamento e limpeza ao filtrar. Controle de selecionar todos também disponível no layout de cards em tela pequena.
- Modal Carbon integrado ao mecanismo existente, configuração, revisão e confirmação; bloqueio de envio repetido e fechamento durante requisição; erro preserva configuração e seleção.
- A `main` foi integrada para preservar entregas anteriores já publicadas: Carbon, modais, feedback por contexto, atividades, agenda e notificações. Sem reversão dessas entregas e sem inclusão de `output/`, dependências de build ou backups locais no PR.

## Validação da implementação

- 300 testes de backend passaram (`test_unit`, `test_clientes_lote`, `test_agenda_atividades`, `test_notificacoes`, `test_origem_djen`).
- Cinco jornadas de lote no navegador com SQLite temporário real passaram: aplicar/remover etiquetas, perfil, conflito e revisão sem mudança, falha e recuperação, limpeza ao filtrar. Prévia não grava dados e confirmação preserva campos não envolvidos.
- Capturas de revisão inspecionadas; modal verificado em 1440, 768, 390 e 320 px. Escape e retorno de foco cobertos. Dados fictícios, sem mutação de produção.
- Testes Node `test_progress_controls.cjs` e `test_feedback_requests.cjs` passaram.
- Regressão completa de interface em andamento antes da publicação.
