type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
} | null;

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["textbox", "combobox", "searchbox", "listbox", "menu", "option"]);

/** True when a keypress belongs to a text field or menu, so single-key shortcuts must not fire. */
export function isTypingTarget(target: KeyTarget) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName && TYPING_TAGS.has(target.tagName.toUpperCase())) return true;
  const role = target.getAttribute?.("role");
  return Boolean(role && TYPING_ROLES.has(role));
}

export type ShortcutEvent = {
  key: string;
  target: KeyTarget;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
};

/** The shortcut key to act on, or null when the event should be left alone. */
export function shortcutKey(event: ShortcutEvent, keys: readonly string[]) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return keys.includes(event.key) ? event.key : null;
}
