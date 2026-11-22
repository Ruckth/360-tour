import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export function clientGraphPath(project, entry) {
  return join(project, "output/start-route-js", `client-${basename(entry)}.json`);
}

const rendererModule = /\/(?:node_modules\/(?:three|@react-three\/(?:fiber|drei))|src\/components\/tour)\//;

/** @param {string} moduleId */
export function isRendererModule(moduleId) {
  const file = moduleId.split("?", 1)[0].replaceAll("\\", "/");
  // The room route server-renders this shared loading screen before WebGL is available.
  // Its static dependencies are still classified individually in the generated chunk graph.
  return rendererModule.test(file) && !file.endsWith("/src/components/tour/TourIntro.tsx");
}

/** @returns {import("vite").Plugin} */
export function startRouteJsManifest() {
  return {
    name: "start-route-js-measurement",
    apply: "build",
    applyToEnvironment: environment => environment.name === "client",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(chunk => chunk.type === "chunk");
      const entries = chunks.filter(chunk => chunk.isEntry);
      if (entries.length !== 1) this.error("Expected exactly one Start client entry");
      const [entry] = entries;
      const graph = Object.fromEntries(chunks.map(chunk => [
        chunk.fileName,
        {
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          renderer: chunk.moduleIds.some(isRendererModule),
        },
      ]));
      const project = this.environment.config.root;
      mkdirSync(join(project, "output/start-route-js"), { recursive: true });
      writeFileSync(clientGraphPath(project, entry.fileName), JSON.stringify(graph, null, 2) + "\n");
    },
  };
}
