import type { Page } from "@playwright/test";
export type Device = {
  id: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  hasTouch: boolean;
  isMobile: boolean;
  judged: boolean;
};
const device = (
  id: string,
  width: number,
  height: number,
  dpr: number,
  touch: boolean,
  judged = true,
): Device => ({
  id,
  width,
  height,
  deviceScaleFactor: dpr,
  hasTouch: touch,
  isMobile: touch,
  judged,
});
export const DEVICES = [
  device("phone", 360, 800, 3, true),
  device("ipad-p", 820, 1180, 2, true),
  device("ipad-l", 1180, 820, 2, true),
  device("desktop", 1440, 900, 2, false),
  device("reflow-320", 320, 800, 3, true, false),
  device("phone-large", 440, 956, 3, true, false),
  device("phone-land", 844, 390, 3, true, false),
  device("ipad-mini", 744, 1133, 2, true, false),
  device("laptop", 1366, 768, 2, false, false),
  device("wide", 1920, 1080, 2, false, false),
];
export const THRESHOLDS = {
  axe: 0,
  contrastText: 4.5,
  contrastLarge: 3,
  contrastUI: 3,
  targetTouch: 44,
  targetMouse: 24,
  overflow: 0,
  fontMin: 12,
  fontTouchWarning: 13,
  fontPairsWarning: 8,
  inputPhone: 16,
  truncation: 0,
  cls: 0.1,
  clsWarning: 0.05,
  focusWidth: 2,
  focusContrast: 3,
  offenderLimit: 25,
};
export const SECTIONS = ["1-daily", "2-scheduling", "3-records", "4-settings"];
export type State = {
  id: string;
  description: string;
  applies?: (device: Device) => boolean;
  recipe: (page: Page, device: Device) => Promise<void>;
};
export type Screen = {
  id: string;
  title: string;
  section: string;
  area: string;
  path: string | ((page: Page, base: string) => Promise<string>);
  states: State[];
  pendingStates: string[];
};
const normal: State = {
  id: "default",
  description: "The main view is displayed by opening its navigation route.",
  recipe: async () => {},
};
const dark: State = {
  id: "dark",
  description: "The main view is displayed with the dark theme selected.",
  applies: (d) => d.id === "ipad-l",
  recipe: async () => {},
};
const dialog = (name: string | RegExp, description: string): State => ({
  id: "dialog",
  description,
  recipe: async (p) => {
    await p.getByRole("button", { name, exact: true }).first().click();
    await p.getByRole("dialog").first().waitFor();
  },
});
const emptyChats: State = {
  id: "empty",
  description:
    "The message-status filter is set to conversations without messages while viewing the reply queue.",
  recipe: async (p) => {
    await p.getByRole("button", { name: /^Chat filters/ }).click();
    await p
      .getByRole("radiogroup", { name: "Message status", exact: true })
      .getByRole("radio", { name: "Empty", exact: true })
      .click();
    await p.keyboard.press("Escape");
    await p
      .getByText(
        /No chats match this search and these filters\.|No matching conversations on this page\./,
      )
      .waitFor();
    await p.waitForFunction(() => !document.querySelector("[data-session-id]"));
  },
};
const keyboard = (
  name: string,
  prepare?: (p: Page) => Promise<void>,
): State => ({
  id: "keyboard",
  description:
    "A text entry field is focused with a reduced viewport representing the software keyboard.",
  applies: (d) => d.id === "phone",
  recipe: async (p, d) => {
    await prepare?.(p);
    await p.getByLabel(name, { exact: true }).focus();
    await p.setViewportSize({ width: d.width, height: d.height - 336 });
  },
});
async function openChat(p: Page) {
  // The first button in each data-backed conversation row opens its transcript without sending a reply.
  if (!(await p.locator("[data-session-id]").count())) {
    await p.getByRole("tab", { name: /In progress/ }).click();
    await p.waitForTimeout(1200);
  }
  await p.locator("[data-session-id] > button").first().click();
  await p
    .getByRole("textbox", { name: "Type an admin reply", exact: true })
    .waitFor();
}
async function propertyPath(p: Page, base: string) {
  await p.goto(base + "/admin/properties");
  const link = p.locator('a[href^="/admin/properties/"]').first();
  await link.waitFor();
  return (await link.getAttribute("href"))!;
}
const CHECKOUT_PREVIEW = "/admin/checkout/preview";
async function addSampleItem(p: Page) {
  await p
    .getByRole("button", { name: /Thai massage 60/ })
    .first()
    .click();
}
/** Opens the pay panel: on the page from iPad up, in the order sheet on phones. */
async function openPayment(p: Page) {
  const cash = p.getByRole("button", { name: "Cash", exact: true });
  if (!(await cash.isVisible()))
    await p.getByRole("button", { name: /open the order$/ }).click();
  await cash.click();
  await p.getByLabel("Cash received", { exact: true }).waitFor();
}
async function payToReceipt(p: Page) {
  await addSampleItem(p);
  await openPayment(p);
  await p.getByRole("button", { name: "Exact", exact: true }).click();
  await p.getByRole("button", { name: /^Confirm cash/ }).click();
  await p.getByRole("button", { name: /^Void/ }).first().waitFor();
}
function screen(
  id: string,
  title: string,
  section: string,
  path: Screen["path"],
  area: string,
  states: State[] = [],
): Screen {
  return {
    id,
    title,
    section,
    path,
    area,
    states: [normal, ...states, dark],
    pendingStates: ["long", "error"],
  };
}
export const SCREENS: Screen[] = [
  screen("chats", "Chats", "1-daily", "/admin/chats", "chats", [
    dialog(
      "Keyboard shortcuts",
      "The keyboard shortcut dialog is opened from the chat list toolbar.",
    ),
    emptyChats,
    keyboard("Type an admin reply", openChat),
  ]),
  screen(
    "hotel",
    "Hotel bookings",
    "2-scheduling",
    "/admin/hotel",
    "hotel-calendar",
    [
      dialog(
        "New booking",
        "The booking form is opened using the booking toolbar action.",
      ),
    ],
  ),
  screen(
    "staff-calendar",
    "Staff calendar",
    "2-scheduling",
    "/admin/staff/calendar",
    "staff-calendar",
    [
      dialog(
        "New appointment",
        "The appointment form is opened using the calendar toolbar action.",
      ),
    ],
  ),
  screen(
    "roster",
    "Roster",
    "2-scheduling",
    "/admin/staff/roster",
    "staff-calendar",
    [
      {
        id: "dialog",
        description:
          "A roster cell is selected and the custom-hours dialog is opened from the toolbar.",
        recipe: async (p) => {
          await p.getByRole("gridcell").first().click();
          await p.getByRole("button", { name: "Custom…", exact: true }).click();
          await p.getByRole("dialog").waitFor();
        },
      },
    ],
  ),
  screen(
    "staff",
    "Staff",
    "3-records",
    "/admin/staff/staff",
    "staff-calendar",
    [
      dialog(
        "Add staff",
        "The staff form is opened using the staff toolbar action.",
      ),
    ],
  ),
  screen(
    "services",
    "Services",
    "3-records",
    "/admin/staff/services",
    "staff-calendar",
    [
      dialog(
        "Add service",
        "The service form is opened using the services toolbar action.",
      ),
    ],
  ),
  // Checkout and its receipt run on the dev-only sample-data preview inside the admin shell: the
  // shared dev deployment can't serve checkout, and paying there would write to it.
  screen("checkout", "Checkout", "1-daily", CHECKOUT_PREVIEW, "checkout", [
    dialog(
      "Orders",
      "The order browser dialog is opened from the checkout toolbar.",
    ),
    keyboard("Cash received", async (p) => {
      await addSampleItem(p);
      await openPayment(p);
    }),
  ]),
  {
    id: "receipt",
    title: "Receipt",
    section: "1-daily",
    path: CHECKOUT_PREVIEW,
    area: "checkout",
    states: [
      {
        ...normal,
        description:
          "The receipt of a one-item order paid in cash is displayed.",
        recipe: payToReceipt,
      },
      {
        id: "dialog",
        description:
          "The receipt void confirmation is opened without confirming it.",
        recipe: async (p) => {
          await payToReceipt(p);
          await p.getByRole("button", { name: /^Void/ }).first().click();
          await p.getByRole("dialog").first().waitFor();
        },
      },
      {
        ...dark,
        description: "The receipt is displayed with the dark theme selected.",
        recipe: payToReceipt,
      },
    ],
    pendingStates: ["long", "error"],
  },
  screen(
    "facts",
    "Business facts",
    "3-records",
    "/admin/questions",
    "business-facts",
    [
      dialog(
        "Add a fact",
        "The fact form is opened using the knowledge toolbar action.",
      ),
    ],
  ),
  screen(
    "properties",
    "Properties",
    "3-records",
    "/admin/properties",
    "properties",
    [
      dialog(
        "New villa",
        "The villa form is opened using the property list toolbar action.",
      ),
    ],
  ),
  screen(
    "property-editor",
    "Property editor",
    "3-records",
    propertyPath,
    "properties",
  ),
  screen("leads", "Leads", "3-records", "/admin/leads", "leads"),
  screen(
    "settings-business",
    "Business settings",
    "4-settings",
    "/admin/settings",
    "settings",
    [keyboard("Business name (required)")],
  ),
  ...["ai", "email", "channels", "admins"].map((tab) =>
    screen(
      `settings-${tab}`,
      `${tab === "ai" ? "AI assistant" : tab[0].toUpperCase() + tab.slice(1)} settings`,
      "4-settings",
      `/admin/settings?tab=${tab}`,
      "settings",
    ),
  ),
];
export const FLAWS: Record<string, { category: string; css: string }> = {
  "contrast-drop": {
    category: "color_contrast",
    css: ":root:not(.dark) body,:root:not(.dark) main :is(p,span,label){color:#a3a3a3!important}",
  },
  "misaligned-column": {
    category: "consistency_polish",
    css: "main :is(li,tr,[data-session-id]):nth-child(even),main form>div:nth-child(even){transform:translateX(6px)!important}",
  },
  "type-chaos": {
    category: "typography",
    css: "main :is(h1,h2,h3,label):nth-child(3n){font-size:11px!important}main :is(h1,h2,h3,label):nth-child(3n+1){font-size:19px!important}main :is(h1,h2,h3,label):nth-child(3n+2){font-size:15px!important}",
  },
  // injectFlaw halves computed spacing for this probe; it does not use a stylesheet.
  cramped: { category: "spacing_density", css: "" },
  "icon-mix": {
    category: "iconography",
    css: "main svg:nth-of-type(odd){stroke-width:4!important;width:12px!important;height:12px!important}main svg:nth-of-type(even){stroke-width:.75!important;width:25px!important;height:25px!important}",
  },
};
