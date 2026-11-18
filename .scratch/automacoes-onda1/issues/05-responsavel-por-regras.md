# Responsável por regras de distribuição

Status: implementado (decisões: incluir "Aplicar" aos existentes e sugerir nos formulários)
Blocked by: 01 (pronto)
Tamanho: M (G se entrar a ferramenta de aplicar aos processos existentes)
Spec: ../spec.md (seção 4)

## O que ele faz, em uma frase
Diz **quem deve ser o responsável** por um processo novo, seguindo regras que o administrador escreve (por cliente, classe,
assunto, tribunal ou vara), e usa isso onde hoje ninguém escolhe: nos processos criados sozinhos (ticket 07), como
**sugestão já preenchida** nos formulários de criar processo, e, se o escritório quiser, para dar responsável aos processos
que hoje não têm.

## O que o código mostrou (e muda o que eu tinha escrito)
1. **Na criação manual o responsável quase nunca fica vazio.** Em "Novo processo", o campo é texto livre e, se vazio, o
   sistema usa quem está criando. Em "criar processo a partir da publicação", o campo é obrigatório. Ou seja: a regra não
   tem o que "preencher" nessas telas; o ganho ali é **sugerir** o valor.
2. **Onde falta de verdade:** processos criados por automação (ticket 07, não há quem esteja criando) e processos antigos
   com o campo vazio. Nesses, os avisos de prazo vão para os administradores.
3. **O responsável é texto livre em "Novo processo"** (ex.: "Dra. Fernanda Reis"), não necessariamente um login. Quem não
   é login não recebe avisos de prazo. As regras apontam **só para pessoas cadastradas e ativas**.

## O que a pessoa (administradora) vê
Em **Administração › Automações**, uma seção **"Regras de responsável"** com a rotina ligada/desligada (nasce desligada):

| Ordem | Se... | Então o responsável é... | |
|---|---|---|---|
| 1 | Quem captou a publicação | a pessoa dona do monitoramento | ligada |
| 2 | Cliente for **Maria Teste** | Dr. Pedro | ligada |
| 3 | Tribunal for **TJSP** e classe contiver **execução** | Dra. Ana | ligada |
| 4 | (padrão do escritório) | Dra. Bia | ligada |

- **Tipos de regra:** *Quem captou* · *Cliente* · *Classe contém* · *Assunto contém* · *Tribunal é* · *Órgão/vara contém* ·
  *Padrão do escritório* (sempre a última, uma só). Uma condição por regra; a **ordem** faz a prioridade (a primeira que
  casa vence), com botões subir/descer.
- Regra que aponta para pessoa **revogada ou inativa** aparece em vermelho ("pessoa inativa: regra ignorada") e é pulada.
- **"Quem captou"** é uma regra como as outras, na posição que o administrador quiser. Lista inicial: *Quem captou* →
  *Padrão*. Quem captou = o dono do monitoramento (OAB ou processo) que trouxe a publicação.
- Contador **"N processos sem responsável"** com **Simular** (mostra quem seria o responsável de cada um e por qual regra,
  sem gravar nada) e **Aplicar** (grava, com confirmação). A aplicação é uma ação do administrador, nunca automática.

