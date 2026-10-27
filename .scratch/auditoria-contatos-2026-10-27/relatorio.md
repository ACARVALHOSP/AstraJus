# Auditoria da aba Contatos / Clientes

Data: 27/10/2026. Status: direção aprovada pelo usuário em “seguir plano de ação”; correções implementadas e verificadas conforme atualização ao final.

## Diagnóstico

A aba identificada internamente como Contatos aparece para o usuário como **Clientes**. A tarefa principal presumida é localizar um cliente, conferir seu cadastro e acessar processos vinculados ou financeiro. Público presumido: equipe do escritório em aplicação web.

A maior oportunidade é tornar a lista uma referência confiável: filtros previsíveis, colunas informativas e controles que correspondam a ações disponíveis. Não foi constatada perda de dados nem bloqueio crítico. Os problemas abaixo são achados de inspeção de código, não resultados de pesquisa com usuários.

## Escopo e método

Inspecionados `static/app.html`, especialmente linhas 1378–1533, e `static/app.js`, especialmente funções `linhaContato`, `tabelaContatos`, `_contatosFiltrados`, `renderizarListaContatos`, `_construirBarraAZ`, `abrirContato`, `voltarParaContatos`, `_selecionarSubabaContato` e `_configurarAbasCadastro`. Foi considerada a árvore de trabalho atual, que já contém modificações anteriores à auditoria.

Aplicadas as skills Carbon Builder, UI/UX Pro Max e gtd-ui-ux-audit. Consultadas as guidelines Carbon pelo conector oficial, a base local UI/UX Pro Max com a consulta `filter empty results recovery` (resultados pertinentes: Empty States, Error Recovery e No Results), a visão oficial GTD e WCAG 2.2.

O `code_audit` Carbon avaliou somente o trecho HTML 1385–1391 da barra de consulta: `valid=true`, zero ocorrências, análise por regex. Esse resultado não certifica a tela, o JavaScript, o contraste ou conformidade WCAG. Não houve teste interativo da aplicação, gravação em servidor, teste com usuários, leitor de tela ou medição de desempenho. O mockup é uma proposta visual estática independente.

## Pontos fortes

| Evidência | Benefício | Preservar |
| --- | --- | --- |
| `app.html:1381–1383`: título Clientes e Novo cliente | Identifica a tarefa e a entrada do cadastro | Uma ação primária clara |
| `app.js:2440–2459`: cadastro abre com foco em Nome | Facilita iniciar a entrada de dados | Foco inicial e cadastro por etapas |
| `app.html:1428–1429`: Nome com label e required | Campo essencial tem identificação semântica | Rótulos persistentes |
| `app.js:2490` e salvamento em torno de 3910 | Há proteção de saída e feedback de salvamento no código | Confirmar o comportamento com testes |
| `app.js:2340–2350`: confirmação antes de excluir | Explica irreversibilidade antes da operação | Confirmação proporcional ao impacto |
| `app.html:1399–1401`: Cadastro, Processos vinculados e Financeiro | Agrupa dados segundo tarefas distintas | Organização por contexto |

## Melhorias priorizadas

Severidade mede impacto; confiança mede a evidência; esforço é relativo. Frequência de uso e prevalência dos problemas são desconhecidas. Todos os graus refletem inspeção e devem ser revisados após teste real.

| ID | Problema | Grau | Impacto e alternativa | Confiança | Esforço |
| --- | --- | --- | --- | --- | --- |
| C01 | Seleção de linhas sem finalidade implementada | S2 | Sugere trabalho em lote indisponível; abrir cliente individualmente é alternativa | Alta no código | Pequeno para remover |
| C02 | Filtros de letra e texto se acumulam, sem recuperação explícita | S2 | Cliente existente pode parecer ausente; selecionar TODOS recupera | Alta no código | Pequeno |
| C03 | Comparação literal de acentos e formatos | S2 | Localização por nome/telefone pode falhar; digitar formato exato recupera | Alta no código | Médio |
| C04 | Abas internas com tabulação restrita e sem setas nos handlers locais | S2 provisório | Pode dificultar acesso por teclado; mouse é alternativa apenas para quem pode usá-lo | Média | Médio |
| C05 | Coluna Tipo não reflete pessoa física/jurídica | S2 | Informação não permite distinguir registros; abrir cadastro recupera | Alta no código | Pequeno |
| C06 | Coluna Etiquetas sempre vazia | S1 | Ocupa espaço sem apoiar decisão | Alta no código | Pequeno |
| C07 | Telefone/e-mail são texto sem ação direta | S1 | Exige copiar dados para iniciar contato | Alta no código | Pequeno |
| C08 | Retorno à lista sem restauração explícita de foco | S2 provisório | Pode perder posição após editar; reencontrar item é alternativa | Média | Médio |

