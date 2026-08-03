import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  assertHead,
  classifyCandidate,
  deriveHistoricalRoute,
  listLegacyCandidates,
  recordTag,
  verifyLive,
  verifyPagesBoundary,
  verifyPreservation,
  verifyStatic,
} from './verify-legacy-boundary.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function put(root, path, content) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function digest(root, path) {
  return createHash('sha256')
    .update(await readFile(join(root, path)))
    .digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-legacy-test-'));
  temporaryRoots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Legacy Test');
  git(root, 'config', 'user.email', 'legacy@example.com');
  await put(
    root,
    '.github/workflows/deploy.yml',
    'uses: actions/upload-pages-artifact@0123456789012345678901234567890123456789\nwith:\n  path: dist\n',
  );
  await put(root, '_config.yml', 'title: legacy\n');
  await put(root, 'index.html', '<h1>legacy</h1>\n');
  await put(root, 'mail/contact_me.php', '<?php echo "legacy";\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  const sha = git(root, 'rev-parse', 'HEAD');
  const tree = git(root, 'rev-parse', `${sha}^{tree}`);
  const paths = ['_config.yml', 'index.html', 'mail/contact_me.php'];
  const candidates = [];
  for (const path of paths) {
    candidates.push({
      path,
      ...classifyCandidate(path),
      digest: await digest(root, path),
      historicalRoute: deriveHistoricalRoute(path),
      preDeletion:
        deriveHistoricalRoute(path) === null
          ? null
          : {
              status: 404,
              finalUrl: `https://example.test/${path}`,
              contentType: 'text/html',
            },
    });
  }
  const manifest = {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    auditedSha: sha,
    auditedTree: tree,
    baseUrl: 'https://example.test',
    candidateCount: candidates.length,
    pagesUpload: {
      workflowPath: '.github/workflows/deploy.yml',
      artifactPath: 'dist',
      verified: true,
    },
    preservation: {
      method: 'annotated-tag',
      recoveryRef: 'fixture-tag',
      remote: 'origin',
      sha,
      tree,
      tagObjectSha: 'pending',
      verifiedAt: new Date(0).toISOString(),
    },
    candidates,
  };
  await put(
    root,
    'docs/legacy-preservation.json',
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { root, sha, tree, manifest };
}

test('classifies and derives only the declared legacy boundary', () => {
  assert.deepEqual(
    listLegacyCandidates([
      'src/pages/index.astro',
      'assets/hero.jpg',
      '_site/index.html',
      '_posts/2017-07-13-KBG.markdown',
      'mail/contact_me.php',
      'index.html',
    ]),
    [
      '_posts/2017-07-13-KBG.markdown',
      '_site/index.html',
      'assets/hero.jpg',
      'index.html',
      'mail/contact_me.php',
    ],
  );
  assert.deepEqual(classifyCandidate('_site/index.html'), {
    classification: 'generated-site',
    preserve: false,
  });
  assert.deepEqual(classifyCandidate('mail/contact_me.php'), {
    classification: 'php-handler',
    preserve: false,
  });
  assert.equal(deriveHistoricalRoute('_site/history/index.html'), '/history/');
  assert.equal(
    deriveHistoricalRoute('_posts/2017-07-13-KBG.markdown'),
    '/2017/07/13/KBG.html',
  );
  assert.equal(deriveHistoricalRoute('_layouts/default.html'), null);
});

test('requires the Pages artifact boundary to be exactly dist', async () => {
  const { root } = await fixture();
  assert.equal((await verifyPagesBoundary(root)).artifactPath, 'dist');
  await put(
    root,
    '.github/workflows/deploy.yml',
    'uses: actions/upload-pages-artifact@0123456789012345678901234567890123456789\nwith:\n  path: .\n',
  );
  await assert.rejects(() => verifyPagesBoundary(root), /exactly dist/);
});

test('locks the audited HEAD and candidate digests before deletion', async () => {
  const { root, sha } = await fixture();
  await assertHead({
    manifestPath: 'docs/legacy-preservation.json',
    sha,
    root,
  });
  await put(root, 'index.html', '<h1>changed</h1>\n');
  await assert.rejects(
    () =>
      assertHead({
        manifestPath: 'docs/legacy-preservation.json',
        sha,
        root,
      }),
    /changed after inventory/,
  );
  await assert.rejects(
    () =>
      assertHead({
        manifestPath: 'docs/legacy-preservation.json',
        sha: '0000000000000000000000000000000000000000',
        root,
      }),
    /SHA mismatch/,
  );
});

test('fails while legacy candidates are active and passes after exact removal', async () => {
  const { root } = await fixture();
  await assert.rejects(
    () => verifyStatic({ manifestPath: 'docs/legacy-preservation.json', root }),
    /remain active/,
  );
  await Promise.all(
    ['_config.yml', 'index.html', 'mail/contact_me.php'].map((path) =>
      unlink(join(root, path)),
    ),
  );
  git(root, 'rm', '--cached', '_config.yml', 'index.html', 'mail/contact_me.php');
  await mkdir(join(root, 'dist'), { recursive: true });
  await verifyStatic({ manifestPath: 'docs/legacy-preservation.json', root });
});

test('detects regression of a route that was live before deletion', async () => {
  let responseStatus = 200;
  const server = createServer((_request, response) => {
    response.writeHead(responseStatus, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('portfolio');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const root = await mkdtemp(join(tmpdir(), 'portfolio-legacy-live-'));
    temporaryRoots.push(root);
    const candidate = {
      path: 'index.html',
      classification: 'legacy-entry',
      preserve: true,
      digest: 'fixture',
      historicalRoute: '/',
      preDeletion: {
        status: 200,
        finalUrl: `${baseUrl}/`,
        contentType: 'text/plain',
      },
    };
    await put(
      root,
      'manifest.json',
      `${JSON.stringify({
        version: 1,
        auditedSha: 'fixture',
        auditedTree: 'fixture',
        candidateCount: 1,
        pagesUpload: { artifactPath: 'dist' },
        preservation: { method: 'annotated-tag' },
        candidates: [candidate],
      })}\n`,
    );
    await verifyLive({ baseUrl, manifestPath: 'manifest.json', root });
    responseStatus = 404;
    await assert.rejects(
      () => verifyLive({ baseUrl, manifestPath: 'manifest.json', root }),
      /route regressions/,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('records and re-verifies a remotely peeled annotated tag', async () => {
  const { root, sha, manifest } = await fixture();
  const remote = await mkdtemp(join(tmpdir(), 'portfolio-legacy-remote-'));
  temporaryRoots.push(remote);
  git(remote, 'init', '--bare', '-q');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'tag', '-a', 'fixture-tag', sha, '-m', 'fixture preservation');
  git(root, 'push', '-q', 'origin', 'refs/tags/fixture-tag');
  manifest.preservation = null;
  await put(
    root,
    'docs/legacy-preservation.json',
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await recordTag({
    manifestPath: 'docs/legacy-preservation.json',
    tag: 'fixture-tag',
    sha,
    remote: 'origin',
    root,
  });
  await verifyPreservation({
    manifestPath: 'docs/legacy-preservation.json',
    remote: 'origin',
    root,
  });
});
