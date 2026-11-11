import type { Id } from "convex/_generated/dataModel";
import type { ReportBasis, ReportData, ReportMoneyEvent, ReportSale, ReportTouch } from "convex/lib/marketingReport";

/*
 * A getReport answer built from docs/previews/marketing/kit/data.md: Last 30 days = 8 Oct–6 Nov 2026,
 * as of Sat 7 Nov 2026, 06:00 Bangkok. Per link: sessions, paid and net match the data.md links table;
 * unknown 41 paid · ฿352,800, staff-entered 9 paid · ฿71,400; refunds ฿38,400 of which ฿9,600 on /a1.
 * /q1 (Spa week poster) sales are checkout orders from a scanned link, so they count in money, not in
 * paid stays. Shared by the unit tests and the browser fixture.
 */

export const FIXTURE_TODAY = "2026-11-07";
export const FIXTURE_FROM = "2026-10-08";
export const FIXTURE_TO = "2026-11-06";
export const FIXTURE_AS_OF = Date.parse("2026-11-06T23:00:00Z"); // 7 Nov 2026, 06:00 Bangkok

const cid = (id: string) => id as Id<"marketingCampaigns">;
const lid = (id: string) => id as Id<"marketingLinks">;
const pid = (id: string) => id as Id<"properties">;
const kid = (id: string) => id as Id<"coupons">;

export const PROPERTIES = [
  { id: pid("prop-tideglass"), name: "Tideglass Pool Residence" },
  { id: pid("prop-mossbell"), name: "Mossbell Garden Suite" },
  { id: pid("prop-canopy"), name: "Canopy Halo Loft" },
];

export const CAMPAIGNS: ReportData["campaigns"] = [
  { id: cid("c-fb-always"), name: "Facebook · Always on", source: "facebook", medium: "social", status: "active" },
  { id: cid("c-fb-nov"), name: "Facebook · November escape", source: "facebook", medium: "paid_social", status: "active", budget: 60000 },
  { id: cid("c-ig"), name: "Instagram · Always on", source: "instagram", medium: "social", status: "active" },
  { id: cid("c-maps"), name: "Google Maps · Profile", source: "google", medium: "organic", status: "active" },
  { id: cid("c-line"), name: "LINE · Rich menu", source: "line", medium: "messaging", status: "active" },
  { id: cid("c-island"), name: "Island Guide", source: "islandguide", medium: "referral", status: "active" },
  { id: cid("c-gads"), name: "Google Ads · Brand search", source: "google", medium: "cpc", status: "draft" },
  { id: cid("c-spa"), name: "Spa week", source: "print", medium: "qr", status: "active" },
  { id: cid("c-anna"), name: "Affiliate · Anna Travel", source: "anna", medium: "affiliate", status: "active" },
  { id: cid("c-sk"), name: "Songkran 2026", source: "facebook", medium: "paid_social", status: "ended" },
];

