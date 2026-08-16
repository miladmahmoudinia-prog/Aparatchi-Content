const API_BASE = 'https://seeko.film/api/v1';
const ref = String(process.env.UPERA_REF_ID || '').trim();
const token = String(process.env.UPERA_TOKEN || '').trim();
if (!ref || !token) throw new Error('Upera credentials are unavailable.');

const samples = [
  { key: 'perfect-crown-e1', id: 'd5054cd0-5121-11f1-afd1-1b6bdd377027', type: 'episode' },
  { key: 'beloved-thief-e1', id: '20996690-ea0b-11f0-bfd6-db38f3dee1e8', type: 'episode' },
  { key: 'yaksha', id: '02a6f6e0-8c17-11ed-beec-a5e35212641d', type: 'movie' },
];
const titleSamples = [
  { key: 'perfect-crown', id: 'cbeacfc0-5121-11f1-a97c-a7cfc3f4e1b6', type: 'series' },
  { key: 'beloved-thief', id: '16b78e90-ea0b-11f0-8bab-27196343f1c8', type: 'series' },
];

const URL_KEYS = new Set(['link','url','href','download_url','downloadUrl','download_link','downloadLink','stream_url','streamUrl','stream_link','streamLink','file_url','fileUrl','file']);
const keepKey = (key) => /lang|audio|voice|dub|sub|title|name|label|type|kind|format|quality|resolution|version|desc|group|media|file/i.test(key);
const cleanUrl = (value) => {
  try {
    const url = new URL(String(value));
    url.searchParams.delete('ref');
    url.searchParams.delete('token');
    return url.toString();
  } catch {
    return String(value || '').slice(0, 240);
  }
};

function scan(value, path = '$', hints = [], output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((child, index) => scan(child, `${path}[${index}]`, hints, output));
    return output;
  }

  const ownHints = [...hints];
  for (const [key, child] of Object.entries(value)) {
    if (child == null || typeof child === 'object') continue;
    if (keepKey(key) && String(child).trim()) ownHints.push(`${key}=${String(child).slice(0, 160)}`);
  }

  for (const [key, child] of Object.entries(value)) {
    if (!URL_KEYS.has(key) || typeof child !== 'string' || !/^https?:\/\//i.test(child)) continue;
    output.push({
      path: `${path}.${key}`,
      url: cleanUrl(child),
      context: [...new Set(ownHints)].slice(-20),
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (URL_KEYS.has(key) || !child || typeof child !== 'object') continue;
    scan(child, `${path}.${key}`, [...ownHints, `parent=${key}`], output);
  }
  return output;
}

function semanticSignals(value, path = '$', output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((child, index) => semanticSignals(child, `${path}[${index}]`, output));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      semanticSignals(child, `${path}.${key}`, output);
      continue;
    }
    if (!/lang|audio|voice|dub|sub|persian|farsi|version|title|name|label|type|kind/i.test(key)) continue;
    const text = String(child ?? '').trim();
    if (!text) continue;
    output.push({ path: `${path}.${key}`, value: text.slice(0, 220) });
  }
  return output;
}

for (const sample of samples) {
  const url = new URL(`${API_BASE}/ghost/get/getaffiliatelinks`);
  url.searchParams.set('id', sample.id);
  url.searchParams.set('type', sample.type);
  url.searchParams.set('ref', ref);
  url.searchParams.set('traffic', '1');
  url.searchParams.set('token', token);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(`UPERA_LANGUAGE_SAMPLE_${sample.key}=HTTP_${response.status}`);
    continue;
  }
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`${sample.key}: non-JSON provider response`); }
  const rows = scan(payload);
  console.log(`UPERA_LANGUAGE_SAMPLE_${sample.key}=` + JSON.stringify({ count: rows.length, rows }));
}

for (const sample of titleSamples) {
  const url = new URL(`${API_BASE}/ghost/get/series/${encodeURIComponent(sample.id)}`);
  url.searchParams.set('affiliate', '1');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) {
    console.log(`UPERA_TITLE_LANGUAGE_${sample.key}=HTTP_${response.status}`);
    continue;
  }
  const payload = JSON.parse(text);
  const signals = semanticSignals(payload).filter((entry) =>
    /lang|audio|voice|dub|sub|persian|farsi/i.test(entry.path) || /دوبله|زیر\s*نویس|dub|sub|persian|farsi/i.test(entry.value)
  );
  console.log(`UPERA_TITLE_LANGUAGE_${sample.key}=` + JSON.stringify(signals.slice(0, 120)));
}