## Evidências, recomendações e aceites

### C01 — Seleção sem ação

`linhaContato` cria checkbox com nome acessível, mas não registra seleção nem conecta ação; `tabelaContatos` tem cabeçalho inicial vazio. Re-renderizar a lista recria os controles. Carbon relaciona seleção a ações individuais ou em lote; GTD/engajar exige que a escolha conduza a uma ação compreensível.

Recomendação: remover a coluna de seleção até existir uma necessidade de lote definida. Não implementar exclusão em lote apenas para justificar o controle. Aceite: nenhuma seleção sem consequência aparece; caso se opte por lote no futuro, seleção, quantidade, cancelamento e ação devem funcionar e ser anunciados. Esforço pequeno pressupõe remoção, sem nova API.

### C02 — Interseção pouco explícita e vazio sem recuperação

`_contatosFiltrados` aplica letra e texto com AND. O handler de `contatos-busca` só retorna a TODOS quando o texto fica vazio. `renderizarListaContatos` mostra uma mensagem genérica e retorna, sem controle de limpar filtros no estado vazio. Reprodução proposta: selecionar B e digitar um cliente iniciado por A. Resultado previsto pelo código: zero resultados.

Recomendação: tornar a combinação visível e oferecer Limpar filtros junto ao resultado e no vazio; preservar um modelo consistente para letra e texto. Aceite: o exemplo acima identifica os dois filtros e Limpar filtros restaura todos os clientes com uma ação. Carbon Empty States e UI/UX Pro Max sustentam mensagem com caminho de recuperação. GTD/organizar: recuperar referência sem memorizar filtros anteriores.

### C03 — Nomes e telefones exigem correspondência literal

`_contatosFiltrados` apenas converte texto para minúsculas; letra inicial usa `toUpperCase()`. Assim, no código, `Álvaro` não pertence ao filtro A e `alvaro` não encontra `Álvaro`. Telefones com pontuação não correspondem necessariamente à entrada só com dígitos. A barra só oferece A–Z, sem grupo para outras iniciais.

Recomendação: normalizar diacríticos na consulta e na inicial; normalizar dígitos para telefone sem alterar a apresentação; definir tratamento para outras iniciais. Aceite: Álvaro aparece em A e em `alvaro`; um telefone formatado é encontrado com e sem pontuação; nomes fora de A–Z continuam recuperáveis em TODOS. Esforço médio inclui casos internacionais e testes de regressão relevantes.

### C04 — Navegação por teclado nas abas internas

`_selecionarSubabaContato` e `_selecionarAbaCadastro` aplicam `tabIndex=-1` às abas inativas; os listeners locais encontrados respondem a click. O handler de setas em torno de `app.js:6009` pertence ao switcher de Processos, não ao cadastro do cliente. Isso indica risco de navegação incompleta, ainda sem reprodução em navegador.

Recomendação: implementar o padrão de teclado das abas com setas, Home/End, foco e ativação coerentes; verificar se algum handler transversal já cobre esses grupos. Aceite: usuário entra pelo Tab, alcança todas as abas com setas, identifica a selecionada e chega ao painel ativo sem mouse. Verificar WCAG 2.1.1 Keyboard (A); não declarar violação definitiva antes do teste. Não classificado como S4 porque não foi demonstrado bloqueio sem alternativa.

### C05 — Tipo não é dado real

`linhaContato` renderiza `_iconePessoa()` para toda linha; o SVG é decorativo (`aria-hidden=true`). Já o formulário distingue `tipo_pessoa`. A coluna não comunica o tipo ao usuário, inclusive por texto acessível.

Recomendação: mostrar Pessoa física/Pessoa jurídica com base no valor real ou remover a coluna. Aceite: dois registros de tipos diferentes exibem informação correta e legível por tecnologia assistiva; valores ausentes não são inventados.

### C06 — Etiquetas vazias

`linhaContato` acrescenta a célula de Etiquetas sem conteúdo para cada cliente. Não foi demonstrado um fluxo de edição de etiquetas nesta aba.

