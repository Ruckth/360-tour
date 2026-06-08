import { createHmac, timingSafeEqual } from "node:crypto";

export function createLineSignature(body: string, channelSecret: string) {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}

export function verifyLineSignature({
  body,
  channelSecret,
  signature,
}: {
  body: string;
  channelSecret?: string;
  signature?: string | null;
}) {
  if (!channelSecret || !signature) return false;

  const expected = Buffer.from(createLineSignature(body, channelSecret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
