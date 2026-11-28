// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { getFunctionName, type FunctionReference } from "convex/server";
import { mergeSiteSettings } from "convex/shared/siteSettings";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffAccessFor } from "./admin-shell-convex";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  channelHealth: {
    channels: [
      {
        channel: "line",
        lastEventAt: Date.parse("2026-11-28T04:40:00Z"),
        lastRepliedAt: Date.parse("2026-11-28T04:39:00Z"),
        failed24h: 1,
        failed7d: 2,
        failedCapped: false,
        latestError: null as { at: number; message: string } | null,
      },
    ],
    ical: [],
  },
  serverConfig: { RESEND_API_KEY: true, OWNER_NOTIFICATION_EMAIL: true },
  tab: "business",
  update: vi.fn(),
  restore: vi.fn(),
  reconcileDirectPanel: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => {
    const name = getFunctionName(ref);
    if (name === "settings/settings:get") return state.settings;
    if (name === "settings/settings:channelHealth") return state.channelHealth;
    if (name === "settings/settings:serverConfig") return state.serverConfig;
    return undefined;
  },
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    if (name === "settings/settings:restore") return state.restore;
    if (name === "commerce/paymentCutover:reconcileDirectPanel") return state.reconcileDirectPanel;
    return state.update;
  },
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.tab ? `tab=${state.tab}` : ""),
}));
vi.mock("@/components/admin/SetupChecklist", () => ({ SetupChecklistCard: () => null }));
vi.mock("@/components/admin/useChannelConfig", () => ({
  useChannelConfig: () => ({ state: "ready", channels: { line: { configured: true, vars: {} } }, retry: vi.fn() }),
}));
vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: ({
    id,
    name,
    value,
    disabled,
    onValueChange,
  }: {
    id: string;
    name: string;
    value: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  }) => createElement("input", { id, name, value, disabled, onChange: (e: { target: { value: string } }) => onValueChange(e.target.value) }),
}));

import { AdminSettingsView } from "@/components/admin/AdminSettingsView";
import { PaymentsCutover } from "@/components/admin/checkout-rules/PaymentsCutover";
import type { RulesView } from "@/components/admin/checkout-rules/use-checkout-rules";
import { StaffAccessProvider } from "@/components/admin/staff-access";

let root: Root;
let host: HTMLDivElement;

