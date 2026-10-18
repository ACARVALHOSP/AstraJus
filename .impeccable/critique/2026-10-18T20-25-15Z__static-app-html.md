---
target: app.html
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:C:\\Users\\ariel\\mcp-servers\\cnj-processual\\static\\app.html"
target_fingerprint: "sha256:49ed0b764dea718c06a94c35d77f6a080891fbb8beccd6a6b298a5bf02652511"
target_path: "C:\\Users\\ariel\\mcp-servers\\cnj-processual\\static\\app.html"
timestamp: 2026-10-18T20-25-15Z
slug: static-app-html
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good loading spinner with timer; token status tag is the only auth confirmation and requires the user to notice it. No data-freshness indicator on Monitoramentos. |
| 2 | Match System / Real World | 2 | Sidebar exposes infrastructure names ("Processo (DataJud)", "Publicações (DJEN)") instead of user goals. Desfecho vocabulary and timeline categories are precise legal domain knowledge — the gap is in the navigation shell, not the tools. |
| 3 | User Control and Freedom | 2 | Modals have Cancel/X. "Voltar" exists in detail views. The `remover_monitoramento` call fires directly with no confirmation — the single most consequential destructive action in the product has no guard. |
| 4 | Consistency and Standards | 2 | Three separate tab implementations in one codebase with different class-name state signals and visual styles. Modal close button in modal-atividade uses the ✕ Unicode character; all others use a properly aria-hidden SVG. |
| 5 | Error Prevention | 3 | Deletion modals use role="alertdialog" correctly. Required fields marked. Token field uses type="password". Monitoring removal is the one unguarded exception. |
| 6 | Recognition Rather Than Recall | 2 | Favorites, history, and sidebar always visible. But "Publicações por OAB" only populates after configuring a monitoring elsewhere — the dependency is explained in help text most users will miss on first encounter. |
| 7 | Flexibility and Efficiency | 1 | Skip link present. No arrow-key tab navigation (WAI-ARIA tablist spec requires it). No search/filter on Casos list. No keyboard shortcuts. No batch actions on cases. |
| 8 | Aesthetic and Minimalist Design | 2 | Nine flat top-level nav items with no grouping. Six non-functional "Conceito" tiles in Jurimetria add visual noise. Header identity space says "cnj-processual" — wasted real estate. |
| 9 | Error Recovery | 3 | Error messages are specific and actionable throughout. Form state preserved on error. |
| 10 | Help and Documentation | 2 | Good contextual campo-ajuda under most inputs. Footer links to user guide. Empty states explain why sections are empty. No onboarding for first-time users. |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

The interface is domain-aware at the data layer and generic at the product layer. The timeline with smart movement grouping, the inline prazo calculator with the correct four Brazilian legal counting types, the Desfecho vocabulary — these are precisely authored for a Brazilian lawyer. The product shell around them is generic: the title reads "Painel de consulta · cnj-processual," the h1 reads "Painel de consulta," and the header label reads "cnj-processual." "AstraJus" appears nowhere in the UI. The navigation names the underlying APIs rather than user goals.

**Deterministic scan:** 34 findings, exit code 2. After removing false positives (14 from Carbon vendor CSS — cramped-padding on cds--tile/cds--modal-container, side-tab on cds--tree-node, marquee on AI skeleton, dark-glow on focus color), 20 real findings remain. All 20 are low-contrast placeholders caused by a single CSS rule at app.html line 19: `.cds--text-input::placeholder { color: var(--cds-text-secondary, #525252); }` which resolves to #9b9b9b on #f4f4f4 (2.5:1 ratio). Fix: remove line 19 entirely.

**Browser inspection:** Port 8080 was a different application on this machine. The CNJ panel runs on port 8000; access was denied. Live overlay inspection was not possible.

## Overall Impression

The tools inside AstraJus are genuinely good — the timeline, the prazo calculator, and the error messages are production-quality work. The product shell around them has not been designed yet: no identity, no navigation architecture, and one quietly dangerous missing confirmation. The highest-leverage change is also the cheapest: replace "cnj-processual" with "AstraJus" in the header and title.

## What's Working

1. **Timeline with smart movement grouping.** Categorizes movements into decisão, petição, tramitação, collapses consecutive tramitação items, marks decisions in red. Legal domain knowledge embedded in interaction logic, placed exactly where users consult it.

2. **Inline prazo calculator on the publication card.** Implements four correct Brazilian legal counting types. Day-by-day table in the format lawyers recognize. Opens inline on the card where the deadline source lives.

3. **Actionable, specific error messages.** "Token inválido, expirado ou revogado. Confira o token ou peça um novo em /cadastro" and "Limite de uso atingido. Tente de novo em 45s" — name the exact cause and give a concrete next step. Maintained throughout via the ErroMCP error class pattern.

## Priority Issues

**[P0] No product identity — the interface carries no "AstraJus" branding**
- What: `<p class="cds--label">cnj-processual</p>`, `<h1>Painel de consulta</h1>`, and `<title>Painel de consulta · cnj-processual</title>` are the only identity signals. "AstraJus" appears nowhere.
- Why it matters: The product's positioning is "self-hosted, lawyer-owned data." Trust requires a name. A lawyer evaluating whether to run this server sees a package name, not a product.
- Fix: Replace the header label and h1 with an AstraJus wordmark + subtitle. Update title to "AstraJus". Three HTML changes.

