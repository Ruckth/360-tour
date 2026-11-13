import { redirect } from "next/navigation";
import { adminSettingsTabPath } from "@/components/admin/admin-routes";

// Marketing roles are set on Settings › Team, next to each person's Desk role.
export default function AdminMarketingAccessPage() {
  redirect(adminSettingsTabPath("team"));
}
