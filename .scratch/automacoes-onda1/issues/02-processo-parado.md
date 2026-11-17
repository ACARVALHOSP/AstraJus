# Processo parado

Status: ready-for-agent
Blocked by: 01
Tamanho: P
Spec: ../spec.md

Ver spec, seção 1. Rotina diária 07:00 que avisa processos ativos sem movimentação há N dias.

Decisão pendente do escritório: N padrão (spec propõe 60). Implementar com o parâmetro do catálogo.

## Aceite
- Um aviso por período de inatividade; rodar de novo no dia não duplica.
- Movimento novo zera o ciclo; caso encerrado, processo sem movimentos guardados ou silenciado não avisa.
- Destinatário: responsável do caso, senão administradores. Sino + e-mail, com ação "criar atividade" (manual).
