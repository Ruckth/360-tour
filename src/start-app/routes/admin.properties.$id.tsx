import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import { AdminPropertyEditor } from "@/components/admin/AdminPropertyEditor";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { StartAdminViewError } from "../admin/AdminBoundaries";
import { validateAdminPropertySearch } from "../admin/admin-route";

export const Route = createFileRoute("/admin/properties/$id")({
  validateSearch: validateAdminPropertySearch,
  component: StartAdminPropertyRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminPropertyRoute() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: async ({ current, next }) => {
      if (current.pathname === next.pathname) return false;
      return !(await confirm({
        title: "Leave this villa without saving?",
        description: "Your changes to this villa or its rates will be discarded.",
        cancelLabel: "Keep editing",
        confirmLabel: "Discard and leave",
        destructive: true,
      }));
    },
  });
  return <AdminPropertyEditor key={id} propertyId={id} tab={tab} onDirtyChange={setDirty} onDeleted={() => {
    void navigate({ to: "/admin/properties", ignoreBlocker: true });
  }} />;
}
