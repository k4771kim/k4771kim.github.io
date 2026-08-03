import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runPreviewVerification } from './run-portfolio-ci.mjs';

const healthyServer = `
  const http = require('node:http');
  const port = Number(process.argv[1]);
  http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ready');
  }).listen(port, '127.0.0.1');
`;

const stubbornServer = `
  process.on('SIGTERM', () => {});
  ${healthyServer}
`;

async function getAvailablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await onceListening(server);
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function onceListening(server) {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function assertPortClosed(url) {
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }));
}

async function runTestPair({ serverCode = healthyServer, verificationExitCode = 0 }) {
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const result = await runPreviewVerification({
    previewCommand: [process.execPath, '-e', serverCode, String(port)],
    verificationCommand: [process.execPath, '-e', `process.exit(${verificationExitCode})`],
    url,
    expectedReadinessBody: 'ready',
    stdio: 'ignore',
    readyTimeoutMs: 1_500,
    readyIntervalMs: 25,
    stopTimeoutMs: 100,
  });
  await assertPortClosed(url);
  return result;
}

test('returns verification success and leaves no preview process', async () => {
  const result = await runTestPair({});
  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanupSignal, 'SIGTERM');
});

test('propagates the verification exit code', async () => {
  const result = await runTestPair({ verificationExitCode: 7 });
  assert.equal(result.exitCode, 7);
});

test('times out readiness and terminates the preview process', async () => {
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;

  await assert.rejects(
    runPreviewVerification({
      previewCommand: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      verificationCommand: [process.execPath, '-e', 'process.exit(0)'],
      url,
      expectedReadinessBody: 'ready',
      stdio: 'ignore',
      readyTimeoutMs: 100,
      readyIntervalMs: 20,
      stopTimeoutMs: 100,
    }),
    (error) => {
      assert.match(error.message, /readiness timed out/);
      assert.equal(error.cleanupSignal, 'SIGTERM');
      return true;
    },
  );
});

test('rejects foreign readiness when the preview serves on another port', async () => {
  const foreignServer = createHttpServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
    response.end('foreign');
  });
  foreignServer.listen(0, '127.0.0.1');
  await onceListening(foreignServer);
  const address = foreignServer.address();
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await assert.rejects(
      runPreviewVerification({
        previewCommand: [process.execPath, '-e', healthyServer, '0'],
        verificationCommand: [process.execPath, '-e', 'process.exit(0)'],
        url,
        expectedReadinessBody: 'ready',
        stdio: 'ignore',
        readyTimeoutMs: 500,
        readyIntervalMs: 20,
        stopTimeoutMs: 100,
      }),
      (error) => {
        assert.match(error.message, /readiness timed out/);
        assert.equal(error.cleanupSignal, 'SIGTERM');
        return true;
      },
    );

    const response = await fetch(url);
    assert.equal(await response.text(), 'foreign');
  } finally {
    await new Promise((resolve, reject) => {
      foreignServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('Astro forwards strict preview binding through Vite configuration', async () => {
  const astroConfig = (await import(new URL('../astro.config.mjs', import.meta.url))).default;
  assert.equal(astroConfig.vite?.preview?.strictPort, true);
});

test('escalates from TERM to KILL for an uncooperative preview', async () => {
  const result = await runTestPair({ serverCode: stubbornServer });
  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanupSignal, 'SIGKILL');
});

test('workflow pins runtimes, permissions, triggers, and immutable actions', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const expectedActions = new Map([
    ['actions/checkout', ['3d3c42e5aac5ba805825da76410c181273ba90b1', 'v7.0.1']],
    ['actions/setup-node', ['820762786026740c76f36085b0efc47a31fe5020', 'v7.0.0']],
    ['actions/configure-pages', ['45bfe0192ca1faeb007ade9deae92b16b8254a0d', 'v6.0.0']],
    ['actions/upload-pages-artifact', ['fc324d3547104276b827a68afc52ff2a11cc49c9', 'v5.0.0']],
    ['actions/deploy-pages', ['cd2ce8fcbc39b97be8ca5fce6e763baed58fa128', 'v5.0.0']],
  ]);
  const actionLines = [...workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s+#\s+(v\S+)$/gm)];

  assert.equal(actionLines.length, expectedActions.size);
  for (const [, action, sha, tag] of actionLines) {
    assert.deepEqual([sha, tag], expectedActions.get(action), action);
  }
  assert.match(workflow, /pull_request:\n\s+branches: \[master\]/);
  assert.match(workflow, /node-version: 24\.18\.1/);
  assert.doesNotMatch(workflow, /ubuntu-latest/);
  assert.match(workflow, /build:\n\s+runs-on: ubuntu-24\.04\n\s+permissions:\n\s+contents: read/);
  assert.match(workflow, /deploy:[\s\S]*permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
  assert.equal(
    (workflow.match(/github\.ref == 'refs\/heads\/master' && github\.event_name != 'pull_request'/g) ?? []).length,
    3,
  );
});
