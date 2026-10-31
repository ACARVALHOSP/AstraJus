# Auditoria de conformidade do frontend

Data: 2026-10-29. Escopo: código React em `src/`, `index.html`, `DESIGN.md` e especificação desta pasta. Público presumido: profissionais jurídicos em trabalho de consulta e cadastro, principalmente desktop.

Auditoria estática; sem reprodução no navegador, leitor de tela ou medição de contraste. Não constitui certificação WCAG. Nenhuma alteração na interface. S2 = impacto médio recuperável; S1 = inconsistência localizada. Confiança alta nos trechos indicados; consequências visuais e interativas precisam de validação em execução.

A auditoria automática Carbon foi bloqueada pela revisão de aprovação porque enviaria código privado ao conector externo sem autorização explícita. As consultas públicas de documentação Carbon foram realizadas sem enviar código. Não há resultado do validador a apresentar.

## Achados confirmados no código

| Prioridade | Evidência | Desvio e consequência | Recomendação e aceite |
| --- | --- | --- | --- |
| S2 — acessibilidade | `src/routes/PublicacoesOab.tsx:308` | Select de status com `labelText=""` e `hideLabel`, sem nome acessível alternativo no trecho. Dificulta identificar a ação por leitor de tela. | Dar nome contextual ao controle; aceite: árvore de acessibilidade identifica status e publicação da linha. |
| S2 — idioma | `index.html:2` | `lang="en"` em interface portuguesa; pode induzir pronúncia incorreta por tecnologia assistiva. | Declarar `pt-BR`; aceite: documento anuncia idioma português brasileiro. |
| S2 — navegação | `src/App.tsx:155` e `src/App.tsx:127` | Shell sem SkipToContent e sem destino explícito correspondente no Content. Usuário de teclado precisa atravessar controles repetidos. | Adicionar atalho como primeiro controle focável; aceite: Tab e Enter levam diretamente ao conteúdo. |
| S2 — densidade OAB | `src/routes/PublicacoesOab.tsx:243` e `src/index.scss:1` | DataTable sem tamanho explícito nem estilos locais que implementem os 12 px e altura M/40 px aprovados. Na versão instalada, `getTableProps` fornece `lg` quando não há size (`node_modules/@carbon/react/lib/components/DataTable/DataTable.js:243`). | Aplicar tamanho médio e tipografia local documentada; conferir também exceção de 10 px para inteiro teor/status. Aceite: medir 40 px na linha simples e 12 px no texto; validar conteúdo expandido e controles sem corte. Essas medidas são requisitos locais, não uma obrigação genérica de toda tabela Carbon. |
| S2 — tipografia | `src/routes/Financeiro.tsx:115`, `src/routes/PublicacoesOab.tsx:141`, `src/index.scss:1` | Títulos principais são h2 sem aplicação explícita de heading-04. Não existe camada local de estilos para assegurar a escala documentada de página 28/36 e seção 16/24. Em notificações, h2 recebe 14 px/600 (`src/CentralNotificacoes.tsx:142`). | Definir papéis tipográficos com tokens/mixins Carbon e hierarquia semântica coerente. Aceite: conferir estilos computados e árvore de títulos nas telas. |
| S2 — grade especificada | `src/routes/contatos/EnderecosRepetivel.tsx:138`, `src/routes/casos/CadastroCaso.tsx:99` | Endereço usa spans lg 7/3/6 etc.; capa usa 6/6/4. Não há spans xlg nem CSS local para cumprir oito colunas por campo entre lg e xlg, conforme DESIGN.md. | Implementar os spans previstos e espaçamento vertical de 16 px; aceite: validar 1056–1311 px com lateral aberta e fechada, além de 320/672/1312 px. |
| S2 — feedback da busca | `src/BuscaGlobal.tsx:46` | Falha da API limpa ambas as listas; a renderização pode apresentar “Nenhum resultado” como se a consulta tivesse funcionado. Isso reduz confiança na busca jurídica. | Separar erro de resultado vazio e oferecer tentativa novamente; aceite: simular erro HTTP e confirmar mensagem de falha, sem falso vazio. |
| S2 provisório — painéis do shell | `src/BuscaGlobal.tsx:26`, `src/CentralNotificacoes.tsx:65` | Fechamento externo implementado apenas por clique; não há tratamento local de Escape ou retorno de foco ao acionador. Não comprova bloqueio de teclado, mas deixa comportamento de fechamento incompleto no código. | Definir comportamento de teclado; aceite: abrir, navegar, fechar com Escape e confirmar foco no acionador, nos dois painéis. |
| S1 — tokens e estados | `src/App.tsx:168`, `src/BuscaGlobal.tsx:80`, `src/CentralNotificacoes.tsx:115` | Layouts inline repetem espaçamentos literais; sombra usa rgba fixo e contador usa branco literal. Os botões de resultado removem aparência nativa sem estilos locais de hover/active; a classe header-busca-resultado-item não possui definição local. Não é prova de contraste insuficiente, mas faltam estados customizados explicitamente alinhados aos tokens. | Extrair estilos, usar tokens semânticos conforme o papel e conferir hover/foco/ativo em ambos os temas. Valores coincidentes com a escala Carbon não são, por si, falha visual. |
| S1 — terminologia | `src/App.tsx:49`, `src/BuscaGlobal.tsx:125` | “Casos” e “Caso” permanecem na interface, enquanto CONTEXT.md define “Processo” como termo de domínio e desaconselha “Caso”. | Uniformizar rótulos visíveis; preservar rotas e nomes físicos legados. Aceite: navegação e busca dizem Processo/Processos. |
| S1 — confirmações | `src/routes/casos/AgendaAtividade.tsx:53` | Confirmações da agenda usam window.confirm, enquanto cadastros usam Modal Carbon. Aparência e textos dos botões ficam sob controle do navegador e não acompanham o tema da aplicação. | Uniformizar com confirmação Carbon contextual; aceite: ações de cancelar/reconciliar têm títulos, botões e foco previsíveis. |
| S1 — iconografia e identidade | `src/routes/contatos/EnderecosRepetivel.tsx:133`, `index.html:7` | Remoção usa glifo ✕ em botão de ícone; título do documento permanece “frontend”. | Usar ícone Carbon verificado e título AstraJus; aceite: ícone consistente e identificação correta na aba. |

