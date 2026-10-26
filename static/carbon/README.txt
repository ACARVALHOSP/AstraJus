Carbon Design System (@carbon/styles 1.116.0), Apache License 2.0.
Arquivo: styles.min.css, copia compilada para uso em paginas geradas pelo servidor.
Fonte: https://github.com/carbon-design-system/carbon
Licenca completa: LICENSE-carbon.txt

flatpickr 4.6.13, MIT License (biblioteca de calendario usada pelo
cds--date-picker do Carbon).
Arquivos: flatpickr.min.js, flatpickr-l10n-pt.js (locale pt-BR),
flatpickr-rangePlugin.js (plugin de intervalo com 2 campos).
Fonte: https://github.com/flatpickr/flatpickr

Search padrão: @carbon/web-components 2.66.0, Apache-2.0.
Bundle independente search-components.min.js; fonte search-components.entry.js.
Build: npm install --prefix output/carbon-build --no-audit --no-fund @carbon/web-components@2.66.0 esbuild@0.25.12
Depois: node static/carbon/build-search-components.cjs
Licença: LICENSE-search-components.txt e search-components.min.js.LEGAL.txt.

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

Tema Claro/Escuro: Toggle de @carbon/web-components 2.66.0, Apache-2.0.
Bundle independente theme-components.min.js, gerado por build-theme-components.cjs.
Build: use as mesmas dependências indicadas acima e execute node static/carbon/build-theme-components.cjs.
CARBON_BUILD_MODULES permite reutilizar um diretório node_modules de build fora da árvore.
Licenças: LICENSE-theme-components.txt e theme-components.min.js.LEGAL.txt.
As variáveis white/g100 estão no CSS Carbon já distribuído; não há CDN em execução.

Dropdown, RadioButton, Modal e ProgressBar: @carbon/web-components 2.66.0.
Bundle local: ui-controls.min.js; fontes: ui-controls.entry.js.
Build com os mesmos pacotes acima: node static/carbon/build-ui-controls.cjs
CARBON_BUILD_MODULES permite indicar uma pasta node_modules alternativa.
Licenças: LICENSE-ui-controls.txt e ui-controls.min.js.LEGAL.txt.
