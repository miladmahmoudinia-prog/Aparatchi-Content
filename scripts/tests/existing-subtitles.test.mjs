import test from 'node:test';
import assert from 'node:assert/strict';
import {appendSubtitledFiles} from '../existing-audit.mjs';
const old = {id:'dub',url:'https://example.invalid/a.mp4',language:'dubbed'};
const sub = {id:'sub',url:'https://example.invalid/b.mp4',language:'subtitled'};
test('episode appends a new version once without replacing dubbed media', () => {
  const group = {id:'episode-4',files:[old]};
  assert.equal(appendSubtitledFiles(group,[old,sub,sub],'ep-'),1);
  assert.equal(appendSubtitledFiles(group,[sub],'ep-'),0);
  assert.deepEqual(group.files,[old,{...sub,id:'ep-sub'}]);
});
test('empty, conflicting and unrelated results preserve existing files', () => {
  const group = {files:[old]};
  for (const incoming of [[],[old],[{...sub,id:'dub'}],[{...sub,url:old.url}]]) assert.equal(appendSubtitledFiles(group,incoming),0);
  assert.deepEqual(group.files,[old]);
});
