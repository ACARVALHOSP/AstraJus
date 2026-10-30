# Monitoramento e captura automática — diagnóstico técnico e funcional

Data: 30/10/2026. Escopo: código local do backend Python, frontend React, interface legada e testes relacionados. Auditoria descritiva; não foram alteradas regras de negócio nem telas.

## Síntese

Existem três mecanismos independentes: Monitoramento de publicações DJEN (6h), captura de publicações por OAB (24h) e atualização de capa/movimentações dos processos (24h). O botão “Monitorar automaticamente” controla apenas o primeiro. A captura manual por OAB não cria Monitoramento. Atualizar a lista na interface não executa uma coleta.

Os principais problemas são cobertura incompleta por ausência de paginação, caminho inexistente para cadastrar OAB no React, mistura de datas com/sem fuso, processamento de eventos condicionado ao sucesso do e-mail e ausência de visibilidade operacional. A aplicação possui deduplicação e isolamento de falhas por Monitoramento, mas não oferece garantia de coleta completa nem recuperação durável de todas as etapas.

## Método e limites

Leitura de `CONTEXT.md`, instruções do projeto, `server.py`, `db.py`, `notificacoes.py`, rotas React, cliente MCP, JavaScript legado e testes. As referências abaixo usam caminhos relativos à raiz do repositório e linhas da revisão local analisada. “Confirmado” significa comportamento identificável no código; impactos condicionais e hipóteses estão explicitados. Não houve consulta ao VPS, à base real, ao SMTP nem às APIs externas. Portanto não se afirma que publicações reais já tenham sido perdidas ou que o agendador em produção esteja saudável.

## Inventário funcional

| Rotina | Entrada e pré-condições | Execução | Saídas |
| --- | --- | --- | --- |
| Criar Monitoramento MCP | `monitorar_publicacoes`, usuário identificado, HTTP e SMTP; processo e/ou OAB | `_criar_monitoramento` valida critério, e-mail e limite de 5 | Registro com ID, critério, criação, expiração de 180 dias e hashes notificados |
| Monitorar pela capa | POST `/casos/<id>/processos/<numero>/capa/monitorar` | Mesma criação, com data UTC; não aplica a mesma guarda SMTP da tool | Monitoramento individual de processo |
| Listar/remover | Tools MCP; DELETE da rota da capa | Lista por usuário; remoção por ID e proprietário | Configuração removida, sem apagar automaticamente o acervo capturado |
| Avisos DJEN | Job de 6h, apenas com configuração SMTP/cofre | Sonda DJEN; concorrência limitada; consulta primeira página de 20 | Feed antes do SMTP; e-mail; hashes/expiração; eventos e pendências após SMTP |
| Captura automática OAB | Job de 24h; registros com `numero_oab` | Sonda; primeira página de 50; deduplicação por hash | Acervo compartilhado de publicações e notificação individual do titular |
| Captura manual OAB | POST `/publicacoes-oab/capturar-manual`; OAB e duas datas | Primeira página de 100 no intervalo; mesma rotina de gravação | Contagem encontrada/nova; não cria recorrência nem notifica titular |
| Atualizar movimentos | Job de 24h; capas com tribunal vinculado | Percorre capas, consulta DataJud/DJEN, compara `(codigo,dataHora)` | Capa atualizada e evento de movimento quando há novidade; sem e-mail |
| Calendar (adjacente) | Job de 1h, integração disponível | Reconciliação por conta e sincronização de eventos | Estado de agenda/atividades; separado da captura DJEN |

Referências principais: `server.py:1855–1929`, `2058–2330`, `2435–2516`, `3161–3252`, `4650–4750`, `5753–5797`, `5942–5960`; `db.py:758–768`, `1868–2029`.

## Fluxo de ponta a ponta

