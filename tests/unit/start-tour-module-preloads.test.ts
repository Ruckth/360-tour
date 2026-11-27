import { describe, expect, it } from "vitest";
import { collectTourModulePreloads } from "../../scripts/start-tour-module-preloads";

const viewerPath = "/checkout/src/components/tour/TourViewer.tsx";
const roomPath = "/checkout/src/start-app/routes/{-$locale}.rooms.$id.tsx";
const entry = { fileName: "assets/index-hash.js", isEntry: true, moduleIds: [], imports: ["assets/shared-hash.js"] };
const room = {
  fileName: "assets/room-hash.js",
  isEntry: false,
  moduleIds: [roomPath + "?tsr-split=component"],
  imports: ["assets/room-shared-hash.js"],
};
const shared = { fileName: "assets/shared-hash.js", isEntry: false, moduleIds: [], imports: [] };
const roomShared = { ...shared, fileName: "assets/room-shared-hash.js" };
const canvas = {
  ...shared, fileName: "assets/canvas-hash.js", imports: [shared.fileName, roomShared.fileName],
};
const viewer = {
  ...shared,
  fileName: "assets/viewer-hash.js",
  moduleIds: [viewerPath],
  imports: [canvas.fileName, shared.fileName],
  dynamicImports: ["assets/viewer-extra-hash.js"],
};
const viewerExtra = { ...shared, fileName: "assets/viewer-extra-hash.js" };
const chunks = [entry, room, shared, roomShared, canvas, viewer, viewerExtra];

describe("Start tour client chunk graph", () => {
  it("selects only hashed viewer dependencies missing from the normal document", () => {
    expect(collectTourModulePreloads(chunks, "/prefix/")).toEqual([
      "/prefix/assets/viewer-hash.js",
      "/prefix/assets/canvas-hash.js",
    ]);
  });

  it("preloads only the selected renderer and rejects cross-renderer imports", () => {
    const trialViewer = {
      ...shared,
      fileName: "assets/trial-viewer.js",
      moduleIds: ["/checkout/src/components/tour/PannellumTourViewer.tsx"],
      imports: ["assets/trial-canvas.js"],
    };
    const trialCanvas = {
      ...shared,
      fileName: "assets/trial-canvas.js",
      moduleIds: ["/checkout/src/components/tour/PannellumTourCanvas.tsx"],
    };
    expect(collectTourModulePreloads([...chunks, trialViewer, trialCanvas], "/", "pannellum")).toEqual([
      "/assets/trial-viewer.js",
      "/assets/trial-canvas.js",
    ]);
    expect(() => collectTourModulePreloads([...chunks, {
      ...trialViewer, imports: [viewer.fileName],
    }], "/", "pannellum")).toThrow("must keep the three renderer lazy");
  });

  it("fails the build if TourViewer becomes eager or its generated chunk disappears", () => {
    expect(() => collectTourModulePreloads(
      [{ ...entry, imports: [viewer.fileName] }, ...chunks.slice(1)], "/",
    )).toThrow("must keep TourViewer lazy");
    expect(() => collectTourModulePreloads(chunks.filter((chunk) => chunk !== viewer), "/"))
      .toThrow("Could not locate");
    expect(() => collectTourModulePreloads(chunks, "//cdn.example.test/")).toThrow("same-origin");
  });
});
