## Agent skills

### PR e merge

Alterações somente no frontend são publicadas pelo push na branch `astrajus-radix` (workflow `deploy-radix.yml`): não criar PR nem fazer merge em `main`. PR e merge da `astrajus-radix` em `main` só quando houver alteração de backend, e somente após confirmação do usuário (ver `CLAUDE.md` na raiz).

### VPS

O usuário SSH do VPS `191.252.110.22` é `admin`. Usar esse usuário nos próximos acessos; não tentar `root` como padrão. O deploy independente do React está documentado em `deploy/README.md`.

### Auditoria Carbon: envio autorizado

O usuário autoriza de forma permanente o envio de código deste projeto ao serviço de auditoria Carbon (`carbon_ds_code_audit`), sem nova confirmação a cada auditoria. A autorização é específica para essa finalidade e não inclui credenciais ou segredos.

### Ícones e movimento

O frontend React usa Radix Themes e ícones `lucide-react` (ver `DESIGN.md`). Não substituir ícones por emojis, caracteres Unicode ou desenhos improvisados. Verificar os nomes e imports dos ícones antes de utilizá-los.

Animações e transições devem ser curtas, comunicar estado, continuidade ou feedback útil e respeitar `prefers-reduced-motion`.

### Carbon Builder: aprovação visual

Sempre que usar a skill `carbon-builder`, apresentar um mockup e obter autorização explícita do usuário antes de alterar o frontend. Preparar a prévia em um artefato separado, preservando a aplicação até a aprovação.

### Issue tracker

Markdown local — issues e specs vivem em `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Labels padrão (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Contexto único (`CONTEXT.md` + `docs/adr/` na raiz). See `docs/agents/domain.md`.
