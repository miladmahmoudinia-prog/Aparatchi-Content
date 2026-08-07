import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const rankingScript = path.resolve(testDirectory, '..', 'update-imdb-top.mjs');

test('IMDb ranking keeps all 100 entries and only links titles available in the catalog', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-imdb-ranking-'));
  const ratings = ['tconst\taverageRating\tnumVotes'];
  const basics = ['tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres'];

  for (let index = 0; index < 100; index += 1) {
    const movieImdb = `tt${String(1_000_000 + index)}`;
    const seriesImdb = `tt${String(2_000_000 + index)}`;
    ratings.push(`${movieImdb}\t${(9.9 - (index % 10) / 10).toFixed(1)}\t${200_000 - index}`);
    ratings.push(`${seriesImdb}\t${(9.8 - (index % 10) / 10).toFixed(1)}\t${150_000 - index}`);
    basics.push(`${movieImdb}\tmovie\tMovie ${index}\tMovie ${index}\t0\t2020\t\\N\t120\tDrama`);
    basics.push(`${seriesImdb}\ttvSeries\tSeries ${index}\tSeries ${index}\t0\t2021\t\\N\t45\tDrama`);
  }

  const catalog = {
    version: 'test',
    updatedAt: new Date(0).toISOString(),
    items: [
      { id: 'movie-in-app', type: 'movie', name: 'Movie 0', nameFa: 'فیلم موجود', year: 2020, imdb: 'tt1000000', rate: 1, poster: 'https://example.test/movie.jpg' },
      { id: 'series-in-app', type: 'series', name: 'Series 0', nameFa: 'سریال موجود', year: 2021, imdb: 'tt2000000', rate: 1, poster: 'https://example.test/series.jpg' },
    ],
  };

  await Promise.all([
    fs.writeFile(path.join(fixtureDirectory, 'catalog.json'), `${JSON.stringify(catalog)}\n`, 'utf8'),
    fs.writeFile(path.join(fixtureDirectory, 'ratings.tsv'), `${ratings.join('\n')}\n`, 'utf8'),
    fs.writeFile(path.join(fixtureDirectory, 'basics.tsv'), `${basics.join('\n')}\n`, 'utf8'),
  ]);

  try {
    await execFileAsync(process.execPath, [rankingScript], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        IMDB_RATINGS_FILE: path.join(fixtureDirectory, 'ratings.tsv'),
        IMDB_BASICS_FILE: path.join(fixtureDirectory, 'basics.tsv'),
        IMDB_TOP_FORCE: '1',
        TMDB_READ_ACCESS_TOKEN: '',
      },
    });
    const result = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'catalog.json'), 'utf8'));
    const manifest = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'catalog-manifest.json'), 'utf8'));
    assert.equal(result.imdbTop100.source, 'imdb-ratings-dataset');
    assert.equal(result.imdbTop100.formatVersion, 2);
    assert.equal(result.imdbTop100.movies.length, 100);
    assert.equal(result.imdbTop100.series.length, 100);
    assert.equal(result.imdbTop100.movies.find((entry) => entry.imdb === 'tt1000000')?.itemId, 'movie-in-app');
    assert.equal(result.imdbTop100.series.find((entry) => entry.imdb === 'tt2000000')?.itemId, 'series-in-app');
    assert.equal(result.imdbTop100.movies.find((entry) => entry.imdb === 'tt1000001')?.itemId, undefined);
    assert.equal(result.imdbTop100.movies.find((entry) => entry.imdb === 'tt1000000')?.title, 'Movie 0');
    assert.equal(result.imdbTop100.movies.find((entry) => entry.imdb === 'tt1000000')?.titleFa, 'فیلم موجود');
    assert.equal(manifest.catalogVersion, result.version);
    assert.equal(manifest.catalogUpdatedAt, result.updatedAt);
    assert.match(manifest.revision, /^[a-f0-9]{64}$/);
    assert.ok(manifest.sizeBytes > 0);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});


test('fresh IMDb ranking repairs missing Persian title and poster metadata without rebuilding ranks', async () => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'aparatchi-imdb-hydrate-'));
  const now = new Date().toISOString();
  const movies = Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    type: 'movie',
    title: `Movie ${index}`,
    imdb: `tt${String(3_000_000 + index)}`,
    year: 2022,
    rating: 9 - index / 100,
    votes: 100_000 - index,
  }));
  const series = Array.from({ length: 100 }, (_, index) => ({
    rank: index + 1,
    type: 'series',
    title: `Series ${index}`,
    imdb: `tt${String(4_000_000 + index)}`,
    year: 2023,
    rating: 9 - index / 100,
    votes: 90_000 - index,
  }));
  const catalog = {
    version: 'test-fresh',
    updatedAt: now,
    items: [
      {
        id: 'movie-fresh',
        type: 'movie',
        name: 'Movie 0',
        nameFa: 'فیلم فارسی تازه',
        year: 2022,
        imdb: 'tt3000000',
        poster: 'https://example.test/fresh-movie.jpg',
      },
      {
        id: 'series-fresh',
        type: 'series',
        name: 'Series 0',
        nameFa: 'سریال فارسی تازه',
        year: 2023,
        imdb: 'tt4000000',
        poster: 'https://example.test/fresh-series.jpg',
      },
    ],
    imdbTop100: {
      formatVersion: 2,
      source: 'imdb-ratings-dataset',
      updatedAt: now,
      movies,
      series,
    },
  };

  await fs.writeFile(path.join(fixtureDirectory, 'catalog.json'), `${JSON.stringify(catalog)}\n`, 'utf8');
  try {
    await execFileAsync(process.execPath, [rankingScript], {
      cwd: fixtureDirectory,
      env: {
        ...process.env,
        IMDB_TOP_REFRESH_HOURS: '20',
        IMDB_TOP_FORCE: '',
        TMDB_READ_ACCESS_TOKEN: '',
      },
    });
    const result = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'catalog.json'), 'utf8'));
    const firstMovie = result.imdbTop100.movies[0];
    const firstSeries = result.imdbTop100.series[0];
    assert.equal(firstMovie.rank, 1);
    assert.equal(firstMovie.itemId, 'movie-fresh');
    assert.equal(firstMovie.titleFa, 'فیلم فارسی تازه');
    assert.equal(firstMovie.poster, 'https://example.test/fresh-movie.jpg');
    assert.equal(firstSeries.rank, 1);
    assert.equal(firstSeries.itemId, 'series-fresh');
    assert.equal(firstSeries.titleFa, 'سریال فارسی تازه');
    assert.equal(firstSeries.poster, 'https://example.test/fresh-series.jpg');
    assert.equal(result.imdbTop100.movies.length, 100);
    assert.equal(result.imdbTop100.series.length, 100);
    const cache = JSON.parse(await fs.readFile(path.join(fixtureDirectory, 'imdb-top-cache.json'), 'utf8'));
    assert.equal(cache.version, 2);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
});
