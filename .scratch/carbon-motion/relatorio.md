# Oportunidades de animação no frontend

Data: 25/10/2026. Escopo: registrar a referência recebida e analisar oportunidades; nenhuma alteração no frontend.

## Referência e método

`spec.md` é uma cópia integral do documento fornecido em Downloads. SHA-256: `A95EDBB995F90342C92284794A6BC58B4A4E38703A46060EB73EDD9A8D1DF927`.

Os exemplos de instalação, código e checklist do documento são material de referência, não comandos autorizados pelo pedido. Não foram instaladas bibliotecas nem aplicados estilos.

Inspeção estática de `static/app.html` e `static/app.js` no snapshot publicado `650f42c81bf3543b1d32d3c3ead6a681f505e114`, consultado em `output/f01-storage-prazo`. Esses arquivos foram comparados com `origin/main`, sem diferenças. As alterações locais do diretório principal foram preservadas. Frequências abaixo são estimativas de uso, não telemetria. A percepção e eventuais transições herdadas dos componentes precisam de confirmação no navegador antes de implementar.

## Movimento existente

- Busca e notificações do cabeçalho: entrada com opacidade e transformação, 150 ms (`app.html:116–137`).
- Sugestões de cliente e menu de combinação: entrada com opacidade e transformação, 110 ms (`app.html:178–181`, `336–340`).
- Indicador de espera: rotação linear de 800 ms, interrompida com movimento reduzido (`app.html:369–375`).
- Setas de ajuda: estados de rotação definidos; nenhuma transição local explícita (`app.html:249–250`).
- Os tooltips personalizados usam popover manual; a regra local não declara transição (`app.html:660`, `app.js:4562–4577`, `4646–4661`).

Não sobrepor animações próprias às transições internas dos Web Components Carbon. A ausência de uma declaração local não prova ausência de movimento herdado.

## Oportunidades

As propostas usam movimento produtivo, sem escalonar dados. Todas exigem estado final imediato quando `prefers-reduced-motion: reduce`. Ações iniciadas por teclado também permanecem imediatas. Não atrasar foco, mensagens acessíveis, comandos ou confirmação de operações para aguardar animação.

| ID | Local / comportamento atual | Propósito | Frequência estimada | Proposta exata e limite funcional |
| --- | --- | --- | --- | --- |
| AN01 | `app.js:300–314`, `mostrarToast`: inserção e remoção diretas de notificações | Feedback e suavizar aparecimento abrupto | Ocasional; se houver rajadas, apresentar imediatamente | Entrada apenas `opacity: 0 → 1`, 150 ms, `cubic-bezier(0,0,.38,.9)`; saída automática `opacity: 1 → 0`, 110 ms, `cubic-bezier(.2,0,1,.9)`. Sem deslocamento da pilha. Fechamento explícito e erro urgente imediatos. Manter anúncio, duração de leitura e interação disponíveis desde a inserção. Confirmar primeiro que não há transição herdada. |
| AN02 | `app.html:249–250`, ajuda de publicações: seta alterna entre −90° e 0° | Indicação de estado | Ocasional, leitura de ajuda | Somente seta: `transform: rotate(-90deg) ↔ rotate(0deg)`, 150 ms, `cubic-bezier(.2,0,.38,.9)`. Texto e altura abrem imediatamente. Validar estilo computado antes de adicionar: se Carbon já animar a seta, reutilizar. Não alterar a semântica nativa de `details/summary`. |
| AN03 | `app.html:660`, `app.js:4562` e `4646`: tooltips personalizados de texto truncado | Suavizar aparecimento sem mover o texto consultado | Dezenas/dia; limite estrito para evitar lentidão | Apenas entrada por ponteiro: `opacity: 0 → 1`, 70 ms, `cubic-bezier(0,0,.38,.9)`; saída imediata. Aplicar exclusivamente em `(hover: hover) and (pointer: fine)`. Foco, Escape e leitores de tela imediatos; sem espera de hover e sem transformar posição. Os 70 ms seguem o token curto do anexo, deliberadamente abaixo do orçamento genérico da skill pela frequência. |

As três propostas cabem abaixo de 300 ms e não movimentam dados em leitura. AN01 tem maior benefício provável; AN02 e AN03 são refinamentos de baixa prioridade, sujeitos à confirmação visual. Não há justificativa para movimento expressivo, elasticidade ou celebração neste fluxo.

