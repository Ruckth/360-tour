import { canOpenResortDesk } from "@/components/admin/admin-access";
import { useStaffAccess } from "@/components/admin/staff-access";
import { createFileRoute } from "@tanstack/react-router";
import { ChatsView } from "@/components/admin/ChatsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/chats")({
  component: StartAdminChatsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminChatsRoute() {
  const access = useStaffAccess();
  if (!canOpenResortDesk(access, "chats")) {
    return <p role="status" className="p-6 text-sm text-muted-foreground">You don’t have access to this resort desk.</p>;
  }
  return <ChatsView />;
}
