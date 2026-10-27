# Acompanhamento do plano de ação

Data: 26/10/2026. Primeira etapa autorizada no chat: I01 e I02.

## Resultado implementado

- I01: PATCH de atividade resolve “Eu mesmo” (null/vazio/espaços) para o usuário autenticado, como já ocorria na criação. Omissão preserva atribuição. Sem identidade para resolver a opção, retorna 400. Validação do registro e aviso de delegação existentes permanecem.
- Modal de atividade conserva o responsável atual mesmo quando /responsaveis falha e informa como tentar novamente. Evita que uma falha de carregamento transforme a seleção em “Eu mesmo”.
- I02: revisão possui filtros cumulativos por responsável pela atividade, responsável pelo processo e tipo. Cada linha identifica ambos os responsáveis. “Sem responsável” distingue dados legados de “Todos”; valores das opções de executor são separados dos nomes para evitar colisões.
- Atualização preserva executor selecionado enquanto a opção existir; retorna a Todos se desaparecer. Cobertura parcial e conclusão após sucesso continuam no fluxo existente.

Sem migração, deploy, uso de cnj.db, requisições a serviços reais ou envio externo. Arquivos preexistentes de outros trabalhos foram preservados.

## Evidências de validação

- Antes da correção, regressão backend falhou para null, vazio e espaços, para ausência de identidade e para modo sem registro de usuários: retornava Bia em lugar do usuário autenticado ou simulava sucesso.
- Depois da correção: **247 testes de backend aprovados**, executando test_unit e test_processos (78,881s). Inclui testes novos de reatribuição com releitura de SQLite temporário, omissão do campo e não envio de aviso para si.
- **Três testes focados de interface aprovados** (11,433s): filtros cruzados, edição com falha da lista de usuários/envio “Eu mesmo”, e agregação/falha parcial/conclusão. APIs interceptadas e dados fictícios; o resultado de gravação backend é validado separadamente pela suíte com banco temporário.
- Testes de layout desktop/móvel e publicação → atividade/origem também passaram em execução anterior desta etapa. Capturas em output/playwright/auditoria-gtd/atividades-{1440,390,320}.png; inspeção visual de 1440/390 e verificação automatizada de overflow em 1440/390/320. Tela física e leitor de tela não testados.
- Ajustado helper compartilhado para escolher opção pelo nome acessível: seletor antigo com regex de texto não encontrava opções do dropdown no Shadow DOM. A primeira execução também revelou erro do mock do teste novo (parâmetro opcional recebia Request), corrigido antes da validação aprovada. Script auxiliar de diagnóstico local preservado nesta pasta, sem uso em produção.
- node --check static/app.js, py_compile de server.py/test_unit.py/test_interface.py e git diff --check: aprovados após os ajustes.
- **Suíte completa de interface: 52 de 55 aprovados**, 188,358s. Saída em output/testes-integracao-gtd-interface.log. Os testes novos e os fluxos de atividades passaram.
- As três falhas foram repetidas com **app.html/app.js originais de HEAD** em cópia isolada, usando os mesmos testes/helper atuais (41,777s). Resultado idêntico: duas falhas de operação dos seletores no teste e uma falha de layout do modal. Nenhuma troca temporária dos arquivos da aplicação foi feita. Saída em output/testes-integracao-gtd-baseline.log; script reproduzível verificar-baseline.py nesta pasta.

### Falhas preexistentes fora de I01/I02

| Teste | Resultado atual e no frontend HEAD | Encaminhamento |
|---|---|---|
| test_dropdowns_de_duas_opcoes_usam_radios_e_preservam_valor | Timeout: o teste tenta clicar diretamente no input de rádio Carbon, cujo label intercepta o ponteiro | Revisar helper para operar o label visível, sem forçar clique; não prova falha do controle pelo usuário |
| test_publicacoes_webcomponents_m_paginacao_selecao_entre_paginas_e_catalogo_completo | get_by_label de “Itens por página:” encontra select oculto, combobox e listbox; strict mode impede select_option | Atualizar o teste para operar o controle visível e verificar requisição/paginação |
| test_indicador_ativo_e_foco_e_dialogo_sem_botoes_transbordando | Botão do rodapé fora do contêiner; x = -31,546875 enquanto contêiner começa em 0, tanto em HEAD quanto no workspace alterado | Triagem de responsividade do modal de edição pendente, em tarefa própria |

