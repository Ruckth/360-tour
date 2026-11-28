// @vitest-environment happy-dom
import type { Doc, Id } from "convex/_generated/dataModel";
import { getFunctionName, type FunctionReference } from "convex/server";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateAdminPropertySearch } from "@/start-app/admin/admin-route";

const state = vi.hoisted(() => ({
  properties: [] as Doc<"properties">[],
  propertyDetail: null as { property: Doc<"properties">; rooms: Doc<"tourScenes">[]; deleteBlocker: string | null; slugLocked: boolean } | null,
  tabParam: "" as unknown,
  push: vi.fn(),
  mutations: [] as [string, unknown][],
  mutationError: null as unknown,
  failNextCreateRoom: false,
  uploadUrl: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));
vi.mock("@/platform/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@/components/admin/RecordHistoryPanel", () => ({
  RecordHistoryPanel: () => null,
  ConfigurationHistoryRecords: () => null,
  HistoryDisclosure: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/admin/OtaRatesDialog", () => ({
  OtaRatesPanel: () => createElement("div", { "data-testid": "ota-panel" }, "OTA panel"),
}));
vi.mock("@/components/admin/IcalSourcesDialog", () => ({
  IcalSourcesPanel: () => createElement("div", { "data-testid": "ical-panel" }, "iCal panel"),
}));
vi.mock("@/components/admin/PropertyReviewsEditor", () => ({
  PropertyReviewsEditor: () => createElement("div", { "data-testid": "reviews-panel" }, "Reviews panel"),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => {
    const name = getFunctionName(ref);
    if (name === "catalog/properties:adminList") return state.properties;
    if (name === "catalog/adminProperties:get") return state.propertyDetail;
    return undefined;
  },
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    return async (args: unknown) => {
      state.mutations.push([name, args]);
      if (name === "catalog/adminProperties:createRoom" && state.failNextCreateRoom) {
        state.failNextCreateRoom = false;
        throw new Error("Temporary room save error");
      }
      if (state.mutationError) throw state.mutationError;
      if (name === "catalog/adminProperties:generateUploadUrl") return "https://upload.example.test/put";
      if (name === "catalog/adminProperties:saveUploadedImage") return { url: "https://cdn.example.test/pano.webp" };
      return "room-new";
    };
  },
}));

import { AdminPropertiesView } from "@/components/admin/AdminPropertiesView";
import { AdminPropertyEditor } from "@/components/admin/AdminPropertyEditor";
import { PropertyPhotosEditor } from "@/components/admin/PropertyPhotosEditor";
import { PropertyRoomsEditor } from "@/components/admin/PropertyRoomsEditor";

function makeProperty(overrides: Partial<Doc<"properties">> = {}): Doc<"properties"> {
  return {
    _id: "prop-1" as Id<"properties">,
    _creationTime: 1,
    slug: "sunset",
    name: "Villa Sunset",
    tagline: "",
    description: "",
    pricePerNight: 850000,
    currency: "THB",
    directDiscountPercent: 1000,
    maxGuests: 4,
    bedrooms: 2,
    bathrooms: 2,
    area: 120,
    amenities: [],
    images: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/pool.jpg"],
    tourRoomIds: [],
    status: "active",
    ...overrides,
  };
}

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
  state.properties = [];
  state.propertyDetail = { property: makeProperty(), rooms: [], deleteBlocker: null, slugLocked: false };
  state.tabParam = "";
  state.push.mockReset();
  state.mutations = [];
  state.mutationError = null;
  state.failNextCreateRoom = false;
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

describe("Villas index search & status composition (M30)", () => {
  it("filters by name or slug while keeping the selected status and restoring status on Clear search", async () => {
    state.properties = [
      ...Array.from({ length: 18 }, (_, i) =>
        makeProperty({
          _id: `prop-${i}` as Id<"properties">,
          name: `Villa Breeze ${i + 1}`,
          slug: `breeze-${i + 1}`,
          status: "active",
        }),
      ),
      makeProperty({ _id: "prop-sunset" as Id<"properties">, name: "Villa Sunset", slug: "sunset-ridge", status: "active" }),
      makeProperty({ _id: "prop-arch" as Id<"properties">, name: "Sunset Archive", slug: "sunset-old", status: "archived" }),
    ];

    await render(createElement(AdminPropertiesView));
    const search = host.querySelector<HTMLInputElement>("#villa-search")!;
    expect(host.textContent).toContain("20 villas");

    // Search by slug matches both active and archived when All is selected.
    await setInput(search, "/sunset-ridge");
    expect(host.textContent).toContain("1 villa");
    expect(host.textContent).toContain("Villa Sunset");
    expect(host.textContent).not.toContain("Villa Breeze 1");

    // Non-matching search shows Clear search and keeps status.
    await setInput(search, "does-not-exist");
    expect(host.textContent).toContain("0 villas");
    const clearBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear search")!;
    await act(async () => clearBtn.click());
    expect(search.value).toBe("");
    expect(host.textContent).toContain("20 villas");
  });
});

const renderEditor = () => render(createElement(AdminPropertyEditor, {
  propertyId: "prop-1",
  tab: validateAdminPropertySearch({ tab: state.tabParam }).tab,
}));