type LinkSpec = {
  id: string; slug: string; name: string; campaign: string; medium: string; entry: "link" | "qr"; status: string;
  sessions: number; paid: number; net: number; refunds: number[]; kind?: "order"; days?: [string, string];
};
const LINK_SPECS: LinkSpec[] = [
  { id: "l-f", slug: "f", name: "Facebook page", campaign: "c-fb-always", medium: "social", entry: "link", status: "active", sessions: 1240, paid: 18, net: 148600, refunds: [] },
  { id: "l-f1", slug: "f1", name: "Facebook · November post", campaign: "c-fb-nov", medium: "social", entry: "link", status: "active", sessions: 860, paid: 21, net: 176400, refunds: [], days: ["2026-11-01", FIXTURE_TO] },
  { id: "l-a1", slug: "a1", name: "Ads 1 · November escape", campaign: "c-fb-nov", medium: "paid_social", entry: "link", status: "active", sessions: 2310, paid: 24, net: 188200, refunds: [4800, 4800], days: ["2026-11-01", FIXTURE_TO] },
  { id: "l-a2", slug: "a2", name: "Ads 2 · Brand search", campaign: "c-gads", medium: "cpc", entry: "link", status: "draft", sessions: 0, paid: 0, net: 0, refunds: [] },
  { id: "l-m", slug: "m", name: "Google Maps", campaign: "c-maps", medium: "organic", entry: "link", status: "active", sessions: 1920, paid: 31, net: 262900, refunds: [9600] },
  { id: "l-ig", slug: "ig", name: "Instagram bio", campaign: "c-ig", medium: "social", entry: "link", status: "active", sessions: 1105, paid: 12, net: 96300, refunds: [4800] },
  { id: "l-w1", slug: "w1", name: "Website 1 · Island Guide", campaign: "c-island", medium: "referral", entry: "link", status: "active", sessions: 340, paid: 6, net: 51000, refunds: [] },
  { id: "l-l", slug: "l", name: "LINE rich menu", campaign: "c-line", medium: "messaging", entry: "link", status: "active", sessions: 780, paid: 15, net: 118500, refunds: [] },
  { id: "l-anna", slug: "r/anna", name: "Anna Travel", campaign: "c-anna", medium: "affiliate", entry: "link", status: "active", sessions: 210, paid: 5, net: 44200, refunds: [] },
  { id: "l-q1", slug: "q1", name: "Poster QR · Lamai café", campaign: "c-spa", medium: "qr", entry: "qr", status: "active", sessions: 95, paid: 4, net: 5600, refunds: [], kind: "order", days: ["2026-11-01", FIXTURE_TO] },
  { id: "l-sk", slug: "sk", name: "Songkran 2026", campaign: "c-sk", medium: "paid_social", entry: "link", status: "paused", sessions: 0, paid: 0, net: 0, refunds: [] },
];

export const LINKS: ReportData["links"] = LINK_SPECS.map((l) => ({ id: lid(l.id), slug: l.slug, name: l.name, campaignId: cid(l.campaign), entry: l.entry, status: l.status }));

export const COUPONS: ReportData["coupons"] = [
  { id: kid("k-f1"), code: "DCNT-F1-20", campaignId: cid("c-fb-nov"), status: "active" },
  { id: kid("k-l"), code: "DCNT-L-10", campaignId: cid("c-line"), status: "active" },
  { id: kid("k-spa"), code: "DCNT-SPA-500", campaignId: cid("c-spa"), status: "active" },
  { id: kid("k-anna"), code: "DCNT-ANNA-10", campaignId: cid("c-anna"), status: "active" },
];
const couponRef = (id: string) => {
  const c = COUPONS.find((x) => x.id === id)!;
  return { couponId: c.id, code: c.code, campaignId: c.campaignId };
};

const NAMES = ["Anna Weber", "Somchai P.", "Lena Fischer", "Kenji Sato", "Priya Nair", "Tom Baker", "Nok S.", "Chloe Martin", "Arjun Rao", "Mia Jensen", "Pim T.", "Lucas Moreau"];

