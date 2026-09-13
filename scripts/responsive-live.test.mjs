import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {writeResponsiveLiveCatalog} from './client-catalog.mjs';

test('v2 sends only cumulative changes and preserves old clients and all identities', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-live-test-'));
  const original = {clientRevision:'a',updatedAt:'2026-09-13T00:00:00Z',items:[
    {id:'a',type:'movie',name:'A'}, {id:'a--operator',type:'movie',name:'A'},
  ]};
  await fs.writeFile(path.join(root,'catalog-live.json'), 'legacy untouched');
  const first = await writeResponsiveLiveCatalog(root, original);
  assert.equal(first.upsertCount,0);
  const next = {...original,clientRevision:'b',updatedAt:'2026-09-13T01:00:00Z',items:[
    {id:'b',type:'series',name:'B'}, {...original.items[0],name:'Updated'}, original.items[1],
  ]};
  assert.equal((await writeResponsiveLiveCatalog(root,next)).upsertCount,2);
  const reverted = {...next,clientRevision:'c',items:[next.items[0],...original.items]};
  await writeResponsiveLiveCatalog(root,reverted);
  const delta = JSON.parse(await fs.readFile(path.join(root,'catalog-live-v2.json'),'utf8'));
  assert.deepEqual(delta.itemOrder,['series:b','movie:a','movie:a--operator']);
  assert.equal(delta.upserts.find(i=>i.id==='a').name,'A');
  assert.equal(delta.baseClientRevision,'a');
  assert.equal(delta.baseUpdatedAt,original.updatedAt);
  assert.equal(await fs.readFile(path.join(root,'catalog-live.json'),'utf8'),'legacy untouched');
});
