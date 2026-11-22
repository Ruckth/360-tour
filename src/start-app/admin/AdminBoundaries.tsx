import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

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
          Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
          configure the Convex `CLERK_JWT_ISSUER_DOMAIN` plus `ADMIN_EMAILS`
          environment variables before opening the dashboard.
        </p>
      </section>
    </main>
  );
}

/**
 * Pure presentation of `src/app/admin/error.tsx`: wraps each admin view inside
 * the layout so a failing view keeps the sidebar and can be retried.
 */
export function AdminViewErrorCard({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
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
  return (
    <AdminViewErrorCard
      error={error}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

export function StartAdminNotFound() {
  return (
    <div className="grid flex-1 place-items-center px-5 py-10">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-foreground">404</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This page could not be found.
        </p>
        <ButtonLink href="/admin/chats" className="mt-5">
          Back to Chats
        </ButtonLink>
      </section>
    </div>
  );
}
