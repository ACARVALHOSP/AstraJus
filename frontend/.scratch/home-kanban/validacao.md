# Validação da home Meu dia

- Build de produção: aprovado (TypeScript e Vite).
- Testes de regras de datas e ordenação: 5 aprovados com `node --experimental-strip-types --test tests/home-dados.test.mjs`.
- API autenticada real, banco SQLite temporário: PATCH e GET para em_andamento, aguardando, concluida e pendente aprovados. Publicações não são tratadas pela movimentação de atividades.
- Playwright com respostas fictícias: resumos 2/3/2/4; filtros; persistência após atualizar; falha de PATCH preservando coluna; arraste; criação de atividade; tema escuro; modo de movimento reduzido; falhas independentes de processo/publicação/checklist; triagem aberta como não tratada.
- Responsividade: sem overflow horizontal em 320, 390, 672, 1056 e 1600 px. Uma coluna no celular, selecionável.
- Estado vazio e ausência de conexão: aprovados; troca de conexão remonta o painel e não reaproveita cartões da conta anterior.
- Auditoria Carbon final: zero erros. SCSS válido. Restaram 7 avisos e 1 informação: quatro avisos classificam botões HTML nativos como Button Carbon; três sinalizam a redução intencional dos spans dos filtros entre tablet e desktop; a informação sugere ModalHeader/ModalBody, composição de ComposedModal que não se aplica ao Modal padrão verificado na referência.
- Lint dos arquivos alterados e de `src`: sem erros; avisos de sincronização em efeitos e avisos preexistentes. `npm run lint` global é bloqueado por erros preexistentes em arquivos antigos de `.scratch`, incluindo `.scratch/central-notificacoes/cenarios.js`.
- Capturas revisadas visualmente: desktop.png, dark.png, mobile.png e falha-parcial.png (artefatos locais não incluídos no PR).
- Verificação de espaços do Git: sem problemas.

A API não fornece data de conclusão. Por isso a coluna de concluídas limita a dez cartões inicialmente, permitindo ver todos, sem afirmar que sejam conclusões recentes.
