// @vitest-environment happy-dom
import type { Doc, Id } from "convex/_generated/dataModel";
import { getFunctionName, type FunctionReference } from "convex/server";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  otaRates: [] as Doc<"otaRates">[],
  icalSources: [] as Doc<"icalSources">[],
  icalToken: "tok_abc123" as string | null,
  reviewsData: {
    reviews: [] as Doc<"reviews">[],
    summary: null as { overallRating: number; totalReviews: number } | null,
  },
  mutations: [] as [string, unknown][],
  confirm: vi.fn(),
  failUploadNames: new Set<string>(),
  uploadedFileNames: [] as string[],
}));

vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => {
    const name = getFunctionName(ref);
    if (name === "catalog/properties:listOtaRates") return state.otaRates;
    if (name === "bookings/calendar/ical:listSources") return state.icalSources;
    if (name === "bookings/calendar/ical:getExportToken") return state.icalToken;
    if (name === "catalog/adminReviews:list") return state.reviewsData;
    return undefined;
  },
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    return async (args: unknown) => {
      state.mutations.push([name, args]);
      if (name === "catalog/adminProperties:generateUploadUrl") return "https://upload.example.test/put";
      if (name === "catalog/adminProperties:saveUploadedImage") {
        const storageId = (args as { storageId: string }).storageId;
        return { url: `https://cdn.example.test/${storageId}` };
      }
      return "ok";
    };
  },
  useAction: () => vi.fn(),
}));

import { IcalSourcesPanel } from "@/components/admin/IcalSourcesDialog";
import { OtaRatesPanel } from "@/components/admin/OtaRatesDialog";
import { PropertyReviewsEditor } from "@/components/admin/PropertyReviewsEditor";

let root: Root;
let host: HTMLDivElement;

const render = (node: ReactNode) => act(async () => root.render(node));
const setInput = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://resort.convex.site");
  state.otaRates = [
    {
      _id: "rate-agoda" as Id<"otaRates">,
      _creationTime: 1,
      propertyId: "prop-1" as Id<"properties">,
      platform: "agoda",
      nightlyRate: 499000,
      url: "https://www.agoda.com/villa",
      updatedAt: Date.now(),
    },
  ];
  state.icalSources = [];
  state.icalToken = "tok_abc123";
  state.reviewsData = {
    reviews: [
      {
        _id: "rev-1" as Id<"reviews">,
        _creationTime: 1,
        propertyId: "prop-1" as Id<"properties">,
        authorName: "Suda",
        authorAvatarUrl: "",
        authorCity: "Bangkok",
        authorCountry: "Thailand",
        rating: 5,
        title: "Wonderful",
        body: "Loved the pool.",
        date: "2026-11-10",
        verified: true,
        photos: [],
      },
    ],
    summary: { overallRating: 5, totalReviews: 1 },
  };
  state.mutations = [];
  state.confirm.mockReset().mockResolvedValue(true);
  state.failUploadNames.clear();
  state.uploadedFileNames = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OTA row edit focus & form target heading (M37)", () => {
  it("focuses the nightly price input and names Agoda when activating row Edit, then updates Agoda on save", async () => {
    await render(createElement(OtaRatesPanel, { propertyId: "prop-1" as Id<"properties"> }));
    const editBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Edit")!;
    await act(async () => editBtn.click());

    const rateInput = host.querySelector<HTMLInputElement>("#ota-rate")!;
    expect(host.querySelector("#ota-form-heading")?.textContent).toBe("Edit Agoda rate");
    expect(rateInput.value).toBe("4990");
    expect(document.activeElement).toBe(rateInput);
    expect(host.querySelector<HTMLInputElement>("#ota-url")?.value).toBe("https://www.agoda.com/villa");

    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.mutations).toEqual([
      [
        "catalog/properties:upsertOtaRate",
        {
          propertyId: "prop-1",
          platform: "agoda",
          nightlyRate: 499000,
          urlChange: { kind: "preserve" },
        },
      ],
    ]);
  });

  it("keeps a dirty platform draft when the staff member cancels row Edit", async () => {
    await render(createElement(OtaRatesPanel, { propertyId: "prop-1" as Id<"properties"> }));
    const rate = host.querySelector<HTMLInputElement>("#ota-rate")!;
    await setInput(rate, "6400");
    state.confirm.mockResolvedValueOnce(false);
    const edit = [...host.querySelectorAll("button")].find(button => button.textContent === "Edit")!;
    await act(async () => { edit.focus(); edit.click(); });
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(edit);
    expect(rate.value).toBe("6400");
    expect(host.querySelector("#ota-form-heading")?.textContent).toContain("Booking.com");
  });
});

