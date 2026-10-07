# Utilidades do painel /app: histórico, favoritos, paginação, copiar texto e monitoramento por e-mail

Status: ready-for-agent

## Problem Statement

Quem usa o painel `/app` do cnj-processual hoje perde trabalho repetido: toda Consulta exige
preencher o formulário do zero, não há como voltar rápido a um processo específico, publicações
extensas vêm em texto corrido sem forma fácil de copiar, resultados de Publicações ficam limitados
à primeira página sem forma de avançar, e não existe nenhuma forma de saber que surgiu uma
publicação nova sem abrir o painel e repetir a Consulta manualmente — mesmo sendo usuário
cadastrado e autenticado.

## Solution

Adicionar ao painel `/app`: Histórico automático e Favoritos manuais (ambos só no navegador, via
`localStorage`, sem mudança no servidor); paginação de verdade nos resultados de Publicações
(anterior/próxima); um botão para copiar o texto de uma publicação; e Monitoramento — um recurso
novo do lado do servidor que permite ao usuário autenticado acompanhar um processo e/ou uma OAB e
receber um e-mail de resumo+link sempre que surgir uma nova Publicação, verificado a cada 6 horas,
com limite de 5 monitoramentos por usuário e expiração automática após 180 dias sem novidade.

## User Stories

1. Como usuária do painel que já fez uma Consulta de processo, quero que o formulário seja preenchido automaticamente ao escolher um item do Histórico, para não redigitar tribunal e número.
2. Como usuária do painel, quero ver as últimas consultas que fiz (Histórico), tanto de Processo quanto de Publicações, para retomar de onde parei.
3. Como usuária do painel, quero que o Histórico guarde só as últimas ~10 consultas, para não virar uma lista infinita.
4. Como usuária do painel, quero que o Histórico fique salvo só no meu navegador, para não expor minhas buscas a quem tiver meu token em outro dispositivo.
5. Como usuária do painel, quero marcar um processo como Favorito, para acessá-lo rápido sem precisar que ele apareça no Histórico recente.
6. Como usuária do painel, quero remover um Favorito quando ele não interessar mais.
7. Como usuária do painel, quero que Favoritos e Histórico sejam listas visualmente distintas, para não confundir o que marquei de propósito com o que só busquei de passagem.
8. Como usuária do painel buscando Publicações, quero navegar para a próxima página de resultados quando o total for maior que o que já veio, para ver todos os itens sem mudar manualmente o número da página.
9. Como usuária do painel, quero voltar para a página anterior de Publicações, para revisar um item que já passei.
10. Como usuária do painel, quero saber se existe uma "próxima página" antes de clicar, para não navegar à toa quando já estou no fim da lista.
11. Como usuária do painel vendo o texto de uma Publicação, quero copiar esse texto para a área de transferência com um clique, para colar em outro documento sem selecionar manualmente.
12. Como usuária do painel, quero uma confirmação visual rápida de que o texto foi copiado, para saber que a ação funcionou.
13. Como usuária autenticada do painel, quero criar um Monitoramento a partir de um resultado de Consulta (processo ou OAB), para não ter que redigitar os dados ao configurá-lo.
14. Como usuária autenticada, quero ver a lista dos meus Monitoramentos ativos ("Meus monitoramentos"), para saber o que estou acompanhando.
15. Como usuária autenticada, quero remover um Monitoramento que não me interessa mais, para parar de receber e-mails sobre ele.
16. Como usuária autenticada, quero ser impedida de criar um sexto Monitoramento quando já tenho 5 ativos, com uma mensagem clara do limite, para entender por que não consegui.
17. Como usuária autenticada com um Monitoramento ativo, quero receber um e-mail de resumo com link quando sair uma Publicação nova para o processo/OAB acompanhado, para saber sem precisar abrir o painel toda hora.
18. Como usuária autenticada, quero que o e-mail de Monitoramento não repita a mesma Publicação duas vezes, para não ser inundada de avisos duplicados.
19. Como operadora do servidor, quero que a verificação de Monitoramentos rode a cada 6 horas automaticamente, para não depender de ação manual.
20. Como operadora do servidor, quero que um Monitoramento sem nenhuma Publicação nova por 180 dias expire automaticamente, para não acumular monitoramentos de processos esquecidos ou encerrados.
21. Como operadora do servidor, quero que o prazo de expiração de um Monitoramento seja renovado sempre que uma Publicação nova é encontrada, para não cortar o acompanhamento de um caso realmente ativo.
22. Como usuária que usa o Claude (fora do painel `/app`) com o cnj-processual conectado, quero poder pedir em linguagem natural para "acompanhar o processo X" e ter isso registrado como Monitoramento, para usar o mesmo recurso sem precisar abrir o navegador.
23. Como administradora do sistema, quero que um usuário criado manualmente (sem e-mail como nome) receba um erro claro ao tentar criar um Monitoramento, para entender que esse recurso depende de ter um e-mail de destino válido.
24. Como usuária do painel, quero que falhas de conexão com o DJEN durante a verificação periódica não quebrem o Monitoramento nem gerem e-mails de erro, para não ser incomodada por instabilidades temporárias da API pública.
25. Como usuária do painel, quero que todas essas utilidades novas sigam o estilo visual Carbon já usado no resto do `/app`, para manter a experiência consistente.