Estas falhas não foram suprimidas nem marcadas como aprovadas. A suíte integral ainda não está verde; I01/I02 estão validados no escopo dos testes de backend e interface correspondentes.

## Limites e ferramentas

As tentativas iniciais no ambiente restrito ficaram sem progresso e foram interrompidas. Execuções válidas usaram o ambiente virtual e permissão revisada para executar fora do sandbox; Chrome local com APIs interceptadas.

A primeira tentativa de editar o frontend não foi executada porque a revisão automática ficou sem limite de uso. Após o usuário instruir “continuar”, a mesma edição passou pelo fluxo de ferramentas e foi aplicada.

Detector mecânico Impeccable executado uma vez sobre app.html/app.js: sinalizou contraste de placeholders e valores de estilo já existentes no restante da aplicação, fora dos trechos alterados. Nenhum CSS/token novo foi introduzido nesta etapa. Isso não atesta conformidade de acessibilidade. O contexto também informou sidecar .impeccable/design.json desatualizado em relação a DESIGN.md; sem alteração automática desse artefato.

## Sequência restante

I03, I04 e I05 possuem specs propostas e tickets próprios, indexados em spec.md. A etapa documental foi concluída após o pedido seguinte do usuário, sem mudanças adicionais na aplicação. Estão em needs-triage pelas decisões de acesso, estratégia remota e retenção indicadas em cada documento. I06/ZapSign segue fora da etapa.

Validação documental: confrontados modelos/handlers locais de atividades, vínculo de publicações, criação/sincronização de agenda e sino. Os contratos e rotas novos foram identificados como propostas. Não foram executados testes de aplicação nem consultada documentação Google nesta etapa documental; validação do adaptador foi mantida como requisito anterior à implementação de I04.

## I03 — implementação após “continuar”

Concluída no workspace em 26/10/2026. A autorização posterior à etapa documental permitiu avançar à implementação de I03. I04 e I05 permanecem especificados, sem implementação.

### Mudanças

- _util.py centraliza validação de identificador e extração de marcador único.
- db.py adiciona hash/versionamento de origem e migração idempotente sem alterar texto livre. Ambiguidades ficam no relatório local origem_djen_migracao_pendencias (ID e motivo). Hash não tem FK para publicação: exclusão/desvinculação não apaga origem nem atividade.
- POST/PATCH aceita origem_djen_hash: criação legada interpreta marcador; PATCH omitido preserva; null remove sem ressurreição. Hash novo/trocado precisa pertencer ao processo na transação de gravação. Formato inválido/conflito retorna 400; origem de outro processo e inexistente têm o mesmo 404 genérico.
- Acesso efetivo verificado: usuários autenticados compartilham a coleção existente. Não foi adicionada ACL por responsável/campo acesso nem leitura global de conteúdo por hash. A consulta de origem continua pela lista do processo.
- DELETE de publicação usa UPDATE condicionado a hash + caso_id, evitando desfazer vínculo pertencente a outro processo.
- Frontend lê campo estruturado com precedência inclusive para null, preserva compatibilidade com servidor antigo e omite origem na edição comum. Desvinculação/troca de processo limpam conteúdo exibido e invalidam respostas antigas em andamento.

### Verificação

