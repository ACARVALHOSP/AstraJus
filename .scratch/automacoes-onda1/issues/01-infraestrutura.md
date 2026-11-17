# Infraestrutura: configuração, tela Automações e auditoria

Status: implementado (aguardando PR para main)
Blocked by: —
Tamanho: M
Spec: ../spec.md

## Escopo (refinado após ler o código)

Backend (arquivo novo `automacoes.py`; entra no `COPY` do Dockerfile e em `py-modules` do `pyproject.toml`, e na lista de
`py_compile` dos workflows):
- Catálogo das rotinas com padrão e parâmetros: `monitoramentos`, `captura_oab`, `movimentos`, `alertas_prazo`,
  `triagem_publicacoes` (as cinco que já rodam em `_montar_agendador`). Padrão **ligada**: nada muda para quem não mexer.
- Tabelas `automacoes_config (chave, ativo, parametros JSON, atualizado_em, atualizado_por)` e
  `automacoes_config_historico (id, ocorrido_em, ator, chave, antes, depois)`. Só o que o administrador muda é gravado.
- `monitoramento_runtime.Repositorio.executar` passa a consultar a configuração: rotina **desligada** não executa (e não
  conta como falha). Rotina nova usa o mesmo caminho.
- Rotas (só administrador ou token administrativo, no despachante de `/admin/usuarios` e `/admin/banco`):
  - `GET /admin/automacoes/api` — catálogo completo com estado, parâmetros, última execução, resultado e erro, mais as
    últimas alterações de configuração.
  - `PUT /admin/automacoes/api/<chave>` — liga/desliga e altera parâmetros validados pelo catálogo; grava no histórico.
  - O `GET /automacoes` antigo (3 rotinas, aberto a qualquer usuário autenticado) foi mantido como está, para não
    quebrar quem o usa; pode ser removido depois.

Frontend: aba "Automações" em Administração (lista, interruptor, parâmetros, última execução, erros, alterações recentes).

Adiados para os tickets que usam (evita código sem uso): **modo simulação** (05 e 07) e **evento no caso com origem
`automacao:<chave>`** (05 e 07).

## Aceite
- Com a configuração intocada, as cinco rotinas continuam rodando como hoje.
- Desligar uma rotina impede a execução seguinte; religar retoma sem rodada em duplicidade.
- Não administrador recebe 403 em todas as rotas; parâmetro inválido é recusado com mensagem clara.
- Toda alteração aparece no histórico (quem, quando, antes e depois).
- Testes: catálogo/validação, persistência, `executar` respeitando o interruptor, rotas (403 e sucesso), teste do frontend
  para a lógica pura da tela.

## Como ficou (implementação)

- Backend: `automacoes.py` (catálogo, `Repositorio`), `monitoramento_runtime.Repositorio.executar` respeita o interruptor,
  rotas em `usuarios_admin.tratar`, despacho em `server.py`. Arquivo novo já entrou no `Dockerfile`, no `pyproject.toml`
  (`py-modules`) e no `py_compile` dos dois workflows.
- Frontend: aba "Automações" em Administração (`administracao/AutomacoesAdmin.tsx`, lógica em `automacoes.ts`).
  Desligar pede confirmação; religar é direto.
- Testes: `test_automacoes.py` (17) e `frontend/tests/automacoes.test.mjs` (5). Conferido no navegador contra o servidor real
  (listar, desligar com confirmação, religar, histórico, 403 sem token).
- Os parâmetros por rotina existem no mecanismo (validação, edição na tela), mas nenhuma das cinco rotinas atuais tem
  parâmetro; o primeiro uso real é o ticket 02 (dias sem movimentação) e o 03 (faixas).
