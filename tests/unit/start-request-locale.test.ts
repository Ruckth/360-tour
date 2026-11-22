import { expect, it, vi } from "vitest";
import { requestLanguage } from "@/start-app/locale-preference.server";

it("negotiates region variants and weighted language ranges", () => {
  expect(requestLanguage("de-AT;q=0.3,th-TH;q=0.9")).toBe("th");
  expect(requestLanguage("zh-Hans-CN,fr;q=0.6")).toBe("zh-CN");
});

it("leaves absent, wildcard and invalid headers available for locale-cookie synchronization", () => {
  for (const value of [null, "*", "@"]) expect(requestLanguage(value)).toBeUndefined();
});

const setHeader = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: () => undefined,
  setCookie: vi.fn(),
  setResponseHeader: setHeader,
}));

it("builds all alternate language links from the public path", async () => {
  const { siteRedirect } = await import("@/start-app/site-redirect.server");
  await siteRedirect(new Request("https://example.test/booking/pay?accessToken=test-value&mk=campaign"));
  const links = setHeader.mock.calls.find(([key]) => key === "link")?.[1];
  expect(typeof links).toBe("string");
  expect(links.match(/hreflang=/g)).toHaveLength(12);
  expect(links).toContain("<https://example.test/th/booking/pay>");
  expect(links).not.toContain("?");
});

it("lets Clerk attach headers to admin and locale redirects", async () => {
  const { siteRedirect } = await import("@/start-app/site-redirect.server");
  for (const [path, destination] of [["/admin", "/admin/chats"], ["/en/services?q=spa", "/services?q=spa"]]) {
    const response = await siteRedirect(new Request("https://example.test" + path));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://example.test" + destination);
    response!.headers.append("set-cookie", "test=1");
  }
});