describe("Addressable villa editor sections & OTA-to-direct jump (M32, M33)", () => {
  it("M32: validates all 6 section tabs, falls back invalid values to Details, and drives tab state from URL", async () => {
    expect(validateAdminPropertySearch({ tab: "reviews", extra: "1" })).toEqual({ tab: "reviews", extra: "1" });
    expect(validateAdminPropertySearch({ tab: "calendar" })).toEqual({ tab: "calendar" });
    expect(validateAdminPropertySearch({ tab: "details" })).toEqual({});
    expect(validateAdminPropertySearch({ tab: "bogus" })).toEqual({});
    expect(validateAdminPropertySearch({ tab: ["reviews", "calendar"] })).toEqual({});

    state.tabParam = "reviews";
    await renderEditor();
    expect(host.querySelector('[data-testid="reviews-panel"]')).not.toBeNull();
    expect(host.querySelector('#villa-tab-reviews')?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('#villa-tab-reviews')?.getAttribute("href")).toBe("/admin/properties/prop-1?tab=reviews");
    expect(host.querySelector('#villa-tab-calendar')?.getAttribute("href")).toBe("/admin/properties/prop-1?tab=calendar");

    // Invalid tab opens Details.
    state.tabParam = "invalid-section";
    await renderEditor();
    expect(host.querySelector('#villa-tab-details')?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("#pr-price")).not.toBeNull();

    // Calendar sync writes a history entry, then the validated route selects the section.
    await act(async () => host.querySelector<HTMLAnchorElement>("#villa-tab-calendar")!.click());
    expect(state.push).toHaveBeenCalledWith("/admin/properties/prop-1?tab=calendar", { scroll: false });
    state.tabParam = "calendar";
    await renderEditor();
    expect(host.querySelector('[data-testid="ical-panel"]')).not.toBeNull();
    state.tabParam = ["reviews", "calendar"];
    await renderEditor();
    expect(host.querySelector('#villa-tab-details')?.getAttribute("aria-selected")).toBe("true");
  });

  it("M33: links from OTA rates to Details and focuses direct nightly price without resetting unsaved Details edits", async () => {
    await renderEditor();
    const nameInput = host.querySelector<HTMLInputElement>("#pr-name")!;
    await setInput(nameInput, "Unsaved Villa Title");

    // Go to Pricing & OTA.
    await act(async () => host.querySelector<HTMLAnchorElement>("#villa-tab-pricing")!.click());
    state.tabParam = "pricing";
    await renderEditor();
    const jumpLink = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((a) =>
      a.textContent?.includes("Edit direct price and discount"),
    )!;
    expect(jumpLink).not.toBeUndefined();

    await act(async () => jumpLink.click());
    state.tabParam = undefined;
    await renderEditor();
    expect(host.querySelector('#villa-tab-details')?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(host.querySelector("#pr-price"));
    expect(nameInput.value).toBe("Unsaved Villa Title");
    expect(state.mutations).toEqual([]);
  });
});

describe("Gallery cover one-step reorder (M35)", () => {
  it("moves photo 5 to cover in one save while preserving relative order of the remaining photos", async () => {
    const property = makeProperty({ images: ["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg", "/5.jpg"] });
    await render(createElement(PropertyPhotosEditor, { property }));

    // Cover photo (1) has no Make cover button; photo 5 has Make photo 5 cover.
    expect(host.querySelector('button[aria-label="Make photo 1 cover"]')).toBeNull();
    const makeCover5 = host.querySelector<HTMLButtonElement>('button[aria-label="Make photo 5 cover"]')!;
    expect(makeCover5).not.toBeNull();

    await act(async () => makeCover5.click());
    expect(state.mutations).toEqual([
      [
        "catalog/properties:update",
        { propertyId: "prop-1", images: ["/5.jpg", "/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg"] },
      ],
    ]);
  });
});

describe("Room panorama file-to-URL switch & upload retry (M36)", () => {
  it("clears selected file to re-enable URL entry while keeping room name and preserves cached-upload retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ storageId: "st-1" }), { status: 200 })));
    await render(createElement(PropertyRoomsEditor, { propertyId: "prop-1" as Id<"properties">, rooms: [] }));

    const nameInput = host.querySelector<HTMLInputElement>("#new-room-name")!;
    const fileInput = host.querySelector<HTMLInputElement>("#new-room-file")!;
    const urlInput = host.querySelector<HTMLInputElement>("#new-room-url")!;

    await setInput(nameInput, "Pool Deck");
    const file = new File(["img"], "pool-360.webp", { type: "image/webp" });
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    expect(urlInput.disabled).toBe(true);
    expect(host.textContent).toContain("Selected file: pool-360.webp");
    expect(host.textContent).toContain("Upload mode");

    // Removing the selected file re-enables URL entry and keeps the room name intact.
    const removeFileBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Remove selected file"),
    )!;
    await act(async () => removeFileBtn.click());

    expect(urlInput.disabled).toBe(false);
    expect(nameInput.value).toBe("Pool Deck");
    expect(host.textContent).toContain("Selected file removed. Panorama URL input is enabled.");
    expect(host.textContent).not.toContain("Selected file: pool-360.webp");

    // A delayed image check for the removed file must not reintroduce its warning.
    const bitmapReady = Promise.withResolvers<{ width: number; height: number; close: () => void }>();
    vi.stubGlobal("createImageBitmap", vi.fn(() => bitmapReady.promise));
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const removeAgain = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Remove selected file"),
    )!;
    await act(async () => removeAgain.click());
    await act(async () => bitmapReady.resolve({ width: 100, height: 100, close: vi.fn() }));
    expect(host.textContent).not.toContain("not 2:1");

    // Re-pick file and fail createRoom once: retry reuses cached upload without re-uploading.
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    state.failNextCreateRoom = true;
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain("Temporary room save error");

    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.mutations.filter(([m]) => m === "catalog/adminProperties:generateUploadUrl")).toHaveLength(1);
    expect(state.mutations.filter(([m]) => m === "catalog/adminProperties:createRoom")).toHaveLength(2);
  });
});
