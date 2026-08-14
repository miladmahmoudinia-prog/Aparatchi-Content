import fs from 'node:fs/promises';
import path from 'node:path';

const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));
const items = Array.isArray(index.items) ? index.items : [];
const failures = [];
let checked = 0;

for (const item of items) {
  const detailPath = String(item?.detailPath || '');
  const match = detailPath.match(/^catalog-items\/([a-f0-9]{12})-[a-f0-9]{12}\.json$/i);
  if (!match) {
    failures.push({ id: item?.id, reason: 'invalid-content-addressed-detail-path', detailPath });
    continue;
  }
  const stablePath = path.join('catalog-stable', `${match[1]}.json`);
  try {
    const stable = JSON.parse(await fs.readFile(stablePath, 'utf8'));
    if (String(stable?.id) !== String(item.id) || String(stable?.type) !== String(item.type)) {
      failures.push({ id: item.id, reason: 'stable-alias-identity-mismatch', stablePath });
      continue;
    }
    checked += 1;
  } catch (error) {
    failures.push({ id: item.id, reason: 'stable-alias-missing-or-invalid', stablePath, error: String(error?.message || error) });
  }
}

console.log(JSON.stringify({
  indexItems: items.length,
  checked,
  failureCount: failures.length,
  firstFailures: failures.slice(0, 30),
}, null, 2));

if (failures.length || checked !== items.length) process.exitCode = 1;
