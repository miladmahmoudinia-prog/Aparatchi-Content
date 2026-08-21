import fs from 'node:fs/promises';
import { buildLiveCatalogBaseline } from './client-catalog.mjs';

const sourcePath = process.argv[2] || 'catalog-bootstrap.json';
const destinationPath = process.argv[3] || 'catalog-live-baseline.json';
const bootstrap = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const baseline = buildLiveCatalogBaseline(bootstrap);

if (!baseline.clientRevision || !baseline.itemCount) {
  throw new Error('A complete bootstrap with clientRevision is required.');
}

await fs.writeFile(destinationPath, `${JSON.stringify(baseline)}\n`, 'utf8');
console.log(JSON.stringify({
  destinationPath,
  clientRevision: baseline.clientRevision,
  itemCount: baseline.itemCount,
}, null, 2));
