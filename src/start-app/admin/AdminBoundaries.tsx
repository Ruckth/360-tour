import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";
import { BranchForbiddenCard, isBranchForbidden } from "@/components/admin/branch/BranchScreens";
import { adminNavItem, adminSectionRecovery } from "@/components/admin/admin-routes";
import { useAdminNav } from "@/components/admin/staff-access";
import { Button, ButtonLink } from "@/components/ui/button";
import { usePathname } from "@/platform/navigation";

export function AdminClerkSetupRequired() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5">
      <section className="w-full max-w-xl border border-border bg-card p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          Admin setup
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
          Clerk is required for admin
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, then configure
          `CLERK_JWT_ISSUER_DOMAIN` in Convex. Create a company owner grant before opening the dashboard.
        </p>
      </section>
    </main>
  );
}

/**
 * Admin error boundary presentation: wraps each admin view inside
 * the layout so a failing view keeps the sidebar and can be retried.
 * A branch denial gets its own fixed card, with one link back to the section's list.
 */
export function AdminViewErrorCard({
  error,
  onRetry,
  pathname = "/admin/chats",
}: {
  error: unknown;
  onRetry: () => void;
  pathname?: string;
}) {
  if (isBranchForbidden(error)) {
    const section = adminNavItem(pathname) ?? { href: "/admin/chats", label: "Chats" };
    return <BranchForbiddenCard backHref={section.href} backLabel={`Back to ${section.label}`} />;
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Check admin authorization and try again.";

  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section role="alert" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <TriangleAlert aria-hidden="true" className="mb-4 size-6 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground">This view could not load</h2>
        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{message}</p>
        <Button type="button" className="mt-5" onClick={onRetry}>
          <RotateCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      </section>
    </div>
  );
}

export function StartAdminViewError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <AdminViewErrorCard
      error={error}
      pathname={pathname}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

/**
 * Not-found inside admin. A stale bookmark in a section with sub-pages (Staff bookings, Marketing)
 * keeps its context: it names the section and links to that section's pages this person may open.
 */
export function StartAdminNotFound() {
  const pathname = usePathname();
  const nav = useAdminNav();
  const recovery = adminSectionRecovery(pathname, nav);
  const home = nav.find((item) => item.href === "/admin/chats") ?? nav[0];
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section aria-labelledby="admin-not-found-title" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 id="admin-not-found-title" className="text-2xl font-semibold text-foreground">
          {recovery ? `This ${recovery.label} page doesn’t exist` : "404"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {recovery ? "The link may be out of date. Choose where to go:" : "This page could not be found."}
        </p>
        {recovery ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {recovery.links.map((link) => (
              <li key={link.href}>
                <ButtonLink href={link.href} variant="outline">{link.label}</ButtonLink>
              </li>
            ))}
          </ul>
        ) : home ? (
          <ButtonLink href={home.href} className="mt-5">
            Back to {home.shortLabel ?? home.label}
          </ButtonLink>
        ) : null}
      </section>
    </div>
  );
}
