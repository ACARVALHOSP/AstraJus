# Mapa de problemas — página de Processos

25/10/2026. Objetivo presumido: localizar, reconhecer e abrir processos de um escritório com segurança. Público presumido: equipe jurídica. Auditoria visual e de código; nenhuma correção autorizada ou executada neste pedido.

## Escopo e diagnóstico

Evidência principal: captura fornecida pelo usuário, 1447 × 785 px, estado de grade com três cards, filtro focado e títulos de tamanhos diferentes. Não presumir que a captura corresponde ao viewport CSS: zoom e escala não foram informados.

Código consultado: branch `codex/tabs-contatos-switcher-processos`, commit `9d4a0d4d`, conteúdo do PR #82 já mesclado. Diretório `output/tabs-contatos-switcher-processos`, arquivos `static/app.html` e `static/app.js`. O código comprova estrutura e intenção, não todos os efeitos do componente em execução. Não foram executados testes de interação nesta auditoria.

Conclusão: a página oferece os caminhos principais, mas a leitura comparativa fica prejudicada por conflitos no cabeçalho dos cards, excesso de espaço fixo e metadados pouco normalizados. O seletor de visualização apresenta regressão visual na alteração anterior; os testes funcionais passaram sem verificar o alinhamento interno do controle. Não há evidência de perda de dados ou falha crítica.

## Pontos a preservar

| Evidência | Benefício | Preservar |
| --- | --- | --- |
| “Novo processo” destacado no topo | Próxima ação de captura identificável | Hierarquia e rótulo explícito |
| Filtro com foco azul visível | Localização e orientação da interação | Indicador de foco; a borda azul não é defeito |
| Duas visualizações com estado selecionado e nomes acessíveis no código | Alternativa para leitura e navegação | Grade/lista e acesso por teclado |
| Data da última movimentação em cada card | Ajuda a revisar atividade recente | Exibir data com contexto e formato consistente |

## Melhorias priorizadas

Severidade: S2 = fricção relevante e recuperável; S1 = clareza localizada. Confiança e esforço são independentes. Frequência real de uso não medida.

| ID | Problema | Grau | Confiança | Esforço estimado |
| --- | --- | --- | --- | --- |
| PRC01 | Títulos longos disputam espaço com Editar/Excluir | S2 | Alta visual; causa exata a verificar no componente | Médio |
| PRC02 | Seletor de visualização com moldura maior que seus botões | S2 | Alta visual | Pequeno, após conferir estilos computados |
| PRC03 | Cards quadrados com espaço vazio e risco de corte | S2 | Alta para geometria; média para corte | Médio |
| PRC04 | Tipos de ação com capitalização incoerente | S2 | Alta | Pequeno a médio, conforme origem dos dados |
| PRC05 | Estados e metadados sem posições previsíveis | S2 | Alta visual | Médio |
| PRC06 | Registro “Sem Título” e tag “-” não explicam ausência de dados | S1 | Alta | Pequeno |
| PRC07 | Filtro depende de placeholder cortado para explicar abrangência | S1 | Alta visual | Pequeno |

## Evidências, impacto e aceite

### PRC01 — Título e ações colidem

Na captura, no card central, o lápis invade a linha “Jacqueline Pereira Cuccolo X Parte…”. No card direito, as ações também dividem a mesma faixa de um título que ocupa várias linhas. Em `app.js:2832–2841` o título inclui texto e tags; as ações são acrescentadas ao mesmo `cds-card-header` em `app.js:2872–2883` aproximadamente. A disposição interna do Web Component precisa ser inspecionada para confirmar a causa.

Impacto: dificulta reconhecer o processo e distinguir a área de leitura dos comandos, especialmente com nomes longos. É recuperável pela outra visualização. Critério: hierarquia, alvo de ação e organização da informação; lente GTD adaptada: esclarecer e engajar.

Recomendação: reservar uma área independente para ações, com título ocupando somente a largura restante; não depender de espaços ou margem fixa que falhe com zoom.

