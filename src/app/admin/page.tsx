import { AdminChatDashboard } from "@/components/admin/AdminChatDashboard";

export default function AdminPage() {
  const clerkPublishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkEnabled =
    Boolean(clerkPublishableKey) && !clerkPublishableKey?.includes("placeholder");

  if (!clerkEnabled) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5">
        <section className="w-full max-w-xl border border-border bg-card p-8 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            Admin setup
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
            Clerk is required for admin
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and configure the Convex
            `CLERK_JWT_ISSUER_DOMAIN` plus `ADMIN_EMAILS` environment variables before
            opening the dashboard.
          </p>
        </section>
      </main>
    );
  }

  return <AdminChatDashboard />;
}
