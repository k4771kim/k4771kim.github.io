import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);
const verifier = new URL('./verify-content-boundary.mjs', import.meta.url);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-content-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await Promise.all([
    cp(new URL('../src/content/projects/', import.meta.url), join(root, 'src/content/projects'), {
      recursive: true,
    }),
    cp(new URL('../src/assets/portfolio/', import.meta.url), join(root, 'src/assets/portfolio'), {
      recursive: true,
    }),
    cp(new URL('../archive/projects/', import.meta.url), join(root, 'archive/projects'), {
      recursive: true,
    }),
    cp(new URL('../package.json', import.meta.url), join(root, 'package.json')),
  ]);
  await mkdir(join(root, 'dist'), { recursive: true });
  await Promise.all([
    cp(new URL('../dist/index.html', import.meta.url), join(root, 'dist/index.html')),
    cp(
      new URL('../dist/portfolio-client-manifest.json', import.meta.url),
      join(root, 'dist/portfolio-client-manifest.json'),
    ),
  ]);
  return root;
}

function verify(root) {
  return spawnSync(process.execPath, [verifier.pathname, '--root', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

test('accepts the intact active and archive boundaries', async (t) => {
  const root = await fixture(t);
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rejects a missing active project', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'src/content/projects/16-flowmate.md'));
  assert.notEqual(verify(root).status, 0);
});

test('rejects an active project with featured disabled', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'src/content/projects/11-boolio.md');
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace('featured: true', 'featured: false'));
  assert.notEqual(verify(root).status, 0);
});

test('rejects a broken active image reference', async (t) => {
  const root = await fixture(t);
  const path = join(root, 'src/content/projects/16-flowmate.md');
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace('flowmate.svg', 'missing-flowmate.svg'));
  assert.notEqual(verify(root).status, 0);
});

test('rejects an archived asset import from active source', async (t) => {
  const root = await fixture(t);
  await writeFile(
    join(root, 'src/archive-leak.js'),
    "import leak from '../archive/projects/assets/portfolio/sajuhub.png';\n",
  );
  assert.notEqual(verify(root).status, 0);
});
