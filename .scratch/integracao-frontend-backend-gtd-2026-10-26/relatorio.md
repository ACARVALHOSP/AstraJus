# Mapa de integração frontend/backend e análise GTD

Data: 26/10/2026. Status: needs-triage. Auditoria do código atual do workspace.

## Diagnóstico

O núcleo operacional possui conexões HTTP/MCP: clientes, processos, publicações, atividades, checklist, monitoramentos e financeiro. As lacunas examinadas concentram-se na revisão transversal da delegação, no retorno de notificações e na continuidade publicação → atividade → agenda. ZapSign é uma funcionalidade anunciada, ainda sem implementação encontrada no escopo examinado.

O problema mais concreto de contrato é a opção “Eu mesmo” ao editar uma atividade delegada: o frontend envia null e o backend conserva o responsável anterior. Não foi reproduzido em navegador; o encadeamento está demonstrado no código.

## Escopo e método

Inspeção estática de static/app.js, static/app.html, server.py, db.py, google_integracao.py, PRODUCT.md, CONTEXT.md, testes existentes e auditorias anteriores. Público definido no produto: escritórios de 2–10 advogados, desktop predominante e móvel eventual. Fluxo analisado: consultar/capturar publicação → vincular processo → criar/delegar atividade → revisar/concluir; agenda e integrações como ramificações.

Não houve execução da aplicação, das suítes, de requisições autenticadas ou dos serviços externos. Não foram lidos dados de cnj.db nem credenciais. Evidência de código demonstra o contrato implementado, não saúde de produção. Linhas referem-se ao snapshot desta data. Este mapa cobre os fluxos inspecionados, não certifica todos os endpoints.

Aplicada a skill gtd-ui-ux-audit. Capturar, esclarecer, organizar, refletir e engajar são a lente GTD; os critérios de interface e as soluções abaixo são adaptações de design, não requisitos oficiais GTD.

## Matriz de conexões

| Fluxo | Frontend | Backend/persistência | Resultado da inspeção |
|---|---|---|---|
| Consulta CNJ/DJEN e monitoramento | Cliente MCP e formulários em app.js | tools em server.py:329, 502, 2395–2444 | Ligado no código; acesso externo não testado |
| Clientes/processos | _buscarJson e _enviarJson; formulários/listas | roteamento server.py:3397–3448; RegistroClientesCasos | Ligado no código |
| Publicações OAB e vínculo | app.js:4267, 4405–4406, 4900 | server.py:3426, 3474–3485 e handlers | Ligado no código |
| CRUD de atividades/delegação | app.js:5036–5073, 5119–5149, 5771–5806 | server.py:4110–4175; db.py:1142–1195 | Ligado com inconsistência na reatribuição; I01 |
| Checklist | app.js:5151–5200 | handler e roteamento de checklist; testes em test_unit.py:2726–2835 | Ligado; não classificar como pendência |
| Revisão de atividades | app.js:5927–6005 | GET /casos + um GET de atividades por processo | Ligado, mas não usa responsável da atividade; I02 |
| Publicação de origem da atividade | app.js:5086–5096, 5787–5788 | apenas campo observacoes persistido | Conexão textual sem relação estruturada; I03 |
| Agenda | app.js:4120–4168 | POST evento-calendar; sincronização em server.py:2294–2332 | Evento ligado ao processo/linha do tempo, não à atividade; I04 |
| Notificações do cabeçalho | app.html:773; app.js:6076–6085 | sem consumo de feed nesse handler | Interface informativa indisponível; I05 |
| Google/Asaas | app.js:1761–1788 e ações operacionais | /integracoes/status; handlers de agenda e pagamentos | Ligados; configuração não equivale a saúde externa |
| ZapSign | app.html:1308–1312 | não localizado contrato operacional nos arquivos examinados | Anunciado “Em breve”; I06 |

## Pontos fortes

| Evidência | Benefício e condição a preservar |
|---|---|
| app.js:5964–5973 informa falhas parciais ao agregar atividades | Revisão não apresenta cobertura incompleta como carteira integral; preservar aviso e repetição |
| app.js:5787–5801 preserva origem e esclarece que criar atividade não trata publicação | Estados de informação e execução permanecem distintos |
| app.js:1763–1788 diferencia configuração, acesso e erro | Evita afirmar disponibilidade externa sem teste |
| CRUD de atividades/checklist com handlers correspondentes | Base operacional já existe; completar conexões sem reconstruir esses fluxos |

## Melhorias priorizadas

| ID | Lacuna | Grau | Confiança | Esforço estimado |
|---|---|---|---|---|
| I01 | “Eu mesmo” não reatribui atividade já delegada | S2 | Alta no contrato estático | Pequeno, após definir semântica |
| I02 | Revisão não permite filtrar pelo executor da atividade | S2 | Alta | Pequeno/médio, reaproveitando campo existente |
| I03 | Origem DJEN depende de convenção em observações | S2 provisório | Alta na implementação; média no impacto | Médio, se incluir migração |
| I04 | Evento de agenda não possui vínculo com atividade | S2 provisório | Alta no contrato; média na necessidade | Médio/grande, conforme política de sincronização |
| I05 | Sino sem central operacional | S2 provisório | Alta | Grande, se exigir feed persistente |
| I06 | ZapSign apenas anunciado | S1 | Alta no escopo examinado | Desconhecido |

