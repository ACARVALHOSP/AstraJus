# Módulo Jurisprudência: de TJSP para multitribunal

Status: proposta, sem código. Origem: análise do repositório público `mcp-dir/jurisprudencia-mcp` (v0.1.0).

## O que o repositório de referência é (e não é)

- Embalagem pública (manifestos, docs, skill, MIT) de um servidor **hospedado e proprietário** (`api.mcp.ai/p_jurisprudencia`). **Sem código.**
- Cobertura: **17 tribunais** (STF, STJ, TST, TRF3, TRF4, CARF e os TJs de SP, RJ, MG, RS, PR, SC, CE, GO, MT, MS e MA). A busca é feita por **Google (Serper)** localizando páginas públicas de decisões. O próprio repositório lista o Serper como sub-processador, ou seja, o **termo pesquisado sai para um terceiro**.
- Contrato com 3 ferramentas e várias boas ideias de comportamento (abaixo). **Não integrar o serviço**: implementar no AstraJus.

## Onde o AstraJus está hoje

- `modulos/jurisprudencia/`: **uma** ferramenta (`consultar_jurisprudencia_tjsp`), ementas do **TJSP** pelo e-SAJ, com destaque dos termos, filtro de frases exatas feito no servidor e ordenação. Tela própria (`frontend/src/modulos/jurisprudencia/`), área de permissão `pesquisa`.
- Complementa com `jurimetria` (CJPG) e `perfil_decisorio_magistrado`, que a referência não tem.

## Ideias da referência que valem copiar (contrato e comportamento)

1. **Três ferramentas separadas:** buscar, buscar súmulas (incluindo vinculantes) e ler o **inteiro teor**. Hoje só há a primeira.
2. **Trecho que casou a busca**, e não a abertura do acórdão. O AstraJus já destaca termos; manter e formalizar como campo.
3. **Link para o site oficial** em todo resultado, com aviso de conferência antes de citar em petição.
4. **Campo nulo significa "a fonte não informa"**, nunca inventar relator, órgão ou número. Indicar `texto_integral_disponivel`.
5. **Zero resultado vem com motivo e sugestão** do que tentar; "fonte indisponível" e "acervo desatualizado" são avisos explícitos, não resposta vazia.
6. **Marcar o que não vincula juiz** (decisão de conselho administrativo, como o CARF).
7. **Operadores de busca** (espaço = E, "frase", OR, `-exclusão`), filtro por tipo (acórdão, súmula, OJ, tema), data e ordem (relevância/recência).

## Decisão proposta

Evoluir o módulo existente em fases, **uma fonte oficial por vez**, mantendo o contrato de saída único. Preferir **APIs e portais oficiais** a busca em Google: dá resultado mais confiável, evita sub-processador externo e atende ao posicionamento do produto.

## Fases

1. **Contrato comum.** Definir o formato de resultado (`tribunal`, `tipo`, `ementa`, `trecho`, `relator`, `orgao_julgador`, `data`, `link_oficial`, `texto_integral_disponivel`, `aviso`) e adaptar o TJSP atual a ele, sem mudar a tela. Adicionar mensagem explicativa para zero resultado e fonte indisponível.
2. **Súmulas e temas.** Ferramenta `buscar_sumulas` (STF, STJ, TST, súmulas vinculantes). O AstraJus já tem o que as páginas do SIJUR listam (súmulas/OJs do TST, temas repetitivos do STJ, repercussão geral do STF, informativos), que podem ser a **base local** com atualização controlada, em vez de busca externa.
3. **Superiores e federais.** STJ, STF, TST, TRF3 e TRF4 pelos portais oficiais; conferir, para cada um, se há API estável ou se exige coleta de página. Documentar a fragilidade de cada fonte.
4. **Outros TJs.** RJ, MG, RS, PR, SC e demais, priorizando os estados onde o escritório atua.
5. **Inteiro teor.** `ler_inteiro_teor` por registro, só quando a fonte permite; sinalizar quando não.
6. **Integração com o processo.** Pesquisa a partir da ficha (assunto/classe da capa) e **salvar precedente** no processo com o link, a ementa e uma nota.

## Integração com o que já existe

- Mesmo padrão de módulo (`manifest.json`, ferramentas MCP, `ferramentas_consulta` liberadas a perfis só de consulta, área `pesquisa`).
- Cache e circuito de proteção por tribunal, para uma fonte instável não derrubar a tela.
- A conferência de citações (já existe como conteúdo no SIJUR) pode virar recurso: colar um texto e conferir cada julgado e súmula citados.

## Riscos e pontos em aberto

- **Fragilidade das fontes:** portais de tribunais mudam de layout e bloqueiam automação. Cada tribunal novo é uma manutenção contínua, e o e-SAJ já exigiu tratamento específico (frase exata, facetas).
- **Termos de uso:** conferir o que cada portal permite antes de coletar.
- **Escopo:** 17 tribunais é uma meta de longo prazo. Começar pelos que o escritório usa.
- **Decidir:** vale cobrir fora do TJSP por coleta própria, ou aceitar conectar o MCP hospedado como complemento opcional, avisando que o termo pesquisado sai para terceiros? (Recomendação: coleta própria, MCP externo só se o usuário ligar.)

## Ordem sugerida

1. Contrato comum + mensagens de zero resultado (Fase 1).
2. Súmulas locais (Fase 2), que dão ganho imediato sem depender de coleta.
3. STJ e STF, depois TRF3/TRF4 e TST.
