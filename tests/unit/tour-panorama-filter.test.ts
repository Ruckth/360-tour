import { LinearFilter, LinearMipmapLinearFilter, PerspectiveCamera, Texture } from "three";
import { expect, it } from "vitest";
import { preparePanoramaFilter } from "@/lib/tour/panorama-filter";

const entry = "/tour/panoramas/v1/pool-villa-living-2048.webp";
function texture() {
  const tex = new Texture();
  tex.image = { width: 2048, height: 1024 };
  return tex;
}

it("uses the base level at a magnified pose and restores trilinear filtering before a steep view draws", () => {
  const camera = new PerspectiveCamera(75, 390 / 844, 0.1, 1100);
  const tex = texture();
  preparePanoramaFilter(tex, entry, camera, 1266);
  expect(tex.minFilter).toBe(LinearFilter);
  expect(tex.generateMipmaps).toBe(false);
  camera.rotation.x = Math.PI / 4;
  camera.updateMatrixWorld();
  preparePanoramaFilter(tex, entry, camera, 1266);
  expect(tex.minFilter).toBe(LinearMipmapLinearFilter);
  expect(tex.generateMipmaps).toBe(true);
  const version = tex.version;
  camera.rotation.x = 0;
  preparePanoramaFilter(tex, entry, camera, 1266);
  expect(tex.minFilter).toBe(LinearMipmapLinearFilter);
  expect(tex.version).toBe(version);
});

it("keeps the normal sampler for uploads, full detail and a minified first viewport", () => {
  const camera = new PerspectiveCamera(75, 390 / 844, 0.1, 1100);
  for (const [path, height] of [
    [entry, 500],
    ["/uploaded.webp", 1266],
    ["/tour/panoramas/v1/other-2048.webp", 1266],
    ["/pool-villa-living.webp", 1266],
  ] as const) {
    const tex = texture();
    preparePanoramaFilter(tex, path, camera, height);
    expect(tex.minFilter).toBe(LinearMipmapLinearFilter);
    expect(tex.generateMipmaps).toBe(true);
  }
});
