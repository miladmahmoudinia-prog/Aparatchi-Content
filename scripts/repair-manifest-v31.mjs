import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Recreate the manifest from the exact committed artifact bytes while keeping
// every compatibility pointer consumed by Mobile startup/detail hydration.
const read = async (path) => fs.readFile(path);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

const catalogBytes = await read('catalog.json');
const indexBytes = await read('catalog-index.json');
const bootstrapBytes = await read('catalog-bootstrap.json');
const catalog = JSON.parse(catalogBytes.toString('utf8'));

const manifest = {
  schemaVersion: 2,
  revision: hash(catalogBytes),
  clientRevision: hash(indexBytes),
  catalogVersion: String(catalog.version || '').trim(),
  catalogUpdatedAt: String(catalog.updatedAt || '').trim(),
  sizeBytes: catalogBytes.length,
  clientSizeBytes: indexBytes.length,
  clientIndex: 'catalog-index.json',
  bootstrapRevision: hash(bootstrapBytes),
  bootstrapSizeBytes: bootstrapBytes.length,
  bootstrapIndex: 'catalog-bootstrap.json',
  detailBase: 'catalog-items/',
  stableDetailBase: 'catalog-stable/',
};

await fs.writeFile('catalog-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
