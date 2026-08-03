import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const manifestPath = new URL('portfolio-client-manifest.json', dist);
const baselinePath = new URL('.omx/qa/portfolio/baseline.json', root);
const metricsPath = new URL('.omx/qa/portfolio/bodygraph-metrics.json', root);

const heavyModulePatterns = [
  /^src\/React\/BodyGraphWrapper\.tsx$/,
  /^src\/data\/humanDesignData\.ts$/,
  /^node_modules\/@hdhub\/bodygraph-3d\//,
  /^node_modules\/@react-three\/fiber\//,
  /^node_modules\/@react-three\/drei\//,
  /^node_modules\/three\//,
];

const isHeavyModule = (moduleId) =>
  heavyModulePatterns.some((pattern) => pattern.test(moduleId));

const [manifest, baseline, html] = await Promise.all([
  readFile(manifestPath, 'utf8').then(JSON.parse),
  readFile(baselinePath, 'utf8').then(JSON.parse),
  readFile(new URL('index.html', dist), 'utf8'),
]);

assert.equal(manifest.version, 1, 'unexpected client manifest version');

const chunkEntries = Object.entries(manifest.chunks);
const findChunkByModule = (moduleId) =>
  chunkEntries.find(([, chunk]) => chunk.modules.includes(moduleId));

const shellEntry = findChunkByModule('src/React/BodyGraphShell.tsx');
const leafEntry = findChunkByModule('src/React/BodyGraphWrapper.tsx');
assert.ok(shellEntry, 'BodyGraph shell chunk is missing');
assert.ok(leafEntry, 'BodyGraph lazy leaf chunk is missing');

const [shellFile, shellChunk] = shellEntry;
const [leafFile, leafChunk] = leafEntry;
assert.deepEqual(
  shellChunk.dynamicImports,
  [leafFile],
  'the shell must have exactly one dynamic import: the BodyGraph leaf',
);
assert.equal(leafChunk.isEntry, false, 'the BodyGraph leaf must not be an entry chunk');

const heavyOwnerFiles = new Set(
  chunkEntries
    .filter(([, chunk]) => chunk.modules.some(isHeavyModule))
    .map(([file]) => file),
);
assert.deepEqual(
  [...heavyOwnerFiles],
  [leafFile],
  'BodyGraph data, Canvas, Three, and vendor modules must share one lazy leaf',
);

for (const requiredModule of [
  'src/data/humanDesignData.ts',
  'node_modules/@hdhub/bodygraph-3d/dist/index.js',
]) {
  assert.ok(
    leafChunk.modules.includes(requiredModule),
    `${requiredModule} must be owned by the lazy leaf`,
  );
}
assert.ok(
  leafChunk.modules.some((moduleId) => moduleId.startsWith('node_modules/@react-three/fiber/')),
  'React Three Fiber must be owned by the lazy leaf',
);
assert.ok(
  leafChunk.modules.some((moduleId) => moduleId.startsWith('node_modules/three/')),
  'Three.js must be owned by the lazy leaf',
);

const staticClosure = new Set();
const visitStaticImports = (file) => {
  if (staticClosure.has(file)) return;
  staticClosure.add(file);
  const chunk = manifest.chunks[file];
  assert.ok(chunk, `missing manifest entry for ${file}`);
  for (const importedFile of chunk.imports) visitStaticImports(importedFile);
};
visitStaticImports(shellFile);

for (const file of staticClosure) {
  const chunk = manifest.chunks[file];
  assert.equal(
    chunk.modules.some(isHeavyModule),
    false,
    `heavy module leaked into the shell's static closure through ${file}`,
  );
}

assert.match(
  html,
  /<astro-island[^>]+component-url="\/_astro\/BodyGraphShell\.[^"]+\.js"[^>]+props="\{\}"[^>]+client="visible"[^>]+rootMargin&quot;:&quot;200px&quot;/,
  'BodyGraph must hydrate visibly with a 200px root margin and no serialized props',
);
assert.doesNotMatch(
  html,
  /Left Angle Cross of Upheaval \(17\/18 \| 38\/39\)/,
  'Human Design fixture data leaked into server HTML',
);

const htmlBytes = (await stat(new URL('index.html', dist))).size;
const htmlReductionBytes = baseline.dist.indexHtmlBytes - htmlBytes;
assert.ok(
  htmlReductionBytes >= 10 * 1024,
  `server HTML reduction was ${htmlReductionBytes} bytes; expected at least 10 KiB`,
);

const assetNames = await readdir(new URL('_astro/', dist));
const javascript = await Promise.all(
  assetNames
    .filter((name) => name.endsWith('.js'))
    .map(async (name) => {
      const bytes = await readFile(new URL(`_astro/${name}`, dist));
      return {
        file: `_astro/${name}`,
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
      };
    }),
);
const emittedJavaScriptGzipBytes = javascript.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const heavyJavaScriptGzipBytes = javascript
  .filter((asset) => heavyOwnerFiles.has(asset.file))
  .reduce((total, asset) => total + asset.gzipBytes, 0);
const nonBodyGraphJavaScriptGzipBytes =
  emittedJavaScriptGzipBytes - heavyJavaScriptGzipBytes;
const nonBodyGraphBudgetBytes =
  baseline.dist.nonBodyGraphJavaScriptGzipBytes + 10 * 1024;
assert.ok(
  nonBodyGraphJavaScriptGzipBytes <= nonBodyGraphBudgetBytes,
  `non-BodyGraph JavaScript is ${nonBodyGraphJavaScriptGzipBytes} bytes gzip; budget is ${nonBodyGraphBudgetBytes}`,
);

const metrics = {
  capturedAt: new Date().toISOString(),
  baseline: {
    indexHtmlBytes: baseline.dist.indexHtmlBytes,
    nonBodyGraphJavaScriptGzipBytes:
      baseline.dist.nonBodyGraphJavaScriptGzipBytes,
  },
  current: {
    indexHtmlBytes: htmlBytes,
    htmlReductionBytes,
    emittedJavaScriptGzipBytes,
    nonBodyGraphJavaScriptGzipBytes,
    nonBodyGraphDeltaGzipBytes:
      nonBodyGraphJavaScriptGzipBytes -
      baseline.dist.nonBodyGraphJavaScriptGzipBytes,
    nonBodyGraphBudgetBytes,
  },
  bodyGraph: {
    shellFile,
    leafFile,
    heavyOwnerFiles: [...heavyOwnerFiles],
    shellStaticClosure: [...staticClosure].sort(),
    leafRawBytes:
      javascript.find((asset) => asset.file === leafFile)?.rawBytes ?? null,
    leafGzipBytes:
      javascript.find((asset) => asset.file === leafFile)?.gzipBytes ?? null,
  },
};

await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);

console.log(
  `BodyGraph build boundary passed: HTML -${htmlReductionBytes} bytes, ` +
    `non-BodyGraph JS ${nonBodyGraphJavaScriptGzipBytes}/${nonBodyGraphBudgetBytes} bytes gzip.`,
);
