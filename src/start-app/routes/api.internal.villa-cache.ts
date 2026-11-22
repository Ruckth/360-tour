import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/internal/villa-cache")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleVillaInvalidation } = await import("../villa-invalidation.server");
        const { expireStartVillaCache } = await import("../villas.server");
        return handleVillaInvalidation(request, process.env.START_VILLA_INVALIDATION_SECRET, expireStartVillaCache);
      },
    },
  },
});
