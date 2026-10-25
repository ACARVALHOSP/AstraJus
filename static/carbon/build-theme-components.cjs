// O Toggle é verificado na referência Carbon e empacotado localmente, sem CDN.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const modules = process.env.CARBON_BUILD_MODULES || path.join(root, 'output/carbon-build/node_modules');
require(path.join(modules, 'esbuild')).buildSync({
  entryPoints: [path.join(modules, '@carbon/web-components/es/components/toggle/index.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2022',
  outfile: path.join(__dirname, 'theme-components.min.js'), legalComments: 'linked',
});
fs.copyFileSync(path.join(modules, '@carbon/web-components/LICENSE'), path.join(__dirname, 'LICENSE-theme-components.txt'));
