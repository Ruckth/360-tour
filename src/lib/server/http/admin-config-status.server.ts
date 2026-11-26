import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";

/** Which channel env vars are set on this (Vercel) deployment. Booleans only; admins only. */
export async function readChannelConfig(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    return Response.json({ error: "Admin sign-in is required" }, { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json({ error: "Convex is not configured" }, { status: 503 });
  }

  // Same check as the admin reply route: Convex validates the Clerk token and staff access.
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  try {
    const facts = await client.query(api.settings.settings.setupChecklist, {});
    return Response.json({ channels: facts.channelConfig }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

}
