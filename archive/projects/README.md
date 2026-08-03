# Archived portfolio projects

This directory keeps eight nonfeatured project records outside Astro's active
content and asset boundaries.

- `content/projects/` mirrors the former `src/content/projects/` location.
- `assets/portfolio/` mirrors the former `src/assets/portfolio/` location, so
  the historical Markdown image paths remain valid without rewriting.
- `reference-graph.json` is generated from the archived Markdown and must match
  exactly when `npm run verify:content` runs.

These files are historical references, not publishable content. To restore a
project, use Git history to move its Markdown and graph-owned assets back under
`src/`, explicitly set `featured: true`, regenerate the reference graph, and
run the complete quality gate before publishing it.
