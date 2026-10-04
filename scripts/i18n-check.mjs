#!/usr/bin/env node
// Lists UI strings wrapped in tr('…') / ctx.t('…') that have no Hindi translation in src/i18n/hi.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { default: hi } = await import(pathToFileURL(path.join(ROOT, 'i18n/hi.js')).href);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const missing = new Map();
for (const f of walk(ROOT)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?<![\w.])(?:tr|ctx\.t)\('((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    if (/[A-Za-z]/.test(key) && hi[key] === undefined) missing.set(key, path.relative(ROOT, f));
  }
}
if (!missing.size) console.log('✔ All UI strings have Hindi translations');
else {
  console.log(`✖ ${missing.size} string(s) missing in src/i18n/hi.js:`);
  for (const [k, f] of missing) console.log(`  ${JSON.stringify(k)}   (${f})`);
  process.exitCode = 1;
}
