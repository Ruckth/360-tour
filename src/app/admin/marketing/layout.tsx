import type { ReactNode } from "react";
import { MarketingSectionNav } from "@/components/admin/marketing/MarketingSectionNav";

// `/admin/marketing` itself redirects to the dashboard (see adminRedirectPath).
export default function AdminMarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingSectionNav>{children}</MarketingSectionNav>;
}
