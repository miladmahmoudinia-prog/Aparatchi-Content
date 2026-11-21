import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMedia} from '../existing-audit.mjs';
for (const [label, status, body, expected] of [
  ['portal disguised as MP4', 206, '<html>Sign in</html>', 'unknown'],
  ['transient CDN failure', 503, 'Unavailable', 'unknown'],
  ['header without bytes', 200, '', 'unknown'],
  ['denial from streaming endpoint', 200, 'This Video is Not For Streaming', 'dead'],
  ['empty missing response', 410, '', 'unknown'],
  ['404 login portal',404,'<html>login</html>','unknown'],
  ['playlist', 200, '#EXTM3U\n#EXT-X-VERSION:3\n', 'healthy'],
  ['MP4 prefix', 206, Buffer.from('000000186674797069736f6d','hex'), 'healthy'],
]) test(label, async () => {
  const response = new Response(body,{status,headers:{'content-type':'video/mp4'}});
  assert.equal(await inspectMedia(response),expected);
});