## Implementation Decisions

- **Um seam só**: toda a lógica de Monitoramento vive em funções puras (recebem como parâmetros
  explícitos o registro de monitoramentos, o cliente HTTP do DJEN e um relógio `agora`, sem estado
  global oculto). As 3 tools MCP novas e o job do scheduler são wrappers finos em torno dessas
  mesmas funções — é o único ponto testado automaticamente nesta feature.
- **3 novas tools MCP** (`monitorar_publicacoes`, `listar_monitoramentos`, `remover_monitoramento`),
  registradas com `@mcp.tool()` igual às 3 tools existentes, expostas pelo mesmo endpoint `/mcp`
  autenticado já existente — nenhuma rota HTTP nova.
- **Identificação do usuário dentro da tool**: a tool recebe `ctx: Context`, lê
  `ctx.request_context.request.headers["authorization"]` (Bearer token) e chama
  `RegistroUsuarios.identificar(token)` — reaproveita a mesma extração que `_AutenticacaoBearer`
  já faz, sem novo mecanismo de autenticação.
- Monitoramento exige que o `nome` do usuário identificado seja um e-mail válido (contém `@`);
  caso contrário a tool devolve erro estruturado (`{"erro": true, "mensagem": "..."}`) sem criar
  o registro.
- **Armazenamento**: novo arquivo `monitoramentos.json`, numa classe nova `RegistroMonitoramentos`
  que copia o padrão de `RegistroUsuarios` (leitura com cache por mtime, escrita atômica via
  arquivo temporário + `os.replace`, lock de threading, método `atualizar(alterar)`). Cada registro
  guarda: usuário (e-mail), critério de busca (processo e/ou OAB+UF), data de criação, referência
  da última publicação vista (hash ou timestamp) e data de expiração corrente.
- Limite de 5 monitoramentos ativos por usuário, verificado na criação.
- **Verificação periódica**: `APScheduler` (`AsyncIOScheduler`, já que o servidor roda num loop
  asyncio), iniciado em `_principal()`, agendado a cada 6 horas, chamando
  `_verificar_monitoramentos_pendentes(agora=...)`.
- `_verificar_monitoramentos_pendentes()`: para cada monitoramento ativo, reaproveita
  `_djen_get_com_retry`/`_extrair_publicacao_djen` com os critérios salvos, compara contra a última
  publicação vista, e se houver item mais novo: envia e-mail (nova função `_enviar_aviso_monitoramento`,
  reaproveitando o padrão SMTP de `_enviar_token_por_email`), atualiza a última publicação vista e
  renova a expiração para "agora + 180 dias". Sem item novo e expirado, marca o monitoramento como
  removido.
- Falhas de rede/DJEN durante a verificação (timeout, geo-bloqueio 403, 5xx) são logadas e
  ignoradas só para aquele ciclo — não expiram o monitoramento, não disparam e-mail de erro, não
  interrompem a verificação dos demais.
