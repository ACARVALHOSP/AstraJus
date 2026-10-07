# Tarefa: construir servidor MCP "cnj-processual"

Construa um servidor MCP (Model Context Protocol) em Python que expõe duas tools para consulta processual judicial brasileira via APIs públicas do CNJ. Use o SDK oficial `mcp` (pacote PyPI `mcp`, também conhecido como `modelcontextprotocol`). Transporte: stdio.

## Tool 1: `consultar_processo_datajud`

Consulta metadados de processo (movimentações, classe, órgão julgador) via API Pública do DataJud.

- Parâmetros: `tribunal` (string, sigla minúscula ex: "tjsp", "trf1", "stj"), `numero_processo` (string, aceita com ou sem máscara — remover formatação antes de usar)
- Endpoint: `POST https://api-publica.datajud.cnj.jus.br/api_publica_{tribunal}/_search`
- Header: `Authorization: APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==` (chave pública oficial do CNJ, divulgada em https://datajud-wiki.cnj.jus.br/api-publica/ — documentar no código que ela pode ser rotacionada pelo CNJ, e permitir override via variável de ambiente `DATAJUD_API_KEY`)
- Content-Type: application/json
- Body: `{"query": {"match": {"numeroProcesso": "<numero_sem_formatacao>"}}}`
- **CRÍTICO: use timeout HTTP de no mínimo 70 segundos.** Essa API é frequentemente lenta (observado ~48s de resposta em teste real), e timeouts curtos (20-30s) geram falso negativo. Implementar retry com backoff (ex: 2 tentativas) em caso de timeout, antes de reportar erro ao caller.
- Resposta: extrair de `hits.hits[]._source` os campos relevantes: `classe.nome`, `dataAjuizamento`, `orgaoJulgador.nome`, `tribunal`, `grau`, `movimentos[]` (cada um com `codigo`, `nome`, `dataHora`, e opcionalmente `complementosTabelados`)
- Se `hits.total.value == 0`: retornar mensagem clara de "processo não encontrado nesse tribunal" (não é erro)
- NÃO retorna nomes de partes (API DataJud não expõe esse dado por política de proteção de dados) — documentar isso no docstring da tool

## Tool 2: `consultar_publicacoes_djen`

Consulta publicações/intimações do Diário de Justiça Eletrônico Nacional (DJEN) via API pública Comunica PJe.

- Parâmetros (todos opcionais, mas exigir ao menos um entre `numero_processo` e `numero_oab`):
  - `numero_processo` (string, 20 dígitos, remover máscara se vier formatado)
  - `sigla_tribunal` (string, ex "TJSP")
  - `numero_oab` (string)
  - `uf_oab` (string, 2 letras)
  - `data_disponibilizacao_inicio` (string YYYY-MM-DD)
  - `data_disponibilizacao_fim` (string YYYY-MM-DD)
  - `pagina` (int, default 1)
  - `itens_por_pagina` (int, default 50)
- Endpoint: `GET https://comunicaapi.pje.jus.br/api/v1/comunicacao` (sem autenticação)
- Passar os parâmetros como query string (usar nomes exatos da API: numeroProcesso, siglaTribunal, numeroOab, ufOab, dataDisponibilizacaoInicio, dataDisponibilizacaoFim, pagina, itensPorPagina)
- Timeout: 30s é suficiente para esta API (ela é rápida)
- Resposta: retornar lista estruturada a partir de `items[]`, extraindo: `data_disponibilizacao`, `siglaTribunal`, `nomeOrgao`, `tipoComunicacao`, `tipoDocumento`, `nomeClasse`, `numeroprocessocommascara`, `hash`, `link`, `destinatarios[]` (lista de {nome, polo}), `destinatarioadvogados[].advogado` (lista de {nome, numero_oab, uf_oab})
- O campo `texto` vem em HTML bruto com entidades HTML (ex: `&aacute;`) — decodificar entidades e stripar tags HTML antes de incluir no resultado, mantendo o texto legível em texto puro
- Se `numero_oab` for fornecido, documentar no docstring que diferentes tribunais gravam a OAB com sufixos variados (ex: "123456", "123456-O", "123456-A") e a busca pode não encontrar tudo — não é necessário implementar retry automático de sufixos nesta v1, apenas documentar a limitação
- Tratar HTTP 403 como geo-bloqueio (API bloqueia IPs fora do Brasil) com mensagem de erro clara
- Tratar HTTP 500 com retry simples (1 retry) antes de propagar erro

## Tool 3 (bônus, opcional se der tempo): `baixar_certidao_djen`

- Parâmetro: `hash` (string, do campo `hash` retornado por consultar_publicacoes_djen)
- Endpoint: `GET https://comunicaapi.pje.jus.br/api/v1/comunicacao/{hash}/certidao`
- Retorna PDF binário — salvar em arquivo temporário e retornar o caminho do arquivo salvo (não tentar devolver bytes brutos na resposta MCP)

## Requisitos gerais do projeto

- Estrutura: `server.py` (entrypoint do servidor MCP), `pyproject.toml` com dependências (`mcp`, `httpx` para HTTP async)
- Usar `httpx.AsyncClient` para as chamadas HTTP (async/await)
- Cada tool deve ter docstring claro em português explicando parâmetros, comportamento e limitações (isso é o que o modelo que for usar a tool vai ler)
- Tratamento de erro: nunca deixar uma exceção não tratada estourar — sempre retornar uma mensagem de erro estruturada e legível para o caller
- Incluir um `README.md` explicando:
  1. Como instalar dependências (`pip install -e .` ou `uv sync`)
  2. Como rodar o servidor standalone para teste (`python server.py`)
  3. Como registrar esse servidor no Hermes (adicionar ao `config.yaml` do Hermes na seção de MCP servers — pesquisar o formato esperado se não tiver certeza, mas tipicamente é algo como um bloco com `command`, `args`, `env`)
  4. Exemplo de uso de cada tool com parâmetros de exemplo
- Escrever um pequeno script de teste manual (`test_manual.py` ou similar) que chama as funções das tools diretamente (sem precisar do protocolo MCP completo) contra os endpoints reais, usando o processo real `1006314-27.2023.8.26.0005` no tribunal `tjsp` como caso de teste, e rodar esse teste para confirmar que ambas as tools funcionam de ponta a ponta antes de finalizar
- Não usar bibliotecas além do necessário (mcp, httpx, stdlib)

## Critério de conclusão

- Projeto roda sem erros de sintaxe/import (`python -c "import server"` ou equivalente passa)
- Teste manual contra as APIs reais (processo 1006314-27.2023.8.26.0005, tjsp) retorna dados reais e corretos para as duas tools principais
- README completo e correto
