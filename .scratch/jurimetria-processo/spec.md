# Jurimetria na ficha do processo

Status: fase 0 concluída (13/11/2026); fase 1 não iniciada.

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
- Em aberto: posição (aba própria, recomendada) e a calculadora de provisão (fase 3).
- Corrigida pela fase 0: o comentário "não espelhável" do código vale só para a árvore de magistrados; vara, classe e assunto baixam normalmente.
