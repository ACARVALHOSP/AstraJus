# Processo parado

Status: implementado (aguardando PR para main)
Blocked by: 01
Tamanho: P
Spec: ../spec.md

Ver spec, seção 1. Rotina diária 07:00 que avisa processos ativos sem movimentação há N dias.

Decisão do escritório: **N = 60 dias**, parâmetro `dias` do catálogo (15 a 365).

## Aceite
- Um aviso por período de inatividade; rodar de novo no dia não duplica.
- Movimento novo zera o ciclo; caso encerrado, processo sem movimentos guardados ou silenciado não avisa.
- Destinatário: responsável do caso, senão administradores. Sino + e-mail, com ação "criar atividade" (manual).

## Como ficou (implementação)

- `automacoes.py`: rotina `processo_parado` no catálogo (**desligada por padrão**, parâmetro `dias`), `processos_parados()` (seleção)
  e `avisar_processos_parados()` (aviso). Silêncio por processo em `automacoes_silenciados`.
- `notificacoes.py`: tipo `processo_parado` (sino, "Abrir movimentações"), um aviso por (processo, data do último movimento, rodada).
- `server.py`: job no agendador (a cada 24 h) e rota `GET/PUT /casos/<id>/aviso-processo-parado`.
- Frontend: interruptor "Avisar se o processo ficar parado" em Cadastro › Organização do escritório.

### Decisões que mudaram em relação à especificação
- **Por caso, não por processo:** usa a mesma "última movimentação" que a lista de Processos já mostra (andamento da capa ou
  publicação vinculada). Se o caso tem vários processos, vale o mais recente dos movimentos.
- **Sem horário fixo:** o agendador atual é por intervalo; a rotina roda a cada 24 h (a primeira vez, ao ligar). Como é
  idempotente, o horário exato não muda o resultado, só o momento em que o aviso chega.
- **Repetição:** reavisa a cada novo período de N dias em que o processo continua parado (rodada = períodos completos
  além do primeiro). Movimento novo zera o ciclo.
- **Fora da regra:** caso não ativo, silenciado, sem movimentação conhecida e caso cujos processos estão todos baixados/arquivados
  na capa (fase ou situação contêm "arquiv" ou "baix").

### Atenção ao ligar
Na **primeira execução**, todo processo que já está parado há N dias ou mais gera aviso de uma vez (sino e e-mail ao
responsável). Em base com muitos processos antigos isso pode ser um lote grande. A simulação (prévia do que seria avisado)
nasce no ticket 05; até lá, ligue com consciência disso ou silencie os processos que não interessam antes.

### Verificação
Testes: `test_processo_parado.py` (18) e `frontend/tests/aviso-processo-parado.test.mjs` (4). Conferido no navegador contra o
servidor real: o agendador rodou a rotina sozinho, o aviso apareceu no sino e abre a aba Movimentações; o interruptor da
ficha silencia e reativa. Um defeito encontrado na conferência (o destino do aviso abria Publicações) foi corrigido e
ganhou teste.
