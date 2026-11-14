# Jurimetria na ficha do processo

Status: fases 0, 1 e 2 no ar; fase 3 implementada (só frontend).

Traz a jurimetria (hoje uma tela de pesquisa à parte, módulo `modulos/jurimetria`) para dentro do processo aberto:
"nesta vara, para este assunto, X% das sentenças foram procedentes; valor mediano R$ Y". Serve de referência
para estimar risco, proposta de acordo e provisão sem sair da ficha.

## Escopo

Entra (o CJPG do TJSP permite):
- desfecho das sentenças de 1º grau (procedente, parcial, improcedente, acordo, extinto) com intervalo de confiança;
- valor de condenação (mediana, p25-p75), hoje só dano moral (regex);
- evolução mensal e perfil do magistrado.

Fica de fora (não há dado no CJPG): percentual de recurso provido (2º grau), tempo exato até a sentença.
O tempo poderia ser aproximado pelo ano do número CNJ (erro de até 1 ano): fase 3, opcional.
Só processos do TJSP (número CNJ com `.8.26.`); nos demais a aba explica que não se aplica.

## Achados da fase 0 (medidos no e-SAJ em 13/11/2026)

1. **As árvores baixam sem problema** (`python server.py --atualizar-arvores-cjpg`): vara 15.498 nós, classe 462,
   assunto 8.896. A de **magistrado vem vazia** (o e-SAJ monta a grade por JavaScript): ela é manual hoje, então
   o perfil de magistrado depende de `magistrado.json` preenchido à mão. O diretório de produção é
   `/data/arvores_cjpg` (Dockerfile): **conferir se está preenchido no VPS**; não há como verificar daqui.
2. **O e-SAJ limita a consulta a no máximo 1 ano e exige as duas datas.** Com período maior ou só uma data, ele devolve
   a página do formulário com uma mensagem "Atenção"; a ferramenta atual não reconhece isso e devolve **0 resultados
   sem erro** (a tela de Jurimetria também sofre disso). O padrão da aba deve ser 12 meses; "24 meses" exigiria
   duas consultas.
3. **Latência boa:** 5 páginas (50 decisões) em cerca de 4 s; 15 páginas devem levar cerca de 13 s. O cache de 7 dias já existe.
4. **O foro sai do número CNJ, sem casamento por nome:** os 4 últimos dígitos (`…8.26.0100`) são o id do nó de foro
   da árvore de varas (80 de 80 resultados reais conferidos). Falta só achar a vara dentro do foro.
5. **A mesma vara aparece com vários códigos** ("12ª Vara Cível" `100-12`, "12ª. Vara Cível" `100-3651`,
   "12ª V.CÍVEL" `100-1718`, "12ª VC" `100-1475`). Só o código limpo trouxe decisões nos últimos 12 meses; os
   variantes não trouxeram nenhuma. O resolvedor deve preferir o nome canônico e, na dúvida, sondar com 1 página.
6. **Assuntos homônimos em ramos diferentes** (`Indenização por Dano Moral` = 10433, 9992 e 7779): o nome sozinho
   não basta; mostrar o caminho (ramo) e deixar a pessoa confirmar.
7. **Cobertura da classificação é parcial:** 32% (vara + classe) e 56% (assunto, TJSP todo) das decisões ficaram sem
   desfecho; muitas são "Cumprimento de sentença", sem trecho de texto. Para as estatísticas, filtrar por classe de
   conhecimento (o resolvedor já fixa a classe da capa) e mostrar quantas foram classificadas.
8. Tamanho real das amostras: 12ª Vara Cível Central + Procedimento Comum Cível = **75 sentenças em 12 meses**;
   assunto dano moral no TJSP todo = 13.985. A amostra por vara costuma ser pequena (< 30): o cartão do TJSP é o
   comparativo, e o aviso de amostra pequena é parte do desenho, não exceção.

## Desenho

**Consulta:** a mesma ferramenta MCP `consultar_jurimetria_cjpg` (cache incluído). Sem endpoint novo de consulta; as
estatísticas saem no frontend com `modulos/jurimetria/estatisticas.ts`.

**Backend (módulo jurimetria):**
- `GET /cjpg-arvore/resolver?numero=…&vara=…&classe=…&assunto=…[&municipio=…]` devolve candidatos ranqueados
  `{campo, id, nome, caminho, confianca}`: foro pelo número CNJ; vara dentro do foro por nome normalizado (sem acento,
  `ª º .`, `V.`→`Vara`); classe e assunto por nome, com o caminho.
- Corrigir `_cjpg_buscar_no_esaj`: reconhecer a mensagem "Atenção" do e-SAJ (período > 1 ano, data faltando) e devolver
  erro legível. Vale também para a tela de Jurimetria atual.
- Validar e padronizar as datas (12 meses, ambas obrigatórias) no servidor.

**Frontend:** aba "Jurimetria" na ficha (depois de "Linha do tempo"), visível só com o módulo ligado, área Pesquisa e
processo do TJSP.
- Filtros resolvidos (vara, classe, assunto, período de 12 meses) mostrados com a confiança e editáveis com os
  `SeletorArvore` existentes. **Sem estatística antes da pessoa ver e confirmar os filtros.**
- Botão "Calcular" (nunca consulta ao abrir). Dois cartões: "Nesta vara" e "TJSP, mesmo assunto": gráfico de
  desfechos, taxa de procedência com intervalo, valor mediano e faixa, decisões classificadas e total.
- Texto-resumo em linguagem de advogado e os avisos de viés e de amostra que o módulo já produz.

**Privacidade:** ao e-SAJ vão só códigos de vara, classe e assunto e o período; nunca nomes de partes.

