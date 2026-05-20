"use client";

import { AIChatWidget } from "@/components/chat/AIChatWidget";
import { ChatContextProvider } from "@/components/chat/ChatContext";
import { SiteFooter } from "@/components/global/SiteFooter";
import { SiteHeader } from "@/components/global/SiteHeader";
import { resort } from "@/lib/data/resort-config";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <ChatContextProvider>
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <AIChatWidget whatsappNumber={resort.whatsapp} lineId={resort.lineId} />
      </ChatContextProvider>
    </div>
  );
}
