# Diretrizes e Especificações de Movimento (Motion) — Carbon Design System

Este documento detalha os fundamentos, princípios de design, curvas de aceleração (easing), durações, tokens de motion e boas práticas de acessibilidade baseados no **IBM Carbon Design System (v11)**.

---

## 1. Princípios de Movimento do Carbon

O movimento no Carbon não serve como mero ornamento decorativo; ele cumpre funções orientadoras, informativas e estruturais na interface.

1. **Intencional e Contextual:** Cada transição comunica hierarquia espacial, mudanças de estado ou causalidade. Se um elemento não requer ênfase ou foco espacial, ele não deve se mover.
2. **Eficiente e Fluido:** As durações são calibradas para evitar atrito operacional. O movimento deve parecer quase imperceptível em fluxos frequentes e recorrentes.
3. **Consistente e Universal:** A aceleração segue a física do sistema de design: entradas desaceleram, saídas aceleram e elementos que permanecem em cena utilizam curvas padrão (*standard*).

---

## 2. Tipos de Movimento: Produtivo vs. Expressivo

O Carbon divide a aplicação de movimento em dois estilos fundamentais:

| Característica | Motion Produtivo (Productive) | Motion Expressivo (Expressive) |
| :--- | :--- | :--- |
| **Objetivo** | Eficiência funcional, velocidade, ausência de distração | Engajamento, narrativa, celebração, ênfase espacial |
| **Casos de Uso** | Modais utilitários, menus suspensos, tooltips, data tables, tabs | Onboarding, páginas de boas-vindas, cards promocionais, microinterações ilustradas |
| **Duração média** | `70ms` a `240ms` | `150ms` a `700ms` |
| **Curvas padrão** | Transições diretas e firmes | Transições com amortecimento dinâmico e sutil elasticidade |

---

## 3. Tokens de Movimento

### 3.1. Tokens de Duração (Duration Tokens)

| Token SCSS / JS | Valor (ms) | Uso Recomendado |
| :--- | :--- | :--- |
| `$duration-fast-01` | `70ms` | Microinterações imediatas: hover em ícones, checkboxes, radio buttons. |
| `$duration-fast-02` | `110ms` | Menus suspensos simples, seletores de opções compactos, fade out de tooltips. |
| `$duration-moderate-01` | `150ms` | Expansão de accordions curtos, menus dropdown, tooltips expressivos. |
| `$duration-moderate-02` | `240ms` | Abertura/fechamento de modais utilitários, painéis laterais pequenos, accordions médios. |
| `$duration-slow-01` | `400ms` | Transição de grandes áreas de layout, drawers/flyouts laterais de tela cheia. |
| `$duration-slow-02` | `700ms` | Animações expressivas, ilustrações SVG animadas, onboarding em página inteira. |

---

### 3.2. Tokens de Curvas de Aceleração (Easing Tokens)

No Carbon, a aceleração reflete a direção e o ciclo de vida do elemento na tela:

```
            Curva Standard (Cubic-Bezier)
            (Elementos que permanecem em tela)
     1.0 |                   . - - '
         |               . '
         |            . '
         |        . '
     0.0 | . - - '
         +-----------------------------
           0.0                      1.0
```

| Token SCSS / CSS | Curva `cubic-bezier` | Comportamento e Cenário de Uso |
| :--- | :--- | :--- |
| `$ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | **Saída de tela:** O elemento sai do campo visual do usuário. Acelera até desaparecer. |
| `$ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | **Entrada em tela:** O elemento entra no campo visual. Desacelera ao acomodar-se na posição final. |
| `$ease-in-out` / `$standard` | `cubic-bezier(0.2, 0, 0.38, 0.9)` | **Permanência / Movimento interno:** Expansão de accordion, ordenação de linhas de tabela, tabs. |

---

### 3.3. Tokens Combinados (Easing + Duração)

O `@carbon/motion` fornece mixins e tokens de conveniência que emparelham curva e duração:

```scss
// Exemplos de tokens emparelhados no pacote SCSS
$motion-productive-entrance: (duration: $duration-moderate-01, easing: $ease-out);
$motion-productive-exit:     (duration: $duration-fast-02,     easing: $ease-in);
$motion-expressive-entrance: (duration: $duration-moderate-02, easing: $ease-out);
$motion-expressive-exit:     (duration: $duration-moderate-01, easing: $ease-in);
```

---

## 4. Matriz de Aplicação por Componente

