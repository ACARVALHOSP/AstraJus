# Relatório: migração do frontend AstraJus para React + Carbon Design System

## 1. Estado atual

| Item | Situação |
|---|---|
| `static/app.html` | 2268 linhas, markup único, 15+ `<section role="tabpanel">` (abas e sub-abas) montadas estaticamente, todas no DOM com `hidden` alternado via JS |
| `static/app.js` | 6913 linhas, um único arquivo: manipulação direta de DOM (`querySelector`, `innerHTML`), 7 chamadas `fetch` centralizadas, lógica de todas as abas misturada (processos, publicações, financeiro, contatos, casos, integrações, jurimetria) |
| `static/ui-controls.js`, `theme.js`, `search-fields.js`, `notificacoes.js`, `integracoes.js`, `cadastro.js` | módulos auxiliares (~550 linhas somadas) para tema, busca, toasts, integrações |
| CSS | classes **`cds--*`** do Carbon aplicadas manualmente no HTML (grid, tabs, content-switcher, date-picker, botões) — não há web components Carbon (`<cds-button>` etc.), é CSS puro + JS próprio imitando o comportamento |
| Backend | `server.py` (5937 linhas), servidor HTTP Python sem framework (não é Flask/FastAPI) — serve o HTML estático e expõe endpoints que o `app.js` consome via `fetch` |

**Diagnóstico**: já existe uma adesão visual ao Carbon (classes CSS corretas), mas zero componentização. É um SPA artesanal: estado implícito no DOM, sem roteamento, sem build step, um arquivo JS gigante por aba.

## 2. Objetivo da migração

Substituir `app.html` + `app.js` por uma aplicação React usando **`@carbon/react`** (componentes React oficiais, não apenas CSS), mantendo o `server.py` como API (ou evoluindo-o para JSON puro, sem servir HTML).

## 3. Mapeamento de telas → componentes Carbon

| Aba atual (`id`) | Componente(s) React/Carbon |
|---|---|
| `side-nav` | `SideNav`, `SideNavItems`, `SideNavLink` |
| `aba-acesso` | `Form`, `TextInput`, `Button` |
| `aba-processo` | `Grid`/`Column`, `Tile`, `StructuredListWrapper` |
| `aba-publicacoes` + paginação | `DataTable` (com `Pagination`) |
| `aba-historico` | `DataTable` ou `StructuredListWrapper` |
| `aba-monitoramentos` | `DataTable`, `Modal` (criar/editar), `Tag` |
| `aba-jurimetria` | `Tile` + gráficos (Carbon Charts, `@carbon/charts-react`) |
| `aba-integracoes` | `Tile`, `Toggle`, `Modal` (OAuth) |
| `aba-financeiro` / `aba-pagamentos` | `DataTable`, `Modal`, `NumberInput`, `DatePicker` |
| `aba-contatos` + sub-abas (cadastro/processos/financeiro) | `Tabs`/`TabList`/`TabPanels`, `Form` com `cds--css-grid` → `Grid` |
| `aba-atividades` | `DataTable`, `Modal` |
| `aba-casos` + sub-abas (atividades/publicações/movimentações/vínculos) | `Tabs` aninhadas, `DataTable` |
| `aba-publicacoes-oab` | `DataTable`, `ComboBox` (filtro) |
| Content switcher (abas internas) | `ContentSwitcher`, `Switch` |
| Date range (já usa `cds--date-picker--range`) | `DatePicker` (`datePickerType="range"`) |
| Toasts (`notificacoes.js`) | `ToastNotification` / `InlineNotification` |
| Busca com sugestões (`search-fields.js`) | `ComboBox` ou `Search` com lista filtrada |

## 4. Arquitetura proposta

