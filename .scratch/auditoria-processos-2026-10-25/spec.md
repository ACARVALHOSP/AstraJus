# Ajustes PRC01–PRC07

Prévia apresentada, com correção expressa do usuário: “não colocar altura pelo conteudo, truncar titulos longos”; PR e merge autorizados.

- Manter aspect-ratio 1 e grade existente. Títulos limitados visualmente a duas linhas; texto integral permanece no nome acessível e no DOM. O título é botão para abrir o processo completo, também por teclado, e tem title para ponteiro.
- Ações ocupam coluna própria independente do título, com rótulo acessível incluindo o processo. Estado fica separado do título.
- Metadados com rótulos Cliente, Classe/rito, Órgão julgador e Última movimentação. Valores extensos usam elipse; dado integral continua no DOM e no detalhe do processo. Conteúdo excedente do card pode rolar, preservando geometria e dados.
- Corrigir altura dos wrappers e botões do seletor icon-only para preencher os 40 px do container; manter grade/lista e teclado.
- Classe e rito em apresentação de frase, preservando siglas jurídicas/fiscais conhecidas; valores persistidos não são alterados. Aplicar apresentação compartilhada à tabela e à grade. Siglas não catalogadas exigem extensão da lista explícita; não aplicar formatador de nomes a esses rótulos.
- Dados ausentes: “Processo sem título”, “Classe não informada”, órgão não informado e identificador real do registro. Sem tag azul com hífen.
- Filtro com placeholder curto e ajuda persistente correspondente ao predicado existente: título, cliente, classe/ação, órgão, responsável e número.

Implementação usa markup próprio para o conteúdo dos cards e mantém os botões Carbon existentes. Não altera dados de negócio, dependências ou preferências.

Validação: Chrome com APIs simuladas, títulos e órgãos extremos, cards quadrados e ações separadas em 320/390/768/1440 px; fallback e capitalização; altura dos segmentos e navegação Home/End. Sintaxe JavaScript e diff sem erros.
