// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuestChatPage } from "@/components/chat/GuestChatPage";
import { ServicesView } from "@/components/services/ServicesView";
import type { Locale } from "@/i18n/routing";
import { getServiceCatalog, getPublicService } from "@/lib/server/services";
import { getPublicMessages } from "@/lib/i18n/server-content";
import type { PageSearch } from "@/lib/page-search";
import { servicesQuery } from "@/lib/services-query";
import { chatQuery, guestSearch, loadStartChatData, validateServicesInput } from "@/start-app/guest/guest-route";

const state = vi.hoisted(() => ({ locale: "en" as Locale }));
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
  price: 240000,
  currency: "THB",
  durationMin: 60,
  options: [{ durationMin: 60, price: 240000 }],
};
/** The Start /services route: search validation, loader deps, server-function input, then the view. */
async function ServicesPage({ searchParams }: { searchParams: Promise<PageSearch> }) {
  const query = servicesQuery(guestSearch(await searchParams));
  const [directory, result] = await getServiceCatalog(validateServicesInput(query));
  const t = getPublicMessages(state.locale).ServiceCatalog;
  return createElement(ServicesView, { locale: state.locale, t, query, directory, result });
}
async function render(params: Record<string, string> = {}) {
  document.body.innerHTML = renderToStaticMarkup(
    await ServicesPage({ searchParams: Promise.resolve(params) }),
  );
}
/** The Start /chat route renders the shared `GuestChatPage`; unwrap it to the `AIChatPage` element. */
async function chatElement(params: Record<string, string>) {
  const { service, property } = await loadStartChatData(
    { locale: state.locale, ...chatQuery(guestSearch(params)) },
    { getPublicService, getVilla: async () => ({ page: null }) },
  );
  const { draft: draftTemplate, minutes: minutesLabel } = getPublicMessages(state.locale).ServiceCatalog;
  const page = createElement(GuestChatPage, { service, property, draftTemplate, minutesLabel });
  return (page.type as (props: typeof page.props) => ReactElement<{ initialDraft?: string }>)(page.props);
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

const thai = {
  ...service,
  slug: "thai-massage",
  durationMin: 60,
  price: 80000,
  options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }],
};

describe("service durations on the catalog", () => {
  it("lists the lengths with a from-price and links the default length to chat", async () => {
    vi.mocked(getServiceCatalog).mockResolvedValue([{ categories: [], nextCategory: null }, { page: [thai], continueCursor: "", isDone: true }]);
    await render();
    const card = document.querySelector("article")!;
    expect(card.textContent).toContain("60 / 90 / 120 min · Default: 60 min · from THB 800");
    expect(card.querySelector("fieldset legend")?.textContent).toBe("Choose a duration");
    expect([...card.querySelectorAll<HTMLInputElement>("input[type=radio]")].map((radio) => [radio.value, radio.checked])).toEqual([["60", true], ["90", false], ["120", false]]);
    expect(link("Ask about this service").getAttribute("href")).toBe("/chat?service=thai-massage&duration=60");
  });

  it("shows the saved replacement default even when a shorter duration is offered", async () => {
    const replacement = { ...thai, durationMin: 120, price: 140000 };
    vi.mocked(getServiceCatalog).mockResolvedValue([{ categories: [], nextCategory: null }, { page: [replacement], continueCursor: "", isDone: true }]);
    await render();
    const card = document.querySelector("article")!;
    expect(card.textContent).toContain("Default: 120 min");
    expect(card.querySelector<HTMLInputElement>('input[type="radio"][value="120"]')?.checked).toBe(true);
    expect(link("Ask about this service").getAttribute("href")).toBe("/chat?service=thai-massage&duration=120");
  });

  it("keeps a one-length service as it was: no chips and no duration in the link", async () => {
    await render();
    expect(document.querySelectorAll("input[type=radio]")).toHaveLength(0);
    expect(document.querySelector("article")?.textContent).not.toContain("from");
    expect(link("Ask about this service").getAttribute("href")).toBe("/chat?service=thai%20massage");
  });

  it("a duration chip updates the price and the chat link", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getServiceCatalog).mockResolvedValue([{ categories: [], nextCategory: null }, { page: [thai], continueCursor: "", isDone: true }]);
    const view = await ServicesPage({ searchParams: Promise.resolve({}) });
    document.body.innerHTML = "";
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(view));
    const ninety = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((radio) => radio.value === "90")!;
    await act(async () => ninety.click());
    expect(ninety.checked).toBe(true);
    expect(document.querySelector("article")?.textContent).toContain("THB 1,100");
    expect(link("Ask about this service").getAttribute("href")).toBe("/chat?service=thai-massage&duration=90");
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

describe("catalog to chat", () => {
  it("forwards an offered duration into the draft and ignores one the service doesn't offer", async () => {
    vi.mocked(getPublicService).mockResolvedValue(thai);
    const element = await chatElement({ service: thai.slug, duration: "90" });
    expect(element.props.initialDraft).toBe("I am interested in Thai Massage (90 min). Please help me choose a date and time.");
    expect(element.key).toBe("thai-massage:90");
    const unknown = await chatElement({ service: thai.slug, duration: "45" });
    expect(unknown.props.initialDraft).toBe("I am interested in Thai Massage. Please help me choose a date and time.");
    expect((await chatElement({ service: thai.slug, duration: "90; drop" })).props.initialDraft).not.toContain("90");
  });

  it("prefills only the verified active service in the guest language", async () => {
    state.locale = "th";
    vi.mocked(getPublicService).mockResolvedValue(service);
    const element = await chatElement({ service: service.slug });
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
    const element = await chatElement({ service: "archived" });
    expect(element.props.initialDraft).toBeUndefined();
  });
});
