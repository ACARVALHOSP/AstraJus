# Automações — Onda 1

Status: especificação (nada implementado). Origem: relatório "automações do SIJUR para implementação" (levantamento de um
concorrente) cruzado com o que o AstraJus já faz. Esta onda reúne as automações de **baixo risco**, que usam só dados que o
sistema já tem e **não enviam texto a nenhum serviço de IA** (custo de IA: zero).

## Princípios (valem para toda automação)

1. **Sugestão antes de ação.** Nada irreversível e nada que saia do escritório sem pessoa revisar. Onde a automação grava
   algo, grava como *rascunho* ou *preenche só o que está vazio*, e registra quem/quando/por quê.
2. **Desligada por padrão**, ligada por um administrador, com interruptor e parâmetros próprios.
3. **Idempotente:** rodar duas vezes não duplica aviso, caso nem tarefa.
4. **Observável:** cada rodada aparece no histórico das rotinas (`/automacoes`) com contagem do que fez; falha de uma
   não derruba as outras.
5. **Dados confidenciais:** e-mails e avisos levam o mínimo (número, tribunal, classe, link), nunca o texto integral.

## Infraestrutura comum (ticket 01)

O que as seis automações compartilham e que não existe hoje:

- **Tela "Automações"** em Configurações (só administrador): lista as rotinas (as cinco que já rodam — monitoramentos,
  captura OAB, movimentos, alertas de prazo, triagem — mais as novas), com interruptor, parâmetros, última execução,
  resultado e erro. Aproveita `automacao_execucoes` e `GET /automacoes`; cumpre parte do "Painel de saúde" do TODO.
- **Configuração persistida:** tabela `automacoes_config (chave, ativo, parametros JSON, atualizado_em, atualizado_por)`.
  Os padrões ficam no código; a tabela guarda só o que o administrador mudou. Toda mudança entra no Histórico
  administrativo (quem alterou, valor antigo e novo).
- **Agendamento:** uma entrada por rotina no agendador existente (`_montar_agendador`), com a trava de execução única
  (`automacao_leases`) e o histórico já usados. Horários em America/Sao_Paulo.
- **Modo simulação** (rotinas que gravam: ticket 05 e 07): botão "Simular" mostra "faria isto" sobre dados reais, sem gravar.
- **Auditoria no caso:** eventos de `caso_eventos` com origem `automacao:<chave>` para tudo que a automação criar ou alterar.
- **Novos tipos de notificação** em `notificacoes.py`: `processo_parado`, `processo_atribuido`, `processo_rascunho`;
  `resumo_diario` é só e-mail. Nenhum exige ciência.
- **Permissões:** configurar = administrador; ver resultados e rascunhos = quem tem a área de processos.

## 1. Processo parado (ticket 02)

**Objetivo:** avisar quando um processo ativo fica N dias sem movimentação, para ninguém descobrir tarde que ele travou.

**Rotina:** diária, 07:00. Reaproveita os movimentos que `_atualizar_movimentos_processos` já guarda a cada 12 h na capa do
processo; **não faz consulta nova ao tribunal**.

**Regra:**
- Considera cada processo vinculado a um caso com status ativo e com histórico de movimentos na capa.
- *Parado* = hoje − data do último movimento ≥ N dias. **Padrão N = 60** (parâmetro do escritório, 15–365).
- Fora da regra: caso encerrado/arquivado, processo baixado/arquivado (fase/status da capa), processo **sem nenhum movimento
  guardado** (sem dado não se avisa; evita enxurrada na primeira carga) e rascunhos do ticket 07.
- Silenciar: botão "Não avisar este processo" na ficha (campo no vínculo do caso), reversível.

**Destinatário:** responsável do caso; sem ele, administradores (mesma regra dos alertas de prazo).

**Aviso:** sino + e-mail. Texto: número, caso, "sem movimentação há X dias (último em dd/mm/aaaa)", link para o processo.
Ação sugerida no aviso (botão, nunca automática): "Criar atividade: verificar andamento".

**Repetição:** um aviso por período de inatividade (chave `caso:numero:data_do_último_movimento`). Se continuar parado,
reavisa só depois de mais N dias. Qualquer movimento novo zera o ciclo.

**Aceite:**
- Processo com último movimento há N dias gera exatamente um aviso; rodar de novo no mesmo dia não gera outro.
- Movimento novo interrompe os avisos; depois de novo período parado, volta a avisar.
- Caso encerrado, sem movimentos ou silenciado não gera aviso.

## 2. Faixas de alerta configuráveis (ticket 03)

**Hoje:** prazos e audiências usam as mesmas faixas fixas (5, 2, 1 e 0 dias; prazo ainda avisa até 3 dias depois de vencer),
definidas em `ALERTAS_PRAZO_FAIXAS`.

**Mudança:** faixas por tipo, configuráveis pelo administrador.
- **Prazo:** padrão 5, 2, 1, 0 (inalterado).
- **Audiência:** padrão **15, 5, 1, 0** (acrescenta 15 dias, como pede o relatório; antecedência maior ajuda a avisar o
  cliente e a testemunha).
