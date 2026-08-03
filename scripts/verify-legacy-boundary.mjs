import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), '..');

const LEGACY_DIRECTORIES = [
  '_site/',
  '_includes/',
  '_layouts/',
  '_posts/',
  '_sass/',
  'assets/',
  'css/',
  'js/',
  'mail/',
];
const LEGACY_FILES = new Set([
  '_config.yml',
  'index.html',
  'portfolio.html',
  'pi.html',
  'history.md',
  'feed.xml',
]);
const ALLOWED_ARCHIVE_DESTINATION = 'archive/legacy';

function runGit(args, root = defaultRoot) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizePath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function listTrackedFiles(root = defaultRoot) {
  const output = runGit(['ls-files', '-z'], root);
  return output ? output.split('\0').filter(Boolean).map(normalizePath) : [];
}

async function listFilesRecursively(directory) {
  if (!(await exists(directory))) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(path)));
    if (entry.isFile()) files.push(path);
  }
  return files.sort(compareText);
}

export function isLegacyCandidate(path) {
  const normalized = normalizePath(path);
  return (
    LEGACY_FILES.has(normalized) ||
    LEGACY_DIRECTORIES.some((directory) => normalized.startsWith(directory))
  );
}

export function listLegacyCandidates(files) {
  return [...new Set(files.filter(isLegacyCandidate))].sort(compareText);
}

export function classifyCandidate(path) {
  if (path.startsWith('_site/')) {
    return { classification: 'generated-site', preserve: false };
  }
  if (path === 'mail/contact_me.php') {
    return { classification: 'php-handler', preserve: false };
  }
  if (path.startsWith('_posts/')) {
    return { classification: 'jekyll-post-source', preserve: true };
  }
  if (path.startsWith('_includes/')) {
    return { classification: 'jekyll-include-source', preserve: true };
  }
  if (path.startsWith('_layouts/')) {
    return { classification: 'jekyll-layout-source', preserve: true };
  }
  if (path.startsWith('_sass/')) {
    return { classification: 'jekyll-style-source', preserve: true };
  }
  if (path === '_config.yml') {
    return { classification: 'jekyll-config', preserve: true };
  }
  if (path === 'history.md') {
    return { classification: 'jekyll-page-source', preserve: true };
  }
  if (LEGACY_FILES.has(path)) {
    return { classification: 'legacy-entry', preserve: true };
  }
  if (path.startsWith('assets/')) {
    return { classification: 'legacy-asset', preserve: true };
  }
  if (path.startsWith('css/')) {
    return { classification: 'legacy-style', preserve: true };
  }
  if (path.startsWith('js/')) {
    return { classification: 'legacy-script', preserve: true };
  }
  throw new Error(`Unclassified legacy candidate: ${path}`);
}

function pageRoute(path) {
  if (path === 'index.html') return '/';
  if (path.endsWith('/index.html')) {
    return `/${path.slice(0, -'index.html'.length)}`;
  }
  return `/${path}`;
}

export function deriveHistoricalRoute(path) {
  if (
    path.startsWith('_includes/') ||
    path.startsWith('_layouts/') ||
    path.startsWith('_sass/') ||
    path === '_config.yml'
  ) {
    return null;
  }
  if (path.startsWith('_site/')) return pageRoute(path.slice('_site/'.length));
  if (path === 'history.md') return '/history/';
  if (path.startsWith('_posts/')) {
    const match = /^_posts\/(\d{4})-(\d{2})-(\d{2})-(.+)\.markdown$/.exec(path);
    if (!match) throw new Error(`Cannot derive Jekyll post route: ${path}`);
    return `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html`;
  }
  return pageRoute(path);
}

function routeUrl(baseUrl, route) {
  const encodedPath = route
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return new URL(encodedPath, `${baseUrl.replace(/\/$/, '')}/`).href;
}

function normalizedContentType(value) {
  return value?.split(';', 1)[0].trim().toLowerCase() || null;
}

