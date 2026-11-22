import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { clerk } from "@clerk/testing/playwright";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("an edited scene loads its uploaded panorama after an unavailable response", async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const owner = await signedInBackend(ownerPage);
  const admin = api.catalog.adminProperties;
  const slug = "upload-tour-" + randomUUID().slice(0, 8);
  const propertyId = await owner.mutation(admin.create, { name: "Guest panorama upload", slug });
  try {
    const bytes = await readFile("public/tour/panoramas/v1/pool-villa-pool-2048.webp");
    const upload = new URL(await owner.mutation(admin.generateUploadUrl, {}));
    expect(["localhost", "127.0.0.1"]).toContain(upload.hostname);
    const saved = await fetch(upload, { method: "POST", headers: { "content-type": "image/webp" }, body: bytes });
    expect(saved.ok).toBe(true);
    const { storageId } = await saved.json() as { storageId: Id<"_storage"> };
    const image = await owner.mutation(admin.saveUploadedImage, { storageId, kind: "panorama" });
    if (!("url" in image)) throw Error(image.error);
    const local = new URL(image.url);
    expect(local.origin).toBe(upload.origin);
    // The isolated backend serves HTTP loopback. Give the stored URL the HTTPS origin used by
    // deployed Convex files and fulfill that exact browser request from the real local object.
    const publicImage = new URL(local.pathname + local.search, "https://phase4-fixture.convex.cloud").href;
    const file = await fetch(local);
    expect(file.ok).toBe(true);
    const body = Buffer.from(await file.arrayBuffer());
    expect(body.equals(bytes)).toBe(true);
    let fail = true;
    let requests = 0;
    await page.route(publicImage, async route => {
      requests++;
      await route.fulfill({
        status: fail ? 503 : 200, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
        ...(fail ? { body: "unavailable" } : { contentType: "image/webp", body }),
      });
    });
    const bundled: string[] = [];
    page.on("request", request => {
      if (/pool-villa-(living|pool)(?:-\d+)?\.webp/.test(new URL(request.url()).pathname)) bundled.push(request.url());
    });

    await owner.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 450_000 });
    const room = await owner.mutation(admin.createRoom, { propertyId, slug: "pv-living", name: "Edited living area", imagePath: "/pool-villa-living.webp" });
    await owner.mutation(api.catalog.properties.updateRoom, { roomId: room, imagePath: publicImage });
    await owner.mutation(admin.setStatus, { propertyId, status: "active" });
    await page.goto(`/rooms/${slug}?tour=1`);
    const viewer = page.getByTestId("tour-viewer");
    await expect(viewer.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    expect(requests).toBe(1);
    expect(bundled).toEqual([]);
    fail = false;
    await viewer.getByRole("button", { name: "Try again" }).click();
    await expect(viewer).toHaveAttribute("data-shown-room", "pv-living", { timeout: 20_000 });
    await expect(viewer).toHaveAttribute("data-scene-status", "ready");
    expect(requests).toBe(2);
    expect(bundled).toEqual([]);
    await expect(viewer.getByRole("button", { name: "Show full detail" })).toHaveCount(0);
  } finally {
    try {
      const token = await ownerPage.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
      if (!token) throw Error("The run-owned session is required for cleanup");
      owner.setAuth(token);
      await owner.mutation(admin.setStatus, { propertyId, status: "draft" });
      await owner.mutation(admin.deleteDraft, { propertyId });
    } finally {
      await clerk.signOut({ page: ownerPage });
      await ownerContext.close();
    }
  }
});
