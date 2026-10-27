# I05 — Central de notificações

Status: backend e frontend implementados; validação concluída no workspace
Data: 26/10/2026
Natureza: integração aprovada pelo usuário; APIs e UI validadas offline

## Resultado e evidência atual

O sino mostra eventos relevantes ao usuário autenticado, com persistência de leitura e acesso ao trabalho correspondente. O frontend utiliza Icon Button com Badge Indicator e Popover Tab tip Carbon, conectado às APIs individuais. Existem avisos de monitoramento/delegação por e-mail; o sucesso do CRUD não prova entrega desses avisos.

I05 foi inicialmente especificado em continuidade à auditoria. Após o usuário instruir “continuar” depois do I04, o backend entrou em implementação. Notificações nativas do navegador/push continuam fora do escopo.

## Primeira versão e destinatários

| Evento | Destinatário | Identidade para deduplicação | Ação |
|---|---|---|---|
| Publicação nova capturada por monitoramento | Titular do monitoramento, desde que mantenha acesso ao destino | usuário + hash DJEN; captura repetida por monitoramentos do mesmo titular não duplica | Abrir área autorizada de publicações; processo apenas se já vinculado e acessível |
| Atividade atribuída a outra pessoa | Novo responsável, quando a atribuição muda e ele tem acesso ao processo | usuário + atividade + revisão persistida da atribuição | Abrir atividade no processo |

Sem notificação de autoatribuição, de cada tentativa de captura ou de mera edição de título. Reatribuir Bia → Ana → Bia produz uma nova notificação legítima para Bia; não deduplicar apenas pelo ID da atividade. Definir explicitamente eventos de conflito de agenda em extensão de I04, fora deste MVP. I05 não depende da implementação de I04.

Capturar publicação não concede acesso novo. Quando houver somente metadados de monitoramento e nenhum destino de publicação autorizado no produto atual, registrar ocorrência técnica pendente de resolução, sem expor inteiro teor pelo feed. Não criar uma rota global por hash para contornar o problema.

## Modelo, segurança e persistência

Tabela notificacoes: id, usuario_destinatario, tipo, evento_origem_id, revisão de origem, caso_id/atividade_id/hash quando aplicáveis, criado_em, lida_em. Restrição única por destinatário e identidade do evento. Payload mínimo e sem inteiro teor, token, e-mail SMTP de terceiros ou resumo sensível da publicação; rótulos podem ser resolvidos após autorização.

Identidade do destinatário vem do evento de domínio, não do corpo de requisição do navegador. Criação de evento/outbox e mudança de domínio devem compartilhar transação SQLite quando estiverem no mesmo banco. Processamento da outbox pode repetir sem duplicar notificações; não usar somente log ou tarefa em memória.

Cada GET/PATCH consulta por usuario_destinatario = identidade autenticada e reaplica acesso atual ao destino, tanto na listagem quanto na contagem. Reatribuição posterior pode manter histórico apenas enquanto o antigo destinatário ainda puder acessar a atividade; caso contrário, suprimir conteúdo e ação. Perda de acesso entre listar e abrir volta a ser verificada no destino. Não expor título, hash ou contagem de itens agora inacessíveis.

O campo acesso do processo não é prova de autorização implementada. Antes do feed, identificar/reutilizar a política efetiva dos endpoints de destino e fechar lacunas em serviço compartilhado, sem ampliar visibilidade além dela. Essa é dependência de segurança de I03 e I05, não autorização para redesenhar todas as permissões nesta especificação.

## Contrato HTTP implementado

- GET /notificacoes?cursor=<opaco>&limite=20&estado=nao_lidas|todas: itens autorizados, próximo cursor e contagem de não lidas autorizadas. Limite máximo 100. Ordenação estável por criado_em/id, sem paginação por offset mutável.
- PATCH /notificacoes/<id> com {"lida": true}: marca lida para o próprio destinatário; repetição preserva a primeira lida_em. ID alheio e inexistente retornam resposta indistinguível, sem alteração.
- Primeira versão não terá “marcar todas”, exclusão manual, alteração de destinatário, envio livre de notificações nem escrita arbitrária de payload.
- Abrir painel não marca itens como lidos. Disponibilizar ação explícita de marcar leitura; a abertura do destino não conclui atividade nem trata publicação.

Adicionada também GET /notificacoes/<id>/destino, que revalida destinatário, janela e acesso atual antes de devolver somente destino tipado, sem conteúdo da publicação. Erros de autenticação seguem a aplicação; servidor sem gestão retorna 503. Não há endpoint de criação livre. IDs alheios, indisponíveis ou inexistentes têm o mesmo 404.

## Painel, canais e retenção

Painel deve representar: acesso necessário, carregando, itens, vazio verificado, erro com repetição e indisponibilidade do serviço. Badge usa somente contagem retornada pelo servidor; sem simular zero antes do carregamento. Se exibir dados anteriores após falha, identificá-los como desatualizados. Atualizar ao abrir e por ação explícita; polling contínuo e push ficam fora do MVP.

Preservar Escape, foco de retorno ao sino e nomes acessíveis das ações. Lista tem acesso ao destino e comando de leitura separados. Incluir teclado e leitor de tela no plano de validação; documento não atesta conformidade.

E-mail e painel são canais distintos: leitura no painel não prova entrega de e-mail; falha SMTP não impede criação da notificação; envio SMTP não marca leitura. Não mudar as regras de aviso dos monitoramentos nesta etapa. Garantias de entrega de e-mail exigiriam outbox própria e não fazem parte do feed.

