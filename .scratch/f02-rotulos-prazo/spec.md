# F02 — Associação de rótulos do painel de prazo

Status: ready-for-agent
Data: 25/10/2026

Cada painel de cálculo de prazo recebe identificadores únicos para Dias, Contagem a partir de e Município/comarca. Os rótulos irmãos usam `for` apontando explicitamente para o respectivo controle. A sequência pertence à sessão da página e evita colisões mesmo quando duas publicações têm a mesma data.

Sem alteração de layout, regra de cálculo, valores iniciais ou persistência. O tratamento de falha de armazenamento (F01) não integra esta correção.

Aceite: abrir dois painéis simultâneos; todos os campos devem ter IDs distintos e nomes acessíveis corretos. Clicar cada rótulo foca seu próprio campo, Tab percorre Dias → Contagem a partir de → Município/comarca e editar um painel não altera o outro.

Validação: regressão aprovada em Chrome/Playwright com dois painéis simultâneos, incluindo nomes acessíveis, foco por clique, teclado e valores independentes. Sintaxe JavaScript e git diff --check aprovados. Não houve teste manual com leitor de tela.
