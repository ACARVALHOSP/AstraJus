# Resumo diário de publicações

Status: implementado (aguardando PR para main)
Blocked by: 01
Tamanho: M
Spec: ../spec.md (seção 3)

## O que ele faz, em uma frase
Em vez de um e-mail a cada verificação de monitoramento, a pessoa recebe **um único e-mail por dia**, de manhã, com
tudo que chegou de publicação nova desde o último resumo, agrupado por processo e já com a sugestão de tipo de ato e de
prazo quando a triagem tiver feito.

## Como é hoje (para saber o que muda)
- Cada monitoramento (por processo ou por OAB) é verificado a cada 6 horas. **Cada lote achado vira um e-mail**: quem
  monitora 3 OABs e 2 processos pode receber 5 e-mails por dia, com data, tribunal e tipo, sem texto.
- A captura por OAB (a cada 24 h) só gera aviso no sino, sem e-mail.
- O sino (central de notificações) avisa publicação por publicação e **não muda** neste ticket.

## O que a pessoa vê
**1. Escolha em "Meu perfil" › "E-mails de publicações novas":**

| Opção | Comportamento |
|---|---|
| Cada publicação | Como hoje: um e-mail por lote, a cada verificação. |
| Resumo do dia | Só o e-mail único da manhã. Nenhum e-mail por lote. |
| Os dois | O e-mail por lote **e** o resumo da manhã. |

Padrão: **Os dois** (nada some; quem quiser menos e-mail escolhe "Resumo do dia"). A escolha só vale enquanto a rotina
estiver ligada no escritório; desligada, todo mundo volta a receber como hoje.

**2. O e-mail da manhã** (ex.: "AstraJus: 12 publicações novas (18/11)"):
- Cabeçalho com o total e o período (se passou mais de um dia sem resumo, diz "desde 17/11").
- **Processos cadastrados no escritório** primeiro, um bloco por processo: título do processo, número CNJ e, por
  publicação: data, tribunal, órgão, classe, tipo de comunicação.
- Depois **"Sem processo cadastrado"**, no mesmo formato, para você decidir se vale cadastrar.
- Quando a triagem já analisou a publicação, aparece como **sugestão**: tipo de ato (ex.: sentença) e prazo provável
  (ex.: apelação). Só entra o que a triagem classificou com confiança suficiente (acima de 0,50); abaixo disso nada é
  sugerido. Dentro do bloco, as mais urgentes primeiro.
- Limite de 40 publicações no e-mail; passando disso, "e mais N", com o botão **Abrir publicações recebidas**.
- **Não leva o texto da publicação nem trecho dele** (igual aos e-mails de aviso de hoje): só os dados acima.
- Dia sem publicação nova: **nenhum e-mail**.

## Regras
- **Quando:** a rotina confere a cada hora e envia na primeira conferência a partir da hora configurada (padrão **08:00**,
  horário de Brasília), **uma vez por dia por pessoa**. Publicação que chega depois do envio espera o resumo seguinte.
  Parâmetro `hora` (0 a 23) na aba Automações.
- **Quem recebe:** o dono de cada monitoramento (a pessoa cuja OAB ou processo é monitorado), com o que veio dos
  monitoramentos dela. Pessoa revogada ou sem e-mail cadastrado não recebe, e o que estava aguardando é dado como entregue
  (não acumula).
- **O que entra:** tudo que os monitoramentos dela trouxeram desde o último resumo, de OAB **e** de número de processo.
- **Nunca fica sem e-mail:** se a pessoa estiver em "Resumo do dia" e a rotina for desligada, ou ela passar para "Cada
  publicação", o que estava esperando sai no e-mail normal do próximo ciclo.
- **Sem repetição:** cada publicação entra no resumo uma vez só. Se o envio falhar (e-mail fora do ar), tenta de novo na
  conferência seguinte e nada se perde; se só sair no dia seguinte, o assunto indica o período.
- **Rotina desligada por padrão**, como as demais novas.

## Como implementar (resumo técnico)
- Terceiro canal de entrega no registro de entregas do monitoramento (`monitoramento_entregas`, hoje canais `email` e
  `local`): coluna `resumo` (padrão 1 = nada pendente). O conteúdo só é apagado quando os três canais terminam (hoje apaga
  quando os dois terminam).
- Na entrada de itens novos: se a rotina está ligada e a pessoa prefere "Resumo do dia" ou "Os dois", `resumo = 0`. Para
  "Resumo do dia", o canal `email` **pula** o item (fica pendente) em vez de enviar; ao enviar o resumo, marca `resumo` e
  `email`.