**[P1] Monitoring removal fires the API with no confirmation dialog**
- What: In cartaoMonitoramento, the "Remover" button calls remover_monitoramento directly. Every other destructive action uses the existing modal-confirmar (role="alertdialog") infrastructure.
- Why it matters: Accidentally removed monitoring for a process in active litigation stops DJEN alerts silently. Missed publications → missed deadlines → OAB disciplinary risk. Highest-stakes irreversible action in the product, only one without a guard.
- Fix: Wrap in the existing confirmarAcao pattern with a clear consequence statement. Five lines of JavaScript.

**[P1] Nine flat sidebar items with no grouping exceeds working memory capacity**
- What: Nine undifferentiated items with API names as labels (DataJud, DJEN), no section breaks, no hierarchy.
- Why it matters: Exceeds 4-item working memory limit for scan-and-select navigation. First-time users cannot infer the product's conceptual model. Conceptually related items separated (Monitoramentos from Publicações por OAB; Contatos from Casos).
- Fix: Group with section labels — Consulta (Processo, Publicações DJEN), Escritório (Contatos, Casos), Monitoramento (Monitoramentos, Publicações por OAB), Ferramentas (Jurimetria, Histórico). Move Acesso to header.

**[P1] "Contatos" vs "Clientes" — same entity, two names**
- What: Sidebar says "Contatos," modal title says "Novo contato," form IDs say form-cliente/cliente-nome, "Novo caso" modal asks for "Cliente," API uses /clientes.
- Why it matters: Creates confusion for the office assistant doing daily data entry. Legally, "cliente" (retainer, confidentiality) and "contato" (opposing party, witness) are distinct — the naming obscures both.
- Fix: Pick one name (recommendation: "Clientes" to match the case model and API) and apply consistently across all UI labels.

**[P1] All 20 placeholder inputs fail WCAG AA contrast — one CSS line to fix**
- What: app.html line 19 overrides Carbon's placeholder color with --cds-text-secondary, which resolves to #9b9b9b on #f4f4f4 (2.5:1 ratio; needs 4.5:1).
- Why it matters: Placeholder text is the primary affordance for what to type. Invisible to users with low vision. Affects every input in the product.
- Fix: Delete line 19. Carbon's own stylesheet handles ::placeholder correctly via --cds-text-placeholder.

## Persona Red Flags

**Alex (Advogado experiente / Power User)**
- Sidebar tablist fires only click events; no Arrow Left/Right keyboard navigation (WAI-ARIA tablist requirement).
- No search or filter on the Casos list. A firm with 200 active cases cannot work without this.
- Two Jurimetria submit buttons side by side — Enter from a form field triggers "Benchmark de valor" even when the user intended "Perfil do magistrado."
- No keyboard shortcut to open "Novo caso" or switch navigation sections.

**Sam (Accessibility-Dependent)**
- modal-atividade-fechar uses innerHTML = "✕" with no aria-label. Screen readers announce this as a symbol, not "fechar." All other modal close buttons correctly use aria-label="Fechar."
- Elapsed-time counter updates every second via setInterval inside resultado containers that have aria-live="polite" — each second triggers a re-announcement, extremely disruptive during any API call.
- Skip link navigates to #conteudo but no landmark shortcuts exist to jump between navigation sections.

**Assistente do Escritório**
- After creating a case via "Novo caso" modal, modal stays open, no "Abrir caso criado" CTA. User must find the new case manually.
- No "Vincular à caso existente" action from the publications view. Linking a publication to an existing case requires: Casos → open case → Publicações sub-tab. No batch path for processing multiple new publications.
- Publication status labels ("Não tratada", "Tratada", "Arquivada") have no tooltip or help text explaining what "tratar" means in the workflow.

## Minor Observations

- modal-atividade HTML block is placed after the closing </body> tag — invalid HTML, browsers repair silently.
- Date placeholder format inconsistency: some forms use "aaaa-mm-dd" (ISO), Jurimetria uses "dd/mm/aaaa."
- modal-atividade uses native <input type="date"> (browser date picker); all other date inputs use Flatpickr. Two different date entry patterns.
- Main nav aria-label reads "Tipo de consulta" — should be "Navegação principal."
- A-Z filter and text search in Contatos operate independently with no visual indication that both are active simultaneously. Clearing text search does not reset the letter filter.
- Six "Conceito" tiles in Jurimetria have no clear "not yet available" state. They look clickable and create false expectation.

## Questions to Consider

1. Is "Contatos" the right frame for the entire CRM, or should AstraJus distinguish "Clientes" (who retain the firm) from "Partes" (opposing parties, witnesses, courts that appear in case records)?

2. What if the post-login default screen were an "Agenda do escritório" showing cases with active monitoring and upcoming deadlines, rather than a blank DataJud search form?

3. Could the OAB Publications inbox become the single entry point that drives all downstream actions — creating cases, scheduling deadlines, monitoring processes — as a sequential triage flow per publication?