/** `total` split into `n` round amounts that add up exactly. */
function split(total: number, n: number, seed: number): number[] {
  if (n === 0) return [];
  const base = total / n;
  const out = Array.from({ length: n - 1 }, (_, i) => Math.round((base * (0.75 + (((i * 37 + seed * 11) % 50) / 100))) / 100) * 100);
  out.push(total - out.reduce((a, b) => a + b, 0));
  return out;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const dayIn = ([from, to]: [string, string], i: number) => addDays(from, (i * 7 + 3) % span(from, to));

function touchFor(spec: LinkSpec): ReportTouch {
  const campaign = CAMPAIGNS.find((c) => c.id === spec.campaign)!;
  return { linkId: lid(spec.id), campaignId: campaign.id, slug: spec.slug, campaignName: campaign.name, source: campaign.source, medium: spec.medium, entry: spec.entry };
}
const spec = (id: string) => LINK_SPECS.find((l) => l.id === id)!;

/** Which coupon each link's sales carry, in order (rest have none). */
const LINK_COUPONS: Record<string, string[]> = {
  "l-f1": Array(12).fill("k-f1"),
  "l-a1": Array(14).fill("k-f1"),
  "l-l": [...Array(5).fill("k-f1"), ...Array(8).fill("k-l")],
  "l-anna": Array(5).fill("k-anna"),
  "l-q1": Array(4).fill("k-spa"),
};
const UNKNOWN_COUPONS = [...Array(4).fill("k-f1"), ...Array(8).fill("k-l"), ...Array(2).fill("k-anna")];
const F1_DISCOUNTS = split(66450, 35, 1);
let f1Index = 0;

function discountFor(couponId: string | undefined, collected: number) {
  if (!couponId) return 0;
  if (couponId === "k-f1") return F1_DISCOUNTS[f1Index++ % F1_DISCOUNTS.length];
  if (couponId === "k-spa") return 500;
  return Math.round(collected / 9 / 10) * 10;
}

function makeSales(): ReportSale[] {
  f1Index = 0;
  const sales: ReportSale[] = [];
  let n = 0;
  const range: [string, string] = [FIXTURE_FROM, FIXTURE_TO];
  const push = (base: Omit<ReportSale, "id" | "label" | "ref" | "createdDay" | "paidDay" | "paid" | "discount" | "propertyId">, day: string, couponId?: string) => {
    n += 1;
    const isStay = base.kind === "stay";
    sales.push({
      ...base,
      ...(base.kind === "stay" && base.evidence === "tracked" ? { session: { id: `session-${n}` as Id<"marketingSessions">, day, linkId: base.last!.linkId, campaignId: base.last!.campaignId } } : {}),
      id: `${base.kind}-${String(n).padStart(3, "0")}`,
      label: NAMES[n % NAMES.length],
      ref: isStay ? `AUR-${String(4100 + n)}` : base.kind === "order" ? `Order #${100 + n}` : "Thai massage 60",
      propertyId: isStay ? PROPERTIES[n % 3].id : undefined,
      coupon: couponId ? couponRef(couponId) : undefined,
      createdDay: day,
      paidDay: [addDays(day, n % 3 === 0 ? 1 : 0), FIXTURE_TO].sort()[0],
      paid: true,
      discount: discountFor(couponId, base.collected),
    });
  };

  for (const link of LINK_SPECS) {
    if (!link.paid) continue;
    const nets = split(link.net, link.paid, link.slug.length);
    nets.forEach((net, i) => {
      const refunded = link.refunds[i] ?? 0;
      const last = touchFor(link);
      // Some guests first came through another link (first touch differs from last).
      const firstFrom = link.id === "l-a1" && i % 4 === 1 ? "l-ig" : link.id === "l-m" && i % 3 === 0 ? "l-f" : link.id === "l-l" && i % 5 === 2 ? "l-m" : null;
      const order = link.kind === "order";
      const currentLink = link.id === "l-anna" && i < 2;
      push(
        {
          kind: order ? "order" : "stay",
          channel: order ? "pos" : i % 6 === 5 ? "web_chat" : "web",
          bucket: "tracked",
          evidence: order ? "scanned" : currentLink ? "current_link" : "tracked",
          last,
          first: order || currentLink ? undefined : firstFrom ? touchFor(spec(firstFrom)) : last,
          collected: net + refunded,
          refunded,
        },
        dayIn(link.days ?? range, i),
        LINK_COUPONS[link.id]?.[i],
      );
    });
  }

  const unknownRefunds = [4800, 4800, 4800];
  split(352800, 41, 3).forEach((net, i) => {
    const refunded = unknownRefunds[i] ?? 0;
    push({ kind: "stay", channel: i % 7 === 6 ? "web_chat" : "web", bucket: "unknown", collected: net + refunded, refunded }, dayIn(range, i + 2), UNKNOWN_COUPONS[i]);
  });

  // Staff-entered: 6 admin stays (2 with the LINE code) and 3 checkout orders with the spa code.
  split(67600, 6, 5).forEach((net, i) => push({ kind: "stay", channel: "admin", bucket: "staff", collected: net, refunded: 0 }, dayIn(range, i + 5), i < 2 ? "k-l" : undefined));
  [1300, 1000, 1500].forEach((net, i) => push({ kind: "order", channel: "pos", bucket: "staff", collected: net, refunded: 0 }, dayIn(range, i + 9), "k-spa"));
  return sales;
}

function makeSessions(): ReportData["sessions"] {
  const rows: ReportData["sessions"] = [];
  for (const link of LINK_SPECS) {
    if (!link.sessions) continue;
    const window = link.days ?? [FIXTURE_FROM, FIXTURE_TO];
    const days = span(...window);
    const weights = Array.from({ length: days }, (_, i) => 3 + ((i * 5 + link.slug.length) % 4));
    const sum = weights.reduce((a, b) => a + b, 0);
    let left = link.sessions;
    weights.forEach((w, i) => {
      const count = i === days - 1 ? left : Math.round((link.sessions * w) / sum);
      left -= count;
      if (count > 0) rows.push({ day: addDays(window[0], i), linkId: lid(link.id), campaignId: cid(link.campaign), count });
    });
  }
  // Consented direct arrivals also belong to the overall conversion denominator.
  for (let i = 0; i < 30; i++) rows.push({ day: addDays(FIXTURE_FROM, i), count: 90 + (i % 5) * 7 });
  return rows;
}

function cashEvents(sales: ReportSale[]): ReportMoneyEvent[] {
  const events: ReportMoneyEvent[] = [];
  for (const sale of sales) {
    if (sale.paidDay) events.push({ saleId: sale.id, kind: "payment", day: sale.paidDay, amount: sale.collected });
    if (sale.refunded) events.push({ saleId: sale.id, kind: "refund", day: [addDays(sale.paidDay ?? sale.createdDay, 3), FIXTURE_TO].sort()[0], amount: sale.refunded });
  }
  return events;
}

export const SPEND: ReportData["spend"] = [
  { id: "sp-nov" as Id<"marketingSpend">, campaignId: cid("c-fb-nov"), amount: 45000, from: "2026-11-01", to: FIXTURE_TO, note: "Meta ads, first week" },
  { id: "sp-spa" as Id<"marketingSpend">, campaignId: cid("c-spa"), amount: 1200, from: "2026-11-01", to: FIXTURE_TO, note: "Posters" },
];

export function dashboardReport(options: { basis?: ReportBasis; spend?: boolean; truncated?: boolean; nonThb?: number } = {}): ReportData {
  const basis = options.basis ?? "cohort";
  const sales = makeSales();
  return {
    asOf: FIXTURE_AS_OF,
    from: FIXTURE_FROM,
    to: FIXTURE_TO,
    basis,
    timeZone: "Asia/Bangkok",
    currency: "THB",
    model: "last_touch_30d@1",
    sales,
    events: basis === "cash" ? cashEvents(sales) : [],
    sessions: makeSessions(),
    campaigns: CAMPAIGNS,
    links: LINKS,
    coupons: COUPONS,
    properties: PROPERTIES,
    spend: options.spend === false ? [] : SPEND,
    excluded: { nonThb: options.nonThb ?? 0 },
    truncated: options.truncated ?? false,
  };
}

/** Nothing set up and nothing in the dates: no campaigns, links, coupons, sales or visits. */
export function firstRunReport(): ReportData {
  return { ...dashboardReport(), sales: [], sessions: [], campaigns: [], links: [], coupons: [], spend: [] };
}

/**
 * No campaigns or links yet, but the business already sells: unknown and staff-entered sales, visits
 * without a link, and coupons that belong to no campaign.
 */
export function untrackedReport(options: { basis?: ReportBasis } = {}): ReportData {
  const report = dashboardReport(options);
  const sales = report.sales
    .filter((sale) => sale.bucket !== "tracked")
    .map((sale) => (sale.coupon ? { ...sale, coupon: { couponId: sale.coupon.couponId, code: sale.coupon.code } } : sale));
  const ids = new Set(sales.map((sale) => sale.id));
  return {
    ...report,
    sales,
    events: report.events.filter((event) => ids.has(event.saleId)),
    sessions: report.sessions.filter((row) => !row.linkId),
    campaigns: [],
    links: [],
    coupons: report.coupons.map(({ id, code, status }) => ({ id, code, status })),
    spend: [],
  };
}

/** Set up, but nothing happened in the dates. */
export function emptyRangeReport(): ReportData {
  return { ...dashboardReport(), sales: [], sessions: [], spend: [] };
}
