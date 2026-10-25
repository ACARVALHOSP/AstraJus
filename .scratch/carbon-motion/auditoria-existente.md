# Auditoria das animações existentes

25/10/2026 — comparação com `spec.md`, considerando as correções de interpretação registradas em `relatorio.md`. Inspeção estática; sem alteração de frontend.

## Resultado

Atendimento parcial. Entradas próprias usam duração produtiva e curva Carbon correta. O principal desvio é a redução de movimento incompleta. Há também diferença entre movimento herdado de Carbon e a matriz mais restritiva do documento recebido. Ausência de animação não é falha por si só.

Foram examinados os fontes atuais do diretório principal, inclusive as alterações locais, e as regras relevantes do CSS Carbon distribuído. O snapshot publicado em `output/f01-storage-prazo` foi usado para identificar a diferença no indicador de espera. Números de linha abaixo referem-se ao diretório principal. Não houve teste de renderização, estilos computados ou desempenho; o navegador bloqueou acesso automatizado a arquivos locais na etapa anterior. Regras declaradas não comprovam comportamento visual em todos os navegadores.

## Inventário e conformidade

| Superfície | Evidência | Avaliação |
| --- | --- | --- |
| Busca global | `static/app.html:116–119`: opacidade + escala .95 e Y −4 px, 150 ms, entrada `(0,0,.38,.9)` | Duração, curva e propriedades adequadas. A abertura chama foco imediatamente (`app.js:6130` aproximadamente), sem distinguir teclado e ponteiro. A recomendação de teclado imediato vem do relatório anterior; não é requisito explícito da spec original. |
| Notificações do cabeçalho | `app.html:134–137`, mesma receita de 150 ms | Entrada produtiva adequada. Fechamento por `hidden` é imediato; não há receita de saída própria. Não considerar isso um defeito automaticamente: não existe obrigação de animar todo fechamento. |
| Sugestões de cliente | `app.html:178–181`: 110 ms, opacidade + escala .97/Y −4 px | Entrada dentro do orçamento; movimento curto e limitado. Confirmar se repete em cada atualização da lista e se distrai durante digitação. Código estático não estabelece frequência real. |
| Menu de ações de publicações | `app.html:336–340`, `app.js:4648–4660`: 110 ms, entrada produtiva, popover | Entrada adequada. Teclas de seta também acionam abertura animada. `display allow-discrete` não produz fade de saída sozinho: o fechamento chama `hidePopover()` e aplica `hidden`; não há alvo de opacidade/transformação de saída. |
| Submenu lateral flutuante | `app.html:90–95`: `opacity .11s`, hover e focus-within | Duração compatível com fast-02, mas literal e sem curva explícita: usa `ease` do CSS, não a curva Carbon escolhida. Não está incluído no tratamento local de movimento reduzido. |
| Setas de ajuda | `app.html:249–250`; `static/carbon/styles.min.css`, seletor `.cds--accordion__arrow` | **Já possuem transição herdada:** `all .11s cubic-bezier(.2,0,.38,.9)`. Curva padrão correta. Duração difere dos 150 ms da matriz de accordion do anexo, mas é comportamento Carbon de microinteração de seta, distinto da expansão do conteúdo. `all` é mais abrangente que o necessário. Não adicionar outra animação sem decidir se a intenção é preservar o componente ou aplicar a matriz local. |
| Rail lateral | CSS Carbon, `.cds--side-nav` | Herda `inline-size` e `transform` em 110 ms, curva `(.2,0,1,.9)`. É uma exceção à regra do anexo de só transformar/opacidade; largura pode causar layout. A receita não coincide com slide de 400 ms da matriz. Não é motivo suficiente para tornar navegação diária mais lenta: ajustar a especificação por superfície antes de sobrescrever Carbon. |
| Overlay lateral | CSS Carbon, `.cds--side-nav__overlay` | 300 ms, opacidade e cor, curva `(.5,0,.1,1)`. Diverge das receitas produtivas do documento. Presença da regra no bundle não prova ativação em todos os layouts. Confirmar no viewport móvel. |
| Modais e loading no bundle | Regras `.cds--modal`, `.cds--loading` em `styles.min.css` | Não atribuir automaticamente ao app: seus fluxos usam `.fluxo-pagina`/`.app-modal`, não o modal Carbon apenas porque existe CSS no bundle. Receitas não utilizadas ficam fora da conclusão de conformidade do fluxo. |
| Indicador de espera | Publicado: `output/f01-storage-prazo/static/app.html:369–373`; local: `static/ui-controls.js:21` | Publicado tem spinner de 800 ms linear com redução desativando rotação. Ciclo de loading não é duração de abertura; 800 ms não viola por si só o teto de transição de 240 ms. Local usa `cds-progress-bar` importado pelo bundle UI controls; conformidade de animação interna e redução exige inspeção do componente em execução. Não confundir local com publicado. |

## Ajustes priorizados

| ID | Prioridade | Constatação e ajuste recomendado |
| --- | --- | --- |
| MV01 | Alta | `app.html:364–368`: movimento reduzido apenas troca as propriedades para `opacity`, conservando 110/150 ms. A seção 6 da spec exige duração zero. Desativar as transições próprias nessas superfícies e incluir o submenu lateral; conferir também as setas herdadas e controles em Shadow DOM. Garantir estado final legível e interação imediata. Não declarar falha WCAG AA com base nisso: SC 2.3.3 é AAA. |
| MV02 | Média | Submenu lateral usa `ease` implícito e valor literal. Centralizar duração fast-02 e curva produtiva; verificar abertura por foco/teclado sem animação conforme recomendação aprovada para as propostas novas. |
| MV03 | Média | Busca, menus e sugestões não distinguem origem de interação. Para alinhar com o relatório de oportunidades, tornar abertura por teclado imediata e preservar foco e comandos. É melhoria de eficiência recomendada, não descumprimento textual da spec anexada. |
| MV04 | Baixa | Definir na spec a exceção de navegação Carbon: rail de 110 ms com mudança de largura e overlay de 300 ms. Validar custo/necessidade antes de personalizar. Não aplicar cegamente a receita genérica de side panel de 400 ms. |

## Retificação da proposta AN02

A análise anterior observou corretamente ausência de transição **local**, mas não confirmou a regra herdada. A seta já anima em 110 ms pela folha Carbon. Portanto AN02 não é adicionar movimento ausente: primeiro decidir se há necessidade de padronizar para 150 ms, restringir a `transform` e atender teclado/redução. A prévia separada representa 150 ms e permanece apenas demonstração, sem aprovação ou implementação inferidas.

## Verificações executadas e pendentes

Busca de transições, animações, keyframes e APIs nos fontes próprios; leitura dos tokens, media query, fluxos de abertura/fechamento e regras pertinentes do bundle Carbon. O verificador Carbon foi chamado sobre um recorte CSS representativo de entrada/redução e retornou zero ocorrências por análise regex; esse resultado limitado **não detectou MV01** e não comprova conformidade integral com a spec local.

Antes de corrigir, validar no navegador: ponteiro/teclado, redução do sistema, abertura/fechamento rápido, temas, viewport móvel, animações ativas e componentes em Shadow DOM. Não foram alterados estilos, dependências, preferências nem dados. Implementação continua condicionada à prévia e autorização visual exigidas pelo `AGENTS.md`.