- **259 testes de backend aprovados**, 68,148s: test_unit + test_processos + test_origem_djen. Os 12 testes novos I03 exercitam migração de schema antigo/idempotência, ambiguidades, persistência, clientes antigos, tipos/formatos inválidos, conflito, exclusão da publicação, desvinculação pela rota errada e autenticação. Log: output/testes-i03-backend.log.
- **Seis testes focados de interface aprovados**, 16,606s: criação legada/estruturada com recuperação de falha e recarga; null autoritativo e PATCH omitido; desvinculação/inacessibilidade; resposta atrasada invalidada; regressão de reatribuição. Chrome com APIs interceptadas, sem serviços reais. Log: output/testes-i03-interface.log.
- Sintaxe JS, compilação Python e diff check aprovados. Não se repetiu a suíte integral de interface: as três falhas preexistentes registradas na etapa I01/I02 continuam fora desta validação; não foram suprimidas.
- Nenhum deploy, envio externo ou leitura/migração do banco real. A migração foi validada com SQLite temporário e está preparada no código para a próxima abertura do banco pela aplicação atualizada.

### Limites

Referência removível explicitamente pela API; não foi criado novo controle visual de remover/trocar origem. Mudança de vínculo em outro dispositivo não envia invalidação automática para uma tela que já recebeu conteúdo. Toda nova consulta verifica a lista atual do processo; conteúdo previamente recebido não é revogado. Esses limites não são apresentados como isolamento privado por processo.

Próximo item do plano: I04, começando pela validação da estratégia do adaptador Google para idempotência/reconciliação; não habilitar vínculo de agenda sem essa verificação.

## I04 — vínculo opcional agenda/atividade

Implementado no workspace após “implementar” e retomada “continuar”. Documentação oficial Google consultada; fontes e decisões no final de spec-i04-agenda-atividade.md. I05 permanece fora desta implementação.

### Entrega

- Schema de vínculos/estado e chaves persistentes no SQLite, com unicidade por atividade ativa e por evento/calendário. Histórico/tombstones preservam idempotência depois de cancelar ou excluir atividade/processo.
- agenda_atividades.py concentra reserva transacional, fila persistida, lease/token, versionamento, comparação local/remota, reconciliação e cancelamento. Não mantém transação aberta durante rede.
- Adaptador Google resolve calendário canônico, usa UUID persistido no INSERT e consulta o mesmo ID após timeout/409; PATCH/DELETE com If-Match. Recorrência, horário e calendário diferente não são convertidos silenciosamente.
- Rotas GET/POST/PATCH/DELETE de agenda precedem fallback de atividades. Validação de pertencimento, versão e idempotência; omissão de chave de criação é erro. Estado pendente/falha retorna 202 com resultado explícito, sem simular sincronização.
- Edição local enfileira mudança; processamento por ação do usuário ou job de 1h. Modificação remota divergente exige decisão explícita; aceitar a agenda altera data e título com confirmação. Conclusão e cancelamento são independentes.
- Excluir atividade/processo com vínculo ativo/incerto é bloqueado com 409. Cancelar/repetir pedido antigo não cancela vínculo novo. Token/conta diferente não transfere o vínculo.
- Detalhe de atividade oferece vincular, atualizar, revisar divergência, cancelar e abrir evento. Falha mantém possibilidade de repetição; chave de tentativa reutilizada; foco retorna ao controle após atualização. Layout móvel e temas preservados.
- Dockerfile, pyproject.toml e checagem de compilação no workflow incluem o módulo novo. Empacotamento conferido quanto à presença dos módulos; imagem Docker não foi construída nem publicada.

### Validação e limites

