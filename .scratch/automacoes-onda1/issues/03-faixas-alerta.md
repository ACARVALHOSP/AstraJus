# Faixas de alerta configuráveis

Status: implementado (aguardando PR para main)
Blocked by: 01
Tamanho: P
Spec: ../spec.md

Ver spec, seção 2. Substituir `ALERTAS_PRAZO_FAIXAS` fixa por faixas por tipo (prazo 5,2,1,0; audiência 15,5,1,0),
configuráveis (0–30 dias, 1–6 faixas). Sem aviso retroativo; escalonamento de ciência inalterado.

## Aceite
- Audiência a 15 dias gera um aviso na faixa 15 e nenhum repetido.
- Mudar a configuração não duplica nem reenvia avisos já enviados.
- Faixa inválida (fora de 0–30, repetida) é recusada na tela.

## Como ficou (implementação)

- `automacoes.py`: parâmetros `faixas_prazo` (padrão 5, 2, 1, 0) e `faixas_audiencia` (padrão **15**, 5, 1, 0) na rotina
  `alertas_prazo`; novo tipo de parâmetro `lista_int` (1 a 6 valores, 0 a 30, sem repetição, guardado do maior para o menor);
  `vigencia(chave, parametro)` guarda desde quando o valor atual passou a valer; só o que difere do padrão é gravado.
- `server.py`: `_alertar_prazos` lê as faixas por tipo; `_faixa_alerta_prazo` aceita as faixas e devolve "" quando ainda
  é cedo; `_faixa_ainda_vale` aplica a regra "sem retroativo".
- `db.py`: `atividades_para_alerta` passa a devolver `criado_em`.
- Frontend: editor de lista na aba Automações ("5, 2, 1, 0"), com validação antes de enviar.

### Regra "sem aviso retroativo" (como funciona de fato)
Uma faixa F "entra" em (data da atividade − F dias). Depois que o administrador altera a lista, a faixa só avisa se
essa entrada for **depois da mudança** ou se a atividade foi **criada depois** dela. Exemplo: audiência daqui a 10 dias e o
administrador acrescenta a faixa 15: não avisa pela 15 (já passou); avisa pela 5 quando chegar. Audiência criada depois
da mudança recebe a faixa em que nasce. Sem mudança registrada, vale tudo (comportamento anterior).

### Escalonamento
Antes dependia dos rótulos de faixa "1", "0" e "atrasado"; agora depende dos **dias que faltam (≤ 1)**. Com as faixas
padrão o comportamento é o mesmo; com faixas próprias (sem a "1") o escalonamento continua valendo.

### Atenção ao publicar
Como o padrão de **audiência** passa a incluir 15 dias e a rotina de alertas já está ligada, na primeira rodada depois
do deploy toda audiência que esteja entre 6 e 15 dias à frente gera **um** aviso (sino e e-mail ao responsável). Prazos
não mudam.

### Verificação
`test_alertas_prazo.py` (+8: padrão de audiência, prazo inalterado, faixas próprias, não reenvia, não retroativo,
atividade nova, escalonamento, regra pura) e `test_automacoes.py` (+lista). Mutação conferida: sem a regra, o teste de
retroativo falha. No navegador contra o servidor real: audiência a 15 dias e prazo a 5 avisaram, prazo a 12 não;
editor aceita "3, 10" (guarda 10, 3) e recusa repetidos.
