// The real Questions screen (BusinessFactsView) on in-memory facts and reports; no backend.
import type { Id } from "convex/_generated/dataModel";
import { createRoot } from "react-dom/client";
import { BusinessFactsView } from "@/components/admin/BusinessFactsView";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AdminBusinessFact, AdminFactProperty } from "@/components/admin/business-facts-form";
import type { AdminUnknownGroup, AdminUnknownQuestion } from "@/components/admin/admin-knowledge-types";
import { registerFixtureFunctions } from "./convex-mock";
import { enableLiveNavigation } from "./next-navigation-mock";
import "@/app.css";

/*
 * Two approved facts and three new missing-information reports (one asked twice). Every
 * mutation is appended to window.fixtureCalls as [name, args].
 */
enableLiveNavigation();
const now = Date.now();
const MIN = 60_000;
const calls: Array<[string, unknown]> = [];
(window as unknown as { fixtureCalls: typeof calls }).fixtureCalls = calls;

const tideglass = "prop-tideglass" as Id<"properties">;
const properties: AdminFactProperty[] = [
  { _id: tideglass, name: "Tideglass Pool Residence", slug: "tideglass", status: "active" },
  { _id: "prop-garden" as Id<"properties">, name: "Garden Villa", slug: "garden", status: "active" },
];
const fact = (id: string, title: string, body: string, propertyId?: Id<"properties">): AdminBusinessFact => ({
  _id: id as Id<"businessFacts">,
  title,
  body,
  searchText: "",
  source: "Owner",
  propertyId,
  status: "approved",
  revision: 1,
  createdAt: now - 30 * 24 * 60 * MIN,
  updatedAt: now - 30 * 24 * 60 * MIN,
  createdByAdminEmail: "narin@auraliscove.co",
  updatedByAdminEmail: "narin@auraliscove.co",
});
const facts: AdminBusinessFact[] = [
  fact("fact-breakfast", "Breakfast is included", "Breakfast for every guest is included, served 7–10 am."),
  fact("fact-pool", "The pool is heated all year", "The Tideglass pool stays around 29 °C all year.", tideglass),
];

let failResolve = new URLSearchParams(location.search).has("failResolve");
let reportSeq = 0;
function report(userQuestion: string, minutesAgo: number, extra: Partial<AdminUnknownQuestion> = {}): AdminUnknownQuestion {
  return {
    _id: `unknown-${++reportSeq}` as Id<"chatUnknownQuestions">,
    sessionId: `chat-${reportSeq}` as Id<"conversations">,
    userQuestion,
    normalizedQuestion: userQuestion.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(),
    status: "new",
    adminNotified: true,
    pageUrl: "/villas/tideglass",
    createdAt: now - minutesAgo * MIN,
    updatedAt: now - minutesAgo * MIN,
    ...extra,
  };
}
const reports: AdminUnknownQuestion[] = [
  report("Is breakfast included?", 12, { detectedTopic: "Dining" }),
  report("Is breakfast included?", 50, { detectedTopic: "Dining" }),
  report("Do you have a baby cot?", 25, { propertyId: tideglass, propertyName: "Tideglass Pool Residence", detectedTopic: "Family" }),
  report("Can I bring my dog?", 70, { detectedTopic: "Pets" }),
];

const cache = new Map<string, unknown>();
function stable<A>(name: string, compute: (args: A) => unknown) {
  return (args: A) => {
    const key = `${name}:${JSON.stringify(args)}`;
    if (!cache.has(key)) cache.set(key, compute(args));
    return cache.get(key);
  };
}
function record(name: string, args: unknown) {
  calls.push([name, args]);
  cache.clear();
}

function groups(status: string, search?: string): AdminUnknownGroup[] {
  const byKey = new Map<string, AdminUnknownQuestion[]>();
  for (const item of reports) byKey.set(item.normalizedQuestion, [...(byKey.get(item.normalizedQuestion) ?? []), item]);
  return [...byKey.entries()]
    .map(([normalizedQuestion, items]) => {
      const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);
      const counts = { new: 0, resolved: 0, ignored: 0 };
      for (const item of items) counts[item.status] += 1;
      return { normalizedQuestion, count: items.length, counts, latestAt: sorted[0].createdAt, channels: ["web" as const], latest: sorted[0] };
    })
    .filter((group) => status === "all" || group.counts[status as keyof typeof group.counts] > 0)
    .filter((group) => !search || group.normalizedQuestion.includes(search.toLowerCase()))
    .sort((a, b) => b.latestAt - a.latestAt);
}

registerFixtureFunctions({
  queries: {
    "properties:adminList": () => properties,
    "concierge/knowledge:adminListUnknownGroups": stable("groups", ({ status, search }: { status: string; search?: string }) => ({
      groups: groups(status, search),
      truncated: false,
    })),
    "concierge/businessFacts:adminList": stable("facts", ({ status }: { status?: string }) => facts.filter((item) => !status || item.status === status)),
  },
  mutations: {
    "concierge/businessFacts:adminResolveUnknownGroups": (args: { normalizedQuestions: string[]; factId?: string; structuredSource?: string }) => {
      record("adminResolveUnknownGroups", args);
      if (failResolve) { failResolve = false; throw new Error("Fixture resolve unavailable"); }
      const title = facts.find((item) => item._id === args.factId)?.title;
      const touched = reports.filter((item) => item.status === "new" && args.normalizedQuestions.includes(item.normalizedQuestion));
      for (const item of touched) Object.assign(item, { status: "resolved", resolvedFactTitle: title, resolvedSource: args.structuredSource });
      return { resolved: touched.length, remaining: 0, remainingIsLowerBound: false, hasMore: false, unknownQuestionIds: touched.map((item) => item._id) };
    },
    "concierge/knowledge:adminIgnoreUnknownGroups": (args: { normalizedQuestions: string[] }) => {
      record("adminIgnoreUnknownGroups", args);
      const touched = reports.filter((item) => item.status === "new" && args.normalizedQuestions.includes(item.normalizedQuestion));
      for (const item of touched) item.status = "ignored";
      return { ignored: touched.length, remaining: 0, remainingIsLowerBound: false, unknownQuestionIds: touched.map((item) => item._id) };
    },
    "concierge/knowledge:adminReopenUnknownGroups": (args: { normalizedQuestions?: string[]; unknownQuestionIds?: string[] }) => {
      record("adminReopenUnknownGroups", args);
      const touched = reports.filter(
        (item) =>
          item.status !== "new" &&
          (args.unknownQuestionIds?.includes(item._id) || args.normalizedQuestions?.includes(item.normalizedQuestion)),
      );
      for (const item of touched) Object.assign(item, { status: "new", resolvedFactTitle: undefined, resolvedSource: undefined });
      return { reopened: touched.length, remaining: 0, remainingIsLowerBound: false };
    },
    "concierge/businessFacts:adminSave": (args: { title: string; body: string; propertyId?: Id<"properties">; unknownQuestionId?: string }) => {
      record("adminSave", args);
      const saved = fact(`fact-${facts.length + 1}`, args.title, args.body, args.propertyId);
      facts.push(saved);
      const item = reports.find((candidate) => candidate._id === args.unknownQuestionId);
      if (item) Object.assign(item, { status: "resolved", resolvedFactTitle: saved.title });
      return saved._id;
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    {/* The admin shell's sidebar provides this in the app. */}
    <TooltipProvider delayDuration={0}>
    <div data-fixture-ready className="min-h-dvh bg-background">
      <BusinessFactsView />
    </div>
    </TooltipProvider>
  </ConfirmProvider>,
);
