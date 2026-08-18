import fs from 'node:fs';

const path = 'scripts/classification.mjs';
let src = fs.readFileSync(path, 'utf8');
const before = `const generalProgramTerms = [
  'ویژه برنامه', 'ویژه‌برنامه', 'برنامه نوروزی', 'برنامه نوروز',
  'nowruz special', 'new year special',
];`;
const after = `const generalProgramTerms = [
  // Keep this identity narrow: generic "special" is also used by real movies
  // and animation films (for example a Christmas special). Only established
  // Nowruz-program wording is strong enough to override movie identity.
  'ویژه برنامه نوروز', 'ویژه‌برنامه نوروز', 'برنامه نوروزی', 'برنامه نوروز',
  'nowruz special',
];`;
const count = src.split(before).length - 1;
if (count !== 1) throw new Error(`generalProgramTerms block expected once, got ${count}`);
src = src.replace(before, after);
fs.writeFileSync(path, src);
console.log('program classification refined');
