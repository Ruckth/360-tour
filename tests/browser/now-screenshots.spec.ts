import { test, expect, type Page } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";
import { MONEY_DRAFT_SCENARIOS, openMoneyDraft } from "./helpers/money-drafts";

// CAPTURE_NOW=1 BOOKING_UI_PORT=4370 pnpm exec playwright test -c playwright.booking.config.ts now-screenshots --workers=1
// Original archives are never written by this spec. Extras are viewport captures.
test.skip(
  process.env.CAPTURE_NOW !== "1",
  "Set CAPTURE_NOW=1 to capture current screens.",
);
// Front-desk iPads and phones are touch screens; desktop captures opt out below.
test.use({
  colorScheme: "light",
  timezoneId: "Asia/Bangkok",
  hasTouch: true,
  isMobile: true,
});
const sizes = {
  ipad: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 },
};
async function open(page: Page, fixture: string, query = "") {
  await page.goto(`/tests/browser/${fixture}.html${query}`);
  if (fixture === "marketing-dashboard")
    await page.getByRole("heading", { name: "Marketing dashboard" }).waitFor();
  else await page.locator("[data-fixture-ready]").waitFor();
}
async function shot(page: Page, name: string, fullPage = false) {
  const captureDir = process.env.CAPTURE_DIR ?? "now";
  const directory = captureDir.startsWith("docs/screenshots/") ? captureDir : `docs/screenshots/${captureDir}`;
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${directory}/${name}.png`,
    fullPage,
    animations: "disabled",
  });
}

// Round 6 desk evidence includes each guarded money dialog and follow-up editor.
for (const [size, viewport] of Object.entries({ ...sizes, desktop: { width: 1440, height: 900 } })) {
  test.describe(`round 6 desk drafts ${size}`, () => {
    test.use({ viewport, hasTouch: size !== "desktop", isMobile: size !== "desktop" });
    for (const scenario of MONEY_DRAFT_SCENARIOS) {
      test(`r6-${scenario}-${size}`, async ({ page }) => {
        await openMoneyDraft(page, scenario);
        await shot(page, `r6-${scenario}-${size}`);
      });
    }
    test(`r6-follow-up-${size}`, async ({ page }) => {
      await open(page, "inbox");
      await page.getByRole("button", { name: "Edit follow-up", exact: true }).click();
      await shot(page, `r6-follow-up-${size}`);
    });
  });
}
test("r6-chats-360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await scene(page, "chats", true);
  await shot(page, "r6-chats-360");
});
test.describe("round 6 desktop sheets", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
  for (const state of ["stay-sheet", "appointment-sheet"]) {
    test(`r6-${state}-desktop`, async ({ page }) => {
      await scene(page, state, false);
      await shot(page, `r6-${state}-desktop`);
    });
  }
});
async function scene(page: Page, name: string, phone: boolean) {
  if (
    [
      "checkout-start",
      "line-open",
      "cash-panel",
      "cash-1500",
      "split",
      "orders",
      "receipt",
      "refund",
    ].includes(name)
  ) {
    await open(
      page,
      "staff-roles",
      `?role=${["receipt", "refund"].includes(name) ? "manager" : "cashier"}${["receipt", "refund"].includes(name) ? "&scenario=refund" : name === "checkout-start" ? "" : "&scenario=spa"}`,
    );
    if (name === "orders") {
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    } else if (name === "refund")
      await page
        .getByTestId("receipt-items")
        .getByRole("button", { name: "Refund Foot spa 45" })
        .click();
    else if (["line-open", "cash-panel", "cash-1500", "split"].includes(name)) {
      if (phone)
        await page.getByRole("button", { name: /open the order/ }).click();
      const panel = phone
        ? page.getByRole("dialog")
        : page.getByRole("complementary", { name: "Order", exact: true });
      if (name === "line-open")
        await panel.getByRole("button", { name: /^Thai massage 60/ }).click();
      else if (name === "split") {
        await panel
          .getByRole("button", { name: "Split payment", exact: true })
          .click();
        await panel.getByLabel("Payment 1 amount").fill("500");
      } else {
        await panel.getByRole("button", { name: /^Cash(?: ฿[\d,.]+)?$/, exact: true }).click();
        if (name === "cash-1500")
          await panel
            .getByRole("button", { name: "฿1,500", exact: true })
            .click();
      }
    }
  } else if (
    [
      "hotel-calendar",
      "staff-calendar",
      "stay-sheet",
      "appointment-sheet",
      "new-booking",
    ].includes(name)
  ) {
    await openDesk(
      page,
      ["staff-calendar", "appointment-sheet"].includes(name)
        ? "?view=staff"
        : "",
    );
    if (name === "stay-sheet") {
      await page
        .locator("[data-slot=event-calendar-event]", {
          hasText: "Anna Schmidt",
        })
        .first()
        .click();
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
    }
    if (name === "appointment-sheet") {
      await page
        .locator("[data-slot=event-calendar-event]", { hasText: "Ken Tanaka" })
        .first()
        .click();
      await page.getByRole("region", { name: "Balance due" }).waitFor();
    }
    if (name === "new-booking") {
      await page
        .getByRole("button", { name: "New booking", exact: true })
        .click();
      await page.getByTestId("booking-check-in").click();
      await page.locator('[data-day="2026-11-20"] button').click();
      await page.locator('[data-day="2026-11-23"] button').click();
      await expect(page.getByText("Total ฿36,000")).toBeVisible();
    }
  } else if (name === "chats") {
    await open(page, "chats", "?path=/admin/chats");
    if (phone)
      await page
        .getByRole("button", { name: /Anna Müller/ })
        .first()
        .click();
  } else if (name === "missing-information")
    await open(page, "questions", "?path=/admin/questions");
  else if (name.startsWith("settings-")) {
    const tab = name.slice("settings-".length).replace(/-(dirty|expired|states)$/, "");
    await open(page, "staff-roles", `?view=settings&tab=${tab}${name === "settings-team-expired" ? "&teamInvite=expired" : name === "settings-channels-states" ? "&channelHealth=states" : ""}`);
    if (name === "settings-business-dirty")
      await page.getByRole("textbox", { name: "Business name", exact: true }).fill("Auralis Cove Resort");
    if (name === "settings-team-dirty")
      await page.getByRole("textbox", { name: "Discount without approval" }).fill("15");
  }
  else if (name === "new-coupon" || name === "new-coupon-filled") {
    await open(page, "marketing-coupon");
    if (name === "new-coupon-filled")
      await page.getByRole("textbox", { name: "Discount", exact: true }).fill("20");
  }
  else if (name === "marketing-dashboard")
    await open(page, "marketing-dashboard");
  else if (name === "marketing-dashboard-negative")
    await open(page, "marketing-dashboard", "?case=negative-net");
}

// Round 6 covers refund-heavy reporting and the expired invite's fixed action column.
for (const [size, viewport] of Object.entries({ ...sizes, desktop: { width: 1440, height: 900 } })) {
  test.describe(`round 6 Package C ${size}`, () => {
    test.use({ viewport, hasTouch: size !== "desktop", isMobile: size !== "desktop" });
    for (const state of ["settings-team-expired", "settings-channels-states", "marketing-dashboard-negative"]) {
      test(`extra-${state}-${size}`, async ({ page }) => {
        await scene(page, state, size === "phone");
        await shot(page, `extra-${state}-${size}`, true);
      });
    }
  });
}
const pairs: Array<
  [
    string,
    string,
    keyof typeof sizes | "business-desktop" | "dashboard-desktop",
    boolean?,
  ]
> = [
  ["ux-p2-phone-line-open", "line-open", "phone"],
  ["ux-p2b-phone-orders", "orders", "phone"],
  ["ux-p3-phone-cash-1500", "cash-1500", "phone"],
  ["ux-p3-ipad-split", "split", "ipad"],
  ["ux-p4-phone-manager-receipt", "receipt", "phone"],
  ["ux-p4-ipad-manager-refund", "refund", "ipad"],
  ["ux-p5-new-booking-phone", "new-booking", "phone"],
  ["ux-p5-stay-sheet-ipad", "stay-sheet", "ipad"],
  ["ux-p6-phone-chat", "chats", "phone"],
  ["ux-p6-desktop-missing", "missing-information", "dashboard-desktop"],
  ["ux-p7-team-phone", "settings-team", "phone"],
  ["ux-p7-business-desktop", "settings-business", "business-desktop", true],
  ["ux-p8-new-coupon-phone", "new-coupon", "phone", true],
  ["ux-p8-dashboard-desktop", "marketing-dashboard", "dashboard-desktop"],
  ["extra-settings-team-desktop", "settings-team", "business-desktop", true],
  ["extra-new-coupon-desktop", "new-coupon", "business-desktop", true],
  ["extra-new-coupon-filled-desktop", "new-coupon-filled", "business-desktop", true],
  ["extra-new-coupon-filled-phone", "new-coupon-filled", "phone", true],
  ["extra-new-coupon-filled-ipad", "new-coupon-filled", "ipad", true],
  ["extra-settings-team-phone-full", "settings-team", "phone", true],
  ["extra-settings-team-ipad-full", "settings-team", "ipad", true],
];
const isDesktop = (size: string) => size.endsWith("-desktop");
for (const desktop of [false, true])
  test.describe(desktop ? "desktop" : "touch", () => {
    if (desktop) test.use({ hasTouch: false, isMobile: false });
    for (const [file, state, size, fullPage] of pairs.filter(
      ([, , size]) => isDesktop(size) === desktop,
    ))
      pairTest(file, state, size, fullPage);
  });
function pairTest(
  file: string,
  state: string,
  size: (typeof pairs)[number][2],
  fullPage?: boolean,
) {
  test(file, async ({ page }) => {
    await page.setViewportSize(
      size === "business-desktop"
        ? { width: 1280, height: 950 }
        : size === "dashboard-desktop"
          ? { width: 1440, height: 900 }
          : sizes[size],
    );
    await scene(page, state, size === "phone");
    await shot(page, file, fullPage);
  });
}
for (const [size, viewport] of Object.entries(sizes))
  for (const state of [
    "checkout-start",
    "line-open",
    "cash-panel",
    "receipt",
    "split",
    "refund",
    "stay-sheet",
    "appointment-sheet",
    "new-booking",
    "hotel-calendar",
    "staff-calendar",
    "chats",
    "missing-information",
    "settings-business",
    "settings-team",
    "new-coupon",
    "marketing-dashboard",
  ])
    test(`extra-${state}-${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await scene(page, state, size === "phone");
      await shot(page, `extra-${state}-${size}`);
    });
