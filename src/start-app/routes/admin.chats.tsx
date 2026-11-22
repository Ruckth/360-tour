import { createFileRoute } from "@tanstack/react-router";
import { ChatsView } from "@/components/admin/ChatsView";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/chats")({
  component: StartAdminChatsRoute,
  errorComponent: StartAdminViewError,
});

function StartAdminChatsRoute() {
  return <ChatsView />;
}
