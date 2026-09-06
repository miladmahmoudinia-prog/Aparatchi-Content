import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('scripts/sync-upera.mjs', 'utf8');
const start = source.indexOf('async function fetchPanelShowLinks(');
const end = source.indexOf('async function fetchAffiliateLinks(', start);
const body = source.slice(start, end);

async function run(records, rootTraffic) {
  const context = {
    panelToken: 'configured',
    PANEL_API_BASE: 'https://panel-api.upera.tv/api/v1',
    fetchPanelJson: async () => ({ data: { links: records, traffic_oo: rootTraffic } }),
    findPanelTrafficFlag: () => rootTraffic,
    extractAffiliateLinkRecords: (data) => data.links,
    panelTrafficFlag: (link, fallback) => Number.isFinite(Number(link.traffic_oo)) ? Number(link.traffic_oo) : fallback,
    uniqueByUrl: (links) => [...new Map(links.map((link) => [link.link, link])).values()],
    isDirectMediaUrl: (url) => /\.(?:mp4|m3u8)(?:$|[?#])/i.test(String(url || '')),
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  return context.fetchPanelShowLinks('episode-id', 'episode');
}

test('authenticated traffic_oo=2 direct episode media is retained', async () => {
  const result = await run([
    { link: 'https://upera.shop/ref/paid' },
    { link: 'https://aparatchi.upera.tv/2936842-0-720.mp4', amount: 0 },
    { link: 'https://aparatchi.upera.tv/2936842-0-hls.m3u8', amount: 0 },
  ], 2);
  assert.deepEqual(
    result.map((link) => link.link),
    [
      'https://aparatchi.upera.tv/2936842-0-720.mp4',
      'https://aparatchi.upera.tv/2936842-0-hls.m3u8',
    ],
  );
  assert.ok(result.every((link) => link._panel_verified === true));
});

test('traffic_oo=2 purchase pages remain rejected', async () => {
  const result = await run([{ link: 'https://upera.shop/ref/paid' }], 2);
  assert.deepEqual(result, []);
});

test('verified portal traffic flags retain their existing behavior', async () => {
  const publicPortal = await run([{ link: 'https://upera.tv/stream/episode/public' }], 0);
  const operatorPortal = await run([{ link: 'https://upera.tv/stream/episode/operator' }], 1);
  assert.equal(publicPortal.length, 1);
  assert.equal(operatorPortal.length, 1);
});
