import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { Id } from "convex/_generated/dataModel";
import { IntlProvider } from "@/platform/intl";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { createFixtureBackend } from "./checkout-transport";
import en from "../../messages/en.json";
import "@/app.css";

/*
 * The real checkout on the fixture database with the pay desk wired as in production. The
 * database survives page reloads in this tab, so reload and resume can be checked for real.
 *   mode=attempts|direct   payments mode at first load (direct by default)
 *   paused=1               checkout paused for update (direct only)
 *   scenario=              tea (฿1,200) · big (฿3,000 + ฿2,000) · room (a dense stay with a room-bill tote)
 *                          · tote (a ฿1,900 product sale; window.productSales("off") refuses it after the charge)
 *                          · stay (Anna's Lagoon Pool Villa balance, the guest has an email: the booking confirmation choice)
 *   role=cashier           sign in as a cashier (manager otherwise)
 */
const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "tea";
const role = params.get("role") === "cashier" ? "cashier" : "manager";
const staff = { role, email: "ploy@example.com" } as const;
// Seeds as a manager (custom items need no approval), then signs in as the requested role.
const backend = await createFixtureBackend({ staff: { ...staff, role: "manager" } }, { key: "pay-desk-fixture" });
Object.assign(window, { payDesk: backend });

/** The owner's product-sales switch, on the settings row. */
async function productSales(flag: "everyone" | "off") {
  const [row] = await backend.fixtureRows("commerceSettings") as { _id: string; saleSwitches: Record<string, string> }[];
  await backend.patchFixtureRow("commerceSettings", row._id, { saleSwitches: { ...row.saleSwitches, products: flag } });
}
Object.assign(window, { productSales });

async function seed(): Promise<OrderId> {
  const actions = backend.useActions();
  await backend.setCommerceSettings({ paymentsMode: params.get("mode") === "attempts" ? "attempts" : "direct", ...(params.get("paused") ? { paused: true } : {}) });
  if (scenario === "big") {
    const { orderId } = await actions.addItem({ item: { kind: "extra", name: "Spa robe", price: 300000 } });
    await actions.addItem({ orderId, item: { kind: "extra", name: "Lemongrass oil", price: 200000 } });
    return orderId;
  }
  if (scenario === "room") {
    // A dense unpaid stay with a tote posted to its room: too large to pay in one go (v27 Settlement).
    const bookingId = "fxbkg000001" as Id<"bookings">;
    await backend.patchFixtureRow("bookings", bookingId, { nights: 601, paymentStatus: "pending", amountPaid: 0 });
    const { orderId } = await actions.openOrderFor({ bookingId });
    const { lineId } = await actions.addItem({ orderId, item: { kind: "extra", name: "Beach tote", price: 35000 } });
    await backend.insertFixtureRows([
      { alias: "fxcat0shop", table: "productCategories", fields: { name: "Shop", sort: 0 } },
      { alias: "fxprod0tote", table: "products", fields: { categoryId: "fxcat0shop", name: "Beach tote", status: "active", vatProfile: "standard", options: [], minPrice: 35000, maxPrice: 35000, variantCount: 1, sort: 0, revision: 0 } },
      { alias: "fxvar0tote", table: "productVariants", fields: { productId: "fxprod0tote", optionValueIds: [], label: "Beach tote", price: 35000, status: "active", revision: 0 } },
    ]);
    await backend.patchFixtureRow("orderLines", lineId, { kind: "product", variantId: "fxvar0tote" });
    return orderId;
  }
  if (scenario === "stay") {
    const bookingId = "fxbkg000001" as Id<"bookings">;
    await backend.patchFixtureRow("bookings", bookingId, { guestEmail: "anna@example.com" });
    return (await actions.openOrderFor({ bookingId })).orderId;
  }
  if (scenario === "tote") {
    // A ฿1,900 product sale with stock in hand and product sales on, so the owner can switch them
    // off after the card is charged (the sale can't be saved as it is: Swap or Give back).
    const { orderId, lineId } = await actions.addItem({ item: { kind: "extra", name: "Beach tote", price: 190000 } });
    const branch = (await backend.fixtureRows("branches")).find(row => row.key === "koh-samui");
    if (!branch) throw new Error("The pay-desk fixture needs its seeded Koh Samui branch.");
    await backend.insertFixtureRows([
      { alias: "fxcat0shop", table: "productCategories", fields: { name: "Shop", sort: 0 } },
      { alias: "fxprod0tote", table: "products", fields: { categoryId: "fxcat0shop", name: "Beach tote", status: "active", vatProfile: "standard", options: [], minPrice: 190000, maxPrice: 190000, variantCount: 1, sort: 0, revision: 0 } },
      { alias: "fxvar0tote", table: "productVariants", fields: { productId: "fxprod0tote", optionValueIds: [], label: "Beach tote", price: 190000, status: "active", revision: 0 } },
      { alias: "fxstock0tote", table: "stockLevels", fields: { branchId: branch._id, productId: "fxprod0tote", variantId: "fxvar0tote", onHand: 5, revision: 0 } },
    ]);
    await backend.patchFixtureRow("orderLines", lineId, { kind: "product", variantId: "fxvar0tote" });
    await productSales("everyone");
    return orderId;
  }
  return (await actions.addItem({ item: { kind: "extra", name: "Thai tea set", price: 120000 } })).orderId;
}

const ORDER_KEY = "pay-desk-fixture-order";
const initialOrder = (backend.reused ? sessionStorage.getItem(ORDER_KEY) as OrderId | null : null) ?? await seed();
sessionStorage.setItem(ORDER_KEY, initialOrder);
if (role === "cashier") await backend.setStaff(staff);

function Harness() {
  const [orderId, setOrderId] = useState<OrderId | null>(initialOrder);
  const [receiptId, setReceiptId] = useState<OrderId | null>(null);
  return (
    <CheckoutBackendProvider backend={backend}>
      <div className="flex h-dvh flex-col bg-background text-foreground" data-fixture-ready="">
        {receiptId ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto" data-testid="receipt-screen">
            <ReceiptView orderId={receiptId} onNewSale={() => { setReceiptId(null); setOrderId(null); }} onOpenOrder={(id) => { setReceiptId(null); setOrderId(id); }} />
          </div>
        ) : (
          <CheckoutView orderId={orderId} onOrderChange={setOrderId} onPaid={setReceiptId} />
        )}
      </div>
    </CheckoutBackendProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <IntlProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
    <ConfirmProvider><Harness /></ConfirmProvider>
  </IntlProvider>,
);
