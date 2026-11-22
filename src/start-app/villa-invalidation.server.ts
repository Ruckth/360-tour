import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "convex/shared/slug";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function validSlugs(value: unknown): value is { slugs: string[] } {
  if (!value || typeof value !== "object" || !("slugs" in value) || !Array.isArray(value.slugs)) return false;
  return value.slugs.length >= 1 && value.slugs.length <= 2 && value.slugs.every((slug) =>
    typeof slug === "string" && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug));
}

export async function handleVillaInvalidation(
  request: Request,
  secret: string | undefined,
  expire: (slug: string) => Promise<{ status: "confirmed" | "unconfirmed" | "local" }>,
) {
  const respond = (status: number, headers: Record<string, string> = {}) => new Response(null, {
    status, headers: { "Cache-Control": "no-store", ...headers },
  });
  if (!secret || !/^[A-Za-z0-9_-]{32,}$/.test(secret)) return respond(404);
  const header = request.headers.get("authorization");
  if (!header || !timingSafeEqual(digest(header), digest("Bearer " + secret))) return respond(401);
  if (request.headers.get("content-type") !== "application/json") return respond(415);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400);
  }
  if (!validSlugs(payload)) return respond(400);
  let local = false;
  for (const slug of new Set(payload.slugs)) {
    const { status } = await expire(slug);
    // Never acknowledge an edit the shared cache did not confirm; the caller retries.
    if (status === "unconfirmed") return respond(503, { "Retry-After": "1" });
    local ||= status === "local";
  }
  return respond(204, local ? { "X-Villa-Cache-Scope": "process" } : {});
}
