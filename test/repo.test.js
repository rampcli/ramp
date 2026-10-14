import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLanding } from '../scripts/build-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.svg', '.yml', '.css', '']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (TEXT.has(extname(name))) yield p;
  }
}

test('docs/index.html is built from the current math and template', async () => {
  assert.equal(readFileSync(join(root, 'docs/index.html'), 'utf8'), await buildLanding(), 'run npm run build:docs');
});

test('no em or en dashes anywhere in the repo', () => {
  const bad = [];
  for (const f of files(root)) if (/[\u2013\u2014]/.test(readFileSync(f, 'utf8'))) bad.push(f);
  assert.deepEqual(bad, []);
});

test('math.js stays browser safe (no imports, no Node globals)', () => {
  const src = readFileSync(join(root, 'src/math.js'), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /\b(require|process|Buffer)\b/);
});
