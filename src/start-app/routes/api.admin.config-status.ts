import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/config-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readChannelConfig } = await import("@/lib/server/http/admin-config-status.server");
        return readChannelConfig(request);
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { Allow: "GET, HEAD, OPTIONS" } }),
      ANY: () => new Response(null, { status: 405 }),
    },
  },
});
