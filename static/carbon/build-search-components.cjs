const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const modules = process.env.CARBON_BUILD_MODULES || path.join(root, 'output/carbon-build/node_modules');
require(path.join(modules, 'esbuild')).buildSync({
  entryPoints: [path.join(__dirname, 'search-components.entry.js')], nodePaths: [modules],
  bundle: true, minify: true, format: 'iife', target: 'es2022',
  outfile: path.join(__dirname, 'search-components.min.js'), legalComments: 'linked',
});
const license = fs.readFileSync(path.join(modules, '@carbon/web-components/LICENSE'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'LICENSE-search-components.txt'), license);
