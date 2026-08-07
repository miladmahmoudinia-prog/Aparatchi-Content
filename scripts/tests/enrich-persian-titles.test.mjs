import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repairScript = path.resolve(testDirectory, '..', 'enrich-persian-titles.mjs');

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

const close = (server) => new Promise((resolve) => server.close(resolve));

test('Persian metadata repair fills a missing Persian title and poster from TMDB', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-persian-repair-'));
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url?.startsWith('/find/tt5000000')) {
      response.end(JSON.stringify({ movie_results: [{ id: 42, title: 'Example Movie', poster_path: null }] }));
      return;
    }
    if (request.url?.startsWith('/movie/42?')) {
      response.end(JSON.stringify({ id: 42, title: 'فیلم نمونه', poster_path: '/poster42.jpg' }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ status_message: 'not found' }));
  });
  const address = await listen(server);

  const catalog = {
    version: 'test-persian-repair',
    updatedAt: new Date(0).toISOString(),
    items: [
      {
        id: 'movie-42',
        type: 'movie',
        name: 'Example Movie',
        nameFa: 'Example Movie',
        year: 2025,
        imdb: 'tt5000000',
        poster: '',
      },
    ],
  };
  await fs.writeFile(path.join(fixtureDirectory, 'catalog.json'), `${JSON.stringify(catalog)}\n`, 'utf8');

  try {
    await execFileAsync(process.execPath, [repairScript], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        TMDB_READ_ACCESS_TOKEN: 'test-token',
        TMDB_API_BASE: `http://127.0.0.1:${address.port}`,
        PERSIAN_TITLE_MAX_TITLES_PER_RUN: '10',
        PERSIAN_TITLE_REQUEST_DELAY_MS: '0',
      },
    });
    const result = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'catalog.json'), 'utf8'));
    assert.equal(result.items[0].nameFa, 'فیلم نمونه');
    assert.equal(result.items[0].poster, 'https://image.tmdb.org/t/p/w500/poster42.jpg');
    assert.equal(result.items[0].posterFallback, 'https://image.tmdb.org/t/p/w500/poster42.jpg');
    const cache = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'persian-title-cache.json'), 'utf8'));
    assert.equal(cache.items['movie-42'].tmdbId, 42);
    const manifest = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'catalog-manifest.json'), 'utf8'));
    assert.match(manifest.revision, /^[a-f0-9]{64}$/);
  } finally {
    await close(server);
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});