const render = (node: ReactNode) => act(async () => root.render(node));
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.settings = {
    ...mergeSiteSettings(null),
    revision: 4,
    updatedAt: Date.parse("2026-11-28T03:00:00Z"),
    defaultOwnerNotificationEmail: "reception@example.com",
    defaultOwnerNotificationConfigured: true,
  };
  state.channelHealth.channels[0].latestError = null;
  state.tab = "business";
  state.update.mockReset().mockResolvedValue(null);
  state.restore.mockReset();
  state.reconcileDirectPanel.mockReset().mockResolvedValue(null);
  state.confirm.mockReset().mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("AdminSettingsView workflows (M24, M25, M26, M31)", () => {
  it("M24: reviews concurrent local and server changes before replacing a dirty draft and retains draft on cancel", async () => {
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );
    const businessName = () => host.querySelector<HTMLInputElement>("#settings-business-businessName")!;
    const checkIn = () => host.querySelector<HTMLInputElement>("#settings-business-checkInTime")!;

    await setInput(businessName(), "My Local Draft Name");
    expect(businessName().value).toBe("My Local Draft Name");

    // Simulate another device updating checkInTime to 15:00 (revision 5).
    state.settings = { ...state.settings, checkInTime: "15:00", revision: 5 };
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );

    const alert = host.querySelector('[data-testid="stale-settings-alert"]')!;
    expect(alert.textContent).toContain("Review changes on another device");
    expect(alert.textContent).toContain("Check-in time");
    expect(alert.textContent).toContain("Current: 15:00 · Your draft: 14:00");
    expect(alert.textContent).toContain("Business name");
    expect(alert.textContent).toContain("Your draft: My Local Draft Name");

    // Cancel replacement: draft and old revision stay intact.
    state.confirm.mockResolvedValueOnce(false);
    const replaceBtn = () => [...alert.querySelectorAll("button")].find((b) => b.textContent?.includes("Replace my draft"))!;
    await act(async () => replaceBtn().click());
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Replace your draft with current settings?" }));
    expect(businessName().value).toBe("My Local Draft Name");
    expect(checkIn().value).toBe("14:00");

    const decision = Promise.withResolvers<boolean>();
    state.confirm.mockReturnValueOnce(decision.promise);
    await act(async () => replaceBtn().click());
    state.settings = { ...state.settings, checkInTime: "16:00", revision: 6 };
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );
    await act(async () => decision.resolve(true));
    expect(businessName().value).toBe("My Local Draft Name");
    expect(alert.textContent).toContain("Current: 16:00");

    // Confirm after reviewing the new revision.
    state.confirm.mockResolvedValueOnce(true);
    await act(async () => replaceBtn().click());
    expect(businessName().value).toBe(mergeSiteSettings(null).businessName);
    expect(checkIn().value).toBe("16:00");
    expect(host.querySelector('[data-testid="stale-settings-alert"]')).toBeNull();

    // Subsequent edit & save still passes expectedRevision: 6.
    await setInput(businessName(), "Updated After Review");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 6 }));
  });

  it("M25: shows effective default email recipient for owners when blank, and source guidance without PII when unavailable or read-only", async () => {
    state.tab = "email";
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );
    expect(host.textContent).toContain("Effective default recipient: reception@example.com");

    // Typing an explicit override hides the blank-fallback note.
    const input = host.querySelector<HTMLInputElement>("#settings-email-ownerNotificationEmail")!;
    await setInput(input, "custom@example.com");
    expect(host.textContent).not.toContain("Effective default recipient:");

    // Clearing restores the effective recipient without saving.
    await setInput(input, "");
    expect(host.textContent).toContain("Effective default recipient: reception@example.com");
    expect(state.update).not.toHaveBeenCalled();

    // Missing env config shows source guidance.
    state.settings = { ...state.settings, defaultOwnerNotificationEmail: null, defaultOwnerNotificationConfigured: false };
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );
    expect(host.textContent).toContain("No default notification address is configured");
    expect(host.textContent).not.toContain("reception@example.com");

    // Read-only manager never sees recipient PII, only source guidance.
    state.settings = { ...state.settings, defaultOwnerNotificationEmail: "reception@example.com", defaultOwnerNotificationConfigured: true };
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("manager", "mgr@example.com") }, createElement(AdminSettingsView)),
    );
    expect(host.textContent).toContain("OWNER_NOTIFICATION_EMAIL");
    expect(host.textContent).not.toContain("reception@example.com");
  });

  it("M26: folds long channel failure details behind a Technical details disclosure while keeping summary and timestamp visible", async () => {
    state.tab = "channels";
    const longDetail = `Webhook delivery failed: HTTP 429 from the provider. ${"Trace segment ".repeat(35)}`;
    expect(longDetail.length).toBeGreaterThan(500);
    state.channelHealth.channels[0].latestError = {
      at: Date.parse("2026-11-28T04:40:00Z"),
      message: longDetail,
    };
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );

    expect(host.textContent).toContain("Latest error at");
    expect(host.textContent).toContain("Webhook delivery failed");
    const details = host.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent?.trim()).toBe("Technical details");
    expect(details.textContent).toContain("HTTP 429 from the provider.");
  });

  it("M31: groups booking timers with a joint summary and writes only chatQuoteValidityMinutes when only that field changes", async () => {
    state.tab = "bookingRules";
    await render(
      createElement(StaffAccessProvider, { access: staffAccessFor("owner", "owner@example.com") }, createElement(AdminSettingsView)),
    );
    expect(host.textContent).toContain("Reservation and chat timers");
    expect(host.textContent).toContain("Reservation held while awaiting payment");
    expect(host.textContent).toContain("Guest confirmation window for chat quotes");
    expect(host.textContent).toContain("Awaiting payment: 30 min · Chat quote confirmation: 15 min");

    const chatQuoteInput = host.querySelector<HTMLInputElement>("#settings-bookingRules-chatQuoteValidityMinutes")!;
    await setInput(chatQuoteInput, "25");
    expect(host.textContent).toContain("Awaiting payment: 30 min · Chat quote confirmation: 25 min");

    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update).toHaveBeenCalledWith({
      expectedRevision: 4,
      bookingRules: { chatQuoteValidityMinutes: 25 },
    });
  });
});

describe("PaymentsCutover open direct panel outcomes (M27)", () => {
  const baseView = (canRecord: boolean): RulesView => ({
    revision: 2,
    terms: {
      voucherDays: 180,
      packageDays: 180,
      serviceDiscountLimitPercent: 20,
      productDiscountLimitPercent: 20,
      manualDiscountNote: "always",
    } as unknown as RulesView["terms"],
    switches: { products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off" },
    mode: "direct",
    paused: true,
    cutoverAt: null,
    tills: { acknowledged: [], pending: [] },
    directPanels: [
      {
        tillId: "till1" as Id<"tills">,
        tillKey: "default",
        panelKey: "panel-1",
        instanceId: "inst-1",
        revision: 3,
        orderId: "order1" as Id<"orders">,
        actor: "cashier1",
        actorEmail: "cashier@example.com",
        openedAt: Date.parse("2026-11-28T04:00:00Z"),
        instruction: { tenders: [{ method: "cash", amount: 50000 }] },
        receiptNumber: canRecord ? 1042 : null,
        canRecord,
        stale: false,
        receiptUsed: false,
      } as unknown as RulesView["directPanels"][number],
    ],
    canEdit: true,
    settingsId: null,
  });

  it("shows all three outcomes in button order, preserves eligibility and confirmation gates, and sends no mutation until chosen", async () => {
    const onSaved = vi.fn();
    await render(createElement(PaymentsCutover, { view: baseView(true), onSaved }));

    const row = host.querySelector('[data-testid="direct-panel-row"]')!;
    const dts = [...row.querySelectorAll("dt")].map((el) => el.textContent?.trim());
    const actionButtons = [...row.querySelectorAll("button")].map((el) => el.textContent?.trim());
    expect(dts).toEqual(["Recorded", "Nothing taken", "Collected · no receipt"]);
    expect(actionButtons).toEqual(["Recorded", "Nothing taken", "Collected · no receipt"]);
    expect(row.textContent).toContain("Close the payment panel using the existing receipt");
    expect(row.textContent).toContain("no money was received");
    expect(row.textContent).toContain("money received without a receipt");

    // All actions stay disabled until operator-stopped confirmation is checked.
    for (const btn of row.querySelectorAll("button")) expect(btn.disabled).toBe(true);
    expect(state.reconcileDirectPanel).not.toHaveBeenCalled();

    // Check confirmation, then click Recorded.
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.disabled)).toEqual([false, false, false]);

    await act(async () => buttons[0].click());
    expect(state.reconcileDirectPanel).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "recorded", stoppedPreviousOperator: true, expectedRevision: 3 }),
    );
    expect(onSaved).toHaveBeenCalled();

    // When canRecord is false, Recorded stays disabled even after confirmation and explains why.
    await render(createElement(PaymentsCutover, { view: baseView(false), onSaved }));
    const row2 = host.querySelector('[data-testid="direct-panel-row"]')!;
    expect(row2.textContent).toContain("Unavailable until an unused receipt");
    expect(row2.querySelectorAll<HTMLButtonElement>("button")[0].disabled).toBe(true);
    expect(row2.querySelectorAll<HTMLButtonElement>("button")[1].disabled).toBe(false);
    expect(row2.querySelectorAll<HTMLButtonElement>("button")[2].disabled).toBe(false);
  });
});
