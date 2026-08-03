// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

const projectRoot = decodeURIComponent(new URL(".", import.meta.url).pathname);
const runtimeProcess = Reflect.get(globalThis, "process");
const previewReadinessToken =
  runtimeProcess?.env?.PORTFOLIO_PREVIEW_READINESS_TOKEN;

/** @param {string} id */
function normalizeModuleId(id) {
  const cleanId = id.replace(/^\0/, "").split("?", 1)[0];
  return cleanId.startsWith(projectRoot)
    ? cleanId.slice(projectRoot.length).replaceAll("\\", "/")
    : cleanId;
}

/** @returns {import("vite").Plugin} */
function portfolioClientManifest() {
  return {
    name: "portfolio-client-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const outputChunks = Object.values(bundle).filter(
        (item) => item.type === "chunk",
      );
      const isPortfolioClientBundle = outputChunks.some((chunk) =>
        Object.keys(chunk.modules).some(
          (id) => normalizeModuleId(id) === "src/React/BodyGraphShell.tsx",
        ),
      );

      if (!isPortfolioClientBundle) return;

      const chunks = Object.fromEntries(
        outputChunks
          .map((chunk) => [
            chunk.fileName,
            {
              facadeModuleId: chunk.facadeModuleId
                ? normalizeModuleId(chunk.facadeModuleId)
                : null,
              modules: Object.keys(chunk.modules).map(normalizeModuleId).sort(),
              imports: [...chunk.imports].sort(),
              dynamicImports: [...chunk.dynamicImports].sort(),
              isEntry: chunk.isEntry,
            },
          ]),
      );

      this.emitFile({
        type: "asset",
        fileName: "portfolio-client-manifest.json",
        source: `${JSON.stringify({ version: 1, chunks }, null, 2)}\n`,
      });
    },
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://k4771kim.github.io',
  integrations: [react()],
  server: {
    headers: previewReadinessToken
      ? { 'x-portfolio-readiness': previewReadinessToken }
      : undefined,
  },
  vite: {
    preview: {
      strictPort: true,
    },
    plugins: [portfolioClientManifest()],
    resolve: {
      alias: {
        "@": "/src",
        "@components": "/src/components",
      },
    },
  },
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
});
