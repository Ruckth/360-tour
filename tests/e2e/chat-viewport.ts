import type { Page } from "@playwright/test";

export async function installMockVisualViewport(page: Page, userAgent: string) {
  await page.addInitScript(({ mockedUserAgent }) => {
    Object.defineProperty(navigator, "userAgent", {
      get: () => mockedUserAgent,
    });

    type VisualViewportListener = (event: Event) => void;
    const listeners = new Map<string, Set<VisualViewportListener>>();
    const viewport = {
      width: 390,
      height: 760,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener !== "function") return;
        const items = listeners.get(type) ?? new Set<VisualViewportListener>();
        items.add(listener);
        listeners.set(type, items);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener !== "function") return;
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: Event) {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => viewport,
    });
    (
      window as unknown as {
        __setTestVisualViewportHeight: (height: number) => void;
      }
    ).__setTestVisualViewportHeight = (height: number) => {
      viewport.height = height;
      viewport.dispatchEvent(new Event("resize"));
    };
  }, { mockedUserAgent: userAgent });
}
