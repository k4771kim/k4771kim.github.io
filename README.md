# Bogyun Kim — Portfolio

Astro-based portfolio for <https://k4771kim.github.io>. The public site presents
six selected projects and is deployed as a static GitHub Pages artifact.

## Local development

Use Node `24.18.1` (the version pinned in `.node-version` and CI).

```sh
npm ci
npx playwright install chromium
npm run dev
```

Before committing, run the same gate used by GitHub Actions:

```sh
npm run quality
npm audit --omit=dev --audit-level=high
```

`npm run build` writes the deployable site to `dist/`; `npm run preview` serves
that output locally.

## Architecture and content boundaries

- `src/pages/`, `src/components/`, `src/React/`, and `src/styles/` own the active
  Astro/React application.
- `src/content/projects/` contains exactly the six featured project records.
  `npm run verify:content` enforces their filenames, order, image ownership, and
  exclusion of archived work.
- `archive/projects/` retains ten historical project records and their
  exclusive assets. It is outside Astro's source and build boundaries.
- `BodyGraphShell.tsx` reserves a stable SSR-safe region and loads the vendored
  `@hdhub/bodygraph-3d@0.1.1` package only near the viewport. The vendored tarball
  is retained because the package is a deliberate live-product proof point and
  is not fetched from the public registry.
- `scripts/verify-legacy-boundary.mjs` proves that the removed Jekyll/static/PHP
  implementation stays outside the active branch and Pages output.

## Verification commands

```sh
npm run check
npm run test:runner
npm run test:content
npm run test:legacy
npm run build
npm run verify:content
npm run verify:legacy
npm run verify:bodygraph
npm run verify:ci
```

The browser suite can also target the deployed site:

```sh
PORTFOLIO_URL=https://k4771kim.github.io npm run verify:portfolio
node scripts/verify-legacy-boundary.mjs verify-live \
  --base-url https://k4771kim.github.io \
  --manifest docs/legacy-preservation.json
```

## Deployment

Pushes to `master` run the pinned workflow in `.github/workflows/deploy.yml`.
It installs Node `24.18.1`, executes `npm run quality`, and uploads only `dist/`
to GitHub Pages. Pull requests execute the same build gate without deploying.

## Legacy recovery

The inactive Jekyll site, generated `_site/` tree, root static bundle, and PHP
handler were removed from the active branch after their 137-path inventory was
recorded in `docs/legacy-preservation.json`. They remain recoverable from the
remote annotated tag `portfolio-legacy-pre-removal-v1`, which points to the exact
pre-removal commit and tree.

Verify the recovery reference before using it:

```sh
node scripts/verify-legacy-boundary.mjs verify-preservation \
  --manifest docs/legacy-preservation.json \
  --verify-origin origin
```

For read-only inspection, check out the tag in a separate worktree:

```sh
git worktree add ../portfolio-legacy portfolio-legacy-pre-removal-v1
```

To roll back the active-branch removal, revert its isolated Lore commit, run the
full quality gate, and redeploy; do not rewrite `master` history.