Recomendação: retirar da lista até haver dados e tarefa definidos. Aceite: toda coluna visível apoia uma informação ou ação disponível. O mockup remove a coluna; não propõe construir um sistema de etiquetas.

### C07 — Canais sem ação direta

`linhaContato` apresenta telefone e e-mail em `span`. Recomendação: usar links `tel:` e `mailto:` quando houver dados válidos, preservando nome acessível e apresentação. Aceite: teclado ativa o aplicativo configurado; ausência de canal continua explícita; valores inválidos não geram links quebrados. Depende da configuração do dispositivo, sem prometer envio dentro do painel. GTD/engajar: reduzir passos entre reconhecer e agir.

### C08 — Continuidade do foco

`voltarParaContatos` alterna `hidden` e reconstrói a lista, sem foco explícito no cliente de origem. `abrirContato` também não estabelece foco de destino após o carregamento. Risco inferido: foco permanecer em região escondida ou cair em posição inesperada.

Recomendação: registrar o acionador, focar título/destino apropriado ao abrir e restaurar o acionador ao voltar; usar fallback no título da lista se o registro foi removido. Aceite: abrir, editar e voltar preserva uma posição previsível; excluir não tenta focar elemento removido. Validar por teclado e árvore de acessibilidade antes de confirmar severidade.

## Guidelines para a proposta

| Área | Diretriz aplicável | Aplicação |
| --- | --- | --- |
| Carbon Data table | Toolbar reúne consulta, filtros e ação primária | Aproximar controles da tabela; manter uma única ação Novo cliente |
| Carbon Data table | Altura da toolbar acompanha a das linhas | Adotar tamanho coerente na implementação futura |
| Carbon seleção | Seleção serve a uma ação real | Retirar checkboxes sem função |
| Carbon Empty States | Explicar ausência de dados e oferecer próximo passo | Distinguir lista inicial de nenhum resultado; permitir limpar filtros |
| UI/UX Pro Max | Empty States, Error Recovery, No Results | Mensagens específicas e recuperação acionável |
| Hierarquia | Priorizar nome e canais; dados secundários só quando úteis | Retirar coluna vazia e mostrar tipo por texto |
| Acessibilidade | Nome acessível, foco, teclado e feedback | Rótulo visível de consulta; revisar anúncio de quantidade e vazios com leitor de tela |
| Conteúdo | Usar o vocabulário visível existente | Manter Clientes; Contatos permanece identificação técnica |

O mockup separado é HTML sem imports Carbon, uma representação da direção proposta, não uma migração de componentes nem certificado de conformidade. A adoção de componentes reais, tokens, grid e responsividade exige verificação específica após aprovação. Não se propõe alterar a arquitetura do frontend nesta auditoria.

## Cobertura GTD e UI/UX

GTD possui cinco etapas: capturar, esclarecer, organizar, refletir e engajar. Sua aplicação abaixo é uma adaptação de design, não exigência oficial de certificação.

- Capturar: cadastro permite começar pelo nome e usa campos agrupados; recuperação de rascunho e persistência não testadas.
- Esclarecer: objetivo da aba e ação principal claros no markup; seleção e tipo enfraquecem significado dos controles.
- Organizar: consulta e A–Z ajudam recuperar referência, com limites de normalização e composição de filtros.
- Refletir: cadastro, processos e financeiro apoiam conferência contextual. Revisão semanal, inbox, energia e algum dia/talvez não se aplicam à lista de clientes e não são recomendados aqui.
- Engajar: abrir e editar existem; iniciar contato exige cópia; ações de lote não estão implementadas.
- UI/UX: semântica, conteúdo, estrutura e estados foram inspecionados. Contraste renderizado, zoom, 320/390 px, leitores de tela, teclado real, latência, volume de dados, erros do servidor e persistência permanecem não verificados.

## Plano de ação

1. Agora: revisar relatório e mockup; reproduzir C02/C03 com dados fictícios e C04/C08 por teclado antes de implementar.
2. Após aprovação visual: remover controles sem função, explicitar filtros e estado vazio, exibir tipo real e canais acionáveis. Manter alterações anteriores da árvore de trabalho.
3. Depois: testar cadastro com sucesso, falha de gravação e saída com edição; verificar filtro + retorno ao item, leitor de tela, zoom e mobile. Só então decidir paginação/virtualização com volume e desempenho medidos.

## Validação e fontes