## O que preservar

- Theme white/g100 no shell e preferência local via CHAVE_TEMA: implementação coerente com a direção registrada, sem inversão de cores.
- Componentes Carbon reais em tabelas, formulários, notificações e modais; Grid/Column e Stack já presentes em vários cadastros.
- Ações em lote da OAB ajustam tabIndex conforme visibilidade; cadastros apresentam notificações de resultado com aria-live e confirmação de exclusão em Modal.
- Superfícies e componentes sem evidência de uma identidade visual concorrente no código examinado.

## Documentação divergente

DESIGN.md ainda prescreve HTML e JavaScript vanilla na seção Components, mas o frontend atual usa React e @carbon/react. Atualizar essa seção para evitar orientar futuras alterações pela implementação antiga. A escolha React não é uma violação do Carbon.

## Próxima validação

Priorizar nomes acessíveis, idioma e navegação; depois densidade/tipografia/grade; em seguida feedback e consistência. Percorrer consulta, seleção de publicação e cadastro com dados de teste em white/g100, teclado, zoom de 200% e viewports estreitas. Verificar contraste computado, sobreposição da lateral, recorte dos painéis, rolagem das tabelas e persistência do tema. Esses comportamentos permanecem não verificados.

Correções visuais exigem mockup separado e autorização explícita, conforme AGENTS.md. A auditoria não implementa as recomendações.

## Referências

- [Carbon: shell e navegação por teclado](https://carbondesignsystem.com/building-blocks/core/components/ui-shell-header/guidelines/#keyboard).
- [Carbon: tamanhos das linhas de tabela](https://carbondesignsystem.com/building-blocks/core/components/data-table/specifications/#rows).
- [Carbon: tipografia para interfaces produtivas](https://carbondesignsystem.com/building-blocks/foundations/typography/type-sets/#two-heading-sets).
- DESIGN.md, CONTEXT.md na raiz do repositório e spec.md desta pasta.
