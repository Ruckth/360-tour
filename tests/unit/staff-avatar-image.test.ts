import { describe, expect, it, vi } from "vitest";
import { MAX_AVATAR_BYTES, avatarUploadProblem } from "convex/lib/imageUploads";
import { AVATAR_MAX_SOURCE_BYTES, avatarSourceProblem, avatarTargetSize, encodeAvatar } from "@/lib/staff-avatar-image";

const blob = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

describe("avatarTargetSize", () => {
  it("caps the longest edge at 768 and keeps the aspect ratio", () => {
    expect(avatarTargetSize(4032, 3024)).toEqual({ width: 768, height: 576 });
    expect(avatarTargetSize(3024, 4032)).toEqual({ width: 576, height: 768 });
    expect(avatarTargetSize(2000, 2000)).toEqual({ width: 768, height: 768 });
    expect(avatarTargetSize(1000, 333)).toEqual({ width: 768, height: 256 });
  });

  it("never upscales", () => {
    expect(avatarTargetSize(768, 500)).toEqual({ width: 768, height: 500 });
    expect(avatarTargetSize(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("keeps extreme shapes at least one pixel wide", () => {
    expect(avatarTargetSize(10000, 2)).toEqual({ width: 768, height: 1 });
  });
});

describe("avatarSourceProblem", () => {
  it("accepts JPEG, PNG and WebP and refuses everything else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(avatarSourceProblem(type, 5_000_000)).toBeNull();
    for (const type of ["image/heic", "image/gif", "application/pdf", ""]) expect(avatarSourceProblem(type, 1000)).toMatch(/JPEG, PNG or WebP/);
  });

  it("refuses oversized sources", () => {
    expect(avatarSourceProblem("image/jpeg", AVATAR_MAX_SOURCE_BYTES)).toBeNull();
    expect(avatarSourceProblem("image/jpeg", AVATAR_MAX_SOURCE_BYTES + 1)).toMatch(/under 30 MB/);
  });
});

describe("encodeAvatar", () => {
  it("uses WebP at quality 0.75 when that fits", async () => {
    const encode = vi.fn(async (type: string) => blob(type, 90_000));
    const result = await encodeAvatar(encode);
    expect(result.type).toBe("image/webp");
    expect(encode.mock.calls).toEqual([["image/webp", 0.75]]);
    expect(avatarUploadProblem(result.type, result.size)).toBeNull();
  });

  it("lowers the quality until the result is under the hard maximum", async () => {
    const encode = vi.fn(async (type: string, quality: number) => blob(type, quality > 0.5 ? MAX_AVATAR_BYTES + 1 : MAX_AVATAR_BYTES));
    const result = await encodeAvatar(encode);
    expect(result.size).toBe(MAX_AVATAR_BYTES);
    expect(encode.mock.calls.map(([, quality]) => quality)).toEqual([0.75, 0.6, 0.45]);
  });

  it("falls back to JPEG when the browser can't encode WebP", async () => {
    // Safari answers a WebP request with PNG.
    const encode = vi.fn(async (type: string) => blob(type === "image/webp" ? "image/png" : type, 120_000));
    const result = await encodeAvatar(encode);
    expect(result.type).toBe("image/jpeg");
    expect(encode.mock.calls).toEqual([["image/webp", 0.75], ["image/jpeg", 0.75]]);
  });

  it("fails clearly when nothing fits or nothing encodes", async () => {
    await expect(encodeAvatar(async (type) => blob(type, MAX_AVATAR_BYTES + 1))).rejects.toThrow("too detailed");
    await expect(encodeAvatar(async () => null)).rejects.toThrow("could not optimize");
  });
});
