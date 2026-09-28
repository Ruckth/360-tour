import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutKey } from "../../src/lib/keyboard";

const element = (tagName: string, extra: { isContentEditable?: boolean; role?: string } = {}) => ({
  tagName,
  isContentEditable: extra.isContentEditable ?? false,
  getAttribute: (name: string) => (name === "role" ? (extra.role ?? null) : null),
});

describe("isTypingTarget", () => {
  it("treats text fields, editable content and menus as typing targets", () => {
    expect(isTypingTarget(element("input"))).toBe(true);
    expect(isTypingTarget(element("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(element("div", { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(element("button", { role: "combobox" }))).toBe(true);
    expect(isTypingTarget(element("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("shortcutKey", () => {
  const keys = ["j", "k", "/", "?"] as const;

  it("returns known keys pressed outside text fields", () => {
    expect(shortcutKey({ key: "j", target: element("body") }, keys)).toBe("j");
    expect(shortcutKey({ key: "?", target: element("button") }, keys)).toBe("?");
  });

  it("ignores typing, modifiers, handled events and unknown keys", () => {
    expect(shortcutKey({ key: "j", target: element("input") }, keys)).toBeNull();
    expect(shortcutKey({ key: "k", target: element("body"), metaKey: true }, keys)).toBeNull();
    expect(shortcutKey({ key: "k", target: element("body"), defaultPrevented: true }, keys)).toBeNull();
    expect(shortcutKey({ key: "x", target: element("body") }, keys)).toBeNull();
  });
});
