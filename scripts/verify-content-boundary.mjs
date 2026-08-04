import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedActiveProjects = {
  '11-boolio.md': 'Boolio',
  '12-allatte.md': 'Allatte',
  '14-humandesignhub.md': 'HDHub',
  '15-linchpin.md': 'Linchpin',
  '16-flowmate.md': 'FlowMate',
  '17-insway.md': 'InsWay',
};
const expectedArchivedProjects = [
  '01-foroom.md',
  '02-voiceofthousands.md',
  '03-ardrumoid.md',
  '04-recipedia.md',
  '05-lookar.md',
  '06-andante.md',
  '07-madlen.md',
  '09-elicemobile.md',
  '10-marketvillage.md',
  '13-sajuhub.md',
];
const imageKeys = new Set(['thumbnail', 'detailImage']);
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.txt', '.xml']);
const sourceTextExtensions = new Set(['.astro', '.js', '.jsx', '.md', '.mjs', '.ts', '.tsx']);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith('--'), `${name} requires a value`);
  return value;
}

const command = process.argv[2] === 'write-graph' ? 'write-graph' : 'verify';
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(argumentValue('--root') ?? defaultRoot);
const activeContentDirectory = join(root, 'src/content/projects');
const activeSourceBoundary = join(root, 'src');
const archiveRoot = join(root, 'archive/projects');
const archivedContentDirectory = join(archiveRoot, 'content/projects');
const archivedAssetDirectory = join(archiveRoot, 'assets/portfolio');
const graphPath = join(archiveRoot, 'reference-graph.json');
const distDirectory = join(root, 'dist');

const normalizePath = (path) => path.replaceAll('\\', '/');
const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort(compareCodeUnits);
const isInside = (boundary, target) => {
  const pathFromBoundary = relative(boundary, target);
  return (
    pathFromBoundary === '' ||
    (!pathFromBoundary.startsWith('..') && !isAbsolute(pathFromBoundary))
  );
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function filesIn(directory, extension) {
  return sorted(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (!extension || extname(entry.name) === extension))
      .map((entry) => entry.name),
  );
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    if (entry.isFile()) files.push(path);
  }
  return sorted(files);
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readProject(path) {
  const source = await readFile(path, 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, `${normalizePath(relative(root, path))} has no frontmatter`);

  const project = { title: undefined, featured: false, imageReferences: [] };
  let readingGallery = false;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const property = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (property) {
      const [, key, value] = property;
      readingGallery = key === 'galleryImages';
      if (key === 'title') project.title = unquote(value);
      if (key === 'featured') project.featured = value.trim() === 'true';
      if (imageKeys.has(key) && value.trim()) {
        project.imageReferences.push(unquote(value));
      }
      continue;
    }

    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (readingGallery && listItem) {
      project.imageReferences.push(unquote(listItem[1]));
    }
  }

  assert.ok(project.title, `${normalizePath(relative(root, path))} has no title`);
  return project;
}

async function resolveProjectImages(projectPath, project, boundary) {
  const resolvedImages = [];
  for (const reference of project.imageReferences) {
    const imagePath = resolve(dirname(projectPath), reference);
    assert.ok(
      isInside(boundary, imagePath),
      `${normalizePath(relative(root, projectPath))} escapes its image boundary: ${reference}`,
    );
    assert.equal(
      (await stat(imagePath)).isFile(),
      true,
      `${normalizePath(relative(root, projectPath))} has a missing image: ${reference}`,
    );
    resolvedImages.push(normalizePath(relative(boundary, imagePath)));
  }
  return sorted(resolvedImages);
}

async function buildReferenceGraph(activeFiles, archivedFiles) {
  const projects = {};
  const assetOwners = {};

  for (const filename of archivedFiles) {
    const path = join(archivedContentDirectory, filename);
    const project = await readProject(path);
    const source = normalizePath(relative(archiveRoot, path));
    assert.equal(project.featured, false, `${source} must remain nonfeatured`);
    const images = await resolveProjectImages(path, project, archiveRoot);
    projects[source] = {
      title: project.title,
      featured: project.featured,
      images,
    };
    for (const image of images) {
      assetOwners[image] ??= [];
      assetOwners[image].push(source);
    }
  }

  return {
    version: 1,
    activeProjectFiles: activeFiles,
    archivedProjectFiles: archivedFiles,
    projects: Object.fromEntries(
      Object.entries(projects).sort(([left], [right]) => compareCodeUnits(left, right)),
    ),
    assets: Object.fromEntries(
      Object.entries(assetOwners)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([asset, owners]) => [asset, sorted(owners)]),
    ),
  };
}

