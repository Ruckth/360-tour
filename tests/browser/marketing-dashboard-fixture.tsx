import type { ReportData } from "convex/lib/marketingReport";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardView, DEFAULT_REQUEST, type ReportRequest, type ReportState } from "@/components/admin/marketing/dashboard/DashboardView";
import { dashboardReport, FIXTURE_AS_OF, FIXTURE_TODAY, firstRunReport } from "./marketing-dashboard-data";
import "@/app.css";

/*
 * Release 3b marketing dashboard on fixture data (marketing-dashboard-data.ts, from kit/data.md).
 *   case=normal | first-run | loading | error | no-spend | refunds (Finance view) | truncated
 *   theme=dark   dark app theme (light otherwise)
 * Calls the dashboard makes are recorded on document.body.dataset for the spec.
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const scenario = params.get("case") ?? "normal";

function reportFor(request: ReportRequest): ReportData {
  if (scenario === "first-run") return firstRunReport();
  const base = dashboardReport({ basis: request.basis, spend: scenario !== "no-spend", truncated: scenario === "truncated", nonThb: scenario === "truncated" ? 2 : 0 });
  return { ...base, from: request.range.from, to: request.range.to };
}

function record(key: string, value: unknown) {
  const list = JSON.parse(document.body.dataset[key] ?? "[]");
  document.body.dataset[key] = JSON.stringify([...list, value]);
}

function Fixture() {
  const [request, setRequest] = useState<ReportRequest>(() => ({ ...DEFAULT_REQUEST(FIXTURE_TODAY), basis: scenario === "refunds" ? "cash" : "cohort" }));
  const state: ReportState =
    scenario === "loading"
      ? { status: "loading" }
      : scenario === "error"
        ? { status: "error", message: "The report service didn’t answer in time." }
        : { status: "ready", report: reportFor(request) };
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <DashboardView
        request={request}
        onRequestChange={(next) => {
          record("requests", next);
          setRequest(next);
        }}
        state={state}
        onRetry={() => record("retries", 1)}
        today={FIXTURE_TODAY}
        campaignsHref="#campaigns"
        linksHref="#links"
        orderHref={(id) => `#order-${id}`}
        onOpenStay={(id) => record("stays", id)}
        onSaveSpend={async (draft) => record("spend", draft)}
        now={FIXTURE_AS_OF}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
