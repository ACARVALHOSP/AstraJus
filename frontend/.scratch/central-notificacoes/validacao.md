# Validação da central de notificações

Data: 30/10/2026. Prévia aprovada explicitamente antes das alterações.

## Resultado

- `npm run build`: passou (TypeScript e Vite). Permanecem avisos das dependências Sass Carbon e do tamanho do bundle.
- `npm run lint`: terminou sem erros; há avisos sobre efeitos React e outros pontos preexistentes. O novo hook segue o padrão de efeitos que consultam APIs usado pelo projeto.
- `git diff --check`: passou.
- Auditoria Carbon: zero problemas em CentralNotificacoes.tsx e notificacoes.scss.
- A auditoria dos arquivos de destino também sinalizou um falso positivo de Grid em Casos.tsx: o Grid já contém Column antes de Stack e Button. O Modal existente de AtividadesCaso usa a composição de alto nível válida com modalHeading; a sugestão de ModalHeader/ModalBody aplica-se a ComposedModal. O botão existente de nova atividade usa o tipo primário padrão.

## Navegador

Chrome com Playwright CLI, APIs simuladas e credenciais fictícias, sem acesso a dados reais. Execução limpa: 12 grupos de cenários passaram, 32 requisições de notificações observadas e nenhum erro JavaScript. Os únicos erros HTTP do cenário final são 404 e 503 provocados pelo teste de indisponibilidade.

1. Paginação com cursor e anexação.
2. Filtro imediato, reinício do cursor e leitura explícita removendo o item do filtro.
3. Revalidação do destino e abertura da atividade exata, sem PATCH de leitura ao abrir.
4. Abertura da aba Publicações com a área Processos já montada.
5. Contagem ao retornar, intervalo de 60 segundos, pausa em página oculta e retorno por visibilitychange.
6. Navegação para atividade de outro processo sem sair do módulo.
7. Destino Publicações monitoradas.
8. Origem indisponível: item removido após reconsulta e navegação impedida.
9. Falha distinta de vazio, contador indisponível e recuperação por nova tentativa.
10. Resposta atrasada descartada após mudar o filtro.
11. White/g100, larguras 1440 e 390, ausência de rolagem horizontal, Escape com foco de volta ao sino e prefers-reduced-motion.
12. Troca de sessão com resposta antiga pendente, sem vazamento de itens/contagem, e vazio confirmado na nova sessão.

Script: `verificar.js` neste diretório. Executar por `playwright-cli -s=notificacoes-final run-code --filename .scratch/central-notificacoes/verificar.js` em uma sessão limpa, com Vite disponível em `http://127.0.0.1:5194/novo/`. Criar antes `output/playwright/notificacoes/` para as capturas.

Capturas locais (não versionadas): `output/playwright/notificacoes/white-1440.png`, `white-390.png`, `g100-390.png`. As animações são desativadas somente durante a captura para registrar o estado final do painel.

## Limites

O backend não foi alterado. Os testes de interface usam o contrato dos endpoints existentes; não comprovam a entrega de notificações reais nem SMTP em produção. Não foram acrescentados novos eventos, push ou preferências.
