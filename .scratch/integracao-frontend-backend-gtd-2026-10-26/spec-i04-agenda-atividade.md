# I04 — Vínculo opcional entre agenda e atividade

Status: implementado no workspace
Data: 26/10/2026
Natureza: contrato implementado; validação offline e sem deploy

## Resultado e evidência atual

Uma atividade pode ter evento de agenda explicitamente vinculado, com retorno confiável de criação, divergência e cancelamento. Evento avulso continua possível e não cria atividade automaticamente.

Hoje POST /casos/<id>/evento-calendar cria evento de dia inteiro e registra evento_id na linha do tempo; google_integracao.criar_evento_calendar marca cnj_caso_id. _sincronizar_calendar_google registra alterações/cancelamentos na linha do tempo, sem relação com caso_atividades. A linha do tempo não será usada como único estado operacional do novo vínculo.

## Decisões propostas para a primeira versão

| Tema | Contrato |
|---|---|
| Cardinalidade | Atividade com zero ou um vínculo ativo; evento vinculado a uma única atividade do mesmo processo |
| Escolha | Ação explícita “Vincular à agenda”; não converter eventos/atividades históricos em massa |
| Fonte da data | data da atividade é canônica. Título deriva da atividade; pedido vinculado não aceita outra data paralela |
| Escopo inicial | Somente atividade com data válida e sem hora, compatível com o evento de dia inteiro atual. Se houver hora, bloquear com orientação; não descartá-la silenciosamente |
| Evento avulso | Preservar contrato antigo título/data, sem criar atividade. Garantias antigas não são declaradas automaticamente idempotentes |
| Mudança externa | Registrar divergência e mostrar data externa; não reescrever a atividade nem sobrescrever imediatamente o Google |
| Conclusão | Concluir atividade não cancela evento; cancelamento de evento não conclui atividade |
| Recorrência | Fora da primeira versão; rejeitar vínculo recorrente em vez de simular suporte |

## Persistência e operações

Tabela proposta atividade_agenda: id estável do vínculo, caso_id, atividade_id, identidade da integração/calendário, evento_id remoto, estado, versão local, versão aplicada, data/título desejados, último estado remoto e timestamps. Unicidade para vínculo ativo por atividade e para evento por integração/calendário. Manter histórico de cancelados; novas tentativas explícitas usam novo vínculo, sem reutilizar silenciosamente evento cancelado.

Estados mínimos: pendente, sincronizado, divergente, cancelamento_pendente, cancelado e falha. Falha guarda operação recuperável e causa; a mensagem ao usuário distingue atividade salva de evento sincronizado. Não armazenar tokens na tabela nem devolvê-los ao frontend.

Rotas propostas, ainda inexistentes:

- POST /casos/<id>/atividades/<aid>/agenda: criar vínculo a partir da atividade existente, com Idempotency-Key obrigatório.
- GET da mesma rota: estado e dados mínimos do vínculo, sem credenciais.
- PATCH da mesma rota: resolver divergência com comando explícito `usar_data_da_atividade` ou `aceitar_data_da_agenda`, incluindo versão esperada. Aceitar data externa atualiza atividade e confirma nova versão; validar data e ausência de hora antes de aceitar.
- DELETE da mesma rota: solicitar cancelamento do evento vinculado; não apagar atividade. Repetição devolve o mesmo estado.

Todos verificam identidade, autorização atual e pertencimento da atividade ao processo. O roteamento atual reconhece /atividades e checklist de modo genérico: adicionar caminhos específicos antes desse fallback e testar que não sejam interpretados como POST/PATCH da atividade.

## Idempotência e concorrência

1. Reservar operação e vínculo no SQLite antes da chamada externa. Registro de idempotência inclui solicitante, processo, atividade, operação e hash do pedido normalizado; não depende de cache em memória.
2. Mesma chave e mesmo pedido retornam a mesma operação/recurso, inclusive após restart. Mesma chave com outro conteúdo retorna 409. Guardar tombstone das chaves enquanto existir histórico do vínculo; não permitir recriação por replay após cancelamento.
3. Pedidos concorrentes com chaves diferentes para a mesma atividade retornam o vínculo já existente, ou 409 se conflitantes; nunca criam dois eventos ativos. Garantir com restrição/transação, não apenas com botão desabilitado.
4. Timeout após possível criação remota: estado pendente de reconciliação. Antes de repetir criação, localizar o evento da operação de forma determinística. Definir e testar a estratégia no adaptador Google com documentação oficial antes de codificar; não presumir atomicidade entre SQLite e Google nem prometer exactly-once sem essa prova.
5. Mudanças locais incrementam versão e enfileiram atualização; respostas de versão antiga não sobrescrevem versões novas. Não manter transação SQLite aberta durante requisição externa.
6. Aplicar controle de versão remoto quando suportado pelo adaptador. Se a data/título remotos mudaram em relação ao último estado aplicado, registrar divergência, sem política silenciosa de “última gravação vence”.

A sincronização deve identificar vínculo por IDs persistidos e marcadores próprios, nunca por título ou data. Eventos legados com apenas cnj_caso_id permanecem avulsos. Incluir caminho de reconciliação para eventos cancelados cujo retorno não traga os marcadores privados: não depender só deles para encontrar o vínculo.

## Cancelamento, exclusão e falhas

