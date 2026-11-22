// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Property } from "@/lib/data/properties";
import { fakeTourClient } from "./tour-live-client";

const env = vi.hoisted(() => ({
  client: undefined as unknown,
  userId: null as string | null,
  /** The separate server read: resolve or reject it from a test. */
  reads: [] as { slug: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }[],
  canvas: undefined as undefined | { inputLocked?: boolean; initialTextureConfirmed: boolean; onNavigate: (roomId: string) => void },
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query(_query: unknown, { slug }: { slug: string }) {
      return new Promise((resolve, reject) => env.reads.push({ slug, resolve, reject }));
    }
  },
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/platform/auth", () => ({ useAuth: () => ({ userId: env.userId }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("convex/react")>(),
  useConvex: () => env.client,
}));
vi.mock("@/lib/i18n/use-public-messages", () => ({ usePublicMessages: () => ({ Rooms: {} }) }));
// The canvas reports the requested room as painted at once, and finishes transitions immediately.
vi.mock("@/components/tour/TourCanvas", async () => {
  const { useEffect } = await import("react");
  return {
    TourCanvas(props: {
      currentRoomId: string; transitioning: boolean; onLoaded: () => void; inputLocked?: boolean; initialTextureConfirmed: boolean;
      onStatusChange: (status: string, roomId: string) => void; onTransitionComplete: () => void;
      onNavigate: (roomId: string) => void;
    }) {
      env.canvas = props;
      const { currentRoomId, transitioning, onLoaded, onStatusChange, onTransitionComplete } = props;
      useEffect(() => {
        onLoaded();
        onStatusChange("ready", currentRoomId);
        if (transitioning) onTransitionComplete();
      }, [currentRoomId, transitioning, onLoaded, onStatusChange, onTransitionComplete]);
      return null;
    },
  };
});

const { TourViewer } = await import("@/components/tour/TourViewer");

const scene = (slug: string) => ({ slug, name: `Room ${slug}`, imagePath: `/tour/${slug}.webp`, hotspots: [] });
const scenes = (...slugs: string[]) => slugs.map(scene);
const villa = (id: string) => ({ id, name: `Villa ${id}`, tourRoomIds: [] }) as unknown as Property;

