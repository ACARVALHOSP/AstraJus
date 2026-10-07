# cnj-processual

Servidor MCP e painel web (`/app`) para consulta processual judicial brasileira via APIs públicas do CNJ (DataJud e DJEN).

## Language

**Consulta**:
Busca pontual e manual, feita uma vez, contra a API do DataJud ou do DJEN a partir dos parâmetros informados pelo usuário no formulário do `/app`.
_Avoid_: Busca, pesquisa

**Histórico**:
Registro automático, local ao navegador (`localStorage`, por dispositivo, não sincronizado), das últimas consultas feitas pelo usuário no `/app`, para repetição rápida sem redigitar os campos.
_Avoid_: Log, cache de busca

**Favorito**:
Processo (tribunal + número) marcado manualmente pelo usuário no `/app`, guardado localmente, para acesso rápido independente do histórico.
_Avoid_: Salvo, marcado

**Monitoramento**:
Acompanhamento recorrente de um processo ou OAB, configurado pelo usuário autenticado no `/app`, que dispara verificações periódicas no DJEN (a cada 6 horas) e avisa por e-mail (resumo + link) quando surge publicação nova. Diferente de uma Consulta: não é pontual, persiste no servidor atrelado ao usuário, tem limite de 5 por usuário, e expira automaticamente após 180 dias sem publicação nova (o prazo é renovado a cada publicação encontrada).
_Avoid_: Alerta, assinatura, inscrição (pode confundir com cobrança)
