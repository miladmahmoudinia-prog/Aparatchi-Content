import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCatalogItem } from '../classification.mjs';
import { buildClientCatalogArtifacts } from '../client-catalog.mjs';

const operatorFile = (suffix = 'stream') => ({
  id: `operator-${suffix}`,
  url: `https://media.example.net/${suffix}.m3u8`,
  mode: 'operator-play',
  operatorOnly: true,
  panelVerified: true,
  trafficOo: 1,
});

const normalFile = (suffix = 'movie') => ({
  id: `normal-${suffix}`,
  url: `https://media.example.net/${suffix}.mp4`,
  mode: 'download',
});

const applyClassification = (item) => {
  const classified = classifyCatalogItem(item);
  return {
    ...item,
    ...classified,
    categoryKeys: [...new Set([...(classified.categoryKeys || []), ...(item.categoryKeys || [])])],
    categoryLabels: [...new Set([...(classified.categoryLabels || []), ...(item.categoryLabels || [])])],
  };
};

test('pending generic operator shells are withheld from client publication', () => {
  const pending = {
    id: 'operator-pending',
    type: 'movie',
    ir: true,
    year: 2025,
    nameFa: 'عنوان اپراتوری نامشخص',
    name: 'Unknown operator title',
    operatorOnly: true,
    access: 'operator',
    operatorClassificationStatus: 'pending',
    categoryKeys: ['mobile-operator'],
    categoryLabels: ['ویژه اینترنت همراه'],
    downloads: [{ id: 'operator', files: [operatorFile('pending')] }],
  };
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: new Date(0).toISOString(), items: [pending] });
  assert.equal(artifacts.index.items.length, 0);
});

test('verified operator content keeps both operator and true-category shelves', () => {
  const classified = applyClassification({
    id: 'operator-doc',
    type: 'movie',
    ir: true,
    year: 2025,
    nameFa: 'مستند اپراتوری آزمایشی',
    name: 'Operator Documentary',
    genres: ['مستند'],
    countryCodes: ['IR'],
    originalLanguage: 'fa',
    operatorOnly: true,
    access: 'operator',
    operatorClassificationStatus: 'verified',
    categoryKeys: ['mobile-operator'],
    categoryLabels: ['ویژه اینترنت همراه'],
    downloads: [{ id: 'operator', files: [operatorFile('verified-doc')] }],
  });
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: new Date(0).toISOString(), items: [classified] });
  assert.equal(artifacts.index.items.length, 1);
  const [item] = artifacts.index.items;
  assert.ok(item.categoryKeys.includes('mobile-operator'));
  assert.ok(item.categoryKeys.includes('documentaries'));
  assert.ok(!item.categoryKeys.includes('iranian-movies'));
});

test('Arghavan-style shorts use the permanent short-films category instead of Iranian movies', () => {
  const classified = applyClassification({
    id: 'arghavan-short',
    type: 'movie',
    ir: true,
    year: 2025,
    nameFa: 'لمس جهان',
    name: 'Touching the World',
    countryCodes: ['IR'],
    originalLanguage: 'fa',
    downloads: [{ id: 'movie', files: [normalFile('arghavan')] }],
  });
  assert.equal(classified.contentKind, 'short-film');
  assert.ok(classified.categoryKeys.includes('short-films'));
  assert.ok(!classified.categoryKeys.includes('iranian-movies'));
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: new Date(0).toISOString(), items: [classified] });
  assert.ok(artifacts.index.items.some((item) => item.id === 'arghavan-short' && item.categoryKeys.includes('short-films')));
});

test('reported documentary examples follow documentary rules, not Iranian-film fallback', () => {
  for (const [nameFa, year] of [['امپراتور و ما', 2006], ['آزادی در مه', 2007], ['اتو استاپ', 2004], ['اشغال جزایر', 2025]]) {
    const classified = classifyCatalogItem({ type: 'movie', ir: true, nameFa, year, countryCodes: ['IR'], originalLanguage: 'fa' });
    assert.equal(classified.contentKind, 'documentary', `${nameFa} should be documentary`);
    assert.ok(classified.categoryKeys.includes('documentaries'), `${nameFa} should be in documentaries`);
    assert.ok(!classified.categoryKeys.includes('iranian-movies'), `${nameFa} should not be in iranian-movies`);
  }
});

test('verified Iranian operator series can live in both Iranian series and mobile operator', () => {
  const classified = applyClassification({
    id: 'operator-series',
    type: 'series',
    ir: true,
    year: 2025,
    nameFa: 'سریال اپراتوری آزمایشی',
    name: 'Operator Series',
    genres: ['درام'],
    countryCodes: ['IR'],
    originalLanguage: 'fa',
    operatorOnly: true,
    access: 'operator',
    operatorClassificationStatus: 'verified',
    categoryKeys: ['mobile-operator'],
    categoryLabels: ['ویژه اینترنت همراه'],
    publicationStatus: 'published',
    archiveComplete: true,
    sourceEpisodeCount: 1,
    episodeCount: 1,
    latestEpisode: { seasonNumber: 1, episodeNumber: 1 },
    downloads: [{ id: 's1e1', seasonNumber: 1, episodeNumber: 1, files: [operatorFile('series-1')] }],
  });
  const artifacts = buildClientCatalogArtifacts({ version: 'test', updatedAt: new Date(0).toISOString(), items: [classified] });
  assert.equal(artifacts.index.items.length, 1);
  const [item] = artifacts.index.items;
  assert.ok(item.categoryKeys.includes('mobile-operator'));
  assert.ok(item.categoryKeys.includes('iranian-series'));
});