- Cada faixa é um número de dias de 0 a 30, de 1 a 6 faixas por tipo.

**Regras:**
- Um aviso por faixa, por pessoa e por atividade, ao *entrar* na faixa (comportamento atual de `registrar_alerta_prazo`).
- **Sem retroativo:** ao mudar a configuração, faixas que a atividade já ultrapassou não geram aviso. Se faltam 10 dias e
  o administrador acrescenta 15, o próximo aviso é o de 5.
- O escalonamento por falta de ciência (administradores) continua só para prazos, sem alteração.
- Mudar a configuração não reenvia nada já enviado.

**Aceite:** com audiência a 15 dias, sai um aviso na faixa 15 e nenhum repetido nas execuções seguintes; alterar faixas não
duplica avisos; faixa inválida (fora de 0–30, repetida) é recusada na tela com mensagem clara.

## 3. Resumo diário das publicações (ticket 04)

**Hoje:** cada publicação nova gera aviso (sino e e-mail do monitoramento). Em dia movimentado, são vários e-mails.

**Mudança:** um **e-mail único por pessoa por dia** com tudo o que chegou desde o último resumo.

- **Quando:** 08:00, dias em que houve publicação. **Sem publicação nova, não envia nada.**
- **Quem recebe:** o dono de cada monitoramento (a pessoa cuja OAB captou); opcionalmente os administradores recebem um
  resumo geral do escritório (parâmetro, desligado).
- **Conteúdo:** agrupado por processo — número, tribunal, classe, **tipo de ato e prazo sugerido pela triagem** quando
  existirem, uma linha de contexto (até 200 caracteres) e link. Processos não cadastrados aparecem em bloco separado
  ("sem processo cadastrado"). Botão "Abrir Publicações recebidas".
- **Preferência por pessoa** (em Meu perfil, junto da pendência "preferências de notificação"): *imediato*, *resumo diário*
  ou *ambos*. Padrão: **ambos**, para não mudar o comportamento atual sem aviso.
- **Idempotência:** guarda a data do último resumo por pessoa. Falha de envio repete na rodada seguinte; se o resumo de um dia
  só sair no dia seguinte, o assunto indica a data a que ele se refere.

**Aceite:** 12 publicações no dia geram 1 e-mail por destinatário com as 12; dia sem publicação não gera e-mail; quem
escolheu "só imediato" não recebe resumo; rodar duas vezes não duplica.

## 4. Responsável por regras de distribuição (ticket 05)

**Hoje:** o responsável é digitado ao criar o caso; sem ele, os avisos vão ao responsável do caso e, na falta, aos
administradores.

**Mudança:** quando um caso nasce **sem responsável**, o sistema o preenche por regras. Nunca sobrescreve um responsável já
definido. Vale para casos criados a partir de publicação (inclusive o ticket 07) e para casos criados na tela sem responsável.

**Ordem de decisão (a primeira que casa vence):**
1. **Quem captou:** o dono do monitoramento que trouxe a publicação (o advogado daquela OAB). É a regra natural e vem ligada.
2. **Regras do administrador**, em ordem editável. Critérios aceitos: cliente; classe ou assunto da capa; tribunal ou órgão
   julgador (foro/vara); área do direito. Cada regra aponta para uma pessoa.
3. **Responsável padrão do escritório** (parâmetro).
4. Sem resposta: fica sem responsável, como hoje, e o administrador é avisado "processo sem responsável".

**Detalhes:**
- Pessoa inativa ou revogada: a regra é pulada e o administrador vê o alerta na tela de Automações.
- Armazenamento: tabela `regras_responsavel (id, ordem, criterio, valor, responsavel, ativo)`.
- O responsável escolhido recebe o aviso `processo_atribuido` (sino e e-mail) e o evento fica no caso: "responsável definido
  por regra X".
- **Simulação:** a tela mostra, para as últimas 50 publicações sem caso, quem seria o responsável e por qual regra.
- **Fora desta onda:** rodízio e balanceamento por carga de trabalho.

**Aceite:** caso sem responsável recebe o dono do monitoramento; regra de cliente vence a padrão; responsável já definido
nunca muda; regra apontando para pessoa revogada é ignorada com alerta; simulação não grava nada.

## 5. Normalizar nomes (ticket 06)

**Hoje:** a *exibição* já normaliza (`formatarNomeExibicao` no frontend; `_caixa_nome` no servidor para classe), mas o dado
**gravado** mantém a caixa do tribunal ("MARIA DA SILVA"), e o relatório pede gravar em caixa de título.

**Decisão de desenho:** não reescrever o dado em massa e sem aviso. Duas partes:

1. **Daqui para frente:** nomes de clientes e títulos de caso criados automaticamente (a partir de publicação) são gravados
   já normalizados, pela **mesma função** usada na exibição (uma só regra, para frontend e servidor não divergirem).
