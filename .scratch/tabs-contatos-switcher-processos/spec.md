# Tabs de contatos e visualização de processos

Prévia separada aprovada pelo usuário com “aplicar”; PR e merge solicitados em seguida.

- Contatos → Cadastro: substituir o content switcher por tabs sublinhadas, mantendo os três rótulos, IDs e painéis. Alternância preserva campos, submissão e validação. Navegação com setas/Home/End e seleção por ARIA.
- Tabs em uma linha com rolagem interna em telas estreitas, sem ampliar a página. Foco permanece visível.
- Processos: content switcher icon-only, grade à esquerda e lista à direita, ícones Grid16 e List16 Carbon. Grade mantém a visualização de cards; lista mantém a tabela e continua selecionada inicialmente.
- Manter IDs e handlers existentes, com a ordem Home/End ajustada à ordem visual. Cada botão tem nome acessível e tooltip nativo por title.
- Preservar dados, preferências e alterações locais de outras branches. Sem novas dependências.

Implementação: HTML/CSS nativos já usados pela aplicação, reaproveitando as regras Carbon distribuídas e os SVGs oficiais de `@carbon/icons`. Prévia em `previa.html`.

Validação: sintaxe JavaScript e diff sem erros; cenários de preservação dos campos, teclado, seleção de visualização e cadastro responsivo passaram em Chrome com APIs simuladas.
