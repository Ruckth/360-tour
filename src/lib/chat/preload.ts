/**
 * Lazy loader + prefetch for the AI chat widget, mirroring `@/lib/tour/preload`. The widget code
 * (and its heavy chat-session machinery) is NOT part of the initial public bundle: it loads only
 * when the guest shows intent to use the launcher. `preloadAIChatWidget` warms the chunk on hover /
 * focus / touch so the first open feels instant; `loadAIChatWidget` is what `next/dynamic` renders
 * once the launcher is activated.
 */
export function loadAIChatWidget() {
  return import("@/components/chat/AIChatWidget").then((mod) => mod.AIChatWidget);
}

export function preloadAIChatWidget() {
  void import("@/components/chat/AIChatWidget");
}
