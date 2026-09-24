import { Suspense, type ReactNode } from "react";
import { AdminChatDashboard } from "@/components/admin/AdminChatDashboard";
import { isClerkConfigured } from "@/lib/clerk-config";

export default function AdminLayout({ children }: { children: ReactNode }) {
  if (!isClerkConfigured()) {
    return (
      <>
        <main className="grid min-h-screen place-items-center bg-background px-5">
          <section className="w-full max-w-xl border border-border bg-card p-8 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              Admin setup
            </p>
            <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
              Clerk is required for admin
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
              configure the Convex `CLERK_JWT_ISSUER_DOMAIN` plus `ADMIN_EMAILS`
              environment variables before opening the dashboard.
            </p>
          </section>
        </main>
        {children}
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <AdminChatDashboard />
      </Suspense>
      {children}
    </>
  );
}
