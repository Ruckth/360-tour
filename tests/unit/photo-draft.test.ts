// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import { usePhotoDraft } from "@/components/admin/usePhotoDraft";

const uploads = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }));
vi.mock("convex/react", () => ({
  useAction: () => uploads.upload,
  useMutation: () => uploads.discard,
}));

let root: Root;
let draft: ReturnType<typeof usePhotoDraft>;
const storageId = "uploaded-photo" as Id<"_storage">;
function Harness({ originalUrl }: { originalUrl?: string }) {
  const current = usePhotoDraft(originalUrl);
  useEffect(() => { draft = current; });
  return null;
}
async function render(originalUrl?: string) {
  await act(async () => root.render(createElement(Harness, { originalUrl })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  uploads.upload.mockReset().mockResolvedValue(storageId);
  uploads.discard.mockReset().mockResolvedValue(null);
  const node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("photo drafts", () => {
  it("keeps edits local, releases replaced previews, and uploads nothing on cancel", async () => {
    await render("https://example.com/original.jpg");
    expect(draft.url).toBe("https://example.com/original.jpg");
    await act(async () => draft.choose(new Blob(["first"], { type: "image/webp" })));
    expect(draft.url).toBe("blob:first");
    expect(draft.changed).toBe(true);
    await act(async () => draft.choose(new Blob(["second"], { type: "image/webp" })));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    await act(async () => root.render(null));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it("preserves unchanged photos and explicitly removes one on save", async () => {
    await render("https://example.com/original.jpg");
    const persist = vi.fn().mockResolvedValue("staff-id");
    await act(async () => { await draft.save(persist); });
    expect(persist).toHaveBeenLastCalledWith(undefined);
    await act(async () => draft.remove());
    expect(draft.url).toBeUndefined();
    expect(draft.removing).toBe(true);
    await act(async () => { await draft.save(persist); });
    expect(persist).toHaveBeenLastCalledWith(null);
    expect(draft.changed).toBe(false);
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it("does not reupload when retrying a later step after a successful profile save", async () => {
    await render();
    await act(async () => draft.choose(new Blob(["photo"], { type: "image/webp" })));
    const persist = vi.fn().mockResolvedValue("staff-id");
    await act(async () => { expect(await draft.save(persist)).toBe("staff-id"); });
    expect(persist).toHaveBeenLastCalledWith(storageId);
    expect(draft.changed).toBe(false);
    expect(draft.url).toBe("blob:first");
    await act(async () => { await draft.save(persist); });
    expect(persist).toHaveBeenLastCalledWith(undefined);
    expect(uploads.upload).toHaveBeenCalledTimes(1);
    // A photo saved while creating a staff member can still be removed on retry.
    await act(async () => draft.remove());
    await act(async () => { await draft.save(persist); });
    expect(persist).toHaveBeenLastCalledWith(null);
  });

  it("discards a failed upload, preserves the draft, and retries with a fresh upload", async () => {
    await render();
    await act(async () => draft.choose(new Blob(["photo"], { type: "image/webp" })));
    const failure = new Error("Profile validation failed");
    const persist = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue("service-id");
    uploads.discard.mockRejectedValueOnce(new Error("Cleanup unavailable"));
    await act(async () => { await expect(draft.save(persist)).rejects.toBe(failure); });
    expect(uploads.discard).toHaveBeenCalledWith({ storageId });
    expect(draft.changed).toBe(true);
    expect(draft.url).toBe("blob:first");
    await act(async () => { await draft.save(persist); });
    expect(uploads.upload).toHaveBeenCalledTimes(2);
    expect(draft.changed).toBe(false);
  });
});