## Candidatos rejeitados

| Local | Proposta descartada | Critério que impede |
| --- | --- | --- |
| Busca do cabeçalho (`app.html:116`) | Acrescentar animação de abertura/fechamento | Frequência e uso por teclado; já existe movimento. |
| Tabela de publicações e barra de lote (`app.html:346`) | Escalonar linhas, mover seleção ou animar troca da barra | Função: leitura densa, ações repetidas e estabilidade das linhas. |
| Formulário inline (`app.js:4343`) | Animar expansão da altura ou deslizar formulário | Função e teclado: o campo recebe foco após renderização; movimento pode deslocar a linha de trabalho. |
| Resultados, prazos e contadores | Contagem progressiva ou entrada em cascata | Função: valores devem estar completos e disponíveis imediatamente. |
| Botões e navegação principais | Escala em todo clique, transição de página ou efeito decorativo | Frequência: controles de trabalho diário; preservar feedback Carbon existente. |

## Ajustes necessários na interpretação da spec

1. **Curvas:** o anexo usa `.4,0,1,1` e `0,0,.2,1` como referências de entrada/saída. Para Carbon produtivo, adotar entrada `(0,0,.38,.9)`, saída `(.2,0,1,.9)` e padrão `(.2,0,.38,.9)`. O projeto já usa a curva de entrada correta. Fonte: [Carbon Motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview).
2. **Tokens:** reutilizar `--cds-duration-fast-02: 110ms`, `--cds-duration-moderate-01: 150ms` e `--cds-ease-entrance` existentes. Se necessário, centralizar duração de 70 ms e curvas padrão/saída na mesma camada, sem um segundo sistema paralelo. Imports e mapas apresentados no anexo precisam ser conferidos na versão realmente usada; não adicionar React, Framer Motion ou pacote de motion ao frontend vanilla apenas por causa dos exemplos. Fonte de API: [Carbon Motion — código](https://www.carbondesignsystem.com/building-blocks/foundations/motion/code).
3. **Movimento reduzido:** o anexo exige duração zero. Hoje a aplicação limita algumas transições à opacidade, mas mantém sua duração (`app.html:372–376`). Registrar como lacuna de alinhamento com a referência recebida: uma implementação futura deve eliminar também essas transições e garantir o estado final. O critério WCAG 2.3.3 é **AAA**, não AA; a decisão mais estrita de zerar duração vem da spec deste projeto. Fonte: [W3C — Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
4. **Desempenho:** o próprio anexo combina receitas com `max-height`/`width` e a orientação de animar apenas transformação/opacidade. Para estas oportunidades, prevalece a solução sem animar geometria da tabela. Uso de transformação/opacidade não garante GPU nem 60 fps: medir no navegador.
5. **Componentes:** os exemplos `.cds--modal-container` e SCSS não são automaticamente aplicáveis aos Web Components e à estrutura atual. Evitar sobrescrever internals Carbon ou aplicar transições globais a todos os botões.

## Validação antes de uma eventual implementação

- Conferir estilos computados e animações ativas de cada candidato para evitar duplicidade com Carbon.
- Comparar ponteiro, teclado e movimento reduzido; foco, Escape, anúncio e disponibilidade dos comandos devem ser imediatos.
- Verificar avisos simultâneos, remoção durante entrada e alternância rápida da ajuda, sem filas ou elementos invisíveis interceptando cliques.
- Verificar temas branco/g100 e tabela com dados longos; medir estabilidade e custo de renderização. Não inferir aprovação visual a partir desta análise estática.
- Qualquer implementação com `carbon-builder` exige prévia separada e autorização visual explícita, conforme `AGENTS.md`. Este relatório não constitui essa aprovação.

## Parecer

A interface precisa de pouco movimento adicional. Priorizar AN01, se a confirmação em navegador demonstrar aparecimento abrupto sem transição herdada; manter dados e navegação estáveis. AN02 e AN03 podem ser avaliadas em prévia posterior. Para detalhar uma proposta em plano de implementação, o próximo passo possível é `improve-animations plan AN01`; nenhum plano ou alteração foi executado neste pedido.
