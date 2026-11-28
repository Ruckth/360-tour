import { getFunctionName } from "convex/server";
import { api } from "../../convex/_generated/api";
import { chooseBranchIfPrompted } from "../support/choose-branch.mjs";
import { signedInBackend } from "./backend";
import { expect, test } from "./fixtures";

test("villa deep links survive hard refresh and the direct pricing shortcut preserves the OTA draft", async ({ page }) => {
  test.setTimeout(60_000);
  const owner = await signedInBackend(page);
  const propertyId = await owner.mutation(api.catalog.adminProperties.create, { name: "Property sections test" });
  const basePath = `/admin/properties/${propertyId}`;
  const tab = (name: string) => page.getByRole("tab", { name });
  try {
    await page.goto(`${basePath}?tab=reviews`);
    await chooseBranchIfPrompted(page, tab("Reviews"));
    await expect(tab("Reviews")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Reviews" })).toBeVisible();
    await page.reload();
    await expect(tab("Reviews")).toHaveAttribute("aria-selected", "true");

    await tab("Calendar sync").click();
    await expect(page).toHaveURL(/[?]tab=calendar$/);
    await page.reload();
    await expect(tab("Calendar sync")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Export to OTAs" })).toBeVisible();

    await page.goto(`${basePath}?tab=unknown`);
    await expect(tab("Details")).toHaveAttribute("aria-selected", "true");
    await tab("Pricing & OTA").click();
    const rate = page.getByLabel(/Nightly price/);
    await rate.fill("2750");
    await page.getByRole("link", { name: "Edit direct price and discount" }).click();
    await expect(page.getByLabel("Price per night")).toBeFocused();
    await expect(rate).toBeHidden();
    await page.goBack();
    await expect(tab("Pricing & OTA")).toHaveAttribute("aria-selected", "true");
    await expect(rate).toHaveValue("2750");
    expect(await owner.query(api.catalog.properties.listOtaRates, { propertyId })).toEqual([]);
  } finally {
    await owner.mutation(api.catalog.adminProperties.deleteDraft, { propertyId });
  }
});

type ChannelHealthFrame = {
  type: string;
  modifications?: {
    type: string;
    queryId: number;
    udfPath?: string;
    value?: { channels?: { channel: string; latestError: { at: number; message: string } | null }[] };
  }[];
};

test("phone channel diagnostics show a summary before opening full details", async ({ page }) => {
  test.setTimeout(60_000);
  await signedInBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const backend = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const query = getFunctionName(api.settings.settings.channelHealth);
  const diagnostic = `Delivery failed: ${"synthetic-trace-".repeat(22)}`;
  await page.routeWebSocket((url) => url.host === backend.host, (socket) => {
    const server = socket.connectToServer();
    const queryIds = new Set<number>();
    socket.onMessage((message) => {
      if (typeof message === "string") {
        const frame = JSON.parse(message) as ChannelHealthFrame;
        if (frame.type === "ModifyQuerySet") {
          for (const update of frame.modifications ?? []) {
            if (update.type === "Add" && update.udfPath === query) queryIds.add(update.queryId);
            if (update.type === "Remove") queryIds.delete(update.queryId);
          }
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message === "string") {
        const frame = JSON.parse(message) as ChannelHealthFrame;
        if (frame.type === "Transition") {
          const update = frame.modifications?.find((change) => change.type === "QueryUpdated" && queryIds.has(change.queryId));
          const line = update?.value?.channels?.find((channel) => channel.channel === "line");
          if (line) {
            line.latestError = { at: Date.parse("2026-09-10T12:34:00Z"), message: diagnostic };
            socket.send(JSON.stringify(frame));
            return;
          }
        }
      }
      socket.send(message);
    });
  });

  await page.goto("/admin/settings?tab=channels");
  const line = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "LINE", exact: true }) });
  const summary = line.getByText(/Latest error at .*19:34.*Delivery failed/);
  await chooseBranchIfPrompted(page, summary);
  await expect(summary).toBeVisible();
  const detail = line.getByText(diagnostic, { exact: true });
  await expect(detail).toBeHidden();

  const disclosure = line.locator("summary").filter({ hasText: "Technical details" });
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(detail).toBeVisible();
  const box = await detail.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Enter");
  await expect(detail).toBeHidden();
  await expect(summary).toBeVisible();
});
