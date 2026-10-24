# Acompanhamento — A01–A11

Data: 24/10/2026. Inspeção e implementação no workspace atual, preservando alterações anteriores. Os achados foram reconferidos no código antes das mudanças; a confirmação interativa usa dados fictícios e APIs simuladas em Chromium.

| ID | Estado | Resultado e justificativa |
|---|---|---|
| A01 | Corrigido | Aba Atividades agrega pendências por processo, filtra por tipo/responsável pelo processo, identifica falha parcial e permite concluir/abrir o detalhe. Não cria delegação por atividade. |
| A02 | Corrigido | O sino informa que a central ainda não está disponível e orienta às áreas operacionais. Não apresenta ausência de notificações como resultado verificado. |
| A03 | Corrigido | Carregamento, falha parcial, nova tentativa, atualização do termo e limite de vinte resultados. Recuperação conserva o painel aberto; Escape devolve foco ao acionador. |
| A04 | Corrigido | Rótulos visíveis, IDs exclusivos e agrupamento em telefones, e-mails, sites e endereços. Ajustada herança flex que aumentava a altura dos controles. |
| A05 | Corrigido | Seleção móvel autorizada fecha drawer e foca o conteúdo; Escape retorna ao menu; proteções de edição existentes permanecem. |
| A06 | Corrigido | Gravação retorna sucesso/falha; estrela não simula persistência; aviso permanece até ser dispensado. Teste de falha e recuperação do armazenamento. |
| A07 | Corrigido | Verificação valida HTTP e formato, distingue acesso/configuração/falha e oferece repetição e orientação ao administrador. |
| A08 | Corrigido | Criar atividade a partir da publicação vinculada preserva hash nas observações e permite conferir origem após recarga. Falha de envio mantém formulário; tratamento sem atividade continua permitido. |
| A09 | Corrigido | Títulos das áreas, espera explícita em Processos e novas tentativas nas listas principais. A revisão foi funcional, sem reformulação estética. |
| A10 | Corrigido | Coleções identificadas como favoritos de consulta e de processos cadastrados, com explicação sobre destino e armazenamento local. |
| A11 | Corrigido | Alternador usa grupo de botões com aria-pressed e teclado consistente para mudança de visualização. |

## Evidências e limites

### Resultados executados

- **Interface: 45 testes aprovados**, incluindo oito regressões novas, em Chromium com APIs interceptadas. Execução final: 143,142s; saída em `testes-interface-final.log`.
- **Backend existente: 199 testes executados, 198 aprovados e um erro** em `test_processos.ProcessosTest.test_migracao_preserva_dados_e_e_idempotente`, durante a limpeza de `TemporaryDirectory`: `PermissionError [WinError 32]` no SQLite temporário. O teste mantém conexão aberta por meio de `with db.conectar(...)`, cujo contexto transacional não fecha a conexão SQLite. Na preparação do PR, o teste passou a usar `contextlib.closing` junto do contexto transacional, fechando as conexões sem mudar as verificações nem o backend. A suíte integrada de backend executou **200 testes aprovados**. Saída em `testes-backend.log`.
- `node --check static/app.js`, compilação Python de `test_interface.py` e `git diff --check -- static/app.html static/app.js test_interface.py`: aprovados.
- Detector mecânico Impeccable executado uma vez. Apontou avisos de densidade/padding e literais em estilos Carbon e trechos já existentes; não foi usado para substituir o sistema visual. A inspeção das capturas corrigiu a herança flex dos campos repetíveis e confirmou o ajuste na segunda rodada.
- Um teste anterior de vinculação montava uma tabela HTML e procurava controles legados, incompatíveis com os Web Components/fluxo inline já presentes no workspace. Foi atualizado para exercitar o fluxo real de seleção e confirmação, preservando a verificação do POST de vínculo.
- As primeiras tentativas no sandbox não iniciaram adequadamente o driver. A execução validada usou `.venv/Scripts/python.exe`, Chromium instalado e permissão de execução fora do sandbox, sempre com dados fictícios. O Python global não é compatível com a versão MCP exigida pelo projeto.

### Cobertura restante e decisões

- `static/app.html` e `static/app.js`: implementação; `test_interface.py`: regressões com respostas simuladas, incluindo falhas e persistência.
- Capturas: `output/playwright/auditoria-gtd/`, em 1440, 390 e 320px para atividades, e 1440/390px para campos de endereço. Viewports emulados não equivalem a teste em aparelho físico.
- Não foram realizados testes manuais com leitor de tela, alto contraste, zoom de 200%, serviços externos reais ou carga de carteira grande. Associações de rótulos e teclado foram verificadas por automação, sem alegação de conformidade integral WCAG.
- Agregação de atividades usa endpoints existentes com concorrência limitada; não há migração nem responsável específico da atividade. Origem da publicação usa convenção nas observações, documentada em `spec.md`.
- Nenhum deploy, cobrança, envio externo ou alteração de dados reais foi realizado.
- O arquivo auxiliar `.impeccable/design.json` foi sincronizado em trabalho separado e publicado pelo PR #68; não foi duplicado neste PR.

## Integração para publicação

- Base: `main` após o PR #68 (`a31a442`). Worktree isolada para preservar os arquivos locais e as mudanças já publicadas.
- Preservados os cards Carbon e a implementação Carbon Search dos PRs anteriores. Backend e bundles já presentes na main não são reintroduzidos nem revertidos.
- Testes operam os inputs visíveis de `cds-search`, mantendo a ponte com os formulários existentes.
- Corrigida a propagação de `cds-search-input` na ponte de consulta: o formulário inline envia seus próprios eventos legados, sem acionar o filtro automático da DataTable. A regressão verifica que as linhas permanecem visíveis e o foco volta ao botão ao cancelar.
- Logs, capturas, dependências de build, estado de ferramentas e worktrees não são publicados.
