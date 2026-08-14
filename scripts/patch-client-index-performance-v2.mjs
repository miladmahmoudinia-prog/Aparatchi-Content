import fs from 'node:fs/promises';

const replaceOnce = (source, from, to, label) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Missing patch marker: ${label}`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`Non-unique patch marker: ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
};

let client = await fs.readFile('scripts/client-catalog.mjs', 'utf8');

client = replaceOnce(
  client,
  `  // Actor/director profile pages need a reverse lookup from person -> titles.\n  // Keep only identity fields in the lightweight index; photos, character names,\n  // bios and the rest of the heavy cast payload remain in the lazy detail shard.\n  // This preserves fast startup while preventing every person profile from\n  // incorrectly showing "0 titles".\n  const compactPeople = compactPersonReferences(item?.people);\n  if (compactPeople.length) summary.people = compactPeople;\n\n`,
  `  // People are intentionally excluded from every item summary. The reverse\n  // peopleWorks index below preserves actor/director search and profile works\n  // without duplicating the same identities inside thousands of catalog rows.\n\n`,
  'per-item compact people',
);

client = replaceOnce(
  client,
  `    items.push(summary);\n    for (const person of Array.isArray(summary.people) ? summary.people : []) {\n      for (const key of peopleWorkKeysForPerson(person)) {\n        if (!peopleWorks[key]) peopleWorks[key] = [];\n        if (!peopleWorks[key].includes(summary.id)) peopleWorks[key].push(summary.id);\n      }\n    }\n`,
  `    const itemIndex = items.length;\n    items.push(summary);\n    for (const person of Array.isArray(item.people) ? item.people : []) {\n      for (const key of peopleWorkKeysForPerson(person)) {\n        if (!peopleWorks[key]) peopleWorks[key] = [];\n        // Transport item indexes instead of repeating long string IDs for every\n        // actor alias. The mobile parser resolves these indexes back to the\n        // existing item.id strings without duplicating string payloads.\n        if (!peopleWorks[key].includes(itemIndex)) peopleWorks[key].push(itemIndex);\n      }\n    }\n`,
  'people works transport',
);

await fs.writeFile('scripts/client-catalog.mjs', client);

let test = await fs.readFile('scripts/tests/client-catalog.test.mjs', 'utf8');
test = test.replace(
  "test('client index strips heavy media fields but preserves browse metadata and compact cast identities', () => {",
  "test('client item summary strips heavy media and duplicated cast identities', () => {",
);
test = replaceOnce(
  test,
  `  assert.deepEqual(summary.people, [{ id: 'p1', nameFa: 'بازیگر', name: 'Actor', role: 'actor', tmdbId: 42 }]);\n  assert.equal('image' in summary.people[0], false);\n  assert.equal('character' in summary.people[0], false);\n  assert.equal('popularity' in summary.people[0], false);\n`,
  `  assert.equal('people' in summary, false);\n`,
  'summary people assertions',
);
test = replaceOnce(
  test,
  `  assert.equal(artifacts.index.items[0].people.length, 25);\n  assert.equal('image' in artifacts.index.items[0].people[0], false);\n`,
  `  assert.equal('people' in artifacts.index.items[0], false);\n  assert.deepEqual(artifacts.index.peopleWorks['tmdb:1000'], [0]);\n  assert.ok(Object.values(artifacts.index.peopleWorks).every((indexes) => indexes.every(Number.isInteger)));\n`,
  'heavy people assertions',
);
await fs.writeFile('scripts/tests/client-catalog.test.mjs', test);

console.log(JSON.stringify({
  perItemPeopleRemoved: true,
  peopleWorksUsesItemIndexes: true,
}, null, 2));
