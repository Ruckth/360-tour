import { createFileRoute } from "@tanstack/react-router";
import { StartAdminHotelRoute } from "../admin/StartAdminHotelRoute";
import { StartAdminViewError } from "../admin/AdminBoundaries";

export const Route = createFileRoute("/admin/hotel")({
  component: StartAdminHotelRoute,
  errorComponent: StartAdminViewError,
});
