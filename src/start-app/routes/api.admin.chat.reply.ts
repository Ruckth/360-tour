import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/chat/reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { sendAdminReply } = await import("@/lib/server/http/admin-chat-reply.server");
        return sendAdminReply(request);
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { Allow: "OPTIONS, POST" } }),
      ANY: () => new Response(null, { status: 405 }),
    },
  },
});