## Onde as regras entram
1. **Autocadastro (ticket 07):** o processo nasce com o responsável da regra.
2. **Formulários de criar processo:** o campo vem **já preenchido com a sugestão** ("sugerido pela regra: cliente
   Maria Teste"); a pessoa pode trocar. Em "criar a partir da publicação" a sugestão é a regra aplicada àquela publicação.
3. **Processos existentes sem responsável:** só pela ação "Aplicar" acima (opcional, ver decisões).

## Regras de funcionamento
- **Nunca sobrescreve** responsável já definido, em nenhum caminho.
- Regras são conferidas **de cima para baixo**; a primeira que casa e aponta para pessoa ativa vence. Sem nenhuma,
  o resultado é "sem responsável" e quem chamou decide (o 07 deixa o rascunho sem responsável e avisa os administradores).
- **Comparação de texto** ignora maiúsculas e acentos ("execucao" casa "Execução").
- **Rotina desligada:** o resolvedor devolve "sem sugestão" e tudo funciona como hoje.
- **Auditoria:** cada responsável definido por regra grava um evento no processo ("responsável definido por regra: Cliente
  Maria Teste") com a origem `automacao:responsavel`. Aplicação em lote (existentes) avisa cada pessoa **só no sino**
  ("processo atribuído"), sem e-mail, para não gerar enxurrada.
- Limite de **50 regras**.

## Como implementar (resumo técnico)
- Tabela `regras_responsavel (id, ordem, tipo, valor, responsavel, ativo)`; `tipo` em `captou|cliente|classe|assunto|tribunal|orgao|padrao`.
- Função pura `resolver_responsavel(contexto, regras, usuarios_ativos)` devolve `{responsavel, regra, motivo}` ou nada;
  `contexto = {cliente_id, classe, assunto, tribunal, orgao, captou}` montado por quem chama (publicação, processo).
- Catálogo: entrada `responsavel_regras` **sem agenda própria** (flag `agendada: false`); a tela mostra "sem execução
  própria: vale quando outras automações criam processos".
- Rotas administrativas: `GET/PUT /admin/automacoes/responsavel/regras`, `POST .../simular`, `POST .../aplicar`.
- Sugestão nos formulários: `GET /responsaveis/sugestao?publicacao=<hash>` ou `?cliente_id=...`.
- Evento no processo via `registrar_evento_no_caso`. Notificação nova `processo_atribuido` (sino).
- Frontend: seção "Regras de responsável" na aba Automações; campo "Responsável" dos formulários com a sugestão.

## Aceite
- Responsável já definido **nunca** muda, por qualquer caminho.
- Regra de cliente acima da padrão vence a padrão; ordem é respeitada; "quem captou" na posição escolhida.
- Regra para pessoa inativa/revogada é pulada e aparece em vermelho na tela.
- Comparação sem maiúsculas/acentos; "tribunal é" exige igualdade.
- **Simular não grava nada.** Aplicar grava só nos que estão sem responsável, registra o evento e avisa no sino.
- Rotina desligada: nenhuma sugestão, comportamento de hoje.
- Formulário de criar processo traz a sugestão e deixa trocar.

## Decisões abertas
1. **Incluir a ação "Aplicar" aos processos que já estão sem responsável?** Sem ela, só valem os processos novos. Com ela, o
   ticket cresce (simulação + aplicação + aviso no sino), mas resolve o caso real de avisos de prazo caindo nos
   administradores. Sugiro **incluir**.
2. **Sugestão já preenchida nos formulários**: ok mudar o campo "Responsável" de "vazio" para "sugerido pela regra"
   (a pessoa ainda pode trocar)? Sugiro **sim**.

O "responsável padrão do escritório" **não bloqueia** a implementação: ele é um campo da própria tela; enquanto estiver
vazio, a última etapa (padrão) é simplesmente pulada.


## Implementação (ticket 05)
- `regras_responsavel.py` (resolvedor, tabelas, simular/aplicar), rotas em `/admin/automacoes/responsavel/{regras,simular,aplicar}`
  e `GET /responsaveis/sugestao`. A rotina nasce desligada e não é agendada (age na criação e no botão Aplicar).
- A auditoria ("definido pela regra: motivo") fica na tabela própria `regras_responsavel_aplicacoes`, **não** em `caso_eventos`:
  qualquer evento ali reinicia a "última movimentação" e atrapalharia o aviso de processo parado.
- Aviso à pessoa: só no sino (`processo_atribuido`, abre a aba Cadastro do processo); nada de e-mail.
- Gancho de criação: `_criar_caso_validado(..., contexto_regras=...)`. Só o autocadastro (ticket 07) vai passar esse contexto;
  hoje nenhuma criação existente o usa, então nada muda para quem cria processo à mão.
- Frontend: editor em Automações (`RegrasResponsavel.tsx`), sugestão no formulário da publicação (pré-preenche) e em Novo processo
  ("Usar sugestão"), nota "Definido pela regra" no Cadastro.

### Verificação
`test_regras_responsavel.py` (30) + suíte completa; `frontend/tests/regrasResponsavel.test.mjs` (3). No navegador contra o servidor
real: criar regras, salvar, simular (nada grava) e aplicar (2 processos receberam responsável).