1. Usuário configura critério. A tool permite processo, OAB ou combinação; nome é rótulo e não filtro de consulta.
2. O registro persiste em SQLite pela abstração `RegistroMonitoramentos`. A listagem não devolve os hashes internos.
3. O job de 6h consulta DJEN. Erros transitórios provocam backoff de 6h, 12h, 24h e até 48h em memória. Uma falha individual é registrada sem encerrar os outros itens.
4. Para hashes novos, o feed é registrado antes do SMTP. Se o SMTP falhar, os hashes não são confirmados e o e-mail será tentado novamente em outro ciclo.
5. Após envio bem-sucedido, atualiza hashes e renova 180 dias. Só depois registra eventos dos processos existentes e pendências dos processos sem cadastro encontrados por OAB.
6. Sem novidade, a mesma rotina verifica expiração e envia lembretes quando restam até 30 dias, com intervalo mínimo de 7 dias entre avisos. O comentário “uma única vez” não descreve a implementação semanal.
7. Separadamente, o job de 24h captura somente OAB e grava acervo. Se o número já possui processo cadastrado, a publicação entra como `tratada` e vinculada ao primeiro cadastro encontrado; caso contrário entra como `nao_tratada`.
8. No React, o painel permite consultar acervo paginado, alterar status, vincular/criar processo e criar atividade. A captura manual usa datas obrigatórias no servidor, embora a interface não as apresente como obrigatórias.

## Achados priorizados

### F01 — P1: coleta sem paginação e sem recuperação por janela

Confirmado: `_verificar_um_monitoramento` consulta apenas página 1/20; `_capturar_um_monitoramento_oab`, página 1/50; captura manual, página 1/100. Nenhum desses fluxos percorre páginas ou mantém cursor temporal de coleta. A contagem manual é o tamanho da página recebida, não o total garantido da consulta.

Impacto condicionado ao volume/ordem do DJEN: itens fora da primeira página podem nunca chegar ao e-mail, acervo ou timeline. Um período de indisponibilidade amplia a lacuna. Dividir manualmente datas não garante recuperação se um único dia exceder 100 itens.

Melhoria: paginação completa com limites explícitos, checkpoint durável por critério, janela sobreposta e deduplicação. Persistir início/fim, total informado, páginas lidas, itens válidos/ignorados e completude. Nunca exibir resultado truncado como captura completa. Testar 21, 51 e 101 itens e retomada após falha intermediária.

### F02 — P1: datas incompatíveis podem interromper expiração

Confirmado: a tool cria com `datetime.now` sem fuso (`server.py:2483`); a rota da capa cria com `datetime.now(timezone.utc)` (`4721–4724`). O job usa `datetime.now` por padrão (`2292`) e compara diretamente com `datetime.fromisoformat(expira_em)` (`2141` e seguintes).

Consequência: para registros UTC criados pela capa, ciclos sem novidade podem levantar `TypeError` ao comparar/subtrair datetime aware e naive. O wrapper captura a exceção e apenas escreve log. Como o ramo de novidade retorna antes dessas comparações, o defeito pode permanecer oculto enquanto há itens novos.

Melhoria: normalizar tudo para UTC aware e migrar datas antigas com política explícita. Testar criação via MCP, via REST e legado, todos sem novidades, perto da expiração e após expirar.

### F03 — P1: sucesso do e-mail controla gravação de eventos

Confirmado: sem SMTP o job retorna antes de consultar. Com SMTP falhando, o feed pode ser criado, mas timeline e pendências não são gravadas. Após sucesso, hashes são confirmados antes da gravação de eventos; falhas nesta última etapa são apenas registradas em log.

Impacto: um evento que falhe depois da confirmação dos hashes deixa de ser “novo” no próximo ciclo e pode não ser reprocessado. Falha de e-mail também pode postergar a renovação da expiração, embora a publicação já tenha sido encontrada.

Melhoria: ingestão persistente independente de entrega; fila/outbox por destino (feed, e-mail, evento, triagem), com estado e repetição próprios. Confirmar coleta separadamente de entrega. Testar SMTP indisponível, falha de banco na timeline e queda entre envio e confirmação.

### F04 — P1: o React não oferece cadastro de Monitoramento por OAB

Confirmado: `frontend/src/routes/Monitoramentos.tsx:109` orienta criar em Consultar processo/Publicações, mas essas rotas não chamam `monitorar_publicacoes`. A única criação React encontrada fica na capa de processo e passa apenas número CNJ. O formulário “Capturar agora” é avulso, sem criar configuração recorrente. O JavaScript legado ainda contém criação pela tool (`static/app.js:1057`).

Dead end: usuário React consegue capturar manualmente por OAB, mas não ativar sua captura automática seguindo as instruções da tela.