- **Suíte final: 281 testes de backend aprovados**, 106,570s: test_unit + test_processos + test_origem_djen + test_agenda_atividades. Inclui 22 testes de agenda com data null, GET 404 com confirmação prévia e GET 410 após criação incerta, além de concorrência, timeout, lease, ETags, calendário diferente, evento avulso, exclusão e cancelamento. Log: output/testes-i04-backend.log.
- Quatro testes focados de interface aprovados na rodada final de fluxo (26,189s): criação/erro/repetição com chave estável, divergência/resolução, cancelamento, bloqueio por hora e integração desconectada, regressões de origem DJEN e modal. APIs interceptadas. Log: output/testes-i04-interface.log.
- Capturas em output/playwright/i04/: 1440/390px, temas white/g100. Corrigida a captura para aplicar tema pelo controlador real e aguardar drawer fechado no móvel. A primeira rotina do teste falhou ao dispensar notificações por índices que mudavam; alterada para dispensar sempre o primeiro item, sem mudar a aplicação.
- Confirmação final do fluxo e das capturas: um teste aprovado em 10,903s; log output/testes-i04-capturas-final.log. Capturas finais conferidas sem sobreposição do drawer no móvel. O ajuste do teste aguarda a geometria final da navegação em vez de presumir que 300ms bastam para todas as transições.
- Detector Impeccable executado uma vez para esta entrega; saída preservada em output/detector-i04.json. Avisos recaíram em estilos e controles já existentes fora das linhas novas de agenda. Nenhum token/identidade visual substituído; não se declara conformidade integral WCAG.
- Sintaxe JS, compilação Python e diff check aprovados. A suíte integral de interface não foi repetida; as três falhas preexistentes documentadas na primeira etapa não foram suprimidas.
- Sem criação/edição/cancelamento de eventos reais, leitura/migração de cnj.db, deploy ou envio externo. Google foi simulado via httpx.MockTransport; testes com SQLite temporário. Serviços reais e comportamento de produção não foram testados.
- Primeira versão contempla evento de um único dia inteiro, sem hora/recorrência. Processamento periódico usa o intervalo Google existente de uma hora; Atualizar agenda antecipa a operação. Não há push nem garantia distribuída de exactly-once.

## I05 — backend concluído e prévia pronta para aprovação

Autorização de continuidade após I04 recebida no chat. Implementado backend em notificacoes.py/db.py/server.py; módulo incluído no empacotamento, Dockerfile e checagem de compilação. Integração com o sino ainda não aplicada.

### Entrega de backend

- Outbox mínima, transacional com delegação e captura. Revisão persistida da atribuição evita duplicação sem suprimir reatribuições legítimas. Ator/destinatário derivados de identidade autenticada e monitoramento, não de campos livres do navegador.
- Feed por destinatário, contagem individual, leitura persistente/idempotente e destino tipado revalidado. Um mesmo predicado protege listagem, contagem, PATCH e abertura. IDs alheios e ausentes têm a mesma resposta. Não há criação livre de aviso.
- Sem inteiro teor ou tokens no payload de eventos/feed. Referências indisponíveis ficam pendentes e não materializam publicação nova na coleção global. A coleção de processos/publicações mantém a política compartilhada autenticada atual, sem inventar autorização por campos existentes.
- Fonte por publicação/usuário é deduplicada mesmo quando a publicação já foi capturada por outro titular. Captura manual não notifica. Aviso persiste mesmo com SMTP falhando, sem afirmar entrega de e-mail.
- Último vínculo de publicação é conservado para que desvincular elimine item/contagem/leitura/destino; reabrir lista global não serve de atalho. Triggers atualizam referência quando publicação pendente é inserida ou associada ao processo. Remoção do destino e revogação do usuário são verificadas novamente em cada operação.
- Janela visível de 180 dias; sem limpeza física automática. Eventos mínimos/tombstones mantêm deduplicação após expiração. Materialização processa somente pendências e é idempotente; cursor estável exclui avisos criados depois da primeira página, sem ignorá-los na contagem atual.

### Validação

