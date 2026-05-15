import { AIChatWidget } from "@/components/chat/AIChatWidget";
import { SiteFooter } from "@/components/global/SiteFooter";
import { SiteHeader } from "@/components/global/SiteHeader";
import { resort } from "@/lib/data/resort-config";
import type { ReactNode } from "react";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <AIChatWidget whatsappNumber={resort.whatsapp} lineId={resort.lineId} />
    </div>
  );
}
