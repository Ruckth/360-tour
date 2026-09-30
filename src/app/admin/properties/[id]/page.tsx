import { AdminPropertyEditor } from "@/components/admin/AdminPropertyEditor";

export default async function AdminPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminPropertyEditor propertyId={id} />;
}
