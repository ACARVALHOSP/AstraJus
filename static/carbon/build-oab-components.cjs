// Execute na raiz do repositório, após o npm install indicado no README.txt.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const modules = process.env.CARBON_BUILD_MODULES || path.join(root, 'output/carbon-build/node_modules');
const esbuild = require(path.join(modules, 'esbuild'));
const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'oab-components.entry.js')],
  nodePaths: [modules], bundle: true, minify: true, format: 'iife', target: 'es2022',
  outfile: path.join(__dirname, 'oab-components.min.js'), legalComments: 'linked', metafile: true,
});
const packages = [...new Set(Object.keys(result.metafile.inputs).filter((p) => p.includes('node_modules/')).map((p) => {
  const parts = p.split('node_modules/').pop().split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}))].sort();
const licenses = packages.map((name) => {
  const input = Object.keys(result.metafile.inputs).find((p) => p.includes(`node_modules/${name}/`));
  const dir = path.resolve(input.slice(0, input.lastIndexOf(`node_modules/${name}/`) + `node_modules/${name}`.length));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = ['LICENSE', 'LICENSE.txt', 'LICENSE.md'].find((f) => fs.existsSync(path.join(dir, f)));
  if (!file) throw new Error(`Licença ausente: ${name}`);
  return `${name} ${pkg.version}\n${fs.readFileSync(path.join(dir, file), 'utf8')}`;
});
fs.writeFileSync(path.join(__dirname, 'LICENSE-web-components.txt'), licenses.join('\n\n'));
console.log('Web Components Carbon e licenças gerados.');
