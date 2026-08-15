import fs from 'node:fs/promises';
import path from 'node:path';

const index = JSON.parse(await fs.readFile('catalog-index.json', 'utf8'));
const items = Array.isArray(index.items) ? index.items : [];
const failures = [];
let checked = 0;
let maxPointerBytes = 0;

for (const item of items) {
  const detailPath = String(item?.detailPath || '');
  const match = detailPath.match(/^catalog-items\/([a-f0-9]{12})-[a-f0-9]{12}\.json$/i);
  if (!match) {
    failures.push({ id: item?.id, reason: 'invalid-content-addressed-detail-path', detailPath });
    continue;
  }

  const stablePath = path.join('catalog-stable', `${match[1]}.json`);
  try {
    const serialized = await fs.readFile(stablePath, 'utf8');
    maxPointerBytes = Math.max(maxPointerBytes, Buffer.byteLength(serialized));
    const stable = JSON.parse(serialized);
    if (String(stable?.id) !== String(item.id) || String(stable?.type) !== String(item.type)) {
      failures.push({ id: item.id, reason: 'stable-pointer-identity-mismatch', stablePath });
      continue;
    }
    if (String(stable?.detailPath || '') !== detailPath) {
      failures.push({ id: item.id, reason: 'stable-pointer-target-mismatch', stablePath, expected: detailPath, actual: stable?.detailPath });
      continue;
    }
    if (Buffer.byteLength(serialized) >= 300) {
      failures.push({ id: item.id, reason: 'stable-pointer-not-lightweight', stablePath, bytes: Buffer.byteLength(serialized) });
      continue;
    }

    const target = JSON.parse(await fs.readFile(path.join('.', detailPath), 'utf8'));
    if (String(target?.id) !== String(item.id) || String(target?.type) !== String(item.type)) {
      failures.push({ id: item.id, reason: 'stable-pointer-target-identity-mismatch', stablePath, detailPath });
      continue;
    }
    checked += 1;
  } catch (error) {
    failures.push({ id: item.id, reason: 'stable-pointer-missing-or-invalid', stablePath, error: String(error?.message || error) });
  }
}

console.log(JSON.stringify({
  indexItems: items.length,
  checked,
  maxPointerBytes,
  failureCount: failures.length,
  firstFailures: failures.slice(0, 30),
}, null, 2));

if (failures.length || checked !== items.length) process.exitCode = 1;