Nenhum S4 comprovado. Frequência e ocorrência em produção são desconhecidas. As alternativas existentes tornam recuperáveis os fluxos acima.

### I01 — Reatribuição para “Eu mesmo”

Evidência: app.js:5127 oferece option com valor vazio e texto “Eu mesmo”; app.js:5784 transforma vazio em null. Na criação, server.py:4131 resolve vazio para scope.usuario; na edição, server.py:4161 normaliza vazio para None. db.py:1190 interpreta None como manter o responsável atual.

Consequência: ao editar atividade de outra pessoa, escolher “Eu mesmo” pode conservar a delegação anterior. O detalhe exibe o responsável, permitindo conferir e corrigir por seleção explícita, quando o usuário está na lista. S2 pela divergência recuperável entre escolha e gravação; confiança alta no encadeamento, reprodução interativa pendente.

GTD: esclarecer e organizar dependem de distinguir quem executa. Próxima ação: definir contrato único entre criação/edição para “eu”, “sem responsável” e “não alterar”, sem sobrecarregar null.

Aceite: autenticado como Ana, editar atividade atribuída a Bia, escolher “Eu mesmo”, salvar e recarregar; responsável retornado e exibido deve ser Ana. PATCH que omite responsável deve preservá-lo. Incluir caso de uso sem registro de usuários, se suportado. Esforço pequeno condicionado à semântica aprovada.

### I02 — Delegação não chega à revisão consolidada

Evidência: backend e db persistem responsavel por atividade; detalhe o exibe em app.js:5057. A consolidação monta opções a partir de casos em app.js:5963 e filtra caso.responsavel em 5981; o rótulo em app.html:1520 informa corretamente “Responsável pelo processo”.

Não é um filtro mentiroso: é uma capacidade ausente. Quem quer revisar suas ações delegadas precisa abrir processos para conferir o executor. S2, alternativa existente e frequência desconhecida.

GTD: refletir e engajar. Próxima ação: acrescentar filtro e identificação de responsável pela atividade, preservando a distinção com o responsável pelo processo. Não inferir um estado “aguardando” apenas da delegação.

Aceite: processo de Ana contendo atividade de Bia aparece no filtro de atividades de Bia; atividade de Ana no mesmo processo aparece no de Ana; atividades sem responsável são distinguíveis. Cobertura parcial continua sinalizada. Dependência: I01 para reatribuição consistente.

### I03 — Origem sem integridade estruturada

Evidência: app.js:5086 extrai hash de linha de observacoes; app.js:5787–5788 recompõe essa linha; app.js:5093–5096 procura publicação entre as vinculadas ao processo. A própria spec anterior documenta essa convenção.

Ligação existe, mas outro cliente pode remover o marcador ao editar observações; desvincular publicação também impede a recuperação pelo fluxo atual. Risco potencial, sem perda reproduzida. A referência textual e a publicação no processo são alternativas parciais. S2 provisório.

GTD: capturar com confiança e refletir sobre a origem. Próxima ação: especificar campo de origem próprio e política de desvinculação/remoção, com compatibilidade para atividades antigas.

Aceite: editar observações por outro cliente preserva a origem estruturada; atividade antiga é reconhecida; publicação desvinculada gera estado explicativo sem apagar a referência. Definir autorização para consultar a origem antes de ampliar sua recuperação.

### I04 — Agenda e atividades são caminhos separados

Evidência: app.js:4160 envia título/data para evento-calendar; server.py:4407–4414 grava evento_id na linha do tempo. A sincronização em server.py:2294–2332 registra alterações como eventos do processo. Esses caminhos não criam/atualizam caso_atividades nem relacionam evento_id com atividade.

O prazo pode existir na agenda e na linha do tempo sem aparecer na revisão de atividades; editar atividade tampouco atualiza o evento por esse contrato. Não é falha demonstrada da sincronização prometida, e sim oportunidade de continuidade entre superfícies. S2 provisório; alternativa é registro manual separado.

GTD: organizar compromissos com data real e refletir. Próxima ação: decidir se “Adicionar à agenda” deve também criar atividade ou permitir vínculo explícito. Definir fonte da data e tratamento de cancelamento, repetição e conflito antes de implementar.

Aceite: um evento vinculado identifica sua atividade; repetição não duplica compromisso; alteração/cancelamento externo tem resultado explicitamente definido e verificável. Manter criação de evento avulso se for requisito. Não equiparar todo evento a prazo jurídico.

### I05 — Central de notificações ainda indisponível