- Rotina `resumo_publicacoes` no catálogo (desligada por padrão; parâmetro `hora`), agendada de hora em hora. Cada pessoa é
  atendida no máximo uma vez por dia (data de Brasília), controlado em `automacoes_resumo (usuario, enviado_em)`.
- Preferência: campo `avisos_publicacao` (`imediato` | `resumo` | `ambos`) no cadastro da pessoa, editável por ela em
  `/responsaveis/me` (hoje aceita só nome, e-mail e foto) e exibido em Meu perfil.
- Triagem só existe para publicações de OAB (a triagem lê `publicacoes_capturadas`): nos itens de monitoramento por número de
  processo não há sugestão de ato nem de prazo, só os dados do DJEN.

## Aceite
- 12 publicações do dia geram **1 e-mail** por destinatário com as 12; dia sem publicação não envia.
- "Cada publicação": comportamento de hoje, sem resumo. "Resumo do dia": nenhum e-mail por lote, só o da manhã. "Os dois":
  ambos.
- Rodar a rotina duas vezes no mesmo dia não duplica o e-mail nem as publicações.
- Falha de envio: tenta de novo e não perde nada. Rotina desligada com pessoa em "Resumo do dia": volta ao e-mail normal.
- E-mail sem texto da publicação. Pessoa sem e-mail ou revogada não gera erro nem acumula pendência.
- Monitoramento por número de processo e por OAB aparecem no mesmo resumo.

## Mudanças em relação à especificação anterior
- **Sem trecho do texto** (a spec previa até 200 caracteres): os e-mails atuais não levam texto e as publicações podem conter
  dados sensíveis; ficou só o que o DJEN traz de cabeçalho.
- **Sem "resumo geral para administradores"** (parâmetro previsto, desligado): não foi pedido e exigiria outro tipo de
  parâmetro; fica para depois, se fizer falta.
- **Fonte dos dados:** não é `publicacoes_capturadas` (só OAB), e sim as entregas do monitoramento (OAB e processo).

## Decisões do escritório (17/11/2026)
1. Padrão **"Os dois"**. 2. Horário **08:00**. 3. **Sem trecho do texto** no e-mail. 4. **Um resumo por dia**.

## Como ficou (implementação)
- `monitoramento_runtime`: coluna `resumo` em `monitoramento_entregas` (tabelas antigas ganham a coluna com valor 1, então nada que
  já existia fica pendente); `ingerir(..., aguarda_resumo)`, `pendentes_detalhe`, canal `resumo` em `confirmar`; o conteúdo só é
  apagado quando os três canais terminam.
- `automacoes.py`: rotina `resumo_publicacoes` (desligada por padrão; parâmetro `hora`, padrão 8), `enviar_resumos_publicacoes`,
  `montar_resumo`, `modo_avisos_publicacao` (a preferência só vale com a rotina ligada), tabela `automacoes_resumo`.
- `server.py`: modo na entrada dos itens; e-mail de cada lote **retém** o que espera o resumo (rede de segurança de 36 h);
  expiração do monitoramento não apaga o que ainda espera; rotina horária no agendador; `/responsaveis/me` devolve e aceita
  `avisos_publicacao` (também em `usuarios_admin.atualizar_perfil`).
- Frontend: "E-mails de publicações novas" em Meu perfil (três opções) e parâmetro `hora` na aba Automações.

### Regras que a implementação fixou
- **Retenção:** quem escolheu "Resumo do dia" não recebe o e-mail de cada lote enquanto o resumo estiver ligado. Se o resumo
  não levar o item em **36 h** (e-mail fora do ar, rotina desligada), ele sai pelo e-mail normal: nunca fica sem e-mail.
- **"Resumo do dia" não repete:** itens que a rede de segurança já enviou ficam fora do resumo. **"Os dois"** leva tudo.
- **Sem SMTP configurado:** nada é enviado nem descartado; os itens esperam.
- **Pessoa sem e-mail ou revogada:** o que esperava o resumo é dado como entregue (não acumula).
- Triagem só existe para publicações de OAB; as de monitoramento por número de processo saem sem sugestão de ato/prazo.

### Verificação
`test_resumo_publicacoes.py` (25) e `frontend/tests/avisos-publicacao.test.mjs` (3). Mutação conferida em 4 pontos
(retenção, uma vez por dia, texto da publicação, rede de segurança): cada uma faz um teste falhar. No navegador contra o
servidor real: a escolha em Meu perfil persiste e volta marcada; o parâmetro `hora` aparece na aba Automações. O e-mail
renderizado foi conferido em HTML (texto e visual); o envio SMTP real não foi exercitado.
