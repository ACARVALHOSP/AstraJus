Carbon Design System (@carbon/styles 1.116.0), Apache License 2.0.
Arquivo: styles.min.css, copia compilada para uso em paginas geradas pelo servidor.
Fonte: https://github.com/carbon-design-system/carbon
Licenca completa: LICENSE-carbon.txt

flatpickr 4.6.13, MIT License (biblioteca de calendario usada pelo
cds--date-picker do Carbon).
Arquivos: flatpickr.min.js, flatpickr-l10n-pt.js (locale pt-BR),
flatpickr-rangePlugin.js (plugin de intervalo com 2 campos).
Fonte: https://github.com/flatpickr/flatpickr

Web Components de Publicações OAB: @carbon/web-components 2.66.0.
Bundle local oab-components.min.js: DataTable, Toggletip, Tag e IconButton.
Fonte: https://github.com/carbon-design-system/carbon/tree/main/packages/web-components
Licenças: LICENSE-web-components.txt e oab-components.min.js.LEGAL.txt.
O bundle inclui estilos encapsulados dos componentes; o CSS Carbon existente continua
atendendo o restante do painel. Não há dependência de CDN em execução.

Para regenerar, na raiz do repositório:
npm install --prefix output/carbon-build --no-audit --no-fund @carbon/web-components@2.66.0 esbuild@0.25.12
node static/carbon/build-oab-components.cjs
Os arquivos de trabalho em output/carbon-build não fazem parte da distribuição.