Evidência: app.html:773 contém painel informativo; app.js:6076–6085 somente abre/fecha. Não há consulta de feed nesse acionador. O backend possui avisos por e-mail de monitoramento e delegação (server.py:1919 e 1980; _avisar_atividade_delegada), mas não há ligação deles ao sino nesse fluxo. Falha de e-mail de delegação é registrada no log sem derrubar a gravação (server.py:4230 em diante).

A indisponibilidade é declarada e já foi decisão explícita na auditoria anterior. Não reabrir como regressão corrigida. Para acompanhar novidades, usuário usa áreas operacionais/e-mail. S2 provisório conforme importância da revisão centralizada; nenhum envio perdido foi comprovado.

GTD: refletir e confiar no retorno do sistema. Próxima ação: definir quais eventos merecem notificação, destinatários, leitura e persistência; só então criar feed autenticado e ligar o painel. Não derivar entrega de e-mail apenas do sucesso do CRUD.

Aceite: publicação/delegação de teste aparece uma vez ao destinatário autorizado; leitura persiste; erro de feed difere de lista vazia; falha de e-mail não afirma entrega. Dependência de decisões de acesso e retenção.

### I06 — ZapSign sem fluxo operacional

Evidência: app.html:1308–1312 apresenta apenas card “Em breve”; não foram encontradas chamadas ZapSign nos handlers frontend/backend examinados.

Escopo planejado, não botão quebrado. S1 pelo impacto localizado de expectativa, com confiança alta na ausência de fluxo nesses arquivos. GTD: esclarecer o que é acionável. Próxima ação: decidir prioridade de produto antes de criar integração; esforço desconhecido por faltarem contrato e regras.

Aceite: se mantido planejado, card permanece inequívoco e sem simular conexão. Se implementado futuramente, documentar envio, estado da assinatura e recuperação de falha, com testes isolados antes de usar documentos reais.

## Cobertura GTD e UI/UX

Capturar: publicações e criação de atividades inspecionadas; rascunhos não testados. Esclarecer: responsáveis, origem e disponibilidade das integrações. Organizar: executor versus responsável do processo, agenda versus atividade. Refletir: agregação, cobertura parcial, origem e notificações. Engajar: conclusão e acesso ao detalhe existentes no código; próxima ação por contexto/tempo/energia não foi tratada como requisito universal.

UI/UX: continuidade, linguagem de estados, feedback e recuperação examinados estaticamente. Teclado, leitor de tela, contraste, zoom, responsividade real, desempenho e persistência em execução não verificados; não são falhas presumidas. Nenhuma conclusão de conformidade WCAG ou de validade jurídica de prazo.

## Plano de ação

1. Agora: reproduzir I01 com usuário e dados fictícios; fechar semântica de reatribuição e corrigir contrato. Em seguida, expor executor na revisão (I02).
2. Depois: especificar origem estruturada (I03) e decisão de vínculo agenda/atividade (I04). Cada mudança precisa de política de compatibilidade e aceite próprio.
3. Evolução: avaliar central de notificações (I05) e prioridade de assinatura digital (I06). Não bloquear correções do núcleo nessas expansões.

A agregação atual faz 1 + N requisições, com quatro simultâneas. Isso é limite arquitetural observado, não lentidão medida; medir carteira representativa antes de priorizar endpoint agregado.

## Validação, fontes e continuidade

Realizado: confronto de chamadas, roteamento, handlers e campos persistidos; leitura dos testes existentes de checklist e revisão. Nenhuma suíte executada nesta auditoria; resultados históricos não foram reapresentados como atuais.

Pendente: testes de contrato e fluxo completo com APIs simuladas, especialmente responsável do processo diferente do executor, edição “Eu mesmo”, referência DJEN removida e cancelamento de agenda. Saúde Google/Asaas/SMTP e cobertura com carteira grande permanecem não verificadas.

Fontes locais: CONTEXT.md, PRODUCT.md, .scratch/auditoria-gtd-ui-ux/spec.md e acompanhamento.md; skill gtd-ui-ux-audit, references/criteria.md e templates/report.md. As referências conceituais GTD fornecidas pela skill não foram consultadas na web nesta execução; não se fazem afirmações normativas WCAG.

Nota de atualização: o acompanhamento de 24/10 dizia que não existia responsável próprio por atividade. O código atual já contém esse campo, UI, persistência e aviso de delegação; usar o presente mapa para essa capacidade, preservando o documento anterior como histórico.

Nenhuma mudança no frontend/backend, publicação ou envio externo foi realizada. Este relatório é o registro local do tópico, com recomendações para triagem, sem criação automática de tickets de implementação.

## Continuidade — implementação iniciada em 26/10/2026

Após autorização “iniciar plano de ação” e retomada “continuar”, I01 e I02 entraram em implementação. O conteúdo acima preserva o snapshot da auditoria original. Contratos e tickets da primeira etapa estão em spec.md e issues/; resultados atuais em acompanhamento.md. I03–I06 permanecem em triagem, sem implementação nesta etapa.
