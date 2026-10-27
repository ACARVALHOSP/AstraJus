# Especificação Técnica de Design: Data Table (Carbon Design System)

## 1. Visão Geral
O componente **Data Table** é utilizado para organizar e exibir conjuntos de dados de forma eficiente. Ele permite que os usuários naveguem, organizem e realizem ações em grandes volumes de recursos ou informações estruturadas.

### 1.1 Quando usar
*   Para organizar, comparar e exibir dados brutos.
*   Quando o usuário precisa localizar uma informação específica para concluir uma tarefa.
*   Para exibir a lista completa de recursos de um usuário.

### 1.2 Quando não usar
*   Quando interações complexas de planilhas eletrônicas (como Excel) forem necessárias.
*   Para dados puramente editoriais que se adaptariam melhor a listas estruturadas (*Structured Lists*) ou texto corrido.

---

## 2. Anatomia do Componente

1.  **Título e Descrição (Title and description):** Identifica o contexto dos dados e o propósito da tabela.
2.  **Barra de Ferramentas (Table toolbar):** Abriga controles globais como busca, filtros e botões de ação primária.
3.  **Cabeçalho da Coluna (Column header):** Título da coluna com suporte opcional a ordenação (*sorting*).
4.  **Linha da Tabela (Table row):** Contêiner dos dados. Pode ser configurado como selecionável, expansível ou receber cores alternadas (*zebra stripes*).
5.  **Barra de Paginação (Pagination table bar):** Componente opcional inferior para segmentar grandes volumes de dados em páginas.

---

## 3. Diretrizes de Sizing (Densidade e Alturas)

As alturas do cabeçalho (`thead`) e das linhas (`tbody`) estão disponíveis em **cinco tamanhos**. Para manter a harmonia visual, a linha do cabeçalho **deve sempre corresponder ao tamanho escolhido para as linhas da tabela** (nunca misture tamanhos).

| Tamanho | Altura (px / rem) | Caso de Uso Recomendado |
| :--- | :--- | :--- |
| **Extra Small (xs)** | `24px / 1.5rem` | Layouts de altíssima densidade onde maximizar a informação visual é prioridade absoluta. |
| **Small (sm)** | `32px / 2rem` | Interfaces compactas que exigem redução de altura, mantendo boa leitura e interação. |
| **Medium (md)** | `40px / 2.5rem` | **Padrão (Default).** Tamanho mais comum, utilizado quando não há restrições estritas de espaço. |
| **Large (lg)** | `48px / 3rem` | Layouts mais espaçosos que demandam maior ênfase visual e facilidade de clique. |
| **Extra Large (xl)** | `64px / 4rem` | Indicado para suportar linhas de dados que contêm até duas linhas de texto corrido. |

### 3.1 Acoplamento de Subcomponentes (Toolbar, Batch Actions e Pagination)
Para manter o alinhamento visual, a altura dos componentes periféricos deve acompanhar o tamanho da tabela, seguindo as regras de acoplamento abaixo:

*   **Tabelas XS e SM:** Devem utilizar obrigatoriamente a **Small Toolbar**.
*   **Tabelas MD e LG:** Devem utilizar a **Tall Toolbar**.
*   **Tabela XL (Caso Especial):** A barra de ações em lote (*Batch Action Bar*) e a paginação devem utilizar o tamanho **Large** (e não Extra Large).

---

## 4. Variantes e Comportamentos Universais

### 4.1 Ordenação (Sorting)
*   As colunas podem ser ordenadas em ordem ascendente ou descendente.
*   A tabela possui três estados de ordenação: **Não ordenado** (ícones de setas visíveis apenas em *hover*), **Ordenado para cima** (`arrow--up`) ou **Ordenado para baixo** (`arrow--down`).

### 4.2 Seleção de Linhas (Selectable)
*   **Multi-select (Checkbox):** Permite selecionar várias linhas simultaneamente. O checkbox do cabeçalho possui três estados: marcado, desmarcado e indeterminado (quando apenas algumas linhas estão selecionadas).
*   **Single-select (Radio Button):** Limita o usuário a selecionar apenas uma linha por vez. É posicionado estritamente na primeira coluna à esquerda.

