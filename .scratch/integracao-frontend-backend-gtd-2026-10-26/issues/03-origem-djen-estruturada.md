# I03 — Estruturar referência DJEN sem ampliar acesso

Status: ready-for-agent
Execução: concluída no workspace
Grau: S2 provisório

## Contrato

[Spec I03](../spec-i03-origem-djen.md): hash estruturado/versionado, migração idempotente e compatibilidade com clientes antigos, remoção explícita da referência e preservação após desvinculação. Conteúdo só pela coleção autorizada do mesmo processo.

## Próxima ação

Implementação concluída após verificar o acesso compartilhado por usuário autenticado das rotas atuais. Validação de vínculo com o processo é feita na transação da gravação; consulta de conteúdo continua somente pela coleção desse processo. Não foi criada política nova de acesso privado nem endpoint global por hash.

## Aceite

Executar cenários da spec em SQLite temporário e APIs simuladas; nenhuma referência/cópia de conteúdo pode contornar autorização ou vínculo atual. PATCH omitido preserva; null explícito remove; marcador antigo não ressuscita origem removida.

## Comments

- 26/10/2026: especificação solicitada pelo usuário, sem autorização inferida para implementar esta etapa.
- 26/10/2026: usuário instruiu “continuar” após as specs e o próximo passo I03. Implementados migração, contrato, compatibilidade frontend/servidor antigo, remoção explícita via API, desvinculação condicionada e invalidação de conteúdo carregado. 259 testes de backend e seis testes focados de interface aprovados. Resultados em ../acompanhamento.md.
