// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { getPropertyById } from "@/lib/data/properties";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadTourViewer, viewerRenders } = vi.hoisted(() => ({
  mockLoadTourViewer: vi.fn(),
  viewerRenders: vi.fn(),
}));

vi.mock("@/platform/intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("@/lib/tour/preload", () => ({
  loadTourViewer: mockLoadTourViewer,
  preloadTourViewer: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const villa = getPropertyById("pool-villa");
if (!villa) throw new Error("Missing pool villa fixture");
const props = { property: villa, onClose: () => {}, closeHref: "/rooms/pool-villa" };

/**
 * A fresh module registry per test, so RoomTourViewer's shared `loaded`/`pending` state starts empty. React and
 * the renderers come from the same registry as the component, so they always share one React instance.
 */
async function fresh() {
  vi.resetModules();
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { renderToString } = await import("react-dom/server");
  const { RoomTourViewer } = await import("@/components/rooms/RoomTourViewer");
  const { useBodyScrollLock } = await import("@/lib/interaction/use-body-scroll-lock");
  const h = React.createElement;

  /** Like the real TourViewer, it holds its own scroll lock while mounted. */
  function LockingTourViewer({ property }: { property: { id: string } }) {
    useBodyScrollLock(true);
    return h("div", { "data-testid": "viewer" }, `360:${property.id}`);
  }
  /** Another lock holder on the page, such as the chat sheet. */
  function OtherLock() {
    useBodyScrollLock(true);
    return null;
  }

  function MockTourViewer({ property }: { property: { id: string } }) {
    viewerRenders(property.id);
    return h("div", { "data-testid": "viewer" }, `360:${property.id}`);
  }
  /** Stands in for the room route's error boundary. */
  class Boundary extends React.Component<{ children?: ReactNode }, { error?: Error }> {
    state: { error?: Error } = {};
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    render() {
      return this.state.error ? h("p", { "data-testid": "boundary" }, this.state.error.message) : this.props.children;
    }
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (node: ReactNode) => {
    await React.act(async () => {
      root.render(node);
      await settle();
    });
  };
  mounted.push(async () => React.act(async () => root.unmount()));
  const viewer = () => h(RoomTourViewer, props);
  const strict = () => h(React.StrictMode, null, viewer());
  const guarded = (key: string) => h(Boundary, { key }, viewer());
  return { React, renderToString, RoomTourViewer, MockTourViewer, LockingTourViewer, OtherLock, container, root, render, viewer, strict, guarded };
}

const mounted: (() => Promise<void>)[] = [];

describe("RoomTourViewer", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockLoadTourViewer.mockReset();
    viewerRenders.mockReset();
  });

  afterEach(async () => {
    for (const unmount of mounted.splice(0)) await unmount();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders only the opaque intro on the server, with a plain link back, and never starts the import there", async () => {
    const { React, renderToString, RoomTourViewer } = await fresh();
    const html = renderToString(React.createElement(RoomTourViewer, props));
    expect(html).toContain('data-testid="tour-viewer-loading"');
    expect(html).toContain(props.property.name);
    expect(html).toContain("Tour.loading");
    expect(html).toMatch(/<a href="\/rooms\/pool-villa"[^>]*aria-label="A11y.close"/);
    expect(html).not.toContain("canvas");
    expect(mockLoadTourViewer).not.toHaveBeenCalled();
  });

  it("imports once across StrictMode replay, a close while pending and a reopen, then reopens from cache", async () => {
    const { React, MockTourViewer, container, root, render, strict } = await fresh();
    const load = deferred<unknown>();
    mockLoadTourViewer.mockReturnValue(load.promise);

    await render(strict());
    expect(mockLoadTourViewer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="tour-viewer-loading"]')).not.toBeNull();

    await render(null);
    await render(strict());
    expect(mockLoadTourViewer).toHaveBeenCalledTimes(1);

    await React.act(async () => {
      load.resolve(MockTourViewer);
      await settle();
    });
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe("360:pool-villa");
    expect(container.querySelector('[data-testid="tour-viewer-loading"]')).toBeNull();

    await render(null);
    expect(container.innerHTML).toBe("");
    viewerRenders.mockReset();
    // A cached reopen mounts the viewer in its first commit, with no further import.
    await React.act(async () => {
      root.render(strict());
    });
    expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull();
    expect(viewerRenders).toHaveBeenCalled();
    expect(mockLoadTourViewer).toHaveBeenCalledTimes(1);
  });

  it("does not update after a close while the import is pending", async () => {
    const { React, MockTourViewer, container, render, viewer } = await fresh();
    const load = deferred<unknown>();
    mockLoadTourViewer.mockReturnValue(load.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await render(viewer());
    await render(null);
    await React.act(async () => {
      load.resolve(MockTourViewer);
      await settle();
    });

    expect(container.innerHTML).toBe("");
    expect(viewerRenders).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("throws a rejected import to the error boundary, and the next mount retries it", async () => {
    const { MockTourViewer, container, render, guarded } = await fresh();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadTourViewer.mockRejectedValueOnce(new Error("chunk failed"));

    await render(guarded("first"));
    expect(container.querySelector('[data-testid="boundary"]')?.textContent).toBe("chunk failed");
    expect(container.querySelector('[data-testid="viewer"]')).toBeNull();

    mockLoadTourViewer.mockResolvedValueOnce(MockTourViewer);
    await render(guarded("retry"));
    expect(mockLoadTourViewer).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="boundary"]')).toBeNull();
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe("360:pool-villa");
  });

  describe("pending intro scroll lock", () => {
    const deferred = () => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise((done) => (resolve = done));
      return { promise, resolve };
    };

    it("refuses page pans from the server render on", async () => {
      const { React, renderToString, RoomTourViewer } = await fresh();
      expect(renderToString(React.createElement(RoomTourViewer, props))).toMatch(
        /data-testid="tour-viewer-loading"[^>]*style="touch-action:none"/,
      );
    });

    it("locks the page while the import is pending and restores it on a close, under StrictMode too", async () => {
      document.body.style.overflow = "scroll";
      const { render, strict } = await fresh();
      mockLoadTourViewer.mockReturnValue(deferred().promise);
      await render(strict());
      expect(document.body.style.overflow).toBe("hidden");
      await render(null);
      expect(document.body.style.overflow).toBe("scroll");
    });

    it("keeps the page locked across the handoff to the viewer, which then owns the lock", async () => {
      const { React, LockingTourViewer, render, viewer } = await fresh();
      const load = deferred();
      mockLoadTourViewer.mockReturnValue(load.promise);
      await render(viewer());
      expect(document.body.style.overflow).toBe("hidden");
      await React.act(async () => {
        load.resolve(LockingTourViewer);
        await settle();
      });
      expect(document.querySelector('[data-testid="viewer"]')).not.toBeNull();
      expect(document.body.style.overflow).toBe("hidden");
      await render(null);
      expect(document.body.style.overflow).toBe("");
    });

    it("releases only its own reference: another holder keeps the page locked", async () => {
      const { React, OtherLock, render, viewer } = await fresh();
      mockLoadTourViewer.mockReturnValue(deferred().promise);
      await render(React.createElement(React.Fragment, null, React.createElement(OtherLock), viewer()));
      expect(document.body.style.overflow).toBe("hidden");
      await render(React.createElement(OtherLock));
      expect(document.body.style.overflow).toBe("hidden");
      await render(null);
      expect(document.body.style.overflow).toBe("");
    });

    it("releases its lock when the import fails into the error boundary", async () => {
      const { render, guarded } = await fresh();
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockLoadTourViewer.mockRejectedValueOnce(new Error("chunk failed"));
      await render(guarded("failed"));
      expect(document.querySelector('[data-testid="boundary"]')).not.toBeNull();
      expect(document.body.style.overflow).toBe("");
    });
  });
});