describe("iCal private export copy without rotation (M38)", () => {
  it("copies the exact private export URL with status feedback and zero rotation mutations, keeping rotation confirmed", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await render(createElement(IcalSourcesPanel, { propertyId: "prop-1" as Id<"properties"> }));
    const copyBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Copy feed URL")!;
    expect(copyBtn).not.toBeUndefined();

    await act(async () => copyBtn.click());
    expect(writeText).toHaveBeenCalledWith("https://resort.convex.site/ical/export?token=tok_abc123");
    expect(host.textContent).toContain("Copied");
    expect(state.mutations).toEqual([]);

    // Rotation lives behind Manage feed URL and still requires confirmation.
    const manageDetails = host.querySelector("details")!;
    expect(manageDetails.open).toBe(false);
    expect(manageDetails.querySelector("summary")?.textContent?.trim()).toBe("Manage feed URL");

    state.confirm.mockResolvedValueOnce(false);
    const rotateBtn = [...manageDetails.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Rotate export URL"),
    )!;
    await act(async () => rotateBtn.click());
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Rotate the export URL?" }));
    expect(state.mutations).toEqual([]);
  });
});

describe("Review verified default & partial photo batch recovery (M39, M40)", () => {
  it("M39: defaults new reviews to verified=false while preserving verified=true when editing an existing verified review", async () => {
    await render(createElement(PropertyReviewsEditor, { propertyId: "prop-1" as Id<"properties"> }));

    // New review defaults to unchecked and persists verified=false.
    const addBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add review"))!;
    await act(async () => addBtn.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    expect(dialog.textContent).toContain("Mark this when the stay has been verified.");

    await setInput(dialog.querySelector<HTMLInputElement>("#rv-name")!, "Alex");
    await setInput(dialog.querySelector<HTMLTextAreaElement>("#rv-body")!, "Great stay!");
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.mutations).toContainEqual([
      "catalog/adminReviews:create",
      expect.objectContaining({ propertyId: "prop-1", authorName: "Alex", verified: false }),
    ]);

    // Existing verified review loads checked=true and persists verified=true.
    state.mutations = [];
    const editBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Edit Suda\'s review"]')!;
    await act(async () => editBtn.click());
    const editDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(editDialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    await act(async () => editDialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.mutations).toContainEqual([
      "catalog/adminReviews:update",
      expect.objectContaining({ reviewId: "rev-1", verified: true }),
    ]);
  });

  it("M40: resumes at failed file 2 of 3 on retry without re-uploading file 1 or losing review text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const file = init?.body as File;
        state.uploadedFileNames.push(file.name);
        if (state.failUploadNames.has(file.name)) {
          return new Response("err", { status: 500 });
        }
        return new Response(JSON.stringify({ storageId: file.name }), { status: 200 });
      }),
    );

    await render(createElement(PropertyReviewsEditor, { propertyId: "prop-1" as Id<"properties"> }));
    const addBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add review"))!;
    await act(async () => addBtn.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const nameInput = dialog.querySelector<HTMLInputElement>("#rv-name")!;
    const bodyInput = dialog.querySelector<HTMLTextAreaElement>("#rv-body")!;
    await setInput(nameInput, "Mina");
    await setInput(bodyInput, "Sunset view was unforgettable.");

    const file1 = new File(["1"], "pool.webp", { type: "image/webp" });
    const file2 = new File(["2"], "sunset.webp", { type: "image/webp" });
    const file3 = new File(["3"], "deck.webp", { type: "image/webp" });
    state.failUploadNames.add("sunset.webp");

    const fileInput = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", { value: [file1, file2, file3], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    expect(state.uploadedFileNames).toEqual(["pool.webp", "sunset.webp"]);
    expect(dialog.textContent).toContain("1 of 3 uploaded (pool.webp)");
    expect(dialog.textContent).toContain("sunset.webp failed.");
    expect(dialog.textContent).toContain("Waiting: deck.webp.");
    expect(nameInput.value).toBe("Mina");
    expect(bodyInput.value).toBe("Sunset view was unforgettable.");

    // Retry resumes from file 2 without re-uploading file 1.
    state.failUploadNames.clear();
    const retryBtn = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Retry remaining 2 photos"),
    )!;
    await act(async () => retryBtn.click());

    expect(state.uploadedFileNames).toEqual(["pool.webp", "sunset.webp", "sunset.webp", "deck.webp"]);
    expect(dialog.textContent).not.toContain("Retry remaining");
    expect(nameInput.value).toBe("Mina");
    expect(bodyInput.value).toBe("Sunset view was unforgettable.");

    // Submitting saves all 3 unique uploaded URLs.
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(state.mutations).toContainEqual([
      "catalog/adminReviews:create",
      expect.objectContaining({
        authorName: "Mina",
        body: "Sunset view was unforgettable.",
        photos: [
          "https://cdn.example.test/pool.webp",
          "https://cdn.example.test/sunset.webp",
          "https://cdn.example.test/deck.webp",
        ],
      }),
    ]);
  });
});
