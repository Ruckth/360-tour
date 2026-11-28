// @vitest-environment happy-dom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExperiencesView } from "@/components/experiences/ExperiencesView";
import { ServicesView, type ServiceResults } from "@/components/services/ServicesView";
import { getPublicMessages } from "@/lib/i18n/server-content";

vi.mock("@/platform/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));
vi.mock("@/platform/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));

const th = getPublicMessages("th");

describe("shared guest views", () => {
  it("renders localized experiences with locale-prefixed navigation", () => {
    const html = renderToStaticMarkup(React.createElement(ExperiencesView, { locale: "th", publicMessages: th }));
    expect(html).toContain(th.Experiences.title);
    expect(html).toContain('href="/th/booking"');
    expect(html).toContain('href="/th/services"');
    // G21: both Contact Concierge actions open localized chat directly, not the Home contact anchor.
    expect(html).not.toContain("#contact");
    const chatLinks = [...html.matchAll(/<a[^>]*href="\/th\/chat"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(chatLinks).toEqual([th.Experiences.secondaryCta, th.Experiences.secondaryCta]);
    expect(html).toContain(th.ServiceCatalog.all);
  });

  it("renders the service catalog's unavailable, empty and paged states", () => {
    const render = (result: ServiceResults, query = {}) => renderToStaticMarkup(React.createElement(ServicesView, {
      locale: "th", t: th.ServiceCatalog, query, directory: { categories: [{ name: "Spa" }], nextCategory: null } as never, result,
    }));
    expect(render(null)).toContain(th.ServiceCatalog.unavailable);
    expect(render({ page: [], isDone: true, continueCursor: "" } as never)).toContain(th.ServiceCatalog.empty);

    const html = render({
      page: [{ slug: "thai-massage", name: "Thai massage", category: "Spa", description: "Ninety minutes", durationMin: 90, price: 150000, currency: "THB" }],
      isDone: false,
      continueCursor: "next-1",
    } as never, { category: "Spa", query: "massage", cursor: "c0" });
    expect(html).toContain("Thai massage");
    expect(html).toContain('href="/th/chat?service=thai-massage"');
    expect(html).toContain('href="/th/services?category=Spa&amp;q=massage&amp;cursor=next-1"');
    expect(html).toContain('href="/th/services?category=Spa&amp;q=massage"');
    expect(html).toContain('action="/th/services"');
    expect(html).toContain('aria-current="page"');
  });
});
