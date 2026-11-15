import type { ReportData } from "convex/shared/marketingReport";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DashboardView, initialRequest, type ReportRequest, type ReportState } from "@/components/admin/marketing/dashboard/DashboardView";
import { dashboardReport, FIXTURE_AS_OF, FIXTURE_TODAY, firstRunReport, untrackedReport } from "./marketing-dashboard-data";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import "@/app.css";

/*
 * Release 3b marketing dashboard on fixture data (marketing-dashboard-data.ts, from kit/data.md).
 *   case=normal | first-run | untracked (sales, no campaigns yet) | loading | error | no-spend | refunds (Finance view) | negative-net | truncated
 *   theme=dark   dark app theme (light otherwise)
 * Calls the dashboard makes are recorded on document.body.dataset for the spec.
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const scenario = params.get("case") ?? "normal";

function reportFor(request: ReportRequest): ReportData {
  if (scenario === "first-run") return firstRunReport();
  if (scenario === "untracked") return { ...untrackedReport({ basis: request.basis }), from: request.range.from, to: request.range.to };
  const base = dashboardReport({ basis: request.basis, spend: scenario !== "no-spend", truncated: scenario === "truncated", nonThb: scenario === "truncated" ? 2 : 0 });
  if (scenario === "negative-net") {
    // Two sources collect income; the other two refund sales paid before this period.
    const tracked = base.sales.find((sale) => sale.bucket === "tracked")!;
    const unknown = base.sales.find((sale) => sale.bucket === "unknown")!;
    const staff = { ...base.sales.find((sale) => sale.bucket === "staff")!, paidDay: "2026-10-01" };
    const messaging: ReportData["sales"][number] = { ...staff, id: "messaging-refund", bucket: "messaging", channel: "messaging" };
    return { ...base, from: request.range.from, to: request.range.to,
      sales: [tracked, unknown, staff, messaging],
      events: [
        { saleId: tracked.id, day: base.to, kind: "payment", amount: 1000 },
        { saleId: unknown.id, day: base.to, kind: "payment", amount: 2000 },
        { saleId: staff.id, day: base.to, kind: "refund", amount: 3000 },
        { saleId: messaging.id, day: base.to, kind: "refund", amount: 500 },
      ],
    };
  }
  return { ...base, from: request.range.from, to: request.range.to };
}

function record(key: string, value: unknown) {
  const list = JSON.parse(document.body.dataset[key] ?? "[]");
  document.body.dataset[key] = JSON.stringify([...list, value]);
}

function Fixture() {
  const [request, setRequest] = useState<ReportRequest>(() => ({ ...initialRequest(FIXTURE_TODAY), basis: ["refunds", "negative-net"].includes(scenario) ? "cash" : "cohort" }));
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

createRoot(document.getElementById("root")!).render(<ConfirmProvider><Fixture /></ConfirmProvider>);
