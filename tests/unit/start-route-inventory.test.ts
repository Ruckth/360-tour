import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { buildManifest } from "../../scripts/bench/start-route-parity.manifest.mjs";
import { archivedNextAppFiles } from "../../scripts/dual-entry-checkpoint.mjs";

// The canonical Start route inventory. Every live file in src/start-app/routes is either the successor of a
// page, handler or metadata route of the retired Next entry (read from the dual-entry checkpoint), or an
// explicitly scoped layout, fallback or Start-only endpoint. Adding, removing or renaming a route fails here.
const root = process.cwd();
const routesDir = path.join(root, "src/start-app/routes");

/** Retired Next source → its live Start route file. */
const SUCCESSORS: Record<string, string> = {
  "src/app/[locale]/(home)/page.tsx": "{-$locale}.index.tsx",
  "src/app/[locale]/booking/page.tsx": "{-$locale}.booking.index.tsx",
  "src/app/[locale]/booking/pay/page.tsx": "{-$locale}.booking.pay.tsx",
  "src/app/[locale]/booking/success/page.tsx": "{-$locale}.booking.success.tsx",
  "src/app/[locale]/chat/page.tsx": "{-$locale}.chat.tsx",
  "src/app/[locale]/experiences/page.tsx": "{-$locale}.experiences.tsx",
  "src/app/[locale]/privacy/page.tsx": "{-$locale}.privacy.tsx",
  "src/app/[locale]/rooms/[id]/page.tsx": "{-$locale}.rooms.$id.tsx",
  "src/app/[locale]/services/page.tsx": "{-$locale}.services.tsx",
  "src/app/[locale]/terms/page.tsx": "{-$locale}.terms.tsx",
  "src/app/admin/chats/page.tsx": "admin.chats.tsx",
  "src/app/admin/checkout/page.tsx": "admin.checkout.index.tsx",
  "src/app/admin/checkout/preview/page.tsx": "admin.checkout.preview.tsx",
  "src/app/admin/hotel/page.tsx": "admin.hotel.tsx",
  "src/app/admin/leads/page.tsx": "admin.leads.tsx",
  "src/app/admin/marketing/access/page.tsx": "admin.marketing.access.tsx",
  "src/app/admin/marketing/affiliates/page.tsx": "admin.marketing.affiliates.tsx",
  "src/app/admin/marketing/campaigns/page.tsx": "admin.marketing.campaigns.tsx",
  "src/app/admin/marketing/coupons/[id]/page.tsx": "admin.marketing.coupons.$id.tsx",
  "src/app/admin/marketing/coupons/page.tsx": "admin.marketing.coupons.index.tsx",
  "src/app/admin/marketing/dashboard/page.tsx": "admin.marketing.dashboard.tsx",
  "src/app/admin/marketing/links/page.tsx": "admin.marketing.links.tsx",
  "src/app/admin/properties/[id]/page.tsx": "admin.properties.$id.tsx",
  "src/app/admin/properties/page.tsx": "admin.properties.index.tsx",
  "src/app/admin/questions/page.tsx": "admin.questions.tsx",
  "src/app/admin/receipt/[orderId]/page.tsx": "admin.receipt.$orderId.tsx",
  "src/app/admin/settings/page.tsx": "admin.settings.tsx",
  "src/app/admin/staff/[tab]/page.tsx": "admin.staff.$tab.tsx",
  "src/app/dev/checkout-preview/page.tsx": "dev.checkout-preview.tsx",
  "src/app/display/page.tsx": "display.tsx",
  "src/app/sign-in/page.tsx": "sign-in.tsx",
  "src/app/sign-up/page.tsx": "sign-up.tsx",
  "src/app/api/admin/chat/reply/route.ts": "api.admin.chat.reply.ts",
  "src/app/api/admin/config-status/route.ts": "api.admin.config-status.ts",
  "src/app/api/messaging/image/route.ts": "api.messaging.image.ts",
  "src/app/robots.ts": "robots[.]txt.ts",
  "src/app/sitemap.ts": "sitemap[.]xml.ts",
};

/** Retired Next sources with no Start successor, each with its reason. */
const RETIRED_WITHOUT_SUCCESSOR: Record<string, string> = {
  "src/app/[locale]/rooms/[id]/villa-benchmark/page.tsx": "Next-only cache benchmark rewrite target; Start reports the same headers from the room route",
};

/** Live Start routes that succeed no single Next page, each scoped explicitly. */
const SCOPED_START_ROUTES: Record<string, string> = {
  "__root.tsx": "document shell (Next src/app/layout.tsx and [locale]/layout.tsx)",
  "admin.tsx": "admin layout (Next src/app/admin/layout.tsx)",
  "admin.index.tsx": "/admin redirect to the first permitted section",
  "admin.$.tsx": "legacy and unknown /admin sections",
  "admin.marketing.tsx": "marketing layout (Next src/app/admin/marketing/layout.tsx)",
  "admin.marketing.profitability.index.tsx": "Service profitability overview",
  "admin.marketing.profitability.transactions.tsx": "Service profitability supporting records",
  "admin.marketing.index.tsx": "/admin/marketing default section",
  "admin.staff.tsx": "staff layout (Next src/app/admin/staff/layout.tsx)",
  "admin.staff.index.tsx": "/admin/staff default tab",
  "admin.receipt.index.tsx": "/admin/receipt without an order",
  "api.internal.villa-cache.ts": "Start-only authenticated villa cache invalidation endpoint",
};

const retired = archivedNextAppFiles(root).filter((file) => /(?:\/page\.tsx|\/route\.ts|^src\/app\/(?:robots|sitemap)\.ts)$/.test(file));

it("accounts for every retired Next page, handler and metadata route", () => {
  expect(retired.sort()).toEqual([...Object.keys(SUCCESSORS), ...Object.keys(RETIRED_WITHOUT_SUCCESSOR)].sort());
});

it("matches the live Start route directory exactly to successors plus scoped routes", () => {
  const live = readdirSync(routesDir).sort();
  const expected = [...new Set([...Object.values(SUCCESSORS), ...Object.keys(SCOPED_START_ROUTES)])].sort();
  expect(live).toEqual(expected);
  for (const file of live) expect(readFileSync(path.join(routesDir, file), "utf8"), file).toMatch(/create(?:File|Root)Route\w*\(/);
});

it("covers every page and handler of the route parity manifest with a live successor", () => {
  const manifest = buildManifest({ targetKind: "next", scope: "full", rootDir: root });
  for (const row of manifest.filter((entry) => entry.kind === "page" || entry.kind === "handler")) {
    expect(SUCCESSORS[row.source], `${row.id}: ${row.source}`).toBeDefined();
  }
});