for (const [size, state] of [
  ["phone", "cashier-till"],
  ["ipad", "manager-approvals"],
] as const)
  test(`ux-p1-${size}-${state}`, async ({ page }) => {
    await page.setViewportSize(sizes[size]);
    await page.goto(
      `/tests/browser/admin-shell.html?role=${size === "phone" ? "cashier&path=/admin/checkout" : "manager&path=/admin/chats&pending=1"}`,
    );
    await page.locator("header h1").waitFor();
    if (size === "ipad") {
      await page
        .getByRole("textbox", { name: "Type an admin reply" })
        .fill("Yes, 10:00 tomorrow works. Shall I book it?");
      await page.getByTestId("approvals-button").click();
    }
    await shot(page, `ux-p1-${size}-${state}`);
  });

// Round 4 settings evidence includes every tab and both shared save-bar contexts.
for (const [size, viewport] of Object.entries(sizes))
  for (const state of ["settings-bookingRules", "settings-ai", "settings-email", "settings-channels", "settings-business-dirty", "settings-team-dirty"])
    test(`extra-${state}-${size}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await scene(page, state, size === "phone");
      await shot(page, `extra-${state}-${size}`);
    });

// Round 3 checkout evidence also covers desktop, plus the previously missing sheet sizes.
test.describe("checkout desktop", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  for (const state of ["checkout-start", "line-open", "cash-panel", "cash-1500", "split", "receipt", "refund", "orders"]) {
    test(`extra-${state}-desktop`, async ({ page }) => {
      await scene(page, state, false);
      await shot(page, `extra-${state}-desktop`);
    });
  }
  test("extra-approvals-desktop", async ({ page }) => {
    await open(page, "staff-roles", "?role=manager&scenario=pending");
    await page.getByTestId("approvals-button").click();
    await shot(page, "extra-approvals-desktop");
  });
});
test("extra-orders-ipad", async ({ page }) => {
  await page.setViewportSize(sizes.ipad);
  await scene(page, "orders", false);
  await shot(page, "extra-orders-ipad");
});
test("extra-approvals-phone", async ({ page }) => {
  await page.setViewportSize(sizes.phone);
  await open(page, "staff-roles", "?role=manager&scenario=pending");
  await page.getByTestId("approvals-button").click();
  await shot(page, "extra-approvals-phone");
});

// Round 5 checks the changed desk and settings screens on desktop as well as touch sizes.
test.describe("round 5 desktop defects", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  for (const state of ["hotel-calendar", "staff-calendar", "new-booking", "chats", "missing-information", "settings-bookingRules", "settings-email", "settings-channels"]) {
    test(`extra-${state}-desktop`, async ({ page }) => {
      await scene(page, state, false);
      await shot(page, `extra-${state}-desktop`);
    });
  }
});

// Inspect the two subtle selections that were previously outside the locked scope.
for (const [size, viewport] of Object.entries({ ...sizes, desktop: { width: 1440, height: 900 } })) {
  test.describe(`round 5 checkout chips ${size}`, () => {
    test.use({ viewport, hasTouch: size !== "desktop", isMobile: size !== "desktop" });
    test(`extra-therapist-chips-${size}`, async ({ page }) => {
      await scene(page, "line-open", size === "phone");
      const panel = size === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
      await panel.getByRole("button", { name: /^Schedule/ }).click();
      await panel.getByRole("button", { name: "Any", exact: true }).scrollIntoViewIfNeeded();
      await shot(page, `extra-therapist-chips-${size}`);
    });
    test(`extra-discount-reason-${size}`, async ({ page }) => {
      await scene(page, "line-open", size === "phone");
      const panel = size === "phone" ? page.getByRole("dialog") : page.getByRole("complementary", { name: "Order", exact: true });
      await panel.getByLabel("Discount", { exact: true }).fill("15%");
      await panel.getByRole("group", { name: "Quick reason", exact: true }).getByRole("button").first().click();
      await shot(page, `extra-discount-reason-${size}`);
    });
  });
}
