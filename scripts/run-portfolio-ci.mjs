import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_READY_INTERVAL_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function signalProcessTree(child, signal) {
  if (!child.pid || !isRunning(child)) return;

  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function stopProcessTree(child, timeoutMs) {
  if (!isRunning(child)) return child.signalCode ?? 'already-exited';

  signalProcessTree(child, 'SIGTERM');
  const exitedAfterTerm = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ]);

  if (exitedAfterTerm) return child.signalCode ?? 'SIGTERM';

  signalProcessTree(child, 'SIGKILL');
  await once(child, 'exit');
  return child.signalCode ?? 'SIGKILL';
}

async function waitForHttp(
  url,
  expectedBody,
  preview,
  getSpawnError,
  timeoutMs,
  intervalMs,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (!isRunning(preview)) {
      throw new Error(`Preview exited before readiness (${preview.exitCode ?? preview.signalCode})`);
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (response.ok && body === expectedBody) return;
    } catch {
      // The preview process is still starting.
    }

    await delay(intervalMs);
  }

  throw new Error(`Preview readiness timed out after ${timeoutMs}ms: ${url}`);
}

async function runCommand(command, { cwd, env, stdio }) {
  const [executable, ...args] = command;
  const child = spawn(executable, args, { cwd, env, stdio });
  const [exitCode, signal] = await Promise.race([
    once(child, 'exit'),
    once(child, 'error').then(([error]) => Promise.reject(error)),
  ]);

  return exitCode ?? (signal ? 1 : 0);
}

export async function runPreviewVerification({
  previewCommand,
  verificationCommand,
  url,
  readinessUrl = url,
  expectedReadinessBody,
  cwd = process.cwd(),
  env = process.env,
  stdio = 'inherit',
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyIntervalMs = DEFAULT_READY_INTERVAL_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
}) {
  if (typeof expectedReadinessBody !== 'string') {
    throw new TypeError('expectedReadinessBody must be a string');
  }

  const [previewExecutable, ...previewArgs] = previewCommand;
  const preview = spawn(previewExecutable, previewArgs, {
    cwd,
    env,
    stdio,
    detached: process.platform !== 'win32',
  });
  let previewSpawnError;
  let failure;
  let verificationExitCode = 1;

  preview.once('error', (error) => {
    previewSpawnError = error;
  });

  try {
    await waitForHttp(
      readinessUrl,
      expectedReadinessBody,
      preview,
      () => previewSpawnError,
      readyTimeoutMs,
      readyIntervalMs,
    );
    verificationExitCode = await runCommand(verificationCommand, {
      cwd,
      env: { ...env, PORTFOLIO_URL: url },
      stdio,
    });
  } catch (error) {
    failure = error;
  }

  const cleanupSignal = await stopProcessTree(preview, stopTimeoutMs);
  if (failure) {
    failure.cleanupSignal = cleanupSignal;
    throw failure;
  }

  return { exitCode: verificationExitCode, cleanupSignal };
}

async function main() {
  const host = process.env.PORTFOLIO_HOST ?? '127.0.0.1';
  const port = process.env.PORTFOLIO_PORT ?? '4321';
  const url = `http://${host}:${port}`;
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const verificationScript = fileURLToPath(new URL('./verify-portfolio.mjs', import.meta.url));
  const readinessFileName = `portfolio-readiness-${randomUUID()}.txt`;
  const readinessBody = randomUUID();
  const readinessFile = fileURLToPath(
    new URL(`../dist/${readinessFileName}`, import.meta.url),
  );

  await writeFile(readinessFile, readinessBody, { flag: 'wx' });
  try {
    const result = await runPreviewVerification({
      previewCommand: [
        npmExecutable,
        'run',
        'preview',
        '--',
        '--host',
        host,
        '--port',
        port,
      ],
      verificationCommand: [process.execPath, verificationScript],
      url,
      readinessUrl: new URL(readinessFileName, `${url}/`).href,
      expectedReadinessBody: readinessBody,
    });

    process.exitCode = result.exitCode;
  } finally {
    await rm(readinessFile, { force: true });
  }
}

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
