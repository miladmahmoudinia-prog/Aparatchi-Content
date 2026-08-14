import fs from 'node:fs/promises';
import path from 'node:path';
import { writeClientCatalogArtifacts } from './client-catalog.mjs';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const result = await writeClientCatalogArtifacts(root, catalog);

console.log(
  `Client catalog rebuilt: items=${result.index.items.length}, indexChanged=${result.indexChanged}, detailFilesChanged=${result.changedDetailFiles}`,
);
