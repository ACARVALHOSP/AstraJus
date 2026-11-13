# Módulos plugáveis

Cada módulo é uma pasta `modulos/<id>/` com:

- `manifest.json` — identidade e contrato com o núcleo (abaixo);
- `servico.py` — o código: funções `@ferramenta` (viram ferramentas MCP) e, se tiver rotas HTTP,
  `async def http(scope, send, caminho) -> bool`. Serviços do núcleo (`_cliente`, `_erro`, `_json`,
  `log`...) vêm de `from modulos.nucleo import nucleo`; nunca importe `server` direto;
- opcional `migrar(conexao)` em `servico.py`, chamada na partida enquanto o módulo estiver ativo e
  listado com `tabelas` no manifesto (crie só tabelas próprias, com `CREATE TABLE IF NOT EXISTS`).

No frontend, a tela do módulo é `frontend/src/modulos/<id>/index.tsx` (export default). O menu, as rotas
e o gerenciador (Configurações › Módulos) são montados a partir de `GET /modulos`.

## manifest.json

| campo | função |
| --- | --- |
| `id` | igual ao nome da pasta |
| `nome`, `descricao`, `versao` | exibidos no gerenciador |
| `ativo_por_padrao` | estado inicial (padrão `true`) |
| `aba` | `{id, rotulo, grupo, icone}`: onde aparece no menu (`grupo` = `trabalho`, `pesquisa`, `financeiro`, `configuracoes`; `icone` = nome lucide registrado em `frontend/src/modulos/registro.ts`) |
| `area_permissao` | área de permissão exigida (`pesquisa`, `casos`...). Área nova vai em `permissoes` |
| `permissoes` | `{area: rótulo}` de áreas novas que o módulo cria |
| `ferramentas` | nomes das ferramentas MCP (conferidos com o código na partida) |
| `ferramentas_consulta` | subconjunto liberado a perfis só de consulta |
| `rotas_http` | prefixos de rota entregues ao `http()` do módulo |
| `dependencias` | ids de outros módulos; ligar exige as dependências ligadas, desligar exige que ninguém ativo dependa |
| `tabelas` | tabelas próprias (documentação e gatilho do `migrar`) |

Módulo desativado: some do menu, a rota HTTP responde 404, a ferramenta MCP devolve erro de "módulo
desativado". Os dados são mantidos. O estado fica na tabela `modulos_estado` do banco do escritório.