async function verifyBuildExclusions(graph) {
  const archivedAssetNames = Object.keys(graph.assets).map((path) => path.split('/').at(-1));
  const archivedAssetStems = archivedAssetNames.map((name) => name.replace(/\.[^.]+$/, ''));
  const archivedSourceNames = graph.archivedProjectFiles;

  for (const file of await walkFiles(distDirectory)) {
    const relativeFile = normalizePath(relative(distDirectory, file));
    const lowerFilename = relativeFile.toLowerCase();
    for (const stem of archivedAssetStems) {
      assert.equal(
        lowerFilename.includes(`${stem.toLowerCase()}.`),
        false,
        `archived asset entered dist as ${relativeFile}`,
      );
    }

    if (!textExtensions.has(extname(file))) continue;
    const source = (await readFile(file, 'utf8')).toLowerCase();
    for (const name of [...archivedAssetNames, ...archivedSourceNames]) {
      assert.equal(
        source.includes(name.toLowerCase()),
        false,
        `archived owner ${name} entered ${relativeFile}`,
      );
    }
    for (const stem of archivedAssetStems) {
      assert.equal(
        source.includes(`/_astro/${stem.toLowerCase()}.`),
        false,
        `archived asset ${stem} is referenced by ${relativeFile}`,
      );
    }
  }
}

async function verifyDeadSurfaceRemoval() {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies?.ogl, undefined, 'ogl remains a direct dependency');
  assert.equal(
    await exists(join(root, 'src/React/LetterGlitch.tsx')),
    false,
    'LetterGlitch remains in active source',
  );
  assert.equal(
    await exists(join(root, 'src/assets/portfolio/dionysign.png')),
    false,
    'Dionysign thumbnail remains in active assets',
  );
  assert.equal(
    await exists(join(root, 'src/assets/portfolio/dionysign_view.png')),
    false,
    'Dionysign detail image remains in active assets',
  );

  for (const file of await walkFiles(activeSourceBoundary)) {
    if (!sourceTextExtensions.has(extname(file))) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /archive\/projects\//i,
      `${normalizePath(relative(root, file))} imports the project archive`,
    );
    assert.doesNotMatch(
      source,
      /\bLetterGlitch\b|from\s+['"]ogl['"]|dionysign/i,
      `${normalizePath(relative(root, file))} references a removed surface`,
    );
  }
}

const activeFiles = await filesIn(activeContentDirectory, '.md');
const archivedFiles = await filesIn(archivedContentDirectory, '.md');
assert.deepEqual(activeFiles, sorted(Object.keys(expectedActiveProjects)));
assert.deepEqual(archivedFiles, sorted(expectedArchivedProjects));

for (const filename of activeFiles) {
  const path = join(activeContentDirectory, filename);
  const project = await readProject(path);
  assert.equal(project.title, expectedActiveProjects[filename]);
  assert.equal(project.featured, true, `${filename} must remain featured`);
  await resolveProjectImages(path, project, activeSourceBoundary);
}

const graph = await buildReferenceGraph(activeFiles, archivedFiles);
const graphAssetFiles = sorted(
  (await filesIn(archivedAssetDirectory)).map((filename) =>
    normalizePath(relative(archiveRoot, join(archivedAssetDirectory, filename))),
  ),
);
assert.deepEqual(Object.keys(graph.assets), graphAssetFiles);

if (command === 'write-graph') {
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`Wrote ${normalizePath(relative(root, graphPath))}.`);
} else {
  assert.deepEqual(
    JSON.parse(await readFile(graphPath, 'utf8')),
    graph,
    'archive/projects/reference-graph.json is stale',
  );
  await verifyBuildExclusions(graph);
  await verifyDeadSurfaceRemoval();

  console.log(
    `Content boundary passed: ${activeFiles.length} active projects, ` +
      `${archivedFiles.length} archived projects, ${graphAssetFiles.length} archived assets.`,
  );
}
