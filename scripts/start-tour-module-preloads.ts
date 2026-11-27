import type { Plugin } from "vite";
import type { TourRenderer } from "../src/lib/tour/renderer";

const virtualModule = "virtual:start-tour-module-preloads";
const resolvedVirtualModule = "\0" + virtualModule;
const viewerModule = {
  three: "/src/components/tour/TourViewer.tsx",
  pannellum: "/src/components/tour/PannellumTourViewer.tsx",
};
const canvasModule = {
  three: "/src/components/tour/TourCanvas.tsx",
  pannellum: "/src/components/tour/PannellumTourCanvas.tsx",
};
const roomRouteModule = "/src/start-app/routes/{-$locale}.rooms.$id.tsx";

type ClientChunk = {
  fileName: string;
  isEntry: boolean;
  moduleIds: string[];
  imports: string[];
};

export function collectTourModulePreloads(
  chunks: ClientChunk[],
  base: string,
  renderer: TourRenderer = "three",
): string[] {
  if (!base.startsWith("/") || base.startsWith("//") || !base.endsWith("/")) {
    throw new Error("Expected a same-origin Start asset base for tour module preloads");
  }
  const contains = (chunk: ClientChunk, file: string) =>
    chunk.moduleIds.some((id) => id.split("?", 1)[0].replaceAll("\\", "/").endsWith(file));
  const viewer = chunks.filter((chunk) => contains(chunk, viewerModule[renderer]));
  const ordinaryRoom = chunks.filter((chunk) => chunk.isEntry || contains(chunk, roomRouteModule));
  if (viewer.length !== 1 || !ordinaryRoom.some((chunk) => contains(chunk, roomRouteModule))) {
    throw new Error("Could not locate the TourViewer and room route in the Start client build");
  }

  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  function staticImports(entries: ClientChunk[]) {
    const seen = new Set<string>();
    function visit(chunk: ClientChunk) {
      if (seen.has(chunk.fileName)) return;
      seen.add(chunk.fileName);
      for (const file of chunk.imports) {
        const dependency = byFile.get(file);
        if (dependency) visit(dependency);
      }
    }
    for (const chunk of entries) visit(chunk);
    return seen;
  }

  // Start already preloads the entry and room route graph in the document head.
  const existing = staticImports(ordinaryRoom);
  if (existing.has(viewer[0].fileName)) {
    throw new Error("The ordinary room route must keep TourViewer lazy");
  }
  const closure = staticImports(viewer);
  const other = renderer === "pannellum" ? "three" : "pannellum";
  if (chunks.some((chunk) => (closure.has(chunk.fileName) || existing.has(chunk.fileName))
      && (contains(chunk, viewerModule[other]) || contains(chunk, canvasModule[other])))) {
    throw new Error(`The ${renderer} tour must keep the ${other} renderer lazy`);
  }
  return [...closure].filter((file) => !existing.has(file)).map((file) => base + file);
}

export function startTourModulePreloads(): Plugin {
  let preloads: Record<TourRenderer, string[]> | undefined;
  return {
    name: "start-tour-module-preloads",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
      const { base } = this.environment.config;
      preloads = {
        three: collectTourModulePreloads(chunks, base, "three"),
        pannellum: collectTourModulePreloads(chunks, base, "pannellum"),
      };
    },
    resolveId(id) {
      return id === virtualModule ? resolvedVirtualModule : undefined;
    },
    load(id) {
      if (id !== resolvedVirtualModule) return;
      if (this.environment.name !== "ssr") this.error("Tour module preload manifest is server-only");
      // Start builds the client environment before SSR. Dev has no hashed client output.
      if (this.environment.config.command === "build" && !preloads) {
        this.error("Build the Start client before loading the tour module preload manifest");
      }
      return `export default ${JSON.stringify(preloads ?? { three: [], pannellum: [] })};`;
    },
  };
}
