import { notFound } from "next/navigation";
import { AdminStaffBookingsView } from "@/components/admin/AdminStaffBookingsView";
import { isAdminStaffTab } from "@/components/admin/admin-routes";

export default async function AdminStaffTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  // The proxy already redirects unknown tabs; this narrows the type.
  if (!isAdminStaffTab(tab)) notFound();
  return <AdminStaffBookingsView tab={tab} />;
}