```
frontend/                      (novo projeto Vite + React + TS)
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # SideNav + roteamento das abas
│   ├── routes/
│   │   ├── Processo.tsx
│   │   ├── Publicacoes.tsx
│   │   ├── Financeiro.tsx
│   │   ├── Pagamentos.tsx
│   │   ├── Contatos/
│   │   │   ├── index.tsx
│   │   │   ├── Cadastro.tsx
│   │   │   ├── Processos.tsx
│   │   │   └── Financeiro.tsx
│   │   ├── Casos/...
│   │   ├── Integracoes.tsx
│   │   ├── Jurimetria.tsx
│   │   └── Monitoramentos.tsx
│   ├── api/                    # um módulo por recurso, substitui os 7 fetch() soltos
│   │   ├── processos.ts
│   │   ├── publicacoes.ts
│   │   ├── financeiro.ts
│   │   └── client.ts           # wrapper fetch com baseURL + tratamento de erro
│   ├── components/             # compostos reaproveitáveis (ex.: BuscaCliente, TabelaPaginada)
│   ├── hooks/                  # useProcessos, useToasts etc.
│   └── theme/                  # g10/g100 (tema atual em theme.js/theme.css)
├── vite.config.ts
└── package.json
```

- **Roteamento**: `react-router-dom`, uma rota por aba (`/processo`, `/publicacoes`, `/contatos/:id`), substituindo o `hidden` manual.
- **Estado de dados**: `@tanstack/react-query` para as chamadas que hoje são `fetch` manuais com re-render via `innerHTML` — dá cache, loading/error de graça, elimina boa parte da lógica de `app.js`.
- **Formulários** (cadastro de contato, lançamentos): `react-hook-form` + componentes Carbon controlados.
- **Build**: Vite gera `dist/`, que o `server.py` passa a servir como estático (ou um Nginx na frente, se o deploy via GitHub Actions permitir).

## 5. Fases sugeridas (incremental, sem big-bang)

1. **Setup**: criar `frontend/` com Vite + React + TypeScript + `@carbon/react` + `@carbon/icons-react`. Configurar tema (g10, conforme `theme.css` atual) e o `SideNav` com os mesmos itens de `side-nav`.
2. **Camada de API**: extrair os 7 `fetch()` de `app.js` para `src/api/*.ts` tipados, validando contra as respostas reais do `server.py` antes de tocar em UI.
3. **Migrar aba por aba**, da mais simples para a mais acoplada:
   - `aba-acesso` (formulário simples) → prova de conceito.
   - `aba-publicacoes` / `aba-historico` (tabelas) → valida `DataTable` + paginação.
   - `aba-financeiro` / `aba-pagamentos` (CRUD com modais) → valida `Modal` + `react-hook-form`.
   - `aba-contatos` e `aba-casos` (sub-abas aninhadas) → por último, são as mais complexas.
4. **Convivência durante a transição**: servir React em `/app2` (ou subdomínio) enquanto `app.html` continua em produção; trocar o link do `side-nav`/deploy quando cada aba estiver validada. Evita quebrar o fluxo de cobrança/Asaas já em produção.
5. **Corte final**: remover `app.html`, `app.js` e os módulos auxiliares; `server.py` passa a expor só JSON.

## 6. Riscos e pontos de atenção

- **`app.js` tem lógica de negócio embutida na manipulação de DOM** (ex.: cálculo de parcelamento em Lançamentos, busca de cliente). Essa lógica precisa ser extraída para funções puras/hooks antes de virar componente — não é só "trocar tag por componente".
- **Sem testes automatizados de frontend hoje** (os testes vistos no repo são de backend, ex. `test_agenda_atividades.py`). Cada aba migrada deveria ganhar ao menos um teste de integração (Playwright, já disponível no `.venv`) antes de substituir a original.
- **Acessibilidade já trabalhada manualmente** (`aria-labelledby`, `role="tabpanel"`, live regions em `notificacoes.js`) — os componentes Carbon cobrem isso nativamente, mas confirmar paridade ao migrar notificações/toasts.
- **Deploy via GitHub Actions faz `docker build` + restart** — a imagem Docker precisa incluir o passo `npm run build` do frontend antes do build Python, ou separar em multi-stage `Dockerfile`.
- **Antes de começar, confirmar no `.claude/worktrees/` se há migração parcial já iniciada** (existem artefatos Carbon duplicados em worktrees antigos) para não retrabalhar.

## 7. Estimativa de esforço

Dado o tamanho (9960 linhas de frontend hoje, 15 abas/sub-abas), recomenda-se tratar como **um módulo por PR**, seguindo a ordem da seção 5, item 3. Sem paralelizar, são ~8-10 PRs incrementais até o corte final.
