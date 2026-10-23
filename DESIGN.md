---
name: AstraJus
description: Interface Carbon white para gestão processual jurídica.
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
    fontSize: "1.25rem"
spacing:
  compact: "0.5rem"
  base: "1rem"
  section: "1.5rem"
---

# Design System: AstraJus

## Overview

Carbon white, com interface sóbria e densa para trabalho jurídico. Preservar a identidade existente, conforme escolha do usuário. Hierarquia, leitura de dados e ações previsíveis orientam a composição.

## Colors

Azul interativo para ações e seleção; superfícies brancas e cinza claro, texto escuro e divisores discretos. Os tokens semânticos Carbon são a referência para os estados.

## Typography

IBM Plex Sans do CSS Carbon. A escala local distingue corpo, ajuda, subtítulos e títulos; números processuais devem permanecer legíveis e copiáveis.

## Layout

Cabeçalho fixo e navegação lateral recolhível. Conteúdo de trabalho em coluna flexível, formulários em grade e tabelas em contêineres com rolagem horizontal. O painel prioriza desktop e adapta navegação e controles para telas estreitas.

## Elevation & Depth

Superfícies predominantemente planas. Camadas e divisores organizam o conteúdo; sombras suaves distinguem menus e painéis flutuantes.

## Shapes

Controles e tabelas seguem a geometria Carbon. Evitar introduzir novas formas decorativas na tabela.

## Components

Botões primários, secundários e ghost, campos com rótulos, tabelas com seleção e ações em lote, menus e modais com gestão de foco. Usar os estilos Carbon compilados já presentes no projeto, com HTML e JavaScript vanilla.

## Do's and Don'ts

- Do preservar Carbon white e português brasileiro.
- Do manter foco visível, navegação por teclado e rótulos associados aos controles.
- Do preservar consulta, seleção, status e vinculação das publicações ao alterar sua apresentação.
- Don't introduzir frameworks CSS externos ou identidade visual concorrente.