Melhoria: cadastro explícito de Monitoramento por OAB/processo, com critério, nome, UF, limite, dependências e confirmação do próximo ciclo. Distinguir “Capturar agora” de “Ativar acompanhamento”.

### F05 — P2: renovação prometida sem operação correspondente

O e-mail de expiração pede acessar o painel para renovar (`server.py:1970–1994`), mas o React só lista/remove; não há operação explícita de renovação nas tools analisadas. Remover e recriar é um contorno que perde identidade e histórico de hashes, podendo reenviar publicações antigas. No limite de 5, criar antes de remover também falha.

Melhoria: renovação idempotente preservando ID/checkpoint; ação na lista, confirmação da nova data e acesso direto ao registro.

### F06 — P2: “Monitorar automaticamente” não controla todas as automações

Confirmado: `_atualizar_movimentos_processos` percorre `capas_vinculadas`, sem consultar Monitoramentos. Parar Monitoramento remove avisos DJEN individuais, mas não interrompe atualização diária da capa. A guarda SMTP também diverge: MCP recusa criação sem SMTP, REST permite, e o job depois pode não executar.

Melhoria: nomear a ação pelo efeito (“Receber avisos de publicações”) e mostrar separadamente atualização da capa, captura por OAB e entrega por e-mail. Unificar elegibilidade da criação e exibir serviço degradado quando necessário.

### F07 — P2: critério composto muda de significado entre jobs

Confirmado: criação aceita processo + OAB; o job de 6h envia ambos ao DJEN. O de 24h seleciona registros com OAB e monta consulta sem `numero_processo` (`server.py:2196–2200`).

Impacto: captura automática pode trazer uma abrangência diferente dos avisos do mesmo Monitoramento. Validar intenção do domínio antes de decidir entre proibir combinações ou preservar todos os filtros.

### F08 — P2: deduplicação de e-mail limitada e sem ordenação cronológica

Confirmado: apenas 50 hashes são lembrados e a atualização usa união de sets convertida em lista antes de cortar (`server.py:2111–2112`). O corte não retém necessariamente os 50 mais recentes. Publicações antigas que reapareçam podem voltar a ser notificadas. Acervo e feed possuem deduplicação persistente própria, que não elimina esse risco do e-mail.

Melhoria: tabela de entrega por usuário/critério/hash e canal, com ordem e retenção deliberadas. Tratar também repetição quando SMTP enviou mas o processo caiu antes de confirmar no banco.

### F09 — P2: falta estado operacional e recuperação após reinício

Confirmado: jobs são intervalares, montados em memória a cada inicialização, sem job store ou checkpoint de execução configurado. Não há execução imediata configurada na montagem. Backoff também é em memória. A lista mostra criação e expiração, não última tentativa, último sucesso, falha, próxima execução ou completude.

Risco: reinícios frequentes podem adiar especialmente os ciclos de 24h; indisponibilidade vira ausência silenciosa de dados. Não foi verificado o padrão de reinícios no VPS. Deploy com múltiplos processos exigiria coordenação para evitar execução duplicada.

Melhoria: histórico durável de runs, recuperação no startup por atraso acumulado, métricas de idade do último sucesso e lock/lease para um executor. Health check de HTTP não substitui saúde dos jobs.

### F10 — P2: “tratada” é atribuída pela existência do processo

Confirmado: `_registrar_itens_capturados` marca como tratada quando encontra cadastro, antes de qualquer revisão humana. `marcar_tratada_por_processo` também transforma publicações do número em tratadas (`db.py:1988`). É regra documentada em comentário Q11, portanto exige decisão de produto antes de mudar.

Impacto: se “tratada” for interpretada como revisada ou convertida em atividade, publicações novas de processos existentes podem desaparecer da fila de trabalho sem essa análise.

Melhoria: separar vínculo ao processo de revisão/tratamento. Registrar quem tratou, quando e qual ação justificou. Preservar status na vinculação salvo decisão explícita.

### F11 — P2: pendências do fluxo antigo sem consumidor React

Confirmado: verificação de 6h pode chamar `registrar_pendente`; backend expõe `/pendentes` e descarte (`server.py:3623`). Não foi encontrada chamada a esses endpoints no React. O acervo de 24h oferece uma triagem alternativa, mas tem origem, cadência e limites diferentes.

