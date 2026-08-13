import fs from 'node:fs/promises';

await import('./apply-final-user-batch-20260814.mjs');

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');
client = client.replace(
  "  const iranian = item.ir === true || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR'));",
  "  const iranian = item.ir !== false || (Array.isArray(item.countryCodes) && item.countryCodes.includes('IR'));",
);
client = client.replace(
`const deriveClientLanguages = (item) => [...new Set(
  (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) =>
    (Array.isArray(section?.files) ? section.files : []).map((file) => file?.language)
  ).filter((value) => value === 'dubbed' || value === 'subtitled')
)];`,
`const deriveClientLanguages = (item) => [...new Set(
  (Array.isArray(item?.downloads) ? item.downloads : []).flatMap((section) =>
    (Array.isArray(section?.files) ? section.files : [])
      .map((file) => clientFileLanguage(file, section))
  ).filter((value) => value === 'dubbed' || value === 'subtitled')
)];`);
await fs.writeFile('scripts/client-catalog.mjs', client, 'utf8');

let tests = await fs.readFile('scripts/tests/client-catalog.test.mjs', 'utf8');
tests = tests.replace(
  "url: `https://cdn.test/${index}/${q}.mp4`, quality: `${q}` })),",
  "url: `https://cdn.test/${index}/${q}.mp4`, quality: `${q}`, language: 'subtitled' })),",
);
await fs.writeFile('scripts/tests/client-catalog.test.mjs', tests, 'utf8');

console.log('Aligned existing transport regressions with strict foreign dub/sub-only policy.');
