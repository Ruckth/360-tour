import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  const key =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  const enabled = Boolean(key) && !key?.includes("placeholder");

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-24">
      {enabled ? (
        <SignIn routing="hash" />
      ) : (
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
          <h1 className="font-serif text-3xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Clerk is optional in this migration. Add a Clerk publishable key to enable auth.
          </p>
        </div>
      )}
    </div>
  );
}
