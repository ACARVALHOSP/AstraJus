// Build: npm install --prefix output/carbon-build --no-audit --no-fund
//   @carbon/web-components@2.66.0 esbuild@0.25.12
// Depois: node static/carbon/build-oab-components.cjs
import '@carbon/web-components/es/components/data-table/index.js';
import '@carbon/web-components/es/components/toggle-tip/index.js';
import '@carbon/web-components/es/components/tag/index.js';
import '@carbon/web-components/es/components/icon-button/index.js';
import '@carbon/web-components/es/components/card/index.js';
import Edit16 from '@carbon/icons/es/edit/16.js';
import TrashCan16 from '@carbon/icons/es/trash-can/16.js';

window.cnjProcessoIcones = { editar: Edit16, excluir: TrashCan16 };