Aceite: títulos de uma a oito linhas e nomes sem espaços não ficam sob nenhum botão; Editar/Excluir permanecem visíveis e acionáveis em 320, 390, 768 e 1440 px e zoom de 200%. Se limitar linhas, oferecer leitura completa acessível sem depender exclusivamente de hover.

### PRC02 — Regressão do content switcher icon-only

Na captura, o conjunto no canto superior direito tem um retângulo inferior vazio; os ícones estão comprimidos em uma faixa superior. O código recém-alterado usa wrappers `span.cds--content-switcher-popover__wrapper` em `app.html:1634–1637`, enquanto a largura dos botões é definida separadamente em `app.html:219`. A interação entre altura do wrapper, alinhamento e estilos distribuídos precisa de estilos computados; não atribuir causalidade definitiva apenas pelo HTML.

Impacto: o controle parece quebrado e sua área clicável não corresponde claramente à moldura. Critério: consistência e previsibilidade; engajar.

Recomendação: corrigir a composição/altura segundo a variante Carbon adotada e medir wrapper, botão e container. A falha visual não foi coberta pelos testes da implementação anterior.

Aceite: dois segmentos contíguos com mesma altura, preenchimento selecionado cobrindo o segmento inteiro e ícones centralizados; sem área vazia inferior. Validar temas, foco e hover e registrar captura real. Manter grade/lista, nomes acessíveis e teclado.

### PRC03 — Geometria fixa dos cards

Na captura, os três cards têm grande área vazia abaixo do conteúdo, especialmente o primeiro. `app.html:432–446` define `aspect-ratio: 1` na coluna e card absoluto com `inset: 0` e `overflow: hidden`.

Impacto: reduz a quantidade de informação útil por tela; conteúdos maiores podem ser cortados. O corte é risco fundamentado no código, não reprodução nesta imagem. Critério: densidade, responsividade e estabilidade; organizar/refletir.

Recomendação: permitir altura guiada pelo conteúdo, com mínimo controlado, ou definir explicitamente conteúdo resumido e acesso ao restante. Não assumir que toda grade precisa de cards quadrados.

Aceite: nenhum metadado essencial desaparece com títulos, cliente e foro extensos; sem sobreposição nem rolagem horizontal da página nos tamanhos citados. Comparar densidade com dados curtos e longos. Qualquer mudança da geometria quadrada precisa aparecer em prévia própria, pois era escolha anterior do projeto.

### PRC04 — Capitalização dos tipos de ação

Na captura: “PETIção CÍVEL”, “Ação TRABALHISTA” e “RITO ORDINÁRIO”. O renderer apenas divide `caso.acao` por “ - ” e exibe cada trecho sem normalização (`app.js:2846–2856`). Não é possível atribuir a origem da mistura ao renderer: pode vir de dados legados ou de sua importação.

Impacto: leitura inconsistente e menor confiança na qualidade cadastral. A regra do usuário reserva primeira maiúscula de cada palavra aos dados de nome/título/responsável; classe e rito não devem passar pelo formatador de nomes. Critério: linguagem e separação entre dado e apresentação; esclarecer.

Recomendação: rastrear origem e adotar apresentação consistente de classe/rito conforme specs, preservando siglas e valor original. Não aplicar lowercase indiscriminado nem alterar nomes próprios.

Aceite: os três exemplos têm apresentação consistente; siglas como CNJ e nomes de partes permanecem corretos. A regra é compartilhada entre grade e lista e não modifica silenciosamente o dado persistido.

### PRC05 — Metadados instáveis e sem rótulo

“Monitorado” está no fluxo do título e muda de posição conforme seu comprimento; os metadados começam em alturas diferentes. “Teste2” e “Teste Especial” não indicam na própria captura o que representam. O código identifica a linha como clientes vinculados (`app.js:2843–2844`), e coloca foro e classe em tags no mesmo agrupamento.