describe("live tour freshness and selection", () => {
  let root: Root;
  let convex: ReturnType<typeof fakeTourClient>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    convex = fakeTourClient();
    env.client = convex.client;
    env.userId = null;
    env.reads = [];
    env.canvas = undefined;
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  const render = (property = villa("a")) =>
    act(async () => root.render(createElement(TourViewer, { property, onClose: () => {} })));
  const deliver = (slug: string, value: unknown) => act(async () => convex.deliver(slug, value));
  const viewer = () => document.querySelector<HTMLElement>('[data-testid="tour-viewer"]');
  const shown = () => viewer()?.dataset.requestedRoom;
  const live = () => viewer()?.dataset.live;
  const button = (name: string) =>
    [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name).at(-1);
  const click = (name: string) => act(async () => button(name)!.click());
  const neighbors = () => [...document.querySelectorAll("button")]
    .map((b) => b.textContent?.trim()).filter((text) => text?.startsWith("Room "));

  it("opens exactly one subscription per open viewer and closes it on unmount", async () => {
    await render();
    await deliver("a", scenes("x", "y"));
    await render();
    expect(convex.subscribed).toEqual(["a"]);
    expect(convex.open()).toEqual(["a"]);
    await act(async () => root.unmount());
    expect(convex.open()).toEqual([]);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });

  it("starts over for a different villa or identity without showing the previous scenes", async () => {
    await render(villa("a"));
    await deliver("a", scenes("x", "y"));
    await click("Room y");
    expect(shown()).toBe("y");

    await render(villa("b"));
    expect(convex.open()).toEqual(["b"]);
    expect(shown()).toBe("");
    await deliver("b", scenes("p", "q"));
    expect(shown()).toBe("p");

    env.userId = "user_signed_in";
    await render(villa("b"));
    expect(convex.subscribed).toEqual(["a", "b", "b"]);
    expect(convex.open()).toEqual(["b"]);
    // The value retained under the old identity is neither shown nor a confirmation.
    expect(shown()).toBe("");
    await deliver("b", scenes("p", "q"));
    expect(shown()).toBe("p");
    expect(live()).toBe("confirmed");
  });

  it("clears the view and input for a null result, and restores it when active again", async () => {
    await render();
    await deliver("a", scenes("x", "y"));
    expect(button("Room y")).toBeDefined();
    await deliver("a", null);
    expect(viewer()?.dataset.sceneStatus).toBe("empty");
    expect(neighbors()).toEqual([]);
    await deliver("a", scenes("x", "y"));
    expect(shown()).toBe("x");
  });

  it("follows the first scene after a reorder until the guest chooses one", async () => {
    await render();
    await deliver("a", scenes("x", "y", "z"));
    expect(shown()).toBe("x");
    await deliver("a", scenes("z", "x", "y"));
    expect(shown()).toBe("z");
  });

  it("keeps an explicit choice through a reorder and updates its neighbors", async () => {
    await render();
    await deliver("a", scenes("x", "y", "z"));
    await click("Room y");
    expect(shown()).toBe("y");
    expect(neighbors()).toEqual(["Room x", "Room z"]);
    await deliver("a", scenes("x", "z", "y"));
    expect(shown()).toBe("y");
    expect(neighbors()).toEqual(["Room z", "Room x"]);
  });

  it("falls back to the first scene when the chosen one is removed, even if it returns", async () => {
    await render();
    await deliver("a", scenes("x", "y", "z"));
    await click("Room y");
    await deliver("a", scenes("x", "z"));
    expect(shown()).toBe("x");
    await deliver("a", scenes("z", "y", "x"));
    expect(shown()).toBe("z");
  });

  it("locks navigation offline and after reconnect until the server delivers again", async () => {
    await render();
    await deliver("a", scenes("x", "y"));
    expect(live()).toBe("confirmed");
    expect(viewer()?.getAttribute("aria-busy")).toBe("false");

    await act(async () => convex.disconnect());
    expect(live()).toBe("unconfirmed");
    expect(viewer()?.getAttribute("aria-busy")).toBe("true");
    expect(button("Room y")?.getAttribute("aria-disabled")).toBe("true");
    await click("Room y");
    expect(shown()).toBe("x");

    // The retained value is identical to the server's, but has not been re-sent on this connection.
    await act(async () => convex.reconnect());
    expect(live()).toBe("unconfirmed");
    await click("Room y");
    expect(shown()).toBe("x");

    await deliver("a", scenes("x", "y"));
    expect(live()).toBe("confirmed");
    await click("Room y");
    expect(shown()).toBe("y");
  });

  it("never shows a retained value on its own while its archive is pending", async () => {
    convex.cache("a", scenes("x", "y"));
    await render();
    expect(shown()).toBe("");
    expect(env.canvas).toBeUndefined();
    // The server already reports the villa archived: the retained scenes are not shown.
    await act(async () => env.reads[0].resolve(null));
    expect(shown()).toBe("");
    expect(env.canvas).toBeUndefined();
    await deliver("a", null);
    expect(viewer()?.dataset.sceneStatus).toBe("empty");
  });

  it("confirms a value held by another watch with one server read when nothing changes", async () => {
    convex.cache("a", scenes("x", "y"));
    await render();
    expect(env.reads.map((read) => read.slug)).toEqual(["a"]);
    expect(convex.open()).toEqual(["a"]);
    await act(async () => env.reads[0].resolve(scenes("x", "y")));
    expect(shown()).toBe("x");
    expect(live()).toBe("confirmed");
  });

  it("waits for the live delivery when the server read fails", async () => {
    convex.cache("a", scenes("x", "y"));
    await render();
    await act(async () => env.reads[0].reject(new Error("offline")));
    expect(shown()).toBe("");
    await deliver("a", scenes("x", "y"));
    expect(shown()).toBe("x");
    expect(live()).toBe("confirmed");
  });

  it("asks the server only when the client already held a value", async () => {
    await render();
    await deliver("a", scenes("x"));
    expect(env.reads).toEqual([]);
  });

  it("locks drag and hotspot navigation while unconfirmed, keeping the scene frozen", async () => {
    await render();
    await deliver("a", scenes("x", "y"));
    expect(env.canvas?.inputLocked).toBe(false);
    expect(env.canvas?.initialTextureConfirmed).toBe(true);
    await act(async () => convex.disconnect());
    expect(shown()).toBe("x");
    expect(env.canvas?.inputLocked).toBe(true);
    expect(env.canvas?.initialTextureConfirmed).toBe(false);
    await act(async () => env.canvas!.onNavigate("y"));
    expect(shown()).toBe("x");
    await act(async () => convex.reconnect());
    expect(env.canvas?.inputLocked).toBe(true);
    expect(env.canvas?.initialTextureConfirmed).toBe(false);
    await deliver("a", scenes("x", "y"));
    expect(env.canvas?.inputLocked).toBe(false);
    expect(env.canvas?.initialTextureConfirmed).toBe(true);
    await act(async () => env.canvas!.onNavigate("y"));
    expect(shown()).toBe("y");
  });
  it("neither paints nor unlocks from a read that started before a reconnect", async () => {
    convex.cache("a", scenes("x", "y"));
    await render();
    await act(async () => convex.disconnect());
    // Archived meanwhile; the new connection's re-delivery is still on its way.
    await act(async () => convex.reconnect());
    await act(async () => env.reads[0].resolve(scenes("x", "y")));
    expect(shown()).toBe("");
    expect(env.canvas).toBeUndefined();
    await deliver("a", null);
    expect(viewer()?.dataset.sceneStatus).toBe("empty");
  });

  it("shows nothing when mounted offline until the reconnect delivery", async () => {
    convex.cache("a", scenes("x", "y"));
    convex.disconnect();
    await render();
    expect(env.reads).toEqual([]);
    expect(shown()).toBe("");
    expect(env.canvas).toBeUndefined();
    await act(async () => convex.reconnect());
    expect(shown()).toBe("");
    await deliver("a", scenes("x", "y"));
    expect(shown()).toBe("x");
    expect(live()).toBe("confirmed");
  });

  it("ignores the previous villa's read after a route change", async () => {
    convex.cache("a", scenes("x"));
    convex.cache("b", scenes("p"));
    await render(villa("a"));
    await render(villa("b"));
    expect(env.reads.map((read) => read.slug)).toEqual(["a", "b"]);
    await act(async () => env.reads[0].resolve(scenes("x")));
    expect(shown()).toBe("");
    await act(async () => env.reads[1].resolve(scenes("p")));
    expect(shown()).toBe("p");
  });
});
