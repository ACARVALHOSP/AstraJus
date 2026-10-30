# Refinamento do modal de atividade e impressão do prazo

Status: resolved — prévia aprovada pelo usuário com “seguir”.

Pedido: reduzir a largura do modal, retirar referência ao site externo de cálculo e incluir impressão em PDF da tabela de prazo conforme o modelo indicado anteriormente.

Prévia isolada: `previa.html` e `impressao.html`, sem alterações em `src/`.

Proposta: trocar Modal lg por md (padrão Carbon; aproximadamente 691 px em viewport de 1440 px). Manter campos em duas colunas quando houver espaço e uma em telas estreitas, com corpo rolável e rodapé acessível. Remover link/texto de referência externa na interface e no documento impresso.

Adicionar ação “Imprimir / salvar PDF” habilitada somente quando houver demonstrativo válido e cálculo não estiver em andamento. Abrir documento em nova aba por clique direto do usuário, com botão de impressão do navegador e layout A4. Tratar bloqueio de popup com feedback. Preencher conteúdo por nós DOM/textContent, sem interpolar dados externos em HTML ou scripts.

Documento: título da atividade, CNJ, tribunal, município/comarca, data-base, quantidade de dias, termo inicial, regra, suspensão selecionada, fonte e cobertura do calendário. Tabela completa com data, dia da semana, número do dia contado e evento. Cabeçalho de tabela repetido na impressão; evitar dividir linhas entre páginas. Dia não útil identificado também por texto.

Distinguir data final calculada da data final alterada manualmente, com estado de revisão. Não mudar a última linha do cálculo para simular que uma alteração manual decorreu da contagem. Cálculo pendente pode ser impresso com indicação explícita de pendência; não imprimir vencimento como confirmado. Nenhum cadastro ou alteração de status é necessário para imprimir.

Validação após aprovação: largura e ausência de overflow do modal em desktop/mobile, inexistência do link externo, conteúdo da nova aba e acionamento de print, tabela e datas coerentes com cálculo, revisão/ajuste manual e impressão com múltiplas páginas. PR/merge e workflow de publicação conforme instrução permanente do projeto.
