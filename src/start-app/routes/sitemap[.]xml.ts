import { createFileRoute } from "@tanstack/react-router";
import { sitemapEntries } from "@/lib/server/search-index";

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: {
    GET: async () => {
      const { getStartVillaSlugs } = await import("../villas.server");
      const entries = sitemapEntries(await getStartVillaSlugs());
      const items = entries.map(({ url, changeFrequency, priority }) =>
        `<url><loc>${url.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</loc><changefreq>${changeFrequency}</changefreq><priority>${priority}</priority></url>`);
      const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...items, "</urlset>"].join("\n");
      return new Response(xml, { headers: { "content-type": "application/xml", "cache-control": "public, s-maxage=60" } });
    },
  } },
});
