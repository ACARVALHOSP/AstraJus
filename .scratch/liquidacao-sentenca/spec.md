# Módulo Calculadoras: liquidação de sentença

Status: proposta, sem código. Origem: análise do repositório público `mcp-dir/liquidacao-de-sentenca-mcp` (v0.1.0) e das tabelas de prazos e ferramentas do SIJUR.

## O que o repositório de referência é (e não é)

- É só a **embalagem pública** de um servidor MCP hospedado e **proprietário** (`api.mcp.ai/p_liquidacao-de-sentenca`): manifestos, docs e skill sob MIT. **Não há código nem fórmulas** para reaproveitar.
- Serve como **especificação de produto**: 16 ferramentas de cálculo, entradas e nomes de parâmetros bem definidos (`docs/ferramentas.md`).
- Gratuito, sem login, e os valores do cálculo passam por um terceiro. Isso conflita com o posicionamento do AstraJus (dados do escritório sob controle dele, LGPD): **não integrar o serviço, implementar nativamente**.

## Decisão proposta

Implementar os cálculos **no próprio AstraJus**, como módulo plugável (`modulos/calculadoras/`), com ferramenta MCP + tela, reaproveitando as regras e os testes do SIJUR (conteúdo do próprio dono). Do repositório de referência, copiar apenas a **lista de funções e os contratos de entrada** como roteiro.

## Mapa das 16 ferramentas de referência

| Ferramenta de referência | No AstraJus hoje | Proposta |
|---|---|---|
| `calculo_atualizar` (parcelas + índice + juros + multa + honorários) | não existe | **Fase 1** (núcleo do módulo) |
| `calculo_indice` (fator acumulado entre datas) | não existe | **Fase 1** (base de tudo) |
| `calculo_salario_minimo` | não existe | Fase 1 (tabela simples) |
| `calculo_aluguel` (atraso, Lei 8.245/91) | não existe | Fase 2 |
| `calculo_pensao` (alimentos em atraso) | não existe | Fase 2 |
| `calculo_trabalhista` (rescisão) | não existe | Fase 2 |
| `calculo_fgts` (tese TR → INPC/IPCA-E) | não existe | Fase 3 |
| `calculo_rmi`, `calculo_tempo_contribuicao`, `calculo_rmc_rcc`, `calculo_restituicao_inss` | não existe | Fase 3 (previdenciário) |
| `calculo_revisional`, `calculo_superendividamento` | não existe | Fase 3 (bancário) |
| `calculo_dosimetria`, `calculo_progressao` | não existe | Fase 4 (penal) |
| `calculo_partilha` | não existe | Fase 4 (família) |

Os cálculos de prazo e o contador de dias úteis **já existem** (calculadora de prazos) e não entram aqui.

## Princípios

1. **Determinístico e reproduzível.** Sem IA no cálculo. Mesma entrada, mesmo resultado, com a **memória de cálculo** (linha a linha) para conferir e anexar.
2. **Índices de fonte oficial, com cache e rastro.** Cada resultado grava índice, série, mês inicial/final usados e a data da consulta.
3. **Sugestão a ser revisada**, como nos prazos: o memorial sempre diz que o advogado confere antes de protocolar.
4. **Falha explícita.** Índice indisponível ou mês ainda não divulgado vira aviso, nunca um valor silencioso.
5. **Sem dado pessoal na consulta externa.** Só séries públicas; nada do processo sai do servidor.

## Fase 1: núcleo de atualização (entrega mínima útil)

- Entrada: lista de **parcelas** (valor, data de vencimento), **abatimentos/pagamentos** (valor, data), índice (IPCA, INPC, IGP-M, SELIC, TR, IPCA-E), data do cálculo, juros (taxa, simples/compostos, periodicidade, `pro_rata`), multa (com opção de incidir sobre os juros) e honorários (percentual ou valor).
- Convenção do índice: **mês inicial excluído, mês final incluído** (BACEN/IBGE), conforme a referência.
- Saída: total corrigido, juros, multa, honorários, total final e **memorial** por parcela.
- Fonte dos índices: séries públicas do **BACEN (SGS)** e do **IBGE (SIDRA)**; guardar em tabela própria (`indices_economicos`) com atualização periódica, em vez de consultar a cada cálculo. Conferir os códigos das séries antes de codificar.
- Exportação do memorial em **PDF/CSV**, com cabeçalho do escritório (depende do "Perfil do escritório" do TODO).
- Entradas pelo processo: botão "Calcular" na ficha do processo e em lançamentos financeiros (honorários e custas), pré-preenchendo data e valores.

## Integração com o que já existe

- **Módulo plugável:** `manifest.json` com `ferramentas` (viram ferramentas MCP, abrindo o Claude Desktop para "atualize esta condenação"), `ferramentas_consulta` (liberadas a perfis só de consulta, já que não alteram dados), `tabelas` e `aba` no grupo `pesquisa` ou `trabalho`.
- **Financeiro:** gerar lançamento (honorário/êxito) a partir do resultado, com confirmação.
- **Proteção de falhas:** reaproveitar o circuito de proteção e o `/healthz` para as séries externas.
- **SIJUR:** portar as regras e os casos de teste das calculadoras que já existem lá (correção monetária, juros de mora, multa do art. 523, honorários, art. 477, rescisão, férias, 13º, FGTS), com os mesmos exemplos como testes de regressão.

## Riscos e pontos em aberto

- **Divergência de metodologia** entre tribunais (IPCA-E × SELIC, EC 113/2021 na Fazenda, TR no FGTS). O módulo deve nomear a regra aplicada em cada cálculo e deixar o índice escolhido pelo advogado; não adivinhar.
- **Responsabilidade:** cálculo errado em petição tem consequência. Testes com casos oficiais (tabelas de tribunais, calculadora do Banco Central) antes de liberar.
- **Código do SIJUR:** confirmar onde está e se reaproveita direto (linguagem e licença são do mesmo dono) ou se reescreve em Python.
- Decidir se as fases 3 e 4 (previdenciário, bancário, penal) pertencem ao AstraJus ou ficam só no SIJUR.

## Ordem sugerida

1. Tabela de índices + `calculo_indice` + testes contra séries oficiais.
2. `calculo_atualizar` com memorial e tela.
3. Botão na ficha do processo e no Financeiro.
4. Fase 2 (aluguel, pensão, rescisão), uma ferramenta por vez.
