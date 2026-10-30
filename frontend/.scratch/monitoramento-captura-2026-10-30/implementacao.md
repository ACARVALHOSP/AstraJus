# Plano aplicado — monitoramento e captura

Aprovação visual do React recebida em 30/10/2026, após apresentação de `previa.png` e da prévia separada. Escopo do plano: F01–F13 do relatório.

## Decisões

- Coleta paginada com persistência por página, checkpoint somente ao completar a consulta, sobreposição de dois dias e reconciliação integral semanal. Limite defensivo de 1000 páginas gera falha explícita, não sucesso truncado. Respostas repetidas, totais incompatíveis e itens sem hash não avançam o checkpoint.
- Fila SQLite por monitoramento/hash com confirmações independentes para destinos locais e e-mail. Falhas de SMTP não interrompem ingestão, renovação por novidade nem registro de publicações/eventos. Itens pendentes são repetidos mesmo quando o DJEN está indisponível. Payloads da fila são descartados após confirmação de ambos os destinos, preservando a deduplicação por hash.
- E-mail tem entrega ao menos uma vez: queda entre aceitação pelo SMTP e confirmação local ainda pode repetir uma mensagem. Não existe protocolo de confirmação exatamente uma vez no SMTP usado pelo projeto. Eventos locais deduplicam por processo/hash dentro de transação.
- Datas novas e legadas são normalizadas em UTC; datas legadas sem fuso são interpretadas como UTC, coerente com a execução hospedada. Renovação explícita mantém ID, hashes e fila.
- Criação idempotente por usuário/critério, com limite verificado sob `BEGIN IMMEDIATE`. Remoção pela capa encerra duplicatas legadas do mesmo número e devolve o estado real.
- Combinação processo/OAB permanece aceita; todos os filtros são preservados nos dois coletores. Nome permanece apenas rótulo.
- Vincular/criar processo preserva o status de revisão. Novas capturas entram como não tratadas, mesmo com processo cadastrado. Não há reabertura indiscriminada das publicações históricas tratadas; a distinção entre revisão humana antiga e classificação automática antiga não é recuperável com segurança.
- Novas publicações OAB convergem para Publicações monitoradas já na ingestão de 6h, além da captura de 24h. Pendências antigas são importadas no startup; endpoints antigos continuam compatíveis. Alteração explícita de status registra usuário, ação e data no banco.
- Agendador verifica a cada cinco minutos quais rotinas venceram, preservando cadências de 6h/24h por estado durável. Lease renovável impede dois processos de executar a mesma rotina simultaneamente. Reinícios recuperam rodadas atrasadas; histórico registra conclusão, falha ou interrupção. Cada monitoramento preserva sua própria cadência e backoff.
- Frontend: cadastro OAB/processo, renovação, confirmação de remoção com erro recuperável, estado de coleta/entregas, histórico e aviso sem SMTP. Captura avulsa exige período completo; vínculo não marca publicação tratada. Capa informa que avisos e atualização diária são independentes.

## Verificação

Regressões novas cobrem 21/51/101 itens, deduplicação acima de 50, falha na página intermediária, repetição de página, hash ausente, SMTP e destino local falhando independentemente, fusos mistos, renovação/proprietário, concorrência no limite, vínculo sem tratamento, autoria da revisão e lease entre executores.

Jornada no navegador com respostas simuladas: criar OAB, renovar, receber erro de domínio ao remover, repetir remoção e conferir mobile sem overflow. A auditoria Carbon foi executada nos cinco arquivos alterados; observações sobre handlers de TableBatchAction/TableHeader são falsos positivos em componentes Carbon que já fornecem teclado. A hierarquia efetiva é Grid → Column → conteúdo.

Resultados finais e PRs serão acrescentados após a validação.
