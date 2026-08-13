import fs from 'node:fs/promises';

const file = 'scripts/sync-upera.mjs';
let source = await fs.readFile(file, 'utf8');

const oldBlock = `    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(45 + ((Number(group?.episodeNumber || 1) * 37) % 210)),
        '-i', source,
        '-frames:v', '1',
        '-vf', 'thumbnail=90,scale=640:-2',
        '-q:v', '5',
        '-y',
        absolute,
      ],
      {
        timeout: 18000,
        maxBuffer: 1024 * 1024,
      },
    );`;

const newBlock = `    // Upera's CDN rejects ffmpeg's default Lavf HTTP identity with 403 even
    // though the exact affiliate URL plays normally in a browser/app. Send a
    // browser-like request and retry the small set of provider referrers. The
    // frame is still decoded from this exact episode URL; no poster/backdrop or
    // another episode is ever used as a fallback.
    const userAgent = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/124 Safari/537.36';
    let sourceOrigin = 'https://upera.tv';
    try { sourceOrigin = new URL(source).origin; } catch { /* keep provider fallback */ }
    const requestOrigins = uniqueStrings([
      sourceOrigin,
      'https://upera.tv',
      'https://www.upera.tv',
      'https://seeko.film',
    ]);
    let frameError = null;
    let frameCreated = false;
    for (const requestOrigin of requestOrigins) {
      try {
        const headers = [
          \`Referer: \${requestOrigin}/\`,
          \`Origin: \${requestOrigin}\`,
          'Accept: */*',
          'Accept-Language: fa-IR,fa;q=0.9,en;q=0.8',
          'Connection: keep-alive',
          '',
        ].join('\\r\\n');
        await execFileAsync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel', 'error',
            '-user_agent', userAgent,
            '-headers', headers,
            '-ss', String(45 + ((Number(group?.episodeNumber || 1) * 37) % 210)),
            '-i', source,
            '-frames:v', '1',
            '-vf', 'thumbnail=90,scale=640:-2',
            '-q:v', '5',
            '-y',
            absolute,
          ],
          {
            timeout: 30000,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        frameCreated = true;
        break;
      } catch (error) {
        frameError = error;
        try { await fs.rm(absolute, { force: true }); } catch { /* retry */ }
      }
    }
    if (!frameCreated) throw (frameError || new Error('episode-frame-http-failed'));`;

if (source.includes(newBlock)) {
  console.log('Episode-frame HTTP access repair already applied.');
} else {
  if (!source.includes(oldBlock)) throw new Error('Expected ffmpeg frame block not found.');
  source = source.replace(oldBlock, newBlock);
}

await fs.writeFile(file, source, 'utf8');

const testFile = 'scripts/tests/episode-frame-http.test.mjs';
const test = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sync-upera.mjs', import.meta.url), 'utf8');

test('episode frame capture uses browser-like HTTP identity and provider referrer retries', () => {
  assert.ok(source.includes("'-user_agent', userAgent"));
  assert.ok(source.includes("'https://upera.tv'"));
  assert.ok(source.includes("'https://seeko.film'"));
  assert.ok(source.includes("Referer: \\${requestOrigin}/"));
  assert.ok(source.includes('if (!frameCreated) throw'));
});

test('episode frame remains sourced from the exact episode media URL', () => {
  assert.ok(source.includes("const source = episodeFrameSource(group);"));
  assert.ok(source.includes(".update(\\`\\${item?.id || 'series'}|\\${group?.sourceEpisodeId || group?.id || ''}|\\${source}\\`)"));
  assert.ok(!source.includes('episode frame fallback poster'));
});
`;
await fs.writeFile(testFile, test, 'utf8');
console.log('Applied exact episode frame HTTP access repair.');
