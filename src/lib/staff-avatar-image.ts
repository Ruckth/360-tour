import { AVATAR_UPLOAD_TYPES, IMAGE_TYPES, MAX_AVATAR_BYTES } from "convex/lib/imageUploads";

export const AVATAR_MAX_EDGE = 768;
/** Phone photos are well under this; anything bigger is refused before decoding. */
export const AVATAR_MAX_SOURCE_BYTES = 30 * 1024 * 1024;
/** Tried in order until the result fits `MAX_AVATAR_BYTES`. */
const QUALITIES = [0.75, 0.6, 0.45];

/** Scales so the longest edge is at most `maxEdge`, keeping the aspect ratio and never upscaling. */
export function avatarTargetSize(width: number, height: number, maxEdge = AVATAR_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Why the chosen file can't be used, or null when it's fine. */
export function avatarSourceProblem(type: string, size: number): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return "Choose a JPEG, PNG or WebP image.";
  if (size > AVATAR_MAX_SOURCE_BYTES) return `Choose an image under ${AVATAR_MAX_SOURCE_BYTES / 1024 / 1024} MB.`;
  return null;
}

type Encode = (type: (typeof AVATAR_UPLOAD_TYPES)[number], quality: number) => Promise<Blob | null>;

/**
 * WebP at falling quality until it fits; JPEG where the browser can't encode WebP
 * (it then returns PNG or nothing). Throws a readable error when nothing fits.
 */
export async function encodeAvatar(encode: Encode, maxBytes = MAX_AVATAR_BYTES): Promise<Blob> {
  let encoded = false;
  for (const type of AVATAR_UPLOAD_TYPES) {
    for (const quality of QUALITIES) {
      const blob = await encode(type, quality);
      if (blob?.type !== type) break;
      encoded = true;
      if (blob.size <= maxBytes) return blob;
    }
    if (encoded) break;
  }
  throw new Error(encoded ? "This photo is too detailed to optimize. Try a different one." : "This browser could not optimize the photo. Try a different browser.");
}

/** Decodes a JPEG/PNG/WebP, applies its EXIF rotation, and returns a small WebP (or JPEG) for upload. */
export async function optimizeAvatar(file: Blob): Promise<Blob> {
  const problem = avatarSourceProblem(file.type, file.size);
  if (problem) throw new Error(problem);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("Could not read this image. It may be damaged; try a different one.");
  const canvas = document.createElement("canvas");
  try {
    Object.assign(canvas, avatarTargetSize(bitmap.width, bitmap.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not optimize the photo. Try a different browser.");
    context.imageSmoothingQuality = "high";
    return await encodeAvatar((type, quality) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (type === "image/jpeg") {
        // JPEG has no transparency: without this, transparent areas turn black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    });
  } finally {
    bitmap.close();
    // Releases the canvas backing store right away instead of waiting for GC.
    canvas.width = canvas.height = 0;
  }
}
