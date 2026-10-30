# Tabelas adaptáveis em todas as telas

Status: resolved

## Proposta para aprovação visual
Remover larguras mínimas rígidas das tabelas e células; ajustar colunas ao espaço disponível, com quebra de linha em conteúdo textual. Preservar tipografia legível, ordenação, seleção, ações em lote, paginação e acesso ao conteúdo completo. Em telas estreitas, manter os campos principais e ações; disponibilizar dados complementares em detalhes da linha. Evitar ocultação definitiva ou corte de dados.

## Cobertura
- Processos e vínculos de processos.
- Contatos e vínculos de contatos.
- Financeiro e pagamentos.
- Histórico e favoritos de consultas.
- Publicações de consulta e publicações monitoradas por OAB (incluindo seleção de colunas e expansão existente).
- Administração: usuários, histórico e acessos.
- Modais: importação de contatos em lote e prévia de parcelas.

## Prévia
`previa.html`: exemplos de Financeiro, Processos, Contatos, Publicações e Administração, com adaptação para celular e detalhes interativos. Dados fictícios.

## Validação prevista após aprovação
Build, lint dos arquivos alterados, verificação de cada tabela com dados longos, estados vazios e ações, larguras de desktop/tablet/celular, temas claro/escuro e navegação por teclado. Criar PR para astrajus-react e fazer merge após validação.

## Aprovação
Usuário autorizou a implementação após a prévia e confirmou que shell e navegação lateral devem permanecer inalterados.

## Implementação
Componente TabelaResponsiva aplicado aos 12 componentes de tabelas existentes. A largura é observada no contêiner (inclusive em modais), com campos prioritários por tela, detalhes expansíveis e ordenação acessível para campos complementares. Conteúdo e handlers originais são preservados. As expansões Carbon e OAB mantêm suas linhas adjacentes e colSpan acompanha as colunas visíveis. Shell, barra superior e navegação lateral sem alterações.

## Validação realizada
- Build e TypeScript aprovados.
- Oxlint em src sem erros; avisos preexistentes de hooks/chaves/Fast Refresh. Componente novo sem avisos.
- Playwright na aplicação real com sessão e registros fictícios: listas em 320, 390, 768, 1024 e 1440 px; tabelas de administração, vínculos e consultas nas mesmas larguras; revisão em lote e parcelas em 320, 390, 768 e 1440 px.
- Detalhes, e-mail longo completo, ordenação de campo complementar, seleção por teclado, manutenção da seleção após resize, alteração de pagamento, expansões Carbon/OAB e ações em lote aprovados.
- Descrição sem espaços e valor excepcionalmente grande verificados sem sobreposição de células.
- Temas claro/escuro verificados. Nenhuma redução de fonte para acomodar colunas.
- Auditoria Carbon do SCSS: apenas recomendação informativa de Grid para a lista semântica dl. Auditoria do adaptador: três alertas de composição estática, pois TableRow/TableCell são retornados por helper; no DOM permanecem dentro do TableBody/DataTable original, conforme verificado no navegador. Não é necessário criar outro DataTable.

## Reprodução dos testes
Inicie o Vite na porta 5185 e abra uma sessão Playwright CLI chamada tabelas-app. Execute iniciar-validacao.js com run-code --filename, seguido de verificar-listas.js, verificar-interacoes.js, verificar-demais-telas.js, verificar-modais.js e verificar-extremos.js. Os endpoints são interceptados; não são usadas credenciais ou registros reais.
