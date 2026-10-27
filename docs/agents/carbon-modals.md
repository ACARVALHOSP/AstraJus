# Modais e tema Carbon

O formulário Adicionar lançamento usa o `cds-modal` transacional, tamanho `md`, com header, heading, body e footer públicos. Ele herda o tema global da aplicação; não adiciona outro seletor de tema.

## Regras a preservar

- Usar os tokens semânticos Carbon de superfície, campo, texto, borda, foco e espaçamento. Evitar cores fixas por tela ou tema.
- Preservar as camadas padrão: White alterna White/Gray 10; Gray 100 avança para Gray 90 e Gray 80. O componente define a superfície do modal e a camada dos campos.
- Manter o modal fora da grade. A grade responsiva organiza apenas seu conteúdo.
- Usar APIs públicas, classes próprias e tokens; não alterar o Shadow DOM nem sobrescrever classes internas Carbon.
- Manter uma ação primária e uma secundária no footer, com conteúdo rolável separado das ações.
- Direcionar o foco inicial à descrição, conter Tab, tornar o fundo inerte e devolver o foco ao acionador.
- Encaminhar fechamento, Cancelar e Escape à proteção de alterações pendentes. O clique no fundo não descarta dados.
- Manter calendários dentro do modal e dropdowns com `autoalign`, verificando recortes, teclado e viewport reduzido.
- Testar White e Gray 100, celular, confirmação sobreposta, recuperação após erro e envio real do formulário com APIs simuladas.

Referências oficiais: [Modal](https://carbondesignsystem.com/building-blocks/core/components/modal/guidelines/) e [temas e camadas](https://carbondesignsystem.com/building-blocks/foundations/color/overview/).
