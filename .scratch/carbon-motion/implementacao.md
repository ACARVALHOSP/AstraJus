# Aplicação de AN01–AN03 e MV01–MV04

Autorização: após a apresentação da prévia separada e da auditoria, o usuário solicitou “aplicar tudo”. Implementação em `codex/carbon-motion`, baseada em `650f42c8`; alterações locais do diretório principal preservadas.

## Regras de integração da spec

Estas regras complementam o documento original, preservado integralmente em `spec.md`, e resolvem suas divergências para esta aplicação:

- Curvas produtivas: entrada `(0,0,.38,.9)`, padrão `(.2,0,.38,.9)`, saída `(.2,0,1,.9)`. Tokens compartilhados de 70, 110 e 150 ms.
- AN01: aviso ocasional entra em 150 ms e expira com fade de 110 ms; fechamento explícito e erros são imediatos. Avisos em rajada não animam. Duração de leitura começa na inserção. Sem deslocamento animado da pilha.
- AN02: a seta já herdava movimento do Carbon; a regra local restringe a propriedade a `transform` e padroniza 150 ms, conforme a prévia. Conteúdo abre imediatamente.
- AN03: tooltips personalizados de nomes e cabeçalhos usam fade de 70 ms apenas em `mouseenter` com ponteiro preciso e hover disponível. Foco e fechamento são imediatos. Não afeta tooltips internos de Web Components.
- MV01/MV03: teclado desativa as transições próprias de painéis, menus, setas e navegação; movimento reduzido desativa esses movimentos e o spinner. Animações próprias de opacidade em andamento são concluídas ao detectar teclado ou redução, sem esperar duração. Eventos de ponteiro restauram a modalidade de ponteiro.
- MV02: submenu flutuante usa fast-02 e curva de entrada compartilhados.
- MV04, **exceção explícita à matriz genérica**: preservar o rail Carbon em 110 ms, incluindo `inline-size`, e o overlay em 300 ms quando habilitado. São navegação frequente, não side panel utilitário de 400 ms. Com teclado/redução, tornam-se imediatos. Não editar o bundle distribuído nem impor uma duração mais lenta. Mudança de largura pode provocar layout; não há garantia de GPU/60 fps.
- Saídas imediatas de painéis e menus são intencionais; não criar animação de fechamento apenas para completar a matriz. Nenhum atraso de foco ou comando.

## Limites

Implementação no snapshot publicado, que usa spinner próprio. O `cds-progress-bar` presente nas alterações locais de outra branch não integra este snapshot e não foi alterado. Sua animação em Shadow DOM requer validação na integração daquela branch. Bibliotecas e dependências preservadas.

## Validação

Sintaxe JavaScript e `git diff --check` sem erros. Três cenários específicos em Chrome com APIs simuladas passaram: aviso/fechamento/erro/teclado; movimento reduzido e duração da seta; expiração e rajada. A suíte completa de interface passou: 62 testes em 139,857 segundos. Os três cenários específicos são adicionais aos 62 testes.