Melhoria: decidir entre incorporar pendências à triagem atual ou aposentar essa escrita após migração. Demonstrar correspondência entre pendência, publicação capturada e processo antes de remover legado.

### F12 — P2: duplicação e remoção podem gerar estado enganoso

Criação não verifica igualdade de critérios. O mesmo usuário pode consumir o limite com duplicatas. A rota DELETE da capa remove apenas o primeiro registro correspondente; o React inverte localmente `monitorando` após sucesso, sem recalcular a existência de outro Monitoramento (`CapaProcesso.tsx:101–103`). Pode mostrar parado enquanto uma duplicata permanece ativa.

Melhoria: chave única de critério normalizado por usuário, criação idempotente e resposta do servidor com estado final. Verificar o limite dentro da mesma transação da inclusão para evitar corrida entre criações concorrentes.

### F13 — P3: feedback de remoção e captura incompleto

`Monitoramentos.tsx:74` ignora o payload de remoção. O cliente MCP lança para `isError`, mas devolve normalmente um JSON de domínio com `{erro:true}`; logo “não encontrado” pode fechar o modal e apenas recarregar sem explicar o erro. O texto de remoção fala no escritório e em processo mesmo para um Monitoramento individual de OAB.

A captura exige datas no backend, mas `PublicacoesOab.tsx` não as identifica como obrigatórias nem bloqueia submissão vazia. Erros e sucesso compartilham o mesmo parágrafo de status.

Melhoria: validar erro de domínio; usar texto conforme critério e escopo individual; explicitar período obrigatório e distinguir falha, parcial e sucesso.

## Persistência, acesso e boas propriedades existentes

- Monitoramentos são por usuário, com remoção conferindo proprietário. Acervo OAB é compartilhado: consultas de `RegistroPublicacoesOAB.listar` não filtram usuário, coerente com escritório institucional; revisar apenas se houver intenção futura de separar escritórios.
- Acervo usa `INSERT OR IGNORE` por hash; captura automática e manual não duplicam o mesmo registro.
- Captura automática encaminha titular para notificação; captura manual não possui esse destinatário. Vários titulares podem receber feed mesmo quando a publicação já existe no acervo.
- O feed antecede o SMTP e deduplica por destinatário/hash, reduzindo perda e duplicação nesse canal específico.
- Circuit breaker, retry, semáforo e captura de exceção por item reduzem pressão sobre o DJEN e impedem que uma falha isolada aborte toda a rodada.
- Não há criação automática indiscriminada de processos pela coleta. A criação/vinculação continua sendo ação de triagem.

## Plano recomendado e critérios de aceite

| Ordem | Entrega | Aceite mínimo |
| --- | --- | --- |
| 1 | Corrigir datas, paginação e checkpoints | Sem erro com registros MCP/REST; coleta acima dos três limites; retomada sem perda após falha |
| 2 | Separar ingestão, eventos e entrega | Falha SMTP não impede acervo/timeline; falha em um destino pode ser repetida sem duplicar outros |
| 3 | Restabelecer criação OAB e renovação no React | Jornada completa cadastrar → acompanhar → renovar → remover, com erro recuperável e escopo claro |
| 4 | Expor saúde e histórico de execução | Última tentativa/sucesso, próxima execução, erro, atraso e cobertura parcial visíveis por rotina |
| 5 | Resolver semântica de tratada e pendências | Nenhuma publicação some da revisão apenas por possuir processo; destino único da triagem definido |
| 6 | Endurecer idempotência e operação | Critério único, limite transacional, entregas persistentes, retomada pós-restart e executor coordenado |

Testes de maior valor: mais de uma página; indisponibilidade por vários ciclos; datas de ambos os caminhos; e-mail falhando com evento persistido; falha de timeline depois do envio; critérios compostos; duplicatas e remoção; reinício com execução atrasada; aviso de renovação com ação realmente disponível; publicação de processo existente ainda exigindo revisão.

## Validação executada

Resultados e limitações da execução automatizada são registrados em `validacao.md`. Não foi executado teste com envio de e-mail real nem captura real de publicações. A auditoria não altera a aplicação e as melhorias acima permanecem propostas.
