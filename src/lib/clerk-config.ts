export function getClerkPublishableKey() {
  return (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}

export function isClerkConfigured() {
  const publishableKey = getClerkPublishableKey();
  const secretKey = process.env.CLERK_SECRET_KEY;

  return Boolean(publishableKey) && !publishableKey?.includes("placeholder") && Boolean(secretKey);
}

export function requireClerkConfiguration() {
  if (!isClerkConfigured()) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are required");
}