- Cancelamento remoto confirmado marca vínculo cancelado e registra na linha do tempo; atividade permanece pendente/concluída como estava. Não recriar evento automaticamente.
- Cancelamento solicitado localmente fica pendente até confirmação/reconciliação. Erro externo não simula sucesso. Repetir a operação é seguro; evento comprovadamente já cancelado equivale a sucesso.
- Uma resposta “não encontrado” remota só vale como cancelado depois de confirmar integração/calendário corretos; perda de acesso/autenticação é falha recuperável.
- Enquanto vínculo estiver ativo ou houver operação incerta, excluir atividade retorna 409 com orientação para cancelar o vínculo e aguardar confirmação. Nenhuma exclusão em cascata deixa evento externo órfão silenciosamente. A mesma barreira vale para exclusão do processo com vínculos ativos.
- Desconectar Google mantém dados locais e estado pendente; informar falta de conexão e retomar após reconciliação. Reconectar outra conta/calendário não reaproveita IDs como se fossem os mesmos recursos.
- Após cancelado, novo evento exige ação explícita e nova operação. Repetir chave antiga não o ressuscita.

## Aceites e sequência

Testar: evento avulso sem atividade; atividade sem data/com hora recusada; repetição e concorrência de criação; timeout depois de sucesso remoto; restart entre operação e persistência; conflito de versão; alteração externa; cancelamento de ambos os lados; conclusão independente; exclusão bloqueada; integração desconectada; evento legado preservado; controle de acesso e isolamento de calendários.

Grau original S2 provisório; esforço médio/grande. Lente GTD: calendário para compromisso com data real, revisão de divergência e ação com confirmação.

## Implementação e decisões fechadas

Autorização: “implementar”, seguida de “continuar”, no chat. Persistência em atividade_agenda e atividade_agenda_chaves; processamento em agenda_atividades.py; adaptador em google_integracao.py; rotas e job em server.py. Fluxo disponível no detalhe da atividade, com os componentes existentes e temas white/g100.

- O acesso mantém a coleção compartilhada autenticada atual. Rota verifica pertencimento de atividade/processo; não introduz isolamento por responsável ou pelo campo acesso.
- ID remoto é UUID hexadecimal gerado e persistido antes da criação. A chave de idempotência tem escopo do solicitante, alvo e corpo; uma chave nova para atividade já vinculada aponta ao vínculo ativo existente. Tombstones sobrevivem à exclusão de atividade/processo cancelados.
- Antes de cada processamento, resolver primary para o ID canônico do calendário e comparar com o persistido. O vínculo não é transferido para outra conta automaticamente. Renovar token da mesma conta não muda o vínculo.
- A operação pendente na própria linha é a fila persistida. Lease de 120 segundos e token de execução impedem disputa local; callbacks antigos não concluem execução adquirida por outro worker. Resultado de operação anterior conserva a edição/cancelamento mais novo e registra o estado remoto aplicado para reconciliação seguinte.
- Criação, atualização ou cancelamento podem ser processados pela ação explícita na interface e pelo job Google já existente, a cada hora. Salvar título/data deixa atualização pendente; a interface permite antecipar pelo botão Atualizar agenda. Não há polling contínuo.
- Alteração local da data/título não substitui alteração externa detectada: apresentar divergência. “Manter dados da atividade” usa ETag revisto; “Usar data e título da agenda” adota ambos na atividade, em transação, mediante confirmação. O nome de comando aceitar_data_da_agenda foi mantido por compatibilidade com esta spec; o rótulo da ação declara o efeito sobre o título.
- Evento de dia inteiro tem fim exclusivo no dia seguinte. Datas inexistentes, data máxima sem dia seguinte, hora ou recorrência são recusadas para esse vínculo. Não converter evento com horário/recorrência em dia inteiro silenciosamente. Cancelamento explícito desse evento continua possível.
- GET cancelado/410 no calendário correto confirma cancelamento. GET 404 só é tratado como cancelado quando há criação anterior confirmada nesse calendário; sem essa evidência, continuar criação determinística ou manter falha da operação incerta. 401/403 e calendário divergente não equivalem a evento cancelado.
- DELETE usa vínculo e versão; repetição contra tombstone não cancela um vínculo posterior. Excluir atividade/processo com vínculo ainda ativo/incerto retorna 409. Concluir atividade não cancela evento; cancelar evento não conclui atividade.
- Nenhum vínculo de evento avulso/histórico é inferido. Nenhum teste usou a conta Google real nem cnj.db. Não se afirma garantia distribuída de exactly-once: a mitigação usa IDs persistidos, unicidade local, reconciliação, validação dos marcadores e ETags, dentro do contrato remoto.

## Fontes oficiais verificadas

Consultadas em 26/10/2026:

- [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): ID fornecido pelo cliente, alfabeto base32hex, recomendação de UUID e ressalva de colisão distribuída.
- [Versões de recursos](https://developers.google.com/workspace/calendar/api/guides/version-resources): ETag/If-Match em atualização/exclusão e resposta 412 para conflito; inserção não usa a mesma precondição.
- [Calendars.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get): resolver primary para a identidade do calendário conectado.
- [Recurso Events](https://developers.google.com/workspace/calendar/api/v3/reference/events): fim exclusivo, propriedades privadas e cancelamentos que podem omitir campos além do ID.

Resultados das suítes e limites em acompanhamento.md. Sem deploy nem criação de evento externo nesta etapa.
