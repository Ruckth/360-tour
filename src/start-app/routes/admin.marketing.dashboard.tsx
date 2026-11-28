import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DashboardScreen } from "@/components/admin/marketing/dashboard/DashboardScreen";
import { useRouter } from "@/platform/navigation";
import { StartAdminViewError } from "../admin/AdminBoundaries";

const scopeFields = ["from", "to", "preset", "basis", "property", "touch", "breakdown"] as const;

export const Route = createFileRoute("/admin/marketing/dashboard")({
  validateSearch: (search): Partial<Record<(typeof scopeFields)[number], string>> => {
    const scope: Partial<Record<(typeof scopeFields)[number], string>> = {};
    for (const field of scopeFields) {
      const value = search[field];
      if (Object.hasOwn(search, field)) scope[field] = typeof value === "string" ? value : "";
    }
    return scope;
  },
  component: StartAdminMarketingDashboardRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminMarketingDashboardRoute() {
  const router = useRouter();
  const scope = Route.useSearch();
  const search = useMemo(() => new URLSearchParams(Object.entries(scope)), [scope]);
  return <DashboardScreen search={search} onScopeChange={(params) => router.push(`/admin/marketing/dashboard?${params}`, { scroll: false })} />;
}
