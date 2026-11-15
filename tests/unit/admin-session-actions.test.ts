// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminSessionActions } from "@/components/admin/AdminSessionActions";
import { AdminSessionDetail } from "@/components/admin/AdminSessionDetail";
import type { AdminSession } from "@/components/admin/admin-chat-types";

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), confirm: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) => mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));

const initial: AdminSession = {
  _id: "session-a" as AdminSession["_id"], channel: "web", createdAt: 1, isActive: false,
  adminStatus: "open", needsReply: true, aiPaused: true, keepWithStaff: true,
  latestGuestMessageId: "message-a" as AdminSession["latestGuestMessageId"], staffTask: "Check housekeeping",
};
let root: Root;
const deleted = vi.fn(), statusChanged = vi.fn();
async function render(session = initial) {
  const props: ComponentProps<typeof AdminSessionActions> = {
    session, onDeleted: deleted, onStatusChanged: statusChanged,
    children: ({ actions, followUp, actionError, replyAction }) => createElement(AdminSessionDetail, {
      selectedSession: session, actions, followUp, actionError, replyAction, messages: [], now: 100, canLoadOlderMessages: false,
      loadOlderMessages: vi.fn(), loadingTranscript: false, loadingOlderMessages: false,
      replyDraft: "Draft stays here", onReplyDraftChange: vi.fn(), onSendReply: vi.fn(),
      replyPending: false, replyError: null, replyStatus: null, replyWindow: { applies: false },
    }),
  };
  await act(async () => root.render(createElement(AdminSessionActions, props)));
}
const button = (text: string) => {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === text);
  expect(result).toBeDefined(); return result!;
};
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: HTMLElement) => act(async () => el.click());
// The ⋯ menu (base-ui) opens on a full pointer sequence, not a bare click().
const press = (el: Element) => act(async () => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
});
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const settleFocus = () => act(async () => new Promise(resolve => setTimeout(resolve, 20)));
async function menu(label: string) {
  await press(byLabel("More chat actions"));
  const item = menuItems().find(el => el.textContent?.trim() === label);
  expect(item, label).toBeDefined();
  await press(item!);
}
const input = () => document.getElementById("follow-up-session-a") as HTMLInputElement;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(async () => document.querySelector("[role=dialog] form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.mutation.mockReset().mockResolvedValue(undefined); mocks.confirm.mockReset().mockResolvedValue(true);
  deleted.mockReset(); statusChanged.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("shares direct and menu editing, initializes from the current task and cancels without saving", async () => {
  await render();
  const direct = byLabel("Edit follow-up");
  await click(direct);
  expect(input().value).toBe("Check housekeeping");
  await type("Unsaved draft");
  await click(button("Cancel"));
  await settleFocus();
  expect(mocks.mutation).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Check housekeeping");
  expect(document.activeElement).toBe(direct);

  await render({ ...initial, staffTask: "Call the guest" });
  await menu("Edit follow-up");
  expect(input().value).toBe("Call the guest");
  await type("  Ask about checkout  ");
  await submit();
  await settleFocus();
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith("messaging/adminChat:setStaffTask", { sessionId: "session-a", task: "Ask about checkout" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector("textarea")?.value).toBe("Draft stays here");
  expect(statusChanged).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(byLabel("More chat actions"));
});

it("guards blank saves independently of the disabled button and leaves the current task intact", async () => {
  await render(); await click(byLabel("Edit follow-up")); await type("   ");
  expect(button("Save").disabled).toBe(true);
  await submit();
  expect(mocks.mutation).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Check housekeeping");
  await click(button("Cancel"));
  await settleFocus();
  await menu("Edit follow-up");
  expect(input().value).toBe("Check housekeeping");
});

it("completes independently and starts Add empty after the current task is removed", async () => {
  await render(); await click(byLabel("Complete follow-up"));
  expect(mocks.mutation).toHaveBeenCalledExactlyOnceWith("messaging/adminChat:setStaffTask", { sessionId: "session-a", task: null });
  await render({ ...initial, staffTask: undefined });
  await settleFocus();
  expect(document.activeElement).toBe(byLabel("More chat actions"));
  expect(byLabel("Edit follow-up")).toBeNull();
  expect(document.body.textContent).not.toContain("Follow-up:");
  await menu("Add follow-up"); expect(input().value).toBe("");
  await click(button("Cancel"));
  expect(statusChanged).not.toHaveBeenCalled();
});

it("retains a failed edit for retry, blocks closing and double submission while pending", async () => {
  let reject!: (reason: Error) => void;
  mocks.mutation.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await render(); await click(byLabel("Edit follow-up")); await type("Check the late checkout");
  await act(async () => {
    const form = document.querySelector("[role=dialog] form")!;
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mocks.mutation).toHaveBeenCalledTimes(1);
  expect(input().disabled).toBe(true); expect(button("Cancel").disabled).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(input()).not.toBeNull();
  await act(async () => reject(new Error("Could not save follow-up")));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Could not save follow-up");
  expect(input().value).toBe("Check the late checkout");
  await submit();
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:setStaffTask", { sessionId: "session-a", task: "Check the late checkout" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("shows No reply needed in the header, rare actions in ⋯, and retains the exact latest guest-message guard", async () => {
  await render(); await press(byLabel("More chat actions"));
  expect(menuItems().map(el => el.textContent)).toEqual([
    "Edit follow-up", "Complete follow-up", "Resume AI", "Let AI handle the next issue", "Archive chat",
  ]);
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await click(button("No reply needed"));
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:setSessionStatus", { sessionId: "session-a", status: "resolved", expectedGuestMessageId: "message-a" });
  expect(statusChanged).toHaveBeenCalledWith("resolved");
  await menu("Resume AI");
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:setAiPaused", { sessionId: "session-a", paused: false });
  await menu("Let AI handle the next issue");
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:setKeepWithStaff", { sessionId: "session-a", keep: false });
  await menu("Complete follow-up");
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:setStaffTask", { sessionId: "session-a", task: null });
});

it("keeps failed actions visible without firing success callbacks and preserves reopen/delete", async () => {
  await render({ ...initial, adminStatus: "archived" });
  mocks.mutation.mockRejectedValueOnce(new Error("Could not reopen"));
  await click(button("Reopen"));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Could not reopen");
  expect(statusChanged).not.toHaveBeenCalled();
  await menu("Delete chat");
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true, confirmLabel: "Delete chat" }));
  expect(mocks.mutation).toHaveBeenLastCalledWith("messaging/adminChat:deleteArchivedSession", { sessionId: "session-a" });
  expect(deleted).toHaveBeenCalledOnce();
});

it("compares follow-up text with its opening value and resets the baseline after Save", async () => {
  await render(); await click(byLabel("Edit follow-up"));
  await type("Changed follow-up");
  mocks.confirm.mockResolvedValueOnce(false);
  await click(button("Cancel"));
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Discard unsaved changes?", cancelLabel: "Keep editing", confirmLabel: "Discard" }));
  expect(input().value).toBe("Changed follow-up");
  mocks.confirm.mockClear();
  await submit();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ ...initial, staffTask: "Changed follow-up" });
  await click(byLabel("Edit follow-up")); await click(button("Cancel"));
  expect(mocks.confirm).not.toHaveBeenCalled();
});