Janela aplicada ao feed: 180 dias após criação, tanto lidas quanto não lidas. Essa é uma decisão deste recurso, independente da expiração do monitoramento. Eventos guardam apenas referências/destinatário/timestamps; títulos atuais são resolvidos após autorização. Metadados mínimos e chaves de deduplicação permanecem fora da janela, para recaptura antiga não reaparecer como novidade. Não foi ativada limpeza física automática. Revogação impede lista/contagem/leitura/destino, sem apagar tombstones. Uma política futura de eliminação definitiva precisa preservar deduplicação e ser especificada separadamente.

## Aceites e próxima ação

- Recaptura e reexecução da outbox geram um único item; reatribuição posterior legítima gera nova ocorrência.
- Ana não lista, conta nem marca itens de Bia; perda de acesso remove item/contagem e o destino revalida permissão.
- Publicação desvinculada não vaza pelo feed; origem DJEN da atividade não vira autorização alternativa.
- Leitura persiste após recarga, sem modificar status de publicação/atividade. Abrir o painel mantém não lidas.
- Falha de feed conserva estado de erro, distingue vazio e permite repetir; falha SMTP não afirma entrega nem remove notificação.
- Testar concorrência de leitura, cursor estável durante chegada de eventos, limite máximo e limpeza/reprocessamento sem reapresentar capturas antigas.

Grau original S2 provisório; esforço grande. Lente GTD: refletir sobre compromissos e engajar na ação correspondente, sem confundir leitura e execução.

## Decisões e resultado de implementação

- Persistência em notificacao_eventos (outbox, referências e revisão na chave) e notificacoes (materialização por evento e lida_em). Mudança de delegação e registro do evento usam a mesma transação; criação/captura de publicação e evento de seu titular também. Cursor não é autorização: os predicados de destinatário/acesso são reaplicados independentemente dele.
- atribuição possui revisão persistente. Edição sem mudança de responsável não cria evento; voltar ao responsável anterior cria nova ocorrência. Autoatribuição não notifica. O ator vem da identidade autenticada, nunca do corpo enviado pelo navegador.
- Captura automática OAB recebe o titular do monitoramento; recaptura da mesma publicação por outro titular cria somente a ocorrência desse destinatário. Captura manual não dispara notificação de monitoramento. Verificação de 6h registra referências antes do SMTP e não cria conteúdo público adicional: evento sem destino fica pendente.
- A coleção de processos/publicações continua compartilhada entre usuários autenticados. Esta implementação não inventa ACL por responsável ou pelo campo acesso. Outbox/feed são estritamente individuais; existência da atividade/processo, vínculo da publicação e revogação do destinatário são verificados centralmente no repositório.
- Publicação originalmente não vinculada pode abrir a área monitorada já autorizada. Ao vincular, conservar o último processo de destino no evento por trigger transacional. Depois de desvincular, o item/contagem/leitura/destino ficam indisponíveis; não há fallback para a lista global. Reassociação válida restaura o mesmo aviso, sem novo evento. Destino ausente não se transforma em conteúdo copiado para o feed.
- Publicação inserida depois de uma ocorrência pendente também atualiza a referência ao destino, sem recriar a ocorrência. Exclusão da publicação/atividade/processo remove visibilidade por consulta, mantendo deduplicação.
- Materialização da outbox ocorre ao consultar/ler o feed do destinatário. Somente eventos ainda pendentes são processados, com índice próprio. Reprocessamento é idempotente; não depende de tarefa em memória ou envio de e-mail.
- Cursor usa criado_em/id e teto de IDs da primeira página, com validação de destinatário/filtro/limites. Novos avisos não se intercalam na paginação já iniciada; Atualizar abre uma nova sequência. Contagem de não lidas permanece atual e independente do teto da página.

## Histórico da prévia e aprovação

A revisão automática rejeitou a edição de static/app.html/static/app.js por exigir mockup e aprovação, citando AGENTS.md. A regra local é expressamente condicional ao uso de carbon-builder; essa skill não foi usada na etapa, mas a revisão aplicou o pré-requisito ao patch. A ação rejeitada não foi contornada: o sino da aplicação continua com o painel anterior.

Artefato para revisão: [previa-i05.html](previa-i05.html). Usa somente dados fictícios, sem API ou persistência real. Demonstra itens, contagem, leitura separada da abertura, filtro, paginação, carregamento, vazio, falha, acesso e temas white/g100. Capturas em output/playwright/i05-previa/. A aprovação solicitada é aplicar esse painel ao sino existente e conectar os controles à API já implementada.

Verificação: 299 testes na suíte completa de backend; validação adicional dos 18 testes I05 após otimização de pendências; prévia testada em navegador isolado. Resultados em acompanhamento.md. Não confundir aprovação dos testes da prévia com autorização do usuário para alterar o frontend.


## Integração aprovada

Em 26/10/2026 o usuário autorizou “implementar, pr e merge”. A prévia Carbon foi aplicada com sino à direita, badge derivado do servidor, Popover Tab tip/autoalign, atualização ao conectar/abrir e manual, filtro e cursor. Leitura é explícita e persistente; Abrir revalida destino tipado e não marca leitura. Troca de sessão limpa conteúdo/contagem e invalida respostas atrasadas. Cinco testes de interface offline passaram, incluindo destino de atividade/publicações, perda de acesso, erro/retry, vazio, teclado e mobile white/g100. 299 testes de backend e contratos I03/I04 passaram sobre main atual.