## Fases

| Fase | Entrega | Estimativa |
|---|---|---|
| 0 | Verificações e medições (feita; achados acima) | concluída |
| 1 | Correção do aviso "Atenção" e das datas; rota de resolução com testes; aba com dois cartões e texto-resumo; bloqueio por módulo/permissão/tribunal | 3 a 4 dias |
| 2 | Perfil do magistrado (exige a lista de magistrados), lembrar a escolha por processo (tabela do módulo), link "abrir na Jurimetria" com filtros | 2 dias |
| 3 | Tempo aproximado pelo ano do CNJ; calculadora de provisão com premissas explícitas | a definir |

Backend + frontend: o frontend sai direto na `astrajus-radix`; a rota nova e a correção dependem de PR para `main`.

## Fase 2 (implementada)

- **Escolha guardada por processo** (`jurimetria_caso`, rota `GET/PUT/DELETE /jurimetria/caso/<id>`): vale sobre a sugestão da capa,
  campo a campo; guarda quem confirmou e quando; "Calcular" também confirma. "Voltar às sugestões da capa" apaga. Quem só consulta
  não consegue gravar: a tela avisa e segue usando os filtros naquela sessão. Processo excluído leva a escolha (limpeza na partida).
- **Cartão "Este magistrado"** (magistrado + classe, `perfil_decisorio_magistrado`): taxa de alguma procedência contra a de todos os
  juízes nos mesmos filtros (diferença em pontos percentuais). O magistrado vem da capa (nome casado com a lista do CJPG, só se for
  exato e único) ou de busca; a lista tem uma semente de 5.164 nomes em `modulos/jurimetria/dados/magistrado.json`.
- **Link "Abrir na tela de Jurimetria"**: vai com ids e datas no endereço (`#/jurimetria?vara=…&classe=…`), a tela busca os nomes em
  `GET /cjpg-arvore/nos` e pré-preenche; continua funcionando ao recarregar a página.
- Contrato dos módulos: o núcleo passou a entregar `receive` ao módulo que define `http_com_corpo(scope, receive, send, caminho)`.

## Fase 3 (implementada, só frontend)

- **Tempo até a sentença (aproximado):** o CJPG não informa a data de distribuição, só o ano no número CNJ. A idade na sentença é estimada com a
  distribuição no meio do ano do número (limitada à data da sentença) e cada tempo tem margem de cerca de 6 meses. Entram só decisões com
  desfecho identificado e número CNJ válido. Mostra mediana e faixa de 25% a 75%; havendo a data de distribuição na capa, compara com a idade
  exata do processo ("já saíram X% das sentenças com esse tempo; pela mediana faltariam Y meses"). Ressalva obrigatória na tela: a amostra só
  tem processos já sentenciados, então o tempo real tende a ser maior.
- **Exposição e provisão (estimativa):** valor × chance de alguma procedência × fator médio (procedente 100%, parcial = fator editável, padrão
  50%). Premissas à vista e editáveis: perspectiva (réu: exposição; autor: expectativa de recebimento), fonte da chance (cartão da vara, do TJSP
  ou do magistrado), valor-base (valor da causa da capa, mediana de condenação da amostra ou outro valor). A faixa vem do intervalo de 95% da
  chance. Acordos e extinções contam zero; custas, honorários de sucumbência, juros e correção ficam de fora. O rótulo "perda provável /
  possível / remota" usa 70% e 30% como referência usual (não é critério legal) e a tela diz que classificar é decisão do advogado e do contador.
- Entrada de valores em pt-BR: com vírgula, ela é o decimal; sem vírgula, ponto seguido de 3 dígitos é milhar ("12.000" = doze mil).

## Testes

- Python: resolvedor com árvores de exemplo (variantes de vara, homônimos de assunto, foro pelo CNJ, ambiguidade →
  confiança baixa); erro "Atenção" reconhecido; datas > 1 ano rejeitadas com mensagem.
- Frontend (node): montagem dos parâmetros a partir dos candidatos, texto-resumo, escolha de cartões, estados de
  amostra pequena e de classificação baixa.
- Navegador com API simulada (Playwright).

## Riscos

1. e-SAJ lento, bloqueando ou mudando o layout: já tratado no módulo; a tela mostra a mensagem e o cache.
2. Vara errada: mitigado pelo foro exato (CNJ) e pela confirmação obrigatória.
3. Cobertura de classificação baixa (item 7): mostrar "N de M classificadas" e esconder percentuais quando n < 30.
4. Leitura como previsão: o texto diz que é referência histórica de sentenças publicadas, não parecer.

## Decisões

- Escopo só de desfecho e valor, sem tempo exato nem recurso: assumido ao pedir a spec; **a confirmar**.
- Período padrão: **12 meses**, por limite do e-SAJ (a proposta de 24 meses caiu).
- Aba própria e calculadora de provisão: implementadas (a calculadora entrou na fase 3, com premissas editáveis e ressalvas); sem objeção registrada.
- Fase 1: 8 páginas (80 sentenças) por consulta, as duas em paralelo (cerca de 8 s); período fixo de 364 dias terminando hoje.
- Fase 1: o foro tem dois nós raiz com o mesmo id (a comarca, "Leme", e o foro, "Foro de Leme"); o resolvedor usa o nó "Foro ...".
- Fase 1: outra sessão acrescentou o download automático das árvores quando faltam e uma semente de magistrados
  (`modulos/jurimetria/dados/magistrado.json`), o que reduz o risco do item 1 da fase 0.
- Corrigida pela fase 0: o comentário "não espelhável" do código vale só para a árvore de magistrados; vara, classe e assunto baixam normalmente.