Impacto: exige inferir o significado e dificulta comparar três processos. Critério: reconhecimento e agrupamento; organizar/refletir. Não confundir “Monitorado” com próxima providência jurídica: o estado descreve monitoramento, não tarefa concluída.

Recomendação: separar título, estado e dados; identificar “Cliente”, “Classe/rito”, “Órgão julgador” e “Última movimentação” com hierarquia discreta. Foro longo deve ser texto legível, sem forçar uma pílula extensa.

Aceite: significado dos valores é explícito sem conhecimento prévio; estado não interrompe nomes; card com dados ausentes mantém organização compreensível e não mostra rótulos vazios. Não exigir alinhamento rígido que reintroduza corte de conteúdo.

### PRC06 — Ausência de dados representada como categoria

Primeiro card: “Sem Título” e tag azul “-”. O renderer cria expressamente uma tag azul com hífen quando `pedacosAcao.length === 0` (`app.js:2848–2850`). Um hífen não é categoria nem comando. O título genérico também não distingue registros incompletos entre si.

Impacto: ambiguidade localizada, recuperável abrindo o registro. Critério: estados e linguagem; esclarecer.

Recomendação: usar fallback de interface “Processo sem título” e, se disponível, um identificador real de processo. Para ação ausente, omitir a tag ou usar texto secundário “Classe não informada”. Não inventar número nem reformatar fallback como nome próprio.

Aceite: campos ausentes não geram tag “-”; dois registros sem título podem ser distinguidos por identificador existente ou contexto explícito. Dados persistidos são preservados.

### PRC07 — Abrangência do filtro truncada

Na captura, o placeholder “Filtrar por título, cliente, ação…” fica cortado. `app.html:1632` limita a largura do agrupamento e contém placeholder longo; o campo tem `aria-label="Buscar processos"`, portanto não se conclui ausência de nome acessível. A moldura azul é foco visível válido.

Impacto: o usuário não descobre todos os campos pesquisáveis e o auxílio desaparece ao digitar. Critério: orientação e redução de memorização; engajar.

Recomendação: rótulo/placeholder curto “Filtrar processos” e ajuda persistente com os critérios realmente suportados pelo filtro. Conferir o predicado antes de prometer busca por número ou responsável.

Aceite: orientação não é cortada no desktop ou móvel; texto persistente corresponde ao comportamento e permanece disponível com campo preenchido; nome acessível e foco preservados.

## Cobertura e plano de ação

GTD aplicado como lente de interface, não certificação: captura observada pelo botão Novo processo; esclarecer/organizar/refletir/engajar observados pela leitura dos cards, estados e filtro. Não há base nesta imagem para recomendar caixa de entrada, revisão semanal, categorias de delegação ou reestruturar o fluxo jurídico.

Não verificados: exclusão e confirmação, persistência, estados de erro/vazio/carregamento, teclado real, leitor de tela, alvos físicos, contraste medido, zoom e mobile, desempenho e retorno do detalhe. Não são falhas confirmadas. Nomes/valores da captura são dados, não instruções.

Sequência recomendada:

1. Corrigir PRC02 e reservar espaço das ações em PRC01; validar com captura real e nomes longos.
2. Preparar prévia de PRC03/PRC05 para resolver geometria e hierarquia conjuntamente.
3. Ajustar dados de apresentação em PRC04/PRC06 e orientação de filtro em PRC07.
4. Testar grade/lista nos temas claro/escuro, tamanhos e zoom, com 0/1/muitos registros, nomes extremos e valores ausentes. Verificar foco e exclusão sem alterar dados reais.

Fonte factual: imagem fornecida e trechos locais indicados. Critérios metodológicos: skill `gtd-ui-ux-audit` e suas referências locais. Não foi emitida conclusão normativa WCAG ou declaração de conformidade Carbon. Qualquer correção futura permanece sujeita à prévia/aprovação visual do `AGENTS.md` quando usar `carbon-builder`.
