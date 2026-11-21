import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMedia,appendMediaVersions} from '../existing-audit.mjs';
test('positive evidence must be a complete explicit file error', async()=>{
  for(const [body,status] of [['{"message":"File not found"}','dead'],['{"message":"Route not found"}','unknown'],['{','unknown'],[' '.repeat(3000)+'{"message":"File removed"}','unknown']]) assert.equal(await inspectMedia(new Response(body,{status:404,headers:{'content-type':'application/json'}})),status);
});
test('new dub is appended once alongside a subtitle',()=>{
  const group={files:[{id:'s',language:'subtitled',url:'https://example.invalid/s'}]};
  const dub={id:'d',language:'dubbed',url:'https://example.invalid/d'};
  assert.equal(appendMediaVersions(group,[dub,dub]),1); assert.deepEqual(group.files.map(f=>f.language),['subtitled','dubbed']);
});
