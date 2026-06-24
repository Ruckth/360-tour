import { createHmac, timingSafeEqual } from "node:crypto";

const META_SIGNATURE_PREFIX = "sha256=";

export function createMetaSignature(body: string, appSecret: string) {
  return `${META_SIGNATURE_PREFIX}${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

export function verifyMetaSignature({
  appSecret,
  body,
  signature,
}: {
  appSecret?: string;
  body: string;
  signature?: string | null;
}) {
  if (!appSecret || !signature?.startsWith(META_SIGNATURE_PREFIX)) return false;

  const providedHex = signature.slice(META_SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;

  const expected = Buffer.from(createMetaSignature(body, appSecret).slice(META_SIGNATURE_PREFIX.length), "hex");
  const actual = Buffer.from(providedHex, "hex");
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