### 4.3 Expansão de Linhas (Expandable)
*   Utilizado para revelar informações complementares sem tirar o usuário do contexto.
*   Se a tabela for simultaneamente **expansível e selecionável**, o ícone de expansão (chevron) deve se posicionar obrigatoriamente **à esquerda** do checkbox/radio button de seleção.

### 4.4 Modos de Ação (Actions)
*   **Ações em Lote (Batch Actions):** Ativado assim que uma ou mais linhas são selecionadas. A *Batch Action Bar* sobrepõe temporariamente a barra de ferramentas padrão. Enquanto ativa, as ações individuais das linhas (menus flutuantes) devem ser desativadas.
*   **Ações Inline:** Funções específicas de uma única linha executadas via botões de ícone ou por um menu de transbordo (*Overflow Menu*) posicionado na extremidade direita. Se houver menos de 3 ações disponíveis, use botões de ícone diretos em vez de ocultá-los em um menu.

---

## 5. Diretrizes de Conteúdo e UX Writing

*   **Capitalização:** O título da tabela, as descrições de suporte e os cabeçalhos das colunas devem utilizar obrigatoriamente **capitalização de frase (sentence-case)**.
*   **Tamanho dos Títulos de Coluna:** Devem ser concisos, preferencialmente contendo **uma ou duas palavras**. Em casos de títulos longos que estourem o espaço, o texto deve quebrar em até duas linhas e depois ser truncado com reticências (`...`), exibindo o termo completo via *tooltip* em *hover*.
*   **Pontuação:** Títulos e cabeçalhos de colunas não recebem ponto final.

---

## 6. Alinhamento no Grid 2x

A Data Table deve ser posicionada na área de conteúdo principal da página. Ela suporta os três modos de calha (*gutters*) do Grid 2x:
*   **Wide Gutter Mode:** Modo padrão. Oferece o maior espaçamento e respiro entre a tabela e os outros elementos da interface.
*   **Narrow Gutter Mode:** A tabela avança ligeiramente sobre a calha, criando um alinhamento tipográfico perfeito entre o título da tabela e os outros textos estruturados da página.
*   **Condensed Gutter Mode:** Utilizado em layouts densos. Recomenda-se aplicar cores de fundo distintas ou um grid híbrido para evitar que as bordas da tabela se fundam com outros componentes adjacentes.

---

## 7. Presença de Inteligência Artificial (AI Presence)

Quando dados gerados por IA estão contidos na tabela, o componente deve receber a estilização visual e os componentes de IA do Carbon:
*   **Tabela Inteira por IA:** Quando todos os dados são sintéticos, a tabela inteira recebe uma borda com gradiente e um elemento visual identificador.
*   **Células Individuais:** Se apenas pontos específicos de dados forem gerados por IA, insere-se um componente inline **AI Label** diretamente ao lado do texto da célula, sem aplicar estilização de borda na linha inteira.
*   **Linhas ou Colunas Específicas:** Apenas as linhas ou colunas afetadas recebem a camada visual de IA e o respectivo *AI Label* indicativo.

---

## 8. Checklist para Design QA e Code Review

- [ ] O tamanho das linhas (`tr`) e do cabeçalho (`thead`) está idêntico por toda a extensão do componente?
- [ ] O título da tabela e os cabeçalhos das colunas estão escritos em *sentence-case* (letras minúsculas, exceto a primeira letra e siglas)?
- [ ] Em tabelas expansíveis e selecionáveis, o chevron de expansão está posicionado antes (à esquerda) do controle de seleção?
- [ ] Se a tabela possuir menos de 3 ações por linha, elas estão expostas como botões de ícone inline em vez de estarem ocultas em um *Overflow Menu*?
- [ ] Os subcomponentes de Toolbar, Paginação e Batch Actions estão com tamanhos acoplados corretamente de acordo com a densidade da tabela?
- [ ] Quando a tabela entra em modo *Batch Action*, as interações individuais de linha são congeladas/desativadas?
