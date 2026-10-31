# Modal de atividade e impressão do prazo

Prévia aprovada pelo usuário com “seguir”. Implementação: Modal Carbon md, sem referência externa, com ação “Imprimir / salvar PDF”.

## Verificações

- `npm run build`: TypeScript/Vite aprovados; permanecem avisos das dependências Sass/Carbon e de tamanho do bundle.
- `npx oxlint src/routes/publicacoes-oab/AtividadePublicacao.tsx src/routes/publicacoes-oab/impressaoPrazo.ts --format stylish`: sem apontamentos.
- `node .scratch/publicacoes-oab-modal-pdf/interface.test.cjs`: 48 verificações de interface com APIs interceptadas e dados fictícios. Servidor local de testes na porta 5199.
- Modal entre 600 e 750 px no viewport de 1440 px (tamanho médio Carbon); conteúdo cabe em 390 px, com rolagem interna.
- Documento de impressão isolado, sem opener nem link externo. Tabela com 12 linhas para o caso de cinco dias úteis, incluindo fim de semana e feriado. Botão chama `window.print()` e é ocultado na impressão.
- PDF do caso simples com uma página A4; cenário longo com seis páginas A4. Extração por pypdf confirmou cabeçalho da tabela em todas as páginas. Primeira página do PDF simples e última do longo foram renderizadas com Poppler e inspecionadas visualmente.
- Ajuste manual de data identificado separadamente; tabela preserva a data final calculada. Pendência de revisão permanece explícita. Abrir o documento não salva atividade nem altera status da publicação.
- Bloqueio de popup informa ao usuário como liberar a nova aba. O aviso é limpo ao tentar novamente.

## Carbon e impressão

Auditoria Carbon de AtividadePublicacao: zero erros, um aviso sobre onRequestSubmit e uma sugestão de ModalHeader/ModalBody, ambos já revistos no projeto: a API instalada mantém onRequestSubmit e o Modal encapsula sua própria estrutura.

A folha de impressão é isolada da aplicação e fixa o papel branco, cores e medidas tipográficas para impressão A4, inclusive quando a interface está no tema escuro. Dados variáveis são inseridos com textContent/nós DOM, sem interpolação em HTML/scripts.

Artefatos locais: `output/playwright/atividade-modal-pdf/` (capturas, PDFs e resultado JSON). Não há dados reais, teste de impressão em impressora física ou alteração das regras de contagem.
