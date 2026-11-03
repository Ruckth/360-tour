// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServicesPage from "@/app/services/page";
import ChatPage from "@/app/chat/page";
import { getServiceCatalog, getPublicService } from "@/lib/server/services";
import { getPublicMessages } from "@/lib/i18n/server-content";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl/server", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/server/services", () => ({
  getServiceCatalog: vi.fn(),
  getPublicService: vi.fn(),
}));
vi.mock("@/components/chat/AIChatWidget", () => ({ AIChatPage: () => null }));

const service = {
  slug: "thai massage",
  name: "Thai Massage",
  category: "Spa & Wellness",
  description: "A traditional massage",
  price: 2400,
  currency: "THB",
  durationMin: 60,
};
async function render(params: Record<string, string> = {}) {
  document.body.innerHTML = renderToStaticMarkup(
    await ServicesPage({ searchParams: Promise.resolve(params) }),
  );
}
function link(label: string) {
  return [...document.querySelectorAll("a")].find(
    (a) => a.textContent === label,
  )!;
}
beforeEach(() => {
  state.locale = "en";
  vi.clearAllMocks();
  vi.mocked(getServiceCatalog).mockResolvedValue([
    {
      categories: [{ name: "Spa & Wellness" }, { name: "Dining" }],
      nextCategory: "Spa & Wellness",
    },
    { page: [service], continueCursor: "next+cursor", isDone: false },
  ]);
});

describe("public service catalog", () => {
  it("renders service facts and keeps language/search/category across pagination", async () => {
    state.locale = "th";
    const t = getPublicMessages("th").ServiceCatalog;
    await render({ category: service.category, q: "Massage", cursor: "old" });
    expect(document.querySelector("article")?.textContent).toContain(
      "THB 2,400",
    );
    expect(document.querySelector("article")?.textContent).toContain("60");
    expect(document.querySelector("form")?.getAttribute("action")).toBe(
      "/th/services",
    );
    expect(
      document.querySelector<HTMLInputElement>("input[name=category]")?.value,
    ).toBe(service.category);
    expect(link(t.ask).getAttribute("href")).toBe(
      "/th/chat?service=thai%20massage",
    );
    const next = new URL(link(t.next).href);
    expect(next.pathname).toBe("/th/services");
    expect(next.searchParams.get("q")).toBe("Massage");
    expect(next.searchParams.get("category")).toBe(service.category);
    expect(next.searchParams.get("cursor")).toBe("next+cursor");
    const dining = new URL(link("Dining").href);
    expect(dining.searchParams.get("category")).toBe("Dining");
    expect(dining.searchParams.get("q")).toBe("Massage");
    expect(dining.searchParams.has("cursor")).toBe(false);
    expect(
      new URL(link(t.moreCategories).href).searchParams.get("categoryAfter"),
    ).toBe(service.category);
  });

  it("distinguishes an empty search from an unavailable backend without fabricated services", async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([null, null]);
    await render();
    expect(document.querySelector("[role=status]")?.textContent).toBe(
      getPublicMessages("en").ServiceCatalog.unavailable,
    );
    expect(document.querySelectorAll("article")).toHaveLength(0);
    vi.mocked(getServiceCatalog).mockResolvedValue([
      { categories: [], nextCategory: null },
      { page: [], continueCursor: "", isDone: true },
    ]);
    await render({ q: "missing" });
    expect(document.querySelector("[role=status]")?.textContent).toBe(
      getPublicMessages("en").ServiceCatalog.empty,
    );
    expect(link(getPublicMessages("en").ServiceCatalog.next)).toBeUndefined();
  });

  it("ignores repeated query parameters and bounds user search input", async () => {
    await ServicesPage({
      searchParams: Promise.resolve({
        category: ["a", "b"],
        q: "x".repeat(200),
      }),
    });
    expect(getServiceCatalog).toHaveBeenCalledWith({
      category: undefined,
      query: "x".repeat(100),
      cursor: undefined,
      categoryAfter: undefined,
    });
  });
});

describe("catalog to chat", () => {
  it("prefills only the verified active service in the guest language", async () => {
    state.locale = "th";
    vi.mocked(getPublicService).mockResolvedValue(service);
    const element = await ChatPage({
      searchParams: Promise.resolve({ service: service.slug }),
    });
    expect(getPublicService).toHaveBeenCalledWith(service.slug);
    expect(element.props.initialDraft).toBe(
      getPublicMessages("th").ServiceCatalog.draft.replace(
        "{name}",
        service.name,
      ),
    );
    expect(element.key).toBe(service.slug);
  });

  it("opens ordinary chat for a missing or archived service", async () => {
    vi.mocked(getPublicService).mockResolvedValue(null);
    const element = await ChatPage({
      searchParams: Promise.resolve({ service: "archived" }),
    });
    expect(element.props.initialDraft).toBeUndefined();
  });
});
