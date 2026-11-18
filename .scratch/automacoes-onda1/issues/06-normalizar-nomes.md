# Normalizar nomes

Status: implementado (decisões: incluir processos; exceções editáveis na tela)
Blocked by: — (nenhum)
Tamanho: P
Spec: ../spec.md (seção 5)

## O que ele faz, em uma frase
Passa a gravar nomes de clientes e títulos de processo em caixa de título ("Maria da Silva", não "MARIA DA SILVA"), e dá ao
administrador uma ferramenta para arrumar o que já está gravado em maiúsculas, com prévia e desfazer.

## Situação hoje
- A **tela** já arruma na exibição (`formatarNomeExibicao`, frontend). O **dado** continua como veio do tribunal: o título do
  processo criado a partir de publicação é "AUTOR X RÉU" em maiúsculas; o cliente novo herda o nome pesquisado.
- No servidor há `_caixa_nome` (só para a classe) com regra própria e diferente da do frontend (partículas e siglas diferentes).
  Duas regras que podem divergir; E-mail, relatório e busca leem o dado cru.
- Consequência prática: busca/ordenação por nome e e-mails mostram caixa alta; o mesmo cliente pode virar duas pessoas ("MARIA
  DA SILVA" e "Maria da Silva") porque a checagem de duplicado depende da grafia.

## Comportamento
**A. Função única.** Uma regra de normalização, implementada uma vez no servidor (`nomes.py`) e espelhada no frontend com a
**mesma tabela de casos de teste** nos dois lados (um arquivo JSON de casos lido pelos testes Python e Node), para não divergir.
- Partículas minúsculas no meio: de, da, do, dos, das, e, em, na, no, para, com…
- Siglas preservadas: INSS, CEF, S/A, Ltda, ME, EPP, MEI, OAB, CPF, CNPJ; algarismos romanos (II, III, IV…) ficam em maiúsculas.
- Apóstrofo e hífen: "D'Ávila", "Sant'Ana", "Ana-Maria".
- Lista de exceções editável pelo administrador (ex.: "iFood", "BRF", "XP Investimentos"): grafia exata que vale sempre.
- **Só mexe em nome todo em maiúsculas ou todo em minúsculas.** Nome em caixa mista é considerado digitado por gente e **nunca é
  tocado**. É isso que torna a função idempotente.

**B. Daqui para frente.** Cliente novo e título de processo criados **a partir de publicação** (e pelo autocadastro do ticket 07)
são gravados já normalizados. Cadastro à mão não muda: o que a pessoa digitou fica como digitou.

**C. Saneamento do que já existe** (Administração → Banco de dados ou Automações):
1. "Verificar": lista "antes → depois" de clientes e processos com nome todo em maiúsculas/minúsculas (limite de 200 por tela).
2. A pessoa marca o que aplicar (ou "marcar todos") e confirma.
3. Cada alteração guarda o valor anterior numa tabela própria (`nomes_normalizados`: tipo, id, antes, depois, quando, quem), e
   "Desfazer" restaura. Desfazer **só restaura se o nome atual ainda for o "depois"** (se alguém editou no meio, não pisa).
4. Entra no histórico administrativo (quem aplicou e quantos).

**D. Nunca altera:** CPF/CNPJ, OAB, número CNJ, nem partes e advogados da **capa** (fonte oficial do tribunal). Também não altera
o título de processo que a pessoa já editou à mão (caixa mista = não toca).

## Cuidados (por que não é só "trocar a caixa")
- **Duplicados:** ao normalizar "MARIA DA SILVA" pode existir "Maria da Silva". Não funde nada sozinho: a prévia marca "já existe
  cliente com este nome" e deixa desmarcado por padrão. Unir clientes é outra decisão.
- A busca de cliente por nome (`buscar_cliente_por_nome`) passa a comparar sem diferenciar caixa e acento, para o autocadastro
  não criar duplicata por causa da grafia.
- Mudar o nome **não** reescreve publicações, capa nem histórico: só `clientes.nome` e `casos.titulo`.
- Não há rotina agendada: é uma ação do administrador e uma regra na criação. Sem ligar/desligar nem notificação.

## Decisões pendentes
1. **Aplicar também a casos e títulos já existentes?** Recomendo sim, com a mesma prévia (o título "AUTOR X RÉU" é o mais
   feio hoje). Alternativa: só clientes.
2. **Lista de exceções editável:** recomendo incluir já (uma caixinha de texto na própria tela, uma grafia por linha). Alternativa:
   deixar a lista só no código e adicionar sob pedido.

## Aceite
- Conjunto de teste (siglas, partículas, razões sociais, algarismos romanos, apóstrofos) dá o mesmo resultado no Python e no Node.
- Reaplicar não muda nada (idempotente); nome em caixa mista não é tocado.
- Aplicar grava o anterior; desfazer restaura; desfazer recusa quando o nome mudou depois.
- Duplicado aparece marcado e fica fora da seleção padrão.
- CPF/CNPJ, OAB, CNJ e capa permanecem intactos (teste com valores nesses campos).

## Implementação
- `nomes.py` (regra, exceções, saneamento, desfazer), rotas `/admin/nomes/{verificar,aplicar,desfazer,excecoes}`, painel "Normalizar nomes"
  na aba Banco de dados. Cliente novo e título criados a partir de publicação já saem normalizados (partes e capa ficam como vieram).
- `buscar_cliente_por_nome` passou a ignorar acento (o `lower()` do SQLite não trata "JOSÉ").
- Desvio do plano: a regra **não** foi espelhada no frontend. Nada no frontend grava nome, e a exibição (`formatarNomeExibicao`) continua
  como estava; espelhar seria código sem uso. `frontend/tests/casos-nomes.json` é a tabela de referência dos testes Python.
- Verificação: `test_nomes.py` (17) + suíte completa; no navegador: verificar, aplicar a todos e desfazer todos.
