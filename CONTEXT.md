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


**Processo (gestão do escritório)**:
Entidade principal do cadastro, com partes, capa, atividades, publicações e movimentações.
Cada cadastro tem zero ou um número CNJ (20 dígitos, armazenado sem máscara).
O número é opcional enquanto ainda não existir. Recursos, apensos e execuções
são cadastros separados, relacionados por vínculos entre processos.
_Avoid_: Caso como nome da entidade na interface.

Os nomes físicos legados `casos`, `caso_id`, `caso_processos` e as rotas `/casos`
são mantidos por compatibilidade. A lista `numeros_processo` da API aceita no máximo
um item. A migração divide cadastros antigos com vários números: o primeiro em ordem
lexicográfica mantém o ID original; os demais recebem IDs e números internos novos,
com vínculo ao original. Capa, eventos e publicações identificados pelo CNJ acompanham
o cadastro correspondente. Clientes adicionais são copiados. Atividades, financeiro,
eventos sem CNJ e vínculos prévios ficam no original, evitando duplicação de obrigações.
A pasta Drive existente continua acessível pelos cadastros derivados.
