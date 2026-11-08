import type { ReactNode } from "react";
import { MarketingSectionNav } from "@/components/admin/marketing/MarketingSectionNav";

// `/admin/marketing` itself redirects to Links & QR (see adminRedirectPath).
export default function AdminMarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingSectionNav>{children}</MarketingSectionNav>;
}