- E-mail de aviso: assunto curto, corpo com resumo (tribunal, classe, data de disponibilização) e
  link para abrir `/app` — sem o texto completo da publicação.
- **Frontend**: botão "Acompanhar" nos cards de resultado de Publicações (chama
  `monitorar_publicacoes` via `ClienteMCP.chamarTool`, já existente) e nova seção "Meus
  monitoramentos" (lista via `listar_monitoramentos`, remove via `remover_monitoramento`).
- **Histórico e Favoritos**: 100% em `app.js`, duas chaves de `localStorage` (ex: `cnj_historico`,
  `cnj_favoritos`), sem chamada ao servidor. Histórico: últimas 10 consultas (tipo + parâmetros +
  timestamp), atualizado a cada busca bem-sucedida. Favoritos: tribunal+número de processo,
  adicionados/removidos manualmente.
- **Paginação de Publicações**: controle "anterior/próxima" usando o parâmetro `pagina` que
  `consultar_publicacoes_djen` já aceita; estado da página atual em memória no `app.js`.
- **Copiar texto**: botão por card de Publicação usando `navigator.clipboard.writeText`, com
  confirmação visual temporária (ex: texto do botão muda para "Copiado!" por alguns segundos).
- Nova dependência: `APScheduler` (ainda não está em `pyproject.toml`).

## Testing Decisions

- Um bom teste aqui verifica comportamento externo (o que a função devolve/envia), não detalhes de
  implementação — mesmo padrão já usado em `DataJudTest`/`DjenTest`/`CertidaoTest`.
- Todo o módulo de Monitoramento (criar, listar, remover, verificar) é testado chamando as funções
  puras direto (`_rodar(server.<funcao>(...))`), com `httpx.MockTransport` para as chamadas ao DJEN
  e `unittest.mock.patch` para o envio SMTP (sem rede real) — prior art: `DataJudTest`, `DjenTest`,
  `CertidaoTest`, e o teste de SMTP já existente `test_envio_smtp_usa_starttls_e_login`.
- Relógio injetável (`agora` como parâmetro) para testar expiração de 180 dias e renovação sem
  esperar tempo real — prior art: `_Relogio` em `LimiteDeUsoTest`.
- `RegistroDeToolsTest` é atualizado para esperar 6 nomes de tools (as 3 existentes + as 3 novas).
- Testes de identificação do usuário evitam montar um request Starlette completo sempre que
  possível, testando a função pura com o "usuário" já resolvido como parâmetro; só quando for
  inevitável simular `ctx.request_context.request`, documentar isso no próprio teste.
- Frontend (histórico, favoritos, paginação, copiar, botão "Acompanhar", seção "Meus
  monitoramentos"): sem teste automatizado — não existe framework de teste JS no projeto hoje.
  Verificado manualmente no navegador (Browser tool), como o resto do `/app` sempre foi.

## Out of Scope

- Indicador de limite de uso (rate limit) restante no painel.
- Marca de "certidão já baixada" por publicação.
- Busca em lote (múltiplos processos de uma vez).
- Modo escuro.
- Botão "tentar novamente" explícito em timeout do DataJud.
- Sincronização de Histórico/Favoritos entre dispositivos (ficam só locais ao navegador).
- Monitoramento para usuários cujo `nome` cadastrado não é um e-mail (ex: contas criadas
  manualmente pelo admin com nome simples).
- Qualquer canal de notificação diferente de e-mail (push, SMS, webhook).
- Frequência de verificação configurável por usuário (fixa em 6 horas para todos).

## Further Notes

- Vocabulário deste spec (Consulta, Histórico, Favorito, Monitoramento) vem de `CONTEXT.md`,
  criado na sessão de grilling que precedeu este spec.
- O repositório núcleo público (`cnj-processual-publico`, stdio-only, sem autenticação) não é
  afetado por nada deste spec: Histórico, Favoritos, paginação e Monitoramento existem só no
  sistema privado hospedado (`cnj-processual`).
