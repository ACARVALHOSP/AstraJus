---
name: AstraJus
description: Interface Carbon white/g100 para gestão processual jurídica.
colors:
  interactive: "#0f62fe"
  background: "#ffffff"
  layer: "#f4f4f4"
  text-primary: "#161616"
  text-secondary: "#525252"
  border-subtle: "#e0e0e0"
typography:
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "0.875rem"
  label:
    fontSize: "0.75rem"
  title:
    fontSize: "1.75rem"
spacing:
  compact: "0.5rem"
  base: "1rem"
  section: "1.5rem"
---

# Design System: AstraJus

## Overview

Carbon white/g100, com interface sóbria e densa para trabalho jurídico. Preservar a identidade existente, conforme escolha do usuário. Hierarquia, leitura de dados e ações previsíveis orientam a composição.

## Colors

Azul interativo para ações e seleção; superfícies brancas e cinza claro, texto escuro e divisores discretos. Os tokens semânticos Carbon são a referência para os estados. O toggle no shell alterna Claro (white) e Escuro (g100), com preferência local compartilhada pelas páginas do frontend. O frontmatter descreve a base white; g100 usa os tokens oficiais do CSS Carbon, sem inversão de cores.

## Typography

IBM Plex Sans do CSS Carbon. Títulos de página usam heading-04 (28/36 px, peso 400); títulos de seção usam heading-02 (16/24 px, peso 600). Corpo usa body-01 (14/20 px) e rótulos/ajuda usam label-01/helper-text-01 (12/16 px). A tabela de Publicações OAB mantém 12 px e altura M de 40 px; inteiro teor e status mantêm a exceção aprovada de 10 px. Números processuais devem permanecer legíveis e copiáveis.

Somente dados de nomes, títulos de cadastros/atividades e responsáveis recebem iniciais maiúsculas por palavra na exibição. Controles, cabeçalhos, mensagens e rótulos usam capitalização de frase. Inteiro teor, identificadores e valores enviados ao servidor são preservados.

## Layout

Cabeçalho fixo e navegação lateral recolhível. Conteúdo de trabalho em coluna flexível, formulários em grade e tabelas em contêineres com rolagem horizontal. O painel prioriza desktop e adapta navegação e controles para telas estreitas.

Formulários de consulta, cadastro, endereço e capa dividem a área útil em 4/8/16 colunas nos breakpoints 320/672/1056 px. Calhas e quebras de linha usam spacing-05 (16 px), com spans explícitos e campos largos ocupando toda a grade. Abaixo de xlg (1312 px), campos de endereço/capa ocupam oito das dezesseis colunas para preservar legibilidade junto à navegação lateral. Espaçamentos customizados usam tokens Carbon em CSS runtime, com fallbacks equivalentes; modais e popovers permanecem fora do grid da página.

## Elevation & Depth

Superfícies predominantemente planas. Camadas e divisores organizam o conteúdo; sombras suaves distinguem menus e painéis flutuantes.

## Shapes

Controles e tabelas seguem a geometria Carbon. Evitar introduzir novas formas decorativas na tabela.

## Components

Ícones devem ser oficiais do Carbon Design System, com nomes e imports verificados. Não usar emojis ou caracteres Unicode como substitutos de ícones, inclusive em prévias e mockups.

Animações e transições seguem Carbon Motion e seus tokens oficiais, com respeito a `prefers-reduced-motion`. O movimento deve comunicar estado, continuidade ou feedback útil.

Botões primários, secundários e ghost, campos com rótulos, tabelas com seleção e ações em lote, menus e modais com gestão de foco. Usar os estilos Carbon compilados já presentes no projeto, com React e os componentes oficiais de `@carbon/react`.

## Do's and Don'ts

- Do preservar Carbon white/g100 e português brasileiro.
- Do manter foco visível, navegação por teclado e rótulos associados aos controles.
- Do preservar consulta, seleção, status e vinculação das publicações ao alterar sua apresentação.
- Don't introduzir frameworks CSS externos ou identidade visual concorrente.
