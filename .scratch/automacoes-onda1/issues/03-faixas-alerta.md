# Faixas de alerta configuráveis

Status: ready-for-agent
Blocked by: 01
Tamanho: P
Spec: ../spec.md

Ver spec, seção 2. Substituir `ALERTAS_PRAZO_FAIXAS` fixa por faixas por tipo (prazo 5,2,1,0; audiência 15,5,1,0),
configuráveis (0–30 dias, 1–6 faixas). Sem aviso retroativo; escalonamento de ciência inalterado.

## Aceite
- Audiência a 15 dias gera um aviso na faixa 15 e nenhum repetido.
- Mudar a configuração não duplica nem reenvia avisos já enviados.
- Faixa inválida (fora de 0–30, repetida) é recusada na tela.