- **299 testes de backend aprovados**, 133,080s: test_unit, test_processos, test_origem_djen, test_agenda_atividades e test_notificacoes. Log output/testes-i05-backend.log. Inclui isolamento entre usuários, leitura independente, rollback da outbox, reatribuição/concorrência, deduplicação, origem sem destino, desvinculação, revogação, retenção/cursor, SMTP simulado e jobs de monitoramento/captura.
- Após essa suíte, otimizado o processamento para não regravar eventos já materializados a cada página. **18 testes I05 aprovados novamente**, 11,577s, com log output/testes-i05-backend-focado-final.log.
- Prévia isolada validada pelo script verificar-previa-i05.py: leitura/contagem, repetição de consulta com falha, vazio, acesso, Escape/foco e ausência de overflow em 390px. Capturas white-1440, white-390, g100-390 e falha-390 em output/playwright/i05-previa/. Log output/testes-i05-previa.log.
- Compilação Python, sintaxe do JavaScript atual da aplicação e diff check preservados. Nenhuma conta/serviço externo ou cnj.db utilizado; testes com SQLite temporário, SMTP/DJEN simulados e navegador bloqueando tráfego externo na prévia. Sem deploy.

### Impedimento da integração visual

A revisão automática rejeitou a edição do frontend com o motivo de exigir mockup e autorização explícita, citando a regra de AGENTS.md relativa ao uso de carbon-builder. A skill Carbon Builder não foi usada nesta etapa, mas a revisão aplicou a exigência ao patch. O patch não foi aplicado por outra via: a aplicação continua exibindo o painel anterior do sino.

Foi preparada a alternativa segura e revisável: previa-i05.html, artefato separado sem API real, dados reais ou alterações no frontend. Aprovação solicitada ao usuário para aplicar a prévia ao sino e conectar o backend. Aprovação automatizada dos testes não é aprovação do usuário. Após aprovação, implementar integração de sessão/contagem/estados/leitura/destino e testar fluxo real com APIs interceptadas antes de declarar I05 completo.

### Ajuste visual I05 — Carbon solicitado pelo usuário
Prévia separada atualizada com Web Components Carbon 2.66.0: `cds-icon-button` ghost/lg + `cds-badge-indicator`, e `cds-popover` com Tab tip e alinhamento automático. Referências confirmadas pelo conector Carbon e código instalado; Tab tip é variante do Popover. Bundle restrito à prévia; aplicação preservada.
Verificação local da prévia passou: clique (hover não abre), badge/leitura, fechamento externo, Escape/foco, falha/repetição, vazio, acesso e largura 390px; imagens white/g100 inspecionadas. Dados fictícios, requisições externas bloqueadas. Aguarda aprovação visual explícita conforme AGENTS.md antes da integração no frontend.

### Integração aprovada e preparação de PR — 26/10/2026
Usuário aprovou expressamente a prévia Carbon e solicitou implementação, PR e merge. Integração sobre a main atual em branch isolada, preservando alterações recentes de feedback, tokens e modais. Sino Carbon Icon Button ghost/lg com Badge Indicator; Popover Tab tip com autoalign, à direita do cabeçalho como na prévia. Feed individual com atualização ao conectar/abrir e comando manual; sem polling. Leitura explícita, cursor opaco, destinos tipados revalidados e descarte de respostas de sessão anterior. Requisições sem dados em localStorage. Registros anteriores de aprovação pendente são históricos e foram atendidos pela autorização atual.

Validação final sobre main atual: 299 testes backend passaram (274,232s); cinco testes UI I05 passaram (13,870s); quatro fluxos I03/I04 passaram, com seletores de erro limitados ao contêiner correto devido ao novo InlineLoading. test_feedback_requests.cjs e test_progress_controls.cjs passaram. Build Carbon/licenças, sintaxe JS/Python e diff check passaram. Não executada novamente a suíte completa UI; as três falhas de baseline anteriores continuam registradas acima.
Regressões finais adicionais: quatro fluxos I01/I03 passaram (17,894s), incluindo filtros cruzados, Eu mesmo, desvinculação e resposta tardia de origem. Novo script servido por ASGI com MIME JavaScript/no-store validado; POST sem autenticação permanece negado. A suíte UI completa não foi repetida nesta rodada.
