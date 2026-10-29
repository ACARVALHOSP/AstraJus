## Agent skills

### Ícones e movimento Carbon

Sempre usar ícones oficiais do Carbon Design System; não substituir ícones por emojis, caracteres Unicode ou desenhos improvisados. Verificar os nomes e imports dos ícones antes de utilizá-los.

Animações e transições devem seguir as diretrizes e os tokens oficiais Carbon Motion, respeitando `prefers-reduced-motion`. Aplicar movimento quando ele comunicar estado, continuidade ou feedback útil.

### Carbon Builder: aprovação visual

Sempre que usar a skill `carbon-builder`, apresentar um mockup e obter autorização explícita do usuário antes de alterar o frontend. Preparar a prévia em um artefato separado, preservando a aplicação até a aprovação.

### Issue tracker

Markdown local — issues e specs vivem em `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Labels padrão (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Contexto único (`CONTEXT.md` + `docs/adr/` na raiz). See `docs/agents/domain.md`.
