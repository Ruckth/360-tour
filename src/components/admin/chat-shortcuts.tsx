import type { ReactNode } from "react";
export const CHAT_SHORTCUT_KEYS = ["j", "k", "r", "e", "/", "?"] as const;
export const CHAT_SHORTCUTS: Array<[string[], string]> = [
  [["j"], "Next chat"],
  [["k"], "Previous chat"],
  [["r"], "Reply to this chat"],
  [["e"], "No reply needed: settle the guest's message and open the next chat"],
  [["/"], "Search chats"],
  [["?"], "Show these shortcuts"],
  [["Esc"], "Leave a text box or close a dialog"],
];

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-xs leading-5 text-foreground">
      {children}
    </kbd>
  );
}
