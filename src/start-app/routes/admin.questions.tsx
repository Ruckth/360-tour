import { createFileRoute } from "@tanstack/react-router";
import { BusinessFactsView } from "@/components/admin/BusinessFactsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/questions")({
  component: StartAdminQuestionsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminQuestionsRoute() {
  return <BusinessFactsView />;
}
