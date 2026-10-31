# Auditoria Publicações OAB — React

Data: 30/10/2026. Auditoria inicial seguida de implementação autorizada pelo usuário nesta conversa.

Inspeção estática de `src/routes/PublicacoesOab.tsx`, `src/index.scss` e specs: `../.scratch/tabela-carbon-xs/spec.md`, `../.scratch/carbon-data-table/spec.md`, `../.scratch/dt01-dt05/spec.md` e `DESIGN.md`. Escopo: frontend React atual. Não comprova comportamento em produção.

## Achados das specs

| Severidade | Achado | Correção proposta |
| --- | --- | --- |
| Alta | CABECALHOS_OAB não inclui Nome do processo nem catálogo/preferências; apresenta seis campos iniciais contra os três obrigatórios especificados | Tribunal, Processo e Nome do processo sempre visíveis; opcionais inicialmente ocultos; botão Colunas na toolbar com checkboxes, persistência versionada e validação de chaves |
| Alta | DataTable recebe somente registros da página e é desmontada no carregamento | Manter seleção por hash entre páginas; limpar em filtro/tamanho; informar alcance da seleção |
| Alta | Select individual e consulta de processo continuam disponíveis durante seleção/lote | Bloquear ações individuais e envios concorrentes; restaurar controles após falha |
| Alta | Não há cadastro/vinculação de processo na página React | Mapear contratos reais da API antes de portar os formulários inline com confirmação e recuperação |
| Média | Paginação fixa em 20, sem intervalo, seletor ou correção de página vazia | Pagination Carbon ligada ao total e à API; retornar à primeira página ao mudar tamanho |
| Média | Sucesso do lote sem feedback; resposta não avaliada para sucesso parcial | Conferir contrato do backend; anunciar resultado e preservar falhas selecionadas quando suportadas |
| Média | CNJ pode ser substituído por Consultar processo quando apenas dados.numeroprocessocommascara existe | Preservar identificador visível/copiável e separar a ação; impedir consulta com número ausente |
| Média | Inteiro teor sem justificação e resumo expandido incompleto | Preservar texto original, 10 px; resumo com tribunal, órgão, datas, tipo e partes disponíveis |
| Média | Grid manual 2+2+5+7 em desktop e campos estreitos em tablet | Rever spans e validar 320/390/768/1440 px e zoom de 200% |

Atendidos no código: expansão antes da seleção; size md; texto 12 px e exceção de 10 px; labels de status; notificação de vazio/erro; texto integral preservado; seleção por hash na página atual.

## Auditor Carbon

Retorno: 8 apontamentos, 3 erros e 5 avisos, análise AST com confiança 0,95; nenhuma regra falhou.

- Acessibilidade — Validate keyboard event handlers: três erros em TableBatchAction. São prováveis falsos positivos: o componente oficial renderiza botão e fornece semântica de teclado. Validar no navegador antes de considerar defeito; não adicionar handlers duplicados.
- Componentes — Validate required props: aviso em button nativo pede props Carbon, inaplicável ao elemento HTML; outro pede kind explícito no botão Capturar agora, melhoria de explicitude.
- Layout — Validate responsive Column configuration: três avisos sobre spans decrescentes; confirmar proporção e usabilidade por breakpoint. Não basta comparar números entre grades de 4/8/16 colunas.

Não foram retornadas substituições autoFix. Os achados funcionais acima vêm da comparação com as specs e não do auditor automático.

## Catálogo proposto

Obrigatórias: tribunal ← dados.siglaTribunal; processo ← dados.numeroprocessocommascara/numero_processo; nome ← dados.destinatarios por polo, sem inventar partes ausentes.

Opcionais conhecidas: divulgado ← dados.data_disponibilizacao; capturado ← criado_em; tipo ← dados.tipoComunicacao; órgão ← dados.nomeOrgao; classe ← dados.nomeClasse; advogados ← dados.destinatarioadvogados; destinatários ← dados.destinatarios; referência ← nome_pesquisado; link ← dados.link; hash ← hash; status ← status. Conferir payload real e campos adicionais antes de fechar o catálogo completo.

Seletor: checkboxes e rótulos com uma alternância por clique; obrigatórias marcadas/desabilitadas; Escape/clique externo/repetição fecham; retorno de foco; painel sem recorte; preferências válidas preservadas e inválidas recuperadas. Colspan acompanha cabeçalhos visíveis e controles.

## Prévia e validação pendente

`previa.html` é um artefato separado, usa CSS Carbon compilado do projeto e dados fictícios. Demonstra temas e alternância de Status/Divulgado; outros opcionais estão identificados como escopo previsto. Controles de lote, expansão, captura e paginação não executam operações nesta prévia.

A referência antiga a Web Components descreve o legado. A proposta conserva React conforme DESIGN.md atual. A exceção local de status com Tag de 10 px é preservada apesar da recomendação genérica da skill sobre indicadores.

Antes da implementação, obter aprovação explícita da prévia conforme AGENTS.md. Depois: build/lint, auditoria Carbon, testes de seleção entre páginas, concorrência, recuperação, preferências inválidas, teclado, temas, mobile, overflow localizado e revisão visual. PR e merge após validações conforme autorização permanente do projeto.

## Resultado após autorização

O usuário solicitou começar após definir as ações e o comportamento do prazo. A implementação React está distribuída em `src/routes/publicacoes-oab/`, mantendo o formulário de captura em `PublicacoesOab.tsx`. Os achados acima representam a situação inicial, não a situação final.

Incluídos: catálogo completo dos campos informados pela API, três colunas obrigatórias, persistência/migração de preferências, paginação real, seleção entre páginas, identificação de sucesso parcial, ações individuais bloqueadas no lote, DJEN em nova aba e demais ações no menu de três pontos. Criar processo consulta CNJ, exige confirmação para vínculo e preenche a capa automaticamente. Criar atividade calcula sugestão editável e mantém vencimento pendente quando não revisado. Retries preservam o processo/atividade já criado.

A consulta atual de calendário não garante cobertura de suspensões e provimentos. A integração futura está registrada em `issues/02-calendario-provimentos.md`; há contrato substituível `ProvedorCalendario`. O modelo PGM foi usado como referência de interação, sem aplicar o calendário da capital a outros municípios.

Auditoria Carbon final contextual: 9 apontamentos, sem falha de execução das regras. Três apontamentos de teclado recaem sobre TableBatchAction/TableHeader, que renderizam botões nativos; não foram adicionados handlers duplicados. A recomendação de ModalHeader/ModalBody refere-se à composição manual, enquanto Modal já encapsula sua estrutura. `onRequestSubmit` está declarado e não depreciado nos tipos instalados. Os três apontamentos tipográficos correspondem à exceção local aprovada de 10 px/16 px para status e inteiro teor. Não se afirma que o auditor automático retornou conformidade total.

As correções automáticas sugeridas durante a auditoria foram aplicadas: `<Grid narrow fullWidth>` → `<Grid withRowGap narrow fullWidth>` nos formulários de captura/atividade. O breakpoint literal foi substituído pelo mixin Carbon. A composição final usa DataTable com rows/headers explícitos e Grid → Column → Stack.

Resultados detalhados e comandos reproduzíveis em `validacao.md`. A prévia HTML inicial permanece um artefato histórico; as capturas da implementação ficam em `output/playwright/publicacoes-oab/`.
