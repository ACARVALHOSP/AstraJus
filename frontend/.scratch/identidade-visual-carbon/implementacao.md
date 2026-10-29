# Correções da auditoria Carbon

Direção visual aprovada pelo usuário com “seguir”, após apresentação da prévia separada. Alterações locais no frontend; sem commit ou envio ao GitHub.

## Implementado

- Idioma pt-BR, título AstraJus, link inicial para pular ao conteúdo, destino focável e títulos principais h1; escalas Carbon heading-04 para páginas e heading-02 para seções.
- Nomes acessíveis de status por publicação e do campo de checklist; tradução dos controles de expansão, token e fechamento de modais.
- Navegação recolhível e comportamento sobreposto no mobile, sem deslocar o conteúdo; fechamento por seleção, overlay e Escape.
- Painéis do shell limitados à viewport, fechamento por Escape com retorno do foco, saída por foco/clique externo e entrada usando Carbon Motion. Preferência por movimento reduzido respeitada.
- Tabela OAB em tamanho md, texto 12 px, status e inteiro teor 10 px. Linha simples de 40 px; textos extensos podem aumentar sua altura. Largura mínima e rolagem contida preservam leitura; ações em lote têm rolagem própria.
- Contenção do grid/Stack e tabelas para impedir overflow horizontal global; spans lg/xlg de endereço e capa ajustados. Grade usa espaçamento vertical de 16 px.
- Carga OAB observa restauração da conexão; reload não depende mais de atualização manual.
- Busca distingue falha de vazio e oferece nova tentativa.
- Confirmações da agenda usam Modal Carbon. Ícones de remoção, adição, retorno e favoritos usam os exports oficiais verificados. Prévia HTML também recebeu SVGs oficiais.
- Estilos inline estáticos extraídos para `src/interface.scss`, com tokens de espaçamento e cores semânticas. Configuração Vite resolve fontes IBM Plex locais no build.
- Documentação atualizada para React e @carbon/react. Nome obrigatório validado antes de enviar cadastro.

## Verificação

- Build de produção e TypeScript: passaram. Persistem avisos Sass em dependências Carbon e aviso de tamanho do bundle.
- Lint: sem erros; 31 avisos sobre efeitos, dependências de hooks e chaves de listas. Não declarar lint livre de avisos.
- Matriz em Chrome headless com respostas interceptadas: 56 verificações passaram, sem exceções JavaScript capturadas. White/g100, 1440/720/390 px, nomes acessíveis, pular ao conteúdo, seleção por teclado, Escape/foco, bounds de painel, overflow de página, cadastro com endereço, persistência de tema, reload OAB, movimento reduzido e reflow 720×450.
- Evidências: [verificacao-final.json](../../output/playwright/carbon-correcoes/verificacao-final.json), capturas na mesma pasta. Roteiro: `verificar-final.cjs`.
- Teste adicional de recuperação e cadastro: passou. Erro da busca não vira resultado vazio; nova tentativa recupera resultados sem fechar o painel. Nome vazio não envia requisição; cadastro válido envia uma única gravação simulada e mostra sucesso. Roteiro `feedback.cjs`, resultado em [feedback.json](../../output/playwright/carbon-correcoes/feedback.json). APIs são simuladas; não comprova integração com persistência real.

## Limites

Zoom nativo de 200% e leitor de tela real permanecem sem validação; reflow equivalente e árvore acessível não os substituem. Contraste foi amostrado durante a auditoria, sem certificação global de todos os estados. Confirmações de agenda foram conferidas por compilação e revisão do fluxo, sem modificar eventos reais. Não houve envio de código privado ao conector de auditoria Carbon.