| Componente | Ação | Duração | Easing | Propriedades CSS |
| :--- | :--- | :--- | :--- | :--- |
| **Accordion** | Expandir/Recolher | `moderate-01` (`150ms`) | `$standard` | `max-height`, `opacity` |
| **Modal** | Entrada (Abertura) | `moderate-02` (`240ms`) | `$ease-out` | `transform (translateY)`, `opacity` |
| **Modal** | Saída (Fechamento) | `fast-02` (`110ms`) | `$ease-in` | `opacity`, `transform` |
| **Side Panel / Flyout** | Deslizar para dentro | `slow-01` (`400ms`) | `$ease-out` | `transform (translateX)` |
| **Tooltip** | Aparição | `fast-01` (`70ms`) | `$ease-out` | `opacity` |
| **Button State** | Hover / Focus | `fast-01` (`70ms`) | `$standard` | `background-color`, `border-color` |
| **Tabs** | Indicador de foco | `fast-02` (`110ms`) | `$standard` | `transform`, `width` |

---

## 5. Implementação Técnica

### 5.1. Instalação do Pacote

```bash
npm install @carbon/motion
# ou via yarn
yarn add @carbon/motion
```

### 5.2. Uso em Sass / SCSS

```scss
@use '@carbon/motion' as motion;

// Exemplo: Transição de um Modal
.cds--modal-container {
  opacity: 0;
  transform: translateY(-16px);
  transition:
    transform motion.$duration-moderate-02 motion.$ease-out,
    opacity motion.$duration-moderate-02 motion.$ease-out;

  &.is-visible {
    opacity: 1;
    transform: translateY(0);
  }

  &.is-closing {
    transition:
      transform motion.$duration-fast-02 motion.$ease-in,
      opacity motion.$duration-fast-02 motion.$ease-in;
  }
}

// Exemplo: Microinteração de Hover
.cds--btn--primary {
  transition: background-color motion.$duration-fast-01 motion.$ease-in-out;
}
```

### 5.3. Uso em CSS Variables

```css
:root {
  --cds-duration-fast-01: 70ms;
  --cds-duration-fast-02: 110ms;
  --cds-duration-moderate-01: 150ms;
  --cds-duration-moderate-02: 240ms;
  --cds-duration-slow-01: 400ms;
  --cds-duration-slow-02: 700ms;

  --cds-ease-in: cubic-bezier(0.4, 0, 1, 1);
  --cds-ease-out: cubic-bezier(0, 0, 0.2, 1);
  --cds-standard: cubic-bezier(0.2, 0, 0.38, 0.9);
}

.custom-panel {
  transition: transform var(--cds-duration-moderate-02) var(--cds-ease-out);
}
```

### 5.4. Uso em JavaScript / TypeScript (Framer Motion / CSS-in-JS)

```typescript
import {
  durationFast01,
  durationFast02,
  durationModerate01,
  durationModerate02,
  easings
} from '@carbon/motion';

export const modalVariants = {
  hidden: {
    opacity: 0,
    y: -20,
    transition: {
      duration: parseInt(durationFast02, 10) / 1000,
      ease: [0.4, 0, 1, 1] // $ease-in
    }
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: parseInt(durationModerate02, 10) / 1000,
      ease: [0, 0, 0.2, 1] // $ease-out
    }
  }
};
```

---

## 6. Acessibilidade e Redução de Movimento (`prefers-reduced-motion`)

Conforme as diretrizes da **WCAG 2.1 (Critério 2.3.3 - Animação a partir de Interações)**, interfaces construídas com o Carbon devem respeitar as preferências do sistema operacional de usuários sensíveis a movimento vestibular ou distração cognitiva.

### Regras Mandatórias:
1. **Desativar deslocamentos espaciais amplos** (`translate`, `scale` agressivo).
2. **Substituir transições espaciais por `opacity` imediato ou nulo**, mantendo a indicação de estado sem o movimento físico.
3. Não remover transições essenciais de acessibilidade (ex: contraste de cores), mas zerar a duração.

### Implementação de Fallback:

```scss
@use '@carbon/motion' as motion;

.cds--side-nav {
  transition: transform motion.$duration-slow-01 motion.$ease-out;

  @media (prefers-reduced-motion: reduce) {
    transition: none !important;
    animation: none !important;
  }
}
```

---

## 7. Checklist de Qualidade de Motion

- [ ] A animação tem propósito funcional (orientação, foco ou feedback)?
- [ ] As propriedades animadas são limitadas a `transform` e `opacity` para garantir processamento via GPU (60fps)?
- [ ] Elementos em saída utilizam `$ease-in` e elementos em entrada utilizam `$ease-out`?
- [ ] O componente respeita a media query `@media (prefers-reduced-motion: reduce)`?
- [ ] Modais e alertas produtivos utilizam durações iguais ou inferiores a `240ms`?