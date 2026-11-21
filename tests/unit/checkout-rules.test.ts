// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutRulesPanel } from "@/components/admin/checkout-rules/CheckoutRulesPanel";
import { DEFAULT_TERMS } from "@/components/admin/checkout-rules/TermsForm";
import { staffAccessFor, type ShellRole } from "./admin-shell-convex";

type Switch = "off" | "managers" | "everyone";
const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  calls: [] as { name: string; args: unknown }[],
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  pages: {} as Record<string, unknown[]>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    return args === "skip" ? undefined : state.queries[name];
  },
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    return { results: args === "skip" ? [] : state.pages[name] ?? [], status: "Exhausted", loadMore: () => {} };
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return (state.mutations[name] ??= vi.fn().mockResolvedValue({ status: "applied", revision: 9, adjustmentId: "a" }));
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let role: ShellRole = "owner";

const switches = (patch: Partial<Record<string, Switch>> = {}) => ({ products: "off", vouchers: "off", sessionPackages: "off", mixedPackages: "off", ...patch });
function serve({ revision = 3, terms = DEFAULT_TERMS, sale = switches(), mode = "direct", paused = false, acknowledged = [] as { tillId: string; key: string; at: number }[], pending = [] as { tillId: string; key: string }[], settingsId = null as string | null } = {}) {
  state.queries = {
    "commerce/settings:getRules": { revision, terms, switches: sale, paymentsMode: mode, canEdit: role === "owner", settingsId },
    "commerce/paymentCutover:status": {
      mode, settingsRevision: revision, paused, cutoverAt: mode === "attempts" ? 1_763_600_000_000 : null,
      cutoverRevision: mode === "attempts" ? revision : null, acknowledged, pending,
    },
    "commerce/settings:getAccess": {
      settingsRevision: revision, switches: sale, canSell: {}, paymentsMode: mode, paused, tillReady: false, cutoverRevision: null,
    },
  };
}
const render = async () => act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor(role) }, createElement(CheckoutRulesPanel, { onDirtyChange: () => {} }))));
const byText = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text);
const click = async (node: Element | null | undefined) => { expect(node).toBeTruthy(); await act(async () => (node as HTMLElement).click()); };
const type = async (node: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
});
const dialog = () => document.querySelector<HTMLElement>('[data-testid="rules-dialog"]');
const row = (kind: string) => document.querySelector<HTMLElement>(`[data-testid="switch-${kind}"]`)!;
const mutation = (name: string) => (state.mutations[name] ??= vi.fn().mockResolvedValue({ status: "applied", revision: 9, adjustmentId: "a" }));
const ready = [{ tillId: "till1", key: "default", at: 1_763_600_100_000 }];

beforeEach(() => {
  role = "owner";
  state.calls = [];
  state.mutations = {};
  state.pages = {};
  serve();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

describe("Settings › Checkout rules, owner", () => {
  it("shows every D20 rule at its default with the advisers note, and keeps sales locked before the cutover", async () => {
    await render();
    expect(document.body.textContent).toContain("Defaults follow common Thai practice. Check them with your own advisers; you are responsible for the rules you set.");
    expect(document.querySelectorAll('[data-testid^="rule-"]')).toHaveLength(11);
    expect(document.querySelector<HTMLInputElement>("#rules-fullRefund")!.value).toBe("7");
    expect(document.querySelector('[data-testid="rule-split"]')!.textContent).toContain("Default: Voucher at face value.");
    expect(document.querySelector('[data-testid="rule-vat"]')!.textContent).toContain("Affects tax invoices and VAT reports.");
    // Off · Managers only · Everyone, all Off; raising waits for new payments.
    const products = row("products");
    expect([...products.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["Off", "Managers only", "Everyone"]);
    expect(byText("Managers only", products)!.disabled).toBe(true);
    expect(document.querySelector('[data-testid="sell-locked"]')!.textContent).toContain("Switch to new payments and reload every till first.");
    // The cutover leads until it is finished.
    const cards = [...document.querySelectorAll("[data-testid]")].map((node) => node.getAttribute("data-testid"));
    expect(cards.indexOf("payments-cutover")).toBeLessThan(cards.indexOf("sale-switches"));
  });

  it("saves a rule change with before → after and a reason, and keeps the other refund period", async () => {
    await render();
    await type(document.querySelector<HTMLInputElement>("#rules-fullRefund")!, "14");
    await type(document.querySelector<HTMLInputElement>("#rules-dueCard")!, "30");
    expect(document.querySelector('[data-testid="rules-save-bar"]')!.textContent).toContain("2 changes not saved");
    await click(byText("Save"));
    expect(dialog()!.textContent).toContain("Save 2 changes?");
    expect(dialog()!.querySelector('[data-testid="rules-diff"]')!.textContent).toContain("Full refund if unused within · 7 days");
    expect(dialog()!.querySelector('[data-testid="rules-diff"]')!.textContent).toContain("30 days");
    // No reason, no save.
    await click(byText("Save", dialog()!));
    expect(mutation("commerce/settings:updateRules")).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain("Choose or type a reason first.");
    await click(byText("Adviser's advice", dialog()!));
    await click(byText("Save", dialog()!));
    expect(mutation("commerce/settings:updateRules")).toHaveBeenCalledWith({
      expectedRevision: 3, clientKey: expect.any(String), reason: "Adviser's advice",
      terms: { unusedFullRefundDays: 14, refundDueDays: { cashOrTransfer: 15, card: 30 } },
    });
    expect(dialog()).toBeNull();
  });

  it("refuses to save a validity of zero or a fraction", async () => {
    await render();
    await type(document.querySelector<HTMLInputElement>("#rules-packageDays")!, "0");
    await click(byText("Save"));
    expect(dialog()).toBeNull();
    expect(document.querySelector("#rules-packageDays-error")!.textContent).toBe("Enter at least 1.");
    await type(document.querySelector<HTMLInputElement>("#rules-packageDays")!, "1.5");
    expect(document.querySelector("#rules-packageDays-error")!.textContent).toBe("Enter a whole number.");
  });

  it("keeps a draft when the rules change on another screen and offers Load current rules", async () => {
    await render();
    await type(document.querySelector<HTMLInputElement>("#rules-fullRefund")!, "14");
    // A switch moves the revision but not the rules: the draft quietly follows it.
    serve({ revision: 4 });
    await render();
    expect(document.querySelector('[data-testid="rules-stale"]')).toBeNull();
    serve({ revision: 5, terms: { ...DEFAULT_TERMS, voucherValidityDays: 90 } });
    await render();
    expect(document.querySelector('[data-testid="rules-stale"]')!.textContent).toContain("These rules changed on another screen.");
    expect(document.querySelector<HTMLInputElement>("#rules-fullRefund")!.value).toBe("14");
    // Saving now is refused by the server; the dialog says so.
    mutation("commerce/settings:updateRules").mockRejectedValueOnce(new ConvexError({ code: "STALE_ADJUSTMENT_REVISION", message: "This record changed." }));
    await click(byText("Save"));
    await click(byText("Correction", dialog()!));
    await click(byText("Save", dialog()!));
    expect(mutation("commerce/settings:updateRules").mock.calls[0][0]).toMatchObject({ expectedRevision: 4 });
    expect(dialog()!.querySelector('[data-testid="rules-refusal"]')!.textContent).toContain("This changed on another screen.");
    await click(byText("Cancel", dialog()!));
    await click(byText("Load current rules"));
    expect(document.querySelector<HTMLInputElement>("#rules-fullRefund")!.value).toBe("7");
    expect(document.querySelector<HTMLInputElement>("#rules-voucherDays")!.value).toBe("90");
    expect(document.querySelector('[data-testid="rules-stale"]')).toBeNull();
  });

  it("raises a switch once every till has reloaded, and lowers one with a ready reason", async () => {
    serve({ mode: "attempts", acknowledged: ready, sale: switches({ vouchers: "everyone" }) });
    await render();
    expect(document.querySelector('[data-testid="sell-locked"]')).toBeNull();
    await click(byText("Managers only", row("products")));
    expect(dialog()!.textContent).toContain("Switch Products to Managers only?");
    await click(byText("Desk rehearsal", dialog()!));
    await click(byText("Switch to Managers only", dialog()!));
    expect(mutation("commerce/settings:updateRules")).toHaveBeenLastCalledWith({ expectedRevision: 3, clientKey: expect.any(String), reason: "Desk rehearsal", switches: { products: "managers" } });

    // Lowering is rollback step 1: the reason is filled in and it says what keeps working.
    await click(byText("Off", row("vouchers")));
    expect(dialog()!.textContent).toContain("What was already sold keeps working");
    await click(byText("Switch to Off", dialog()!));
    expect(mutation("commerce/settings:updateRules")).toHaveBeenLastCalledWith({ expectedRevision: 3, clientKey: expect.any(String), reason: "Stop selling for now", switches: { vouchers: "off" } });
  });

  it("explains a refused raise when a till hasn't reloaded", async () => {
    serve({ mode: "attempts", acknowledged: ready });
    await render();
    mutation("commerce/settings:updateRules").mockRejectedValueOnce(new ConvexError({ code: "PAYMENT_ROLLOUT_PENDING", message: "x" }));
    await click(byText("Everyone", row("products")));
    await click(byText("Going live", dialog()!));
    await click(byText("Switch to Everyone", dialog()!));
    expect(dialog()!.querySelector('[data-testid="rules-refusal"]')!.textContent).toBe("Switch to new payments and reload every till before enabling sales.");
    serve({ mode: "attempts", pending: [{ tillId: "till1", key: "default" }] });
    await click(byText("Cancel", dialog()!));
    await render();
    expect(document.querySelector('[data-testid="sell-locked"]')!.textContent).toContain("Waiting for 1 till to reload.");
  });

  it("lists open payments when Switch to new payments is refused, and retries with the same request key", async () => {
    serve({ paused: true });
    await render();
    expect(document.querySelector('[data-testid="payments-status"]')!.textContent).toBe("Checkout paused");
    const activate = mutation("commerce/paymentCutover:activate");
    activate.mockRejectedValueOnce(new ConvexError({
      code: "PAYMENTS_STILL_OPEN", message: "Finish or reconcile open payments before switching.",
      panels: [{ panelKey: "p1", orderId: "order1", actor: "token", openedAt: 1_763_600_000_000, tillId: "till1", tillKey: "default" }],
      attempts: [], moreAttempts: false,
    }));
    await click(byText("Switch to new payments"));
    expect(dialog()!.textContent).toContain("This can't be undone.");
    await click(byText("Switch to new payments", dialog()!));
    const open = dialog()!.querySelector('[data-testid="still-open"]')!;
    expect(open.textContent).toContain("Pay panel on Main till");
    expect(open.querySelector("a")!.getAttribute("href")).toBe("/admin/checkout?order=order1");
    await click(byText("Switch to new payments", dialog()!));
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate.mock.calls[1][0]).toEqual(activate.mock.calls[0][0]);
    expect(activate.mock.calls[0][0]).toEqual({ expectedRevision: 3, clientKey: expect.any(String), reason: "Payments cutover" });
    expect(dialog()).toBeNull();
  });

  it("shows tills reloaded and waiting after the switch, and lets a manager retire a replaced till", async () => {
    serve({ mode: "attempts", acknowledged: ready, pending: [{ tillId: "till2", key: "bar" }] });
    await render();
    const tills = document.querySelector('[data-testid="tills"]')!;
    expect(tills.textContent).toContain("Main till");
    expect(tills.textContent).toContain("Reloaded");
    expect(tills.textContent).toContain("barWaiting to reload");
    expect(byText("Switch to new payments")).toBeUndefined();
    const retire = mutation("commerce/paymentCutover:retireTill");
    await click(byText("Retire till", tills));
    expect(dialog()!.textContent).toContain("Retire bar?");
    await click(byText("Retire till", dialog()!));
    expect(retire).toHaveBeenCalledWith({ tillId: "till2", reason: "Browser or device replaced" });
    expect(dialog()).toBeNull();
  });

  it("reconciles open direct panels with Recorded, Nothing taken, and Collected · no receipt, each after the till has stopped", async () => {
    serve({ paused: true });
    const settled = {
      tillId: "till1", tillKey: "default", panelKey: "p-settled", orderId: "order1",
      orderNumber: 12, orderStatus: "paid", receiptNumber: 12, receiptUsed: false,
      actor: "cashier", actorEmail: "mint@example.com", openedAt: 1_763_600_000_000,
      instruction: { revision: 1, due: 120000, tenders: [{ method: "card", amount: 120000 }], at: 1_763_600_000_000 },
      settled: true, stale: false, canRecord: true, instanceId: "row-settled", revision: 3,
    };
    state.queries["commerce/paymentCutover:directPanels"] = [
      settled,
      {
        tillId: "till2", tillKey: "Till 000002", panelKey: "p-open", orderId: "order2",
        orderNumber: 13, orderStatus: "draft", receiptNumber: null, receiptUsed: false,
        actor: "cashier", actorEmail: "mint@example.com", openedAt: 1_763_500_000_000,
        settled: false, stale: true, canRecord: false, instanceId: "row-open", revision: 0,
      },
      // Another cashier's receipt, or another tender: settled, but the server would refuse Recorded.
      { ...settled, tillId: "till3", panelKey: "p-other-receipt", orderId: "order3", receiptNumber: 14, canRecord: false, instanceId: "row-other" },
    ];
    await render();
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="direct-panel-row"]')];
    const stopped = (row: HTMLElement) => row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain("Card ฿1,200");
    expect(rows()[0].textContent).toContain("Receipt #12");
    expect(rows()[0].textContent).toContain("mint has stopped, and I checked the terminal and drawer");
    expect(rows()[1].textContent).toContain("Instruction not saved");
    expect(rows()[1].textContent).toContain("Open over 12 hours");
    // Nothing reconciles before the manager confirms that till's cashier has stopped.
    for (const row of rows()) {
      for (const label of ["Recorded", "Nothing taken", "Collected · no receipt"]) expect(byText(label, row)!.disabled).toBe(true);
    }
    for (const row of rows()) await click(stopped(row));
    expect(byText("Recorded", rows()[0])!.disabled).toBe(false);
    expect(byText("Recorded", rows()[1])!.disabled).toBe(true);
    expect(byText("Recorded", rows()[2])!.disabled).toBe(true);
    expect(byText("Nothing taken", rows()[2])!.disabled).toBe(false);

    const reconcile = mutation("commerce/paymentCutover:reconcileDirectPanel");
    await click(byText("Recorded", rows()[0]));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till1", panelKey: "p-settled", outcome: "recorded", expectedInstanceId: "row-settled", expectedRevision: 3, stoppedPreviousOperator: true,
    });

    await click(byText("Nothing taken", rows()[1]));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till2", panelKey: "p-open", outcome: "nothing_taken", expectedInstanceId: "row-open", expectedRevision: 0, stoppedPreviousOperator: true,
    });

    await click(byText("Collected · no receipt", rows()[1]));
    expect(dialog()!.textContent).toContain("Record payment taken without a receipt?");
    await type(dialog()!.querySelector<HTMLInputElement>("input")!, "Terminal batch showed voided duplicate");
    await click(byText("Collected · no receipt", dialog()!));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till2", panelKey: "p-open", outcome: "collected_unrecorded", note: "Terminal batch showed voided duplicate",
      expectedInstanceId: "row-open", expectedRevision: 0, stoppedPreviousOperator: true,
    });
  });

  it("refuses a reconciliation reviewed on a panel the till has since changed, and asks again after each change, a takeover too", async () => {
    serve({ paused: true });
    const panel = {
      tillId: "till1", tillKey: "default", panelKey: "p-card", orderId: "order1",
      orderNumber: 12, orderStatus: "draft", receiptNumber: null, receiptUsed: false,
      actor: "cashier", actorEmail: "mint@example.com", openedAt: 1_763_600_000_000,
      instruction: { revision: 1, due: 120000, tenders: [{ method: "card", amount: 120000 }], at: 1_763_600_000_000 },
      settled: false, stale: false, canRecord: false, instanceId: "row-a", revision: 1,
    };
    state.queries["commerce/paymentCutover:directPanels"] = [panel];
    const reconcile = mutation("commerce/paymentCutover:reconcileDirectPanel");
    reconcile.mockRejectedValueOnce(new ConvexError({ code: "PAY_PANEL_CHANGED", message: "server text" }));
    reconcile.mockRejectedValueOnce(new ConvexError({ code: "OPERATOR_NOT_STOPPED", message: "server text" }));
    await render();
    const row = () => document.querySelector<HTMLElement>('[data-testid="direct-panel-row"]')!;
    await click(row().querySelector('input[type="checkbox"]'));
    await click(byText("Nothing taken", row()));
    expect(reconcile).toHaveBeenLastCalledWith(expect.objectContaining({ expectedInstanceId: "row-a", expectedRevision: 1, stoppedPreviousOperator: true }));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("This pay panel changed on the till. Review the current instruction first.");
    await click(byText("Nothing taken", row()));
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Confirm the other till has stopped first.");
    // The till switched to Cash: the row shows it, and the manager confirms again for the new instruction.
    const cash = { ...panel, revision: 2, instruction: { ...panel.instruction, tenders: [{ method: "cash", amount: 120000 }], at: 1_763_600_060_000 } };
    state.queries["commerce/paymentCutover:directPanels"] = [cash];
    await render();
    expect(row().textContent).toContain("Cash ฿1,200");
    expect(byText("Nothing taken", row())!.disabled).toBe(true);
    await click(row().querySelector('input[type="checkbox"]'));
    await click(byText("Nothing taken", row()));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till1", panelKey: "p-card", outcome: "nothing_taken", expectedInstanceId: "row-a", expectedRevision: 2, stoppedPreviousOperator: true,
    });
    // Another manager takes it over on the same till: the same instruction (and its time), a new operator.
    state.queries["commerce/paymentCutover:directPanels"] = [{ ...cash, revision: 3, actor: "manager2", actorEmail: "nok@example.com" }];
    await render();
    expect(row().textContent).toContain("nok has stopped, and I checked the terminal and drawer");
    expect(row().querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(byText("Nothing taken", row())!.disabled).toBe(true);
    await click(row().querySelector('input[type="checkbox"]'));
    await click(byText("Nothing taken", row()));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till1", panelKey: "p-card", outcome: "nothing_taken", expectedInstanceId: "row-a", expectedRevision: 3, stoppedPreviousOperator: true,
    });
  });

  it("clears the stop confirmation when the row is replaced under the same key at the same revision", async () => {
    serve({ paused: true });
    const rowA = {
      tillId: "till1", tillKey: "default", panelKey: "k", orderId: "order1",
      orderNumber: 12, orderStatus: "draft", receiptNumber: null, receiptUsed: false,
      actor: "cashier", actorEmail: "mint@example.com", openedAt: 1_763_600_000_000,
      settled: false, stale: false, canRecord: false, instanceId: "row-a", revision: 0,
    };
    state.queries["commerce/paymentCutover:directPanels"] = [rowA];
    const reconcile = mutation("commerce/paymentCutover:reconcileDirectPanel");
    await render();
    const row = () => document.querySelector<HTMLElement>('[data-testid="direct-panel-row"]')!;
    const stopped = () => row().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await click(stopped());
    expect(stopped().checked).toBe(true);
    expect(byText("Nothing taken", row())!.disabled).toBe(false);
    // Row A was reconciled elsewhere, and a retried open registered row B under the same key and revision.
    state.queries["commerce/paymentCutover:directPanels"] = [{ ...rowA, instanceId: "row-b" }];
    await render();
    expect(stopped().checked).toBe(false);
    expect(byText("Nothing taken", row())!.disabled).toBe(true);
    await click(stopped());
    await click(byText("Nothing taken", row()));
    expect(reconcile).toHaveBeenLastCalledWith({
      tillId: "till1", panelKey: "k", outcome: "nothing_taken", expectedInstanceId: "row-b", expectedRevision: 0, stoppedPreviousOperator: true,
    });
  });
});

describe("Settings › Checkout rules, History", () => {
  it("lists each change with who, why and every rule before → after, and reads nothing before the first change", async () => {
    await render();
    expect(state.calls.some((call) => call.name === "commerce/history:staffPage" && call.args !== "skip")).toBe(false);
    expect(document.querySelector('[data-testid="rules-history"]')!.textContent).toContain("Nothing recorded yet");
    act(() => root.unmount());
    root = createRoot(host);
    serve({ settingsId: "settings1" });
    state.pages["commerce/history:staffPage"] = [
      { entryId: "a2", at: 1_763_700_000_000, fact: { key: "rulesChanged" }, balance: null,
        staff: { actorName: "Owner", reason: "other", reasonText: "Adviser's advice" },
        changes: [
          { field: "refundDueDays.card", before: 45, after: 30 },
          { field: "allowSessionTransfer", before: true, after: false },
          { field: "saleSwitches.vouchers", before: "off", after: "managers" },
        ] },
      { entryId: "a1", at: 1_763_600_000_000, fact: { key: "checkoutPaused" }, balance: null,
        staff: { actorName: "Ploy", reason: "other", reasonText: "Payments update" }, changes: [] },
    ];
    await render();
    const call = state.calls.find((item) => item.name === "commerce/history:staffPage" && item.args !== "skip");
    expect(call!.args).toEqual({ target: { targetType: "settings", targetId: "settings1" } });
    const entries = [...document.querySelectorAll('[data-testid="history-entry"]')].map((node) => node.textContent);
    expect(entries[0]).toContain("Checkout rules changed");
    expect(entries[0]).toContain("Refund due · card: 45 days → 30 days");
    expect(entries[0]).toContain("Passing sessions on: Allowed, with the owner's consent → Not allowed");
    expect(entries[0]).toContain("Gift vouchers: Off → Managers only");
    expect(entries[0]).toContain("Adviser's advice");
    expect(entries[0]).not.toContain("Other");
    expect(entries[1]).toContain("Checkout paused");
  });
});

describe("Settings › Checkout rules, other roles", () => {
  it("lets a manager pause checkout and read the rules, switches, tills and History without changing them", async () => {
    role = "manager";
    serve({ revision: 6, sale: switches({ products: "managers" }), settingsId: "settings1" });
    await render();
    const read = state.calls.filter((call) => call.args !== "skip").map((call) => call.name);
    expect(new Set(read)).toEqual(new Set(["commerce/settings:getRules", "commerce/paymentCutover:status", "commerce/paymentCutover:directPanels", "commerce/history:staffPage"]));
    expect(row("products").querySelectorAll("button")).toHaveLength(0);
    expect(row("products").textContent).toContain("Managers only");
    // The rules show read-only, with no way to save.
    expect(document.querySelector<HTMLInputElement>("#rules-fullRefund")!.readOnly).toBe(true);
    expect(document.querySelector('[data-testid="terms-form"]')!.textContent).toContain("Only the owner can change these rules.");
    expect(document.querySelector('[data-testid="rules-history"]')).not.toBeNull();
    await type(document.querySelector<HTMLInputElement>("#rules-fullRefund")!, "9");
    expect(document.querySelector('[data-testid="rules-save-bar"]')).toBeNull();
    await click(byText("Pause checkout for update"));
    await click(byText("Pause checkout for update", dialog()!));
    expect(mutation("commerce/paymentCutover:setPaused")).toHaveBeenCalledWith({ expectedRevision: 6, clientKey: expect.any(String), reason: "Payments update", paused: true });
  });

  it("shows a cashier nothing and reads nothing", async () => {
    role = "cashier";
    await render();
    expect(host.textContent).toBe("");
    expect(state.calls.filter((call) => call.args !== "skip")).toEqual([]);
  });
});