2. **Saneamento do que já existe:** ferramenta em Administração que lista "antes → depois" dos clientes e casos com nome todo
   em maiúsculas (ou todo em minúsculas), a pessoa marca o que aplicar, e cada alteração guarda o valor anterior para
   **desfazer**.

**Regras da função:** partículas minúsculas (de, da, do, dos, das, e), siglas preservadas (INSS, CEF, S/A, Ltda, ME, EPP),
algarismos romanos, nomes próprios compostos e apóstrofos; lista de exceções editável pelo administrador.

**Nunca altera:** CPF/CNPJ, OAB, número CNJ, nem as partes e advogados da **capa** (vêm do tribunal e são fonte oficial).

**Aceite:** conjunto de nomes de teste (incluindo siglas, partículas e razões sociais) normaliza como esperado; reaplicar
não muda nada (idempotente); desfazer restaura o valor anterior; nome já com caixa mista não é tocado.

## 6. Autocadastro como rascunho (ticket 07)

**Hoje:** para publicação com número de processo não cadastrado, a pessoa usa "criar caso a partir da publicação" e escolhe o
cliente. O núcleo (`_criar_caso_de_publicacao`) já monta o caso e a capa **só com os dados da publicação**, sem consultar APIs.

**Mudança:** rotina que faz isso sozinha, **mas só quando o cliente é reconhecido com segurança**, e cria o caso como
**rascunho** a confirmar.

**Quando cria:** publicação captada por monitoramento de OAB, com número CNJ válido, sem caso vinculado, não silenciada nem
descartada, e cujo processo **não esteja cadastrado em outro caso**.

**Cliente:** usa o reconhecimento de partes que já existe (`polos.py`). Cria **só se exatamente um cliente do escritório for
reconhecido** nas partes. Zero ou mais de um: **não cria**; a publicação segue na fila com o selo "sem cliente reconhecido".
(Não se inventa cliente: `cliente_id` é obrigatório e um cadastro errado polui a base.)

**O rascunho:**
- novo estado do caso, "pendente de confirmação", com lista própria ("Processos a confirmar") e contador na Home;
- **não** entra nos alertas de processo parado, financeiro, relatórios nem buscas de produção até ser confirmado;
- botões **Confirmar** (vira ativo) e **Descartar** (remove o rascunho e devolve a publicação à fila);
- responsável definido pelas regras do ticket 05; sino e e-mail `processo_rascunho` ao responsável.

**Limites:** teto por rodada e por dia (padrão 20/dia); rotina roda junto da captura OAB (24 h).

**Simulação obrigatória na primeira ativação:** "criaria N rascunhos, para estes clientes" antes de ligar de verdade.

**Depende de:** ticket 05 (responsável) e ticket 01 (interruptor e simulação).

**Aceite:** publicação com cliente único reconhecido gera um rascunho, e só um, mesmo com a rotina rodando de novo;
cliente não reconhecido ou ambíguo não gera caso; rascunho não dispara alerta de processo parado; descartar devolve a
publicação à fila; o teto diário é respeitado.

## Ordem de entrega

| # | Ticket | Tamanho | Depende de |
|---|--------|---------|------------|
| 01 | Infraestrutura: configuração, tela Automações, simulação, auditoria | M | — |
| 02 | Processo parado | P | 01 |
| 03 | Faixas de alerta configuráveis | P | 01 |
| 04 | Resumo diário de publicações (+ preferência por pessoa) | M | 01 |
| 05 | Responsável por regras | M | 01 |
| 06 | Normalizar nomes (função única + saneamento) | P | — |
| 07 | Autocadastro como rascunho | G | 01, 05 |

Todos são **B+F** (backend em PR para `main`; telas na `astrajus-radix`). Pelo CLAUDE.md, arquivo `.py` novo na raiz exige
`COPY` no `Dockerfile` e entrada em `py-modules`; sugestão: criar as rotinas novas dentro de um módulo/pacote existente
(`modulos/`) para evitar isso.

## Fora desta onda

Motor de regras "quando/então", abrir prazo automaticamente, relatório do processo por IA, rascunho de peça, e-mail a
cliente, WhatsApp, download de autos, OCR e transcrição (ver relatório de análise). Fechamento automático de prazo vencido
também fica de fora: encerrar prazo sem cumprimento esconde risco, e só faria sentido para prazos já marcados como cumpridos.

## Decisões abertas (precisam do responsável pelo escritório)

1. **N padrão do processo parado:** 60 dias serve, ou prefere 30 / 90?
2. **Horário do resumo diário:** 08:00 está bom?
3. **Responsável padrão do escritório** (regra 3 do ticket 05): quem?
4. **Autocadastro:** aceita criar apenas com cliente reconhecido de forma única, deixando o resto na fila manual?
5. **Resumo diário:** o padrão "ambos" (imediato + resumo) agrada, ou prefere começar só com o resumo opt-in?
