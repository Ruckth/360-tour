import { clerk } from "@clerk/testing/playwright";
import { api } from "../../convex/_generated/api";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("the visual editor opens from the keyboard, places and moves a hotspot, and reloads the saved marker", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const propertyId = await owner.mutation(api.catalog.adminProperties.create, { name: "Visual hotspot test" });
  try {
    await owner.mutation(api.catalog.adminProperties.createRoom, {
      propertyId,
      name: "Living room",
      slug: "living",
      imagePath: "/tour/panoramas/v1/pool-villa-living-2048.webp",
    });
    await owner.mutation(api.catalog.adminProperties.createRoom, {
      propertyId,
      name: "Pool",
      slug: "pool",
      imagePath: "/tour/panoramas/v1/pool-villa-pool-2048.webp",
    });

    await page.goto(`/admin/properties/${propertyId}`);
    await page.getByRole("tab", { name: "360 rooms" }).click();
    const trigger = page.getByRole("listitem").filter({ has: page.getByLabel(/Room name · living/) })
      .getByRole("button", { name: "Edit hotspots" });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const editor = page.getByRole("dialog", { name: "Hotspots · Living room" });
    const canvas = editor.locator("canvas");
    const label = editor.getByRole("textbox", { name: "Hotspot label" });
    // The canvas mounts before its image resolves. A new marker confirms the image is interactive.
    await expect.poll(async () => {
      if (await label.isVisible()) return true;
      await canvas.click();
      return label.isVisible();
    }).toBe(true);
    await label.fill("Walk to the pool");
    await editor.getByRole("button", { name: "Done" }).click();

    const marker = editor.getByTestId("tour-hotspot");
    const before = await marker.boundingBox();
    expect(before).not.toBeNull();
    const x = before!.x + before!.width / 2;
    const y = before!.y + before!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 65, y - 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await marker.boundingBox())!.x - before!.x)).toBeGreaterThan(30);

    await editor.getByRole("button", { name: "Save hotspots" }).click();
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText("Edit hotspots (1)");
    const property = await owner.query(api.catalog.adminProperties.get, { propertyId });
    const hotspot = property?.rooms.find((room) => room.slug === "living")?.hotspots[0];
    expect(hotspot).toMatchObject({ label: "Walk to the pool", targetRoomSlug: "pool" });
    expect(Math.hypot(...hotspot!.position)).toBeCloseTo(360, 0);

    await page.keyboard.press("Enter");
    await expect(editor.getByTestId("tour-hotspot")).toHaveText("Walk to the pool");
    await expect(editor.getByRole("button", { name: "Save hotspots" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await owner.mutation(api.catalog.adminProperties.deleteDraft, { propertyId });
    await clerk.signOut({ page });
  }
});
