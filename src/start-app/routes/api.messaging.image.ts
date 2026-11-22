import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/messaging/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { serveMessagingImage } = await import("@/lib/server/http/messaging-image.server");
        return serveMessagingImage(request);
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { Allow: "GET, HEAD, OPTIONS" } }),
      ANY: () => new Response(null, { status: 405 }),
    },
  },
});