Realizados: inspeção de código atual, consulta de guidelines Carbon e busca local UI/UX Pro Max; auditoria automática limitada da barra sem ocorrências. Testes propostos nos aceites ainda não executados. Não há nota global ou declaração de conformidade.

- [Carbon Data table — guidelines](https://carbondesignsystem.com/building-blocks/core/components/data-table/guidelines/): variantes com seleção, toolbar e consistência de alturas.
- [Carbon Empty States](https://carbondesignsystem.com/building-blocks/core/patterns/empty-states/): contexto de ausência de conteúdo e recuperação.
- [David Allen Company — What is GTD](https://gettingthingsdone.com/what-is-gtd/): fundamento das cinco etapas.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/): referência normativa para validação posterior.

Na entrega inicial, o frontend foi preservado. A exigência de aprovação visual vem de `AGENTS.md`, seção Carbon Builder: “apresentar um mockup e obter autorização explícita do usuário antes de alterar o frontend”. A instrução posterior “seguir plano de ação” autorizou a execução das correções da proposta.

## Atualização após implementação

- C01/C06: retiradas seleção sem ação e coluna Etiquetas vazia.
- C02: resumo persistente com quantidade e filtros ativos; botão Limpar filtros disponível também quando não há resultados. Remover texto não altera silenciosamente o filtro de letra. Região `role=status` informa as atualizações sem reconstruir a própria região.
- C03: normalização de acentos e comparação de telefone por dígitos, preservando apresentação; nomes fora de A–Z continuam em TODOS.
- **C04 corrigido no diagnóstico:** o handler compartilhado ao final de `app.js` já cobre `.sub-tabs` e `.cadastro-tabs`. O risco apontado pela inspeção parcial não se confirmou. Teste real confirmou setas, Home e End; foi preservado o handler existente, sem duplicação. Adicionado destino de tabulação ao painel de processos vinculados.
- C05: tipo exibido por texto com base em `tipo_pessoa`; ausência de valor aparece como Não informado.
- C07: links `tel:` e `mailto:` para valores aceitos; conteúdo inválido permanece texto. Não foi testada a abertura de aplicativos externos no sistema operacional.
- C08: detalhe recebe foco no título; retorno reconstrói lista e restaura foco no mesmo cliente, com fallback no título da lista.
- Rótulo visível de consulta, cabeçalhos com `scope=col` e larguras ajustadas. Inspeção visual encontrou quebra no texto de Excluir em desktop; padding foi ajustado por classe própria.

### Evidências e resultados

Seis testes de navegador passaram com APIs interceptadas, sem token ou persistência real:

1. Filtros combinados, acentos, telefone, recuperação e colunas/canais.
2. Teclado das abas internas e retorno de foco ao cliente.
3. Proteção de edição e descarte restaurando campos repetíveis (regressão existente).
4. Financeiro do cliente, totais, isolamento e estados (regressão existente).
5. Falha simulada ao salvar preserva dados; tentativa seguinte salva e retorna com foco ao cliente.
6. Cadastro responsivo em 1440, 768, 390 e 320 px, incluindo ações e teclado (regressão existente).

O script `capturar.py` gerou evidências da lista com dados fictícios e verificou ausência de rolagem horizontal da página em 1440, 768, 390 e 320 px. Capturas em `output/playwright/auditoria-contatos-2026-10-27/`. As imagens desktop e 390 px foram inspecionadas. Verificações de lógica de filtros/canais em Node, sintaxe JavaScript, compilação do arquivo de teste Python e `git diff --check` restrito aos arquivos alterados passaram.

A auditoria Carbon do trecho atualizado retornou um aviso de “Validate required props”: recomendou kind/size para o botão HTML nativo. Esses atributos pertencem ao componente Web Component, não ao botão nativo estilizado já usado pelo projeto; não foram acrescentados atributos sem efeito. A análise por regex não demonstra problema funcional nem conformidade geral.

Ambiente: o Chrome atual não aceita o modo headless antigo da versão instalada de Playwright. Os testes passaram usando o Chromium 1134 já instalado, sem instalar dependências. A execução precisou ocorrer fora do sandbox para iniciar o navegador.

Limites restantes: leitor de tela real, contraste instrumental, zoom do navegador, integração com aplicativos externos, produção e persistência real não foram verificados. Não há declaração de conformidade integral WCAG. As alterações anteriores do repositório foram mantidas; não houve publicação ou deploy.
