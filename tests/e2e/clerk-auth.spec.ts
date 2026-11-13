import { expect, test, type Page } from "./fixtures";
import { clerk } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function backend() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  expect(new URL(url).hostname).toBe("127.0.0.1");
  return new ConvexHttpClient(url);
}
async function signIn(page: Page, role: "OWNER" | "CASHIER" | "NONSTAFF") {
  await page.goto("/admin/chats");
  await clerk.signIn({ page, emailAddress: process.env[`E2E_${role}_EMAIL`]! });
  const token = await page.evaluate(async () => {
    return window.Clerk.session!.getToken({ template: "convex" });
  });
  expect(Boolean(token)).toBe(true);
  const client = backend();
  client.setAuth(token!);
  return client;
}
test.afterEach(async ({ page }) => {
  await clerk.signOut({ page }).catch(() => undefined);
});

test("@smoke anonymous and real signed-in nonstaff cannot read protected checkout queries", async ({
  page,
}) => {
  await expect(
    backend().query(api.pos.catalog.stableCatalog, {}),
  ).rejects.toThrow();
  const nonstaff = await signIn(page, "NONSTAFF");
  const access = await nonstaff.query(api.auth.staffAccess.myAccess, {});
  expect(access.role).toBeNull();
  await expect(
    nonstaff.query(api.pos.catalog.stableCatalog, {}),
  ).rejects.toThrow();
  await page.goto("/admin/checkout");
  await expect(
    page.getByRole("heading", { name: "This view could not load" }),
  ).toBeVisible();
});

test("@smoke owner browser session authorizes real protected queries and retains team controls", async ({
  page,
}) => {
  const owner = await signIn(page, "OWNER");
  expect((await owner.query(api.auth.staffAccess.myAccess, {})).role).toBe(
    "owner",
  );
  const catalog = await owner.query(api.pos.catalog.stableCatalog, {});
  expect(catalog.services.length).toBeGreaterThan(0);
  await page.goto("/admin/settings?tab=team");
  await expect(
    page.getByRole("button", { name: "Invite", exact: true }),
  ).toBeVisible();
});

test("@smoke cashier browser session authorizes checkout and preserves manager-only limits", async ({
  page,
}) => {
  const cashier = await signIn(page, "CASHIER");
  expect((await cashier.query(api.auth.staffAccess.myAccess, {})).role).toBe(
    "cashier",
  );
  const catalog = await cashier.query(api.pos.catalog.stableCatalog, {});
  expect(catalog.services.length).toBeGreaterThan(0);
  await expect(
    cashier.query(api.auth.staffAccess.listPeople, {}),
  ).rejects.toThrow();
  const { orderId, lineId } = await cashier.mutation(
    api.pos.commands.addItem.addItem,
    { item: { kind: "service", serviceId: catalog.services[0]._id } },
  );
  await expect(
    cashier.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, {
      lineId,
      price: 1,
      note: "Role refusal acceptance",
    }),
  ).rejects.toThrow();
  await page.goto(`/admin/checkout?order=${orderId}`);
  await expect(
    page
      .getByRole("complementary", { name: "Order", exact: true })
      .getByText(catalog.services[0].name, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toHaveCount(0);
});

test("owner checkout interactions persist a local cash receipt across reload", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 950 });
  const owner = await signIn(page, "OWNER");
  const catalog = await owner.query(api.pos.catalog.stableCatalog, {});
  const item = catalog.rooms[0];
  await page.goto('/admin/checkout');
  await page.getByRole('tab', { name: 'Rooms', exact: true }).click();
  await page.getByRole('region', { name: 'Catalog' }).getByRole('button').filter({ hasText: item.name }).first().click();
  await expect(page).toHaveURL(/\/admin\/checkout\?order=/);
  const orderId = new URL(page.url()).searchParams.get('order') as Id<'orders'>;
  const order = page.getByRole('complementary', { name: 'Order', exact: true });
  await expect(order.getByText(item.name, { exact: true })).toBeVisible();
  await order.getByRole('button').filter({ hasText: item.name }).first().click();
  await order.getByRole('button', { name: 'One more night', exact: true }).click();
  await expect.poll(async () => (await owner.query(api.pos.orders.getOrder, { orderId }))?.lines[0].qty).toBe(2);
  const reviewed = await owner.query(api.pos.orders.getOrder, { orderId });
  expect(reviewed?.totals.due).toBe(item.price * 2);
  // Local cash recording only: this path cannot contact a payment/refund provider.
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: 'Exact', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cash', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Receipt', exact: true })).toContainText(item.name);
  const paid = await owner.query(api.pos.orders.getOrder, { orderId });
  expect(paid?.order.status).toBe('paid');
  expect(paid?.payments).toHaveLength(1);
  expect(paid?.payments[0]).toMatchObject({ method: 'cash', amount: reviewed!.totals.due });
  await page.reload();
  await expect(page.getByRole('article', { name: 'Receipt', exact: true })).toContainText(item.name);
  const reloaded = await owner.query(api.pos.orders.getOrder, { orderId });
  expect(reloaded?.payments).toEqual(paid?.payments);
  expect(reloaded?.lines[0].qty).toBe(2);
});
