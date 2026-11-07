---
name: AstraJus (frontend React)
description: Interface Radix Themes (claro/escuro) para gestão processual jurídica.
colors:
  accent: "Radix accent (indigo padrão; violet, teal ou crimson pelo seletor de aparência)"
  gray: "Radix slate"
  background: "var(--color-background) / var(--gray-1) na área de conteúdo"
  panel: "var(--color-panel-solid)"
  text-primary: "var(--gray-12)"
  text-secondary: "var(--gray-11)"
  border-subtle: "var(--gray-a4) / var(--gray-a5)"
typography:
  family: "Fonte padrão do Radix Themes (system-ui)"
  page-title: "Heading size 6 (24 px, 700)"
  section-title: "Heading size 4/3 (18/16 px)"
  body: "14 px"
  secondary: "12–13 px, var(--gray-11)"
spacing:
  content-padding: "24 px 32 px no desktop; 16 px abaixo de 1056 px"
  page-gap: "32 px entre blocos (Flex gap 6)"
  form-gap: "16 px"
---

# Design System: AstraJus (frontend React)

## Overview

Interface sóbria e densa para trabalho jurídico, construída com **Radix Themes** (`@radix-ui/themes`) e ícones **lucide-react**. Hierarquia, leitura de dados e ações previsíveis orientam a composição. Português brasileiro em toda a interface.

A interface legada em `static/` segue o Carbon (ver `DESIGN.md` na raiz); este documento vale apenas para `frontend/`.

## Colors

Tema Radix com `grayColor="slate"` e cor de destaque escolhida pelo usuário no botão **Aparência** da barra superior (índigo, violeta, verde-azulado ou carmesim), junto do tema claro/escuro. Usar sempre tokens Radix (`--gray-*`, `--accent-*`, `--red-*`…); não usar hex fixos no app. Texto secundário usa `--gray-11` (não `--gray-9`/`--gray-10`, que não atingem 4,5:1 em textos pequenos).

No tema escuro a barra superior usa superfície neutra (`--gray-2`); no claro, `--accent-9`.

## Typography

- Título de página: sempre via `CabecalhoPagina` (Heading size 6, 24 px).
- Títulos de seção: Heading size 4 ou 3.
- Corpo: 14 px. Texto auxiliar: 12–13 px em `--gray-11`. Nada abaixo de 11 px.
- Nomes, títulos de cadastros e responsáveis passam por `formatarNomeExibicao` (iniciais maiúsculas, partículas como "de", "da", "e", "com", "x" em minúsculas, siglas como ME/EPP/OAB em maiúsculas). Controles, cabeçalhos e mensagens usam capitalização de frase.

## Layout

- Shell: barra superior de 48 px, navegação lateral de 200 px (sobreposta abaixo de 1056 px) e área de conteúdo `.aj-content` com padding e largura máxima de 1440 px. As telas **não** definem padding externo próprio.
- Cada tela começa com `<CabecalhoPagina titulo descricao acoes />`; a ação principal fica à direita do título.
- Formulários usam `.aj-form-grade` ou `.aj-filtros-linha`. Formulários de um campo (token, login) usam largura máxima de 40rem (`.aj-form-estreito`).
- Tabelas sempre dentro de `TabelaResponsiva`: colunas sem texto no cabeçalho viram colunas de controle estreitas; valores monetários alinham à direita e datas à esquerda.

## Components

- **Botões:** principal `solid` size 2; secundário `soft` (cinza para "Atualizar", "Limpar filtros", paginação); `ghost` só para ações de link dentro de textos e menus. Ações em linha de tabela usam size 1.
- **Datas:** `CampoData` (dd/mm/aaaa com calendário), nunca `type="date"` direto.
- **Seleção vazia:** "Todos os …"/"Todas as …"/"Selecione o …", nunca "— todos —".
- **Seções recolhíveis:** `<details>/<summary>` recebem estilo global (chevron e cor de destaque).
- **Ícones:** `lucide-react`, um ícone distinto por item de navegação. Não usar emojis ou caracteres Unicode como ícones.
- **Movimento:** transições curtas (≤ 200 ms) que comuniquem estado; respeitar `prefers-reduced-motion`.

## Do's and Don'ts

- Do usar tokens Radix e os componentes compartilhados (`CabecalhoPagina`, `CampoData`, `TabelaResponsiva`, `AcoesTabela`).
- Do manter foco visível, navegação por teclado e rótulos associados aos controles.
- Don't introduzir frameworks CSS externos, hex fixos ou estilos de página duplicados (um arquivo de estilo por área).
