import { createFileRoute } from "@tanstack/react-router";
import { robotsDocument } from "@/lib/server/search-index";

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: {
    GET: () => {
      const { rules, sitemap } = robotsDocument();
      const lines = [`User-Agent: ${rules.userAgent}`, `Allow: ${rules.allow}`, ...rules.disallow.map(path => `Disallow: ${path}`), "", `Sitemap: ${sitemap}`, ""];
      return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
    },
  } },
});
