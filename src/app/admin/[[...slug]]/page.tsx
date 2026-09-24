import { redirect } from "next/navigation";
import { adminRoute } from "@/components/admin/admin-routes";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  if (!slug || !adminRoute(`/admin/${slug.join("/")}`)) redirect("/admin/chats");
  return null;
}