export async function inspectRoute(baseUrl, route) {
  const response = await fetch(routeUrl(baseUrl, route), {
    headers: { 'user-agent': 'portfolio-legacy-boundary/1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  await response.body?.cancel();
  return {
    status: response.status,
    finalUrl: response.url,
    contentType: normalizedContentType(response.headers.get('content-type')),
  };
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

async function digestFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function verifyPagesBoundary(root = defaultRoot) {
  const workflowPath = resolve(root, '.github/workflows/deploy.yml');
  const workflow = await readFile(workflowPath, 'utf8');
  const lines = workflow.split('\n');
  const artifactPaths = lines.flatMap((line, index) => {
    if (!/uses:\s*actions\/upload-pages-artifact@/.test(line)) return [];
    const step = lines.slice(index + 1, index + 10).join('\n');
    const path = /^\s*path:\s*([^\s#]+)/m.exec(step)?.[1];
    return path ? [path] : [];
  });
  if (artifactPaths.length !== 1 || artifactPaths[0] !== 'dist') {
    throw new Error(
      `Pages artifact boundary must be exactly dist; found ${JSON.stringify(artifactPaths)}`,
    );
  }
  return {
    workflowPath: '.github/workflows/deploy.yml',
    artifactPath: 'dist',
    verified: true,
  };
}

function assertManifestShape(manifest) {
  if (manifest?.version !== 1) throw new Error('Legacy manifest version must be 1');
  if (!manifest.auditedSha || !manifest.auditedTree) {
    throw new Error('Legacy manifest is missing its audited SHA/tree');
  }
  if (!Array.isArray(manifest.candidates)) {
    throw new Error('Legacy manifest candidates must be an array');
  }
  if (manifest.candidateCount !== manifest.candidates.length) {
    throw new Error('Legacy manifest candidate count is inconsistent');
  }
  const paths = manifest.candidates.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Legacy manifest contains duplicate candidate paths');
  }
  for (const entry of manifest.candidates) {
    const expectedBoundary = classifyCandidate(entry.path);
    if (
      !isLegacyCandidate(entry.path) ||
      entry.classification !== expectedBoundary.classification ||
      entry.preserve !== expectedBoundary.preserve ||
      typeof entry.digest !== 'string' ||
      !Object.hasOwn(entry, 'historicalRoute') ||
      entry.historicalRoute !== deriveHistoricalRoute(entry.path) ||
      (entry.historicalRoute !== null &&
        (!entry.preDeletion || typeof entry.preDeletion.status !== 'number'))
    ) {
      throw new Error(`Invalid or unclassified manifest candidate: ${entry.path}`);
    }
  }
  if (manifest.pagesUpload?.artifactPath !== 'dist') {
    throw new Error('Legacy manifest does not record the dist Pages boundary');
  }
}

async function readManifest(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assertManifestShape(manifest);
  return manifest;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function inventory({ baseUrl, out, root = defaultRoot }) {
  if (!baseUrl || !out) throw new Error('inventory requires --base-url and --out');
  const candidates = listLegacyCandidates(listTrackedFiles(root));
  if (candidates.length === 0) throw new Error('No tracked legacy candidates found');
  const changedCandidates = runGit(
    ['diff', '--name-only', 'HEAD', '--', ...candidates],
    root,
  );
  if (changedCandidates) {
    throw new Error(
      `Legacy working tree differs from audited HEAD: ${changedCandidates.replaceAll('\n', ', ')}`,
    );
  }

  const classified = candidates.map((path) => ({
    path,
    ...classifyCandidate(path),
    historicalRoute: deriveHistoricalRoute(path),
  }));
  const routes = [...new Set(classified.map((entry) => entry.historicalRoute).filter(Boolean))];
  const routeResults = await mapConcurrent(routes, 8, async (route) => [
    route,
    await inspectRoute(baseUrl, route),
  ]);
  const responses = new Map(routeResults);

  const entries = await mapConcurrent(classified, 16, async (entry) => ({
    ...entry,
    digest: await digestFile(resolve(root, entry.path)),
    preDeletion: entry.historicalRoute
      ? responses.get(entry.historicalRoute)
      : null,
  }));
  entries.sort((left, right) => compareText(left.path, right.path));

  const auditedSha = runGit(['rev-parse', 'HEAD'], root);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    auditedSha,
    auditedTree: runGit(['rev-parse', `${auditedSha}^{tree}`], root),
    baseUrl: new URL(baseUrl).origin,
    candidateCount: entries.length,
    pagesUpload: await verifyPagesBoundary(root),
    preservation: null,
    candidates: entries,
  };
  await writeJson(resolve(root, out), manifest);
  console.log(
    `Legacy inventory recorded ${entries.length} candidates and ${routes.length} routes at ${auditedSha}.`,
  );
  return manifest;
}

export async function assertHead({ manifestPath, sha, root = defaultRoot }) {
  const manifest = await readManifest(resolve(root, manifestPath));
  const head = runGit(['rev-parse', 'HEAD'], root);
  if (head !== sha || manifest.auditedSha !== sha) {
    throw new Error(
      `Legacy SHA mismatch: HEAD=${head} manifest=${manifest.auditedSha} expected=${sha}`,
    );
  }
  const tree = runGit(['rev-parse', `${sha}^{tree}`], root);
  if (tree !== manifest.auditedTree) throw new Error('Audited tree no longer matches HEAD');

  const current = listLegacyCandidates(listTrackedFiles(root));
  const recorded = manifest.candidates.map((entry) => entry.path);
  if (JSON.stringify(current) !== JSON.stringify(recorded)) {
    throw new Error('Tracked legacy candidate set changed after inventory');
  }
  for (const entry of manifest.candidates) {
    if ((await digestFile(resolve(root, entry.path))) !== entry.digest) {
      throw new Error(`Legacy candidate changed after inventory: ${entry.path}`);
    }
  }
  console.log(`Legacy inventory matches HEAD ${sha}.`);
}

function remoteTagState(tag, remote, root) {
  const output = runGit(
    ['ls-remote', '--tags', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    root,
  );
  const refs = new Map(
    output
      .split('\n')
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/, 2).reverse()),
  );
  return {
    objectSha: refs.get(`refs/tags/${tag}`) ?? null,
    peeledSha: refs.get(`refs/tags/${tag}^{}`) ?? null,
  };
}

export async function recordTag({
  manifestPath,
  tag,
  sha,
  remote,
  root = defaultRoot,
}) {
  const absoluteManifest = resolve(root, manifestPath);
  const manifest = await readManifest(absoluteManifest);
  if (!tag || !sha || !remote) {
    throw new Error('record-tag requires --tag, --sha, and --verify-origin');
  }
  if (manifest.auditedSha !== sha) throw new Error('Tag SHA differs from audited SHA');
  if (runGit(['cat-file', '-t', `refs/tags/${tag}`], root) !== 'tag') {
    throw new Error(`${tag} is not an annotated tag`);
  }
  const localSha = runGit(['rev-parse', `refs/tags/${tag}^{}`], root);
  const localTree = runGit(['rev-parse', `refs/tags/${tag}^{tree}`], root);
  const remoteState = remoteTagState(tag, remote, root);
  if (
    localSha !== sha ||
    localTree !== manifest.auditedTree ||
    remoteState.peeledSha !== sha ||
    !remoteState.objectSha
  ) {
    throw new Error(
      `Annotated tag verification failed: local=${localSha} remote=${remoteState.peeledSha} expected=${sha}`,
    );
  }
  manifest.preservation = {
    method: 'annotated-tag',
    recoveryRef: tag,
    remote,
    sha,
    tree: localTree,
    tagObjectSha: remoteState.objectSha,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(absoluteManifest, manifest);
  console.log(`Verified remote annotated tag ${tag} at ${sha}.`);
}

function assertInsideRoot(path, root) {
  const rel = relative(root, path);
  if (rel.startsWith('..') || resolve(root, rel) !== path) {
    throw new Error(`Path escapes repository root: ${path}`);
  }
}

export async function archiveCandidates({
  manifestPath,
  destination,
  apply,
  root = defaultRoot,
}) {
  const absoluteManifest = resolve(root, manifestPath);
  const manifest = await readManifest(absoluteManifest);
  const normalizedDestination = normalizePath(destination ?? '');
  if (normalizedDestination !== ALLOWED_ARCHIVE_DESTINATION) {
    throw new Error(`Archive destination must be ${ALLOWED_ARCHIVE_DESTINATION}`);
  }
  const moves = manifest.candidates
    .filter((entry) => entry.preserve)
    .map((entry) => ({
      source: entry.path,
      destination: `${normalizedDestination}/${entry.path}`,
      digest: entry.digest,
    }));
  for (const move of moves) {
    const source = resolve(root, move.source);
    const target = resolve(root, move.destination);
    assertInsideRoot(source, root);
    assertInsideRoot(target, root);
    if (!isLegacyCandidate(move.source)) throw new Error(`Refusing source ${move.source}`);
    if (!(await exists(source))) throw new Error(`Archive source is missing: ${move.source}`);
    if (await exists(target)) throw new Error(`Archive destination exists: ${move.destination}`);
  }
  console.log(moves.map((move) => `${move.source} -> ${move.destination}`).join('\n'));
  if (!apply) return moves;

  for (const move of moves) {
    const source = resolve(root, move.source);
    const target = resolve(root, move.destination);
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }
  manifest.preservation = {
    method: 'in-repo-archive',
    recoveryRef: normalizedDestination,
    files: moves,
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(absoluteManifest, manifest);
  return moves;
}

export async function verifyStatic({ manifestPath, root = defaultRoot }) {
  const manifest = await readManifest(resolve(root, manifestPath));
  if (!manifest.preservation) throw new Error('Preservation gate has not been recorded');
  const archiveAllowlist = new Set(
    manifest.preservation.method === 'in-repo-archive'
      ? manifest.preservation.files.map((entry) => entry.destination)
      : [],
  );
  const survivors = [];
  for (const entry of manifest.candidates) {
    if (await exists(resolve(root, entry.path))) survivors.push(entry.path);
  }
  if (survivors.length > 0) {
    throw new Error(`Legacy candidates remain active: ${survivors.join(', ')}`);
  }
  const currentCandidates = listLegacyCandidates(listTrackedFiles(root));
  if (currentCandidates.length > 0) {
    throw new Error(`Tracked legacy candidates remain: ${currentCandidates.join(', ')}`);
  }
  for (const path of archiveAllowlist) {
    if (!(await exists(resolve(root, path)))) {
      throw new Error(`Archived preservation file is missing: ${path}`);
    }
  }
  if (manifest.preservation.method === 'in-repo-archive') {
    const archiveRoot = resolve(root, ALLOWED_ARCHIVE_DESTINATION);
    const archivedFiles = (await listFilesRecursively(archiveRoot)).map((path) =>
      normalizePath(relative(root, path)),
    );
    const expectedFiles = [...archiveAllowlist].sort(compareText);
    if (JSON.stringify(archivedFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `In-repo archive differs from its exact allowlist: ${JSON.stringify(archivedFiles)}`,
      );
    }
  }
  await verifyPagesBoundary(root);
  const distRoot = resolve(root, 'dist');
  if (await exists(distRoot)) {
    const forbiddenDistPaths = ['_site', '_posts', '_includes', '_layouts', '_sass', 'mail'];
    for (const path of forbiddenDistPaths) {
      if (await exists(resolve(distRoot, path))) {
        throw new Error(`Legacy root entered Pages output: dist/${path}`);
      }
    }
  }
  console.log(
    `Legacy static boundary passed: ${manifest.candidateCount} candidates absent; Pages uploads dist only.`,
  );
}

export async function verifyLive({ baseUrl, manifestPath, root = defaultRoot }) {
  const manifest = await readManifest(resolve(root, manifestPath));
  const expected = new Map();
  for (const entry of manifest.candidates) {
    if (entry.historicalRoute && entry.preDeletion.status >= 200 && entry.preDeletion.status < 300) {
      expected.set(entry.historicalRoute, entry.preDeletion);
    }
  }
  const routes = [...expected.keys()].sort(compareText);
  const current = new Map(
    await mapConcurrent(routes, 8, async (route) => [
      route,
      await inspectRoute(baseUrl, route),
    ]),
  );
  const regressions = [];
  for (const route of routes) {
    const before = expected.get(route);
    const after = current.get(route);
    if (
      after.status !== before.status ||
      after.finalUrl !== before.finalUrl ||
      after.contentType !== before.contentType
    ) {
      regressions.push({ route, before, after });
    }
  }
  if (regressions.length > 0) {
    throw new Error(`Live legacy route regressions: ${JSON.stringify(regressions)}`);
  }
  console.log(`Legacy live boundary passed: ${routes.length} pre-deletion 2xx routes unchanged.`);
  return { checkedRoutes: routes.length, regressions: [] };
}

export async function verifyPreservation({
  manifestPath,
  remote,
  root = defaultRoot,
}) {
  const manifest = await readManifest(resolve(root, manifestPath));
  const preservation = manifest.preservation;
  if (!preservation) throw new Error('Preservation gate has not been recorded');
  if (preservation.method === 'annotated-tag') {
    if (!remote) throw new Error('Tag preservation verification requires --verify-origin');
    const remoteState = remoteTagState(preservation.recoveryRef, remote, root);
    const localSha = runGit(
      ['rev-parse', `refs/tags/${preservation.recoveryRef}^{}`],
      root,
    );
    const localTree = runGit(
      ['rev-parse', `refs/tags/${preservation.recoveryRef}^{tree}`],
      root,
    );
    if (
      remoteState.peeledSha !== preservation.sha ||
      remoteState.objectSha !== preservation.tagObjectSha ||
      localSha !== preservation.sha ||
      localTree !== preservation.tree ||
      preservation.sha !== manifest.auditedSha ||
      preservation.tree !== manifest.auditedTree
    ) {
      throw new Error('Annotated-tag preservation no longer matches the audited SHA/tree');
    }
  } else if (preservation.method === 'in-repo-archive') {
    for (const file of preservation.files) {
      const path = resolve(root, file.destination);
      if (!(await exists(path)) || (await digestFile(path)) !== file.digest) {
        throw new Error(`Archived preservation digest mismatch: ${file.destination}`);
      }
    }
  } else {
    throw new Error(`Unknown preservation method: ${preservation.method}`);
  }
  console.log(`Legacy preservation verified via ${preservation.method}.`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'dry-run' || key === 'apply') {
      options[key] = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[key] = value;
  }
  return options;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === 'inventory') {
    await inventory({ baseUrl: options['base-url'], out: options.out });
  } else if (command === 'assert-head') {
    await assertHead({ manifestPath: options.manifest, sha: options.sha });
  } else if (command === 'record-tag') {
    await recordTag({
      manifestPath: options.manifest,
      tag: options.tag,
      sha: options.sha,
      remote: options['verify-origin'],
    });
  } else if (command === 'archive') {
    if (!options['dry-run'] && !options.apply) {
      throw new Error('archive requires --dry-run or --apply');
    }
    await archiveCandidates({
      manifestPath: options.manifest,
      destination: options.destination,
      apply: Boolean(options.apply),
    });
  } else if (command === 'verify-static') {
    await verifyStatic({ manifestPath: options.manifest });
  } else if (command === 'verify-live') {
    await verifyLive({
      baseUrl: options['base-url'],
      manifestPath: options.manifest,
    });
  } else if (command === 'verify-preservation') {
    await verifyPreservation({
      manifestPath: options.manifest,
      remote: options['verify-origin'],
    });
  } else {
    throw new Error(
      'Usage: verify-legacy-boundary.mjs <inventory|assert-head|record-tag|archive|verify-static|verify-live|verify-preservation> [options]',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
