const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const modules = process.env.CARBON_BUILD_MODULES || path.join(root, 'output/carbon-build/node_modules');
require(path.join(modules, 'esbuild/lib/main.js')).buildSync({
  entryPoints: [path.join(__dirname, 'ui-controls.entry.js')], nodePaths: [modules],
  bundle: true, minify: true, format: 'iife', target: 'es2022',
  outfile: path.join(__dirname, 'ui-controls.min.js'), legalComments: 'linked',
});
fs.copyFileSync(path.join(modules, '@carbon/web-components/LICENSE'), path.join(__dirname, 'LICENSE-ui-controls.txt'));
