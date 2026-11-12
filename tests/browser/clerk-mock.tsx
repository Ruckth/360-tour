// Browser fixtures have no Clerk session: a signed-in placeholder and inert account controls.
import type { ReactNode } from "react";

const user = { primaryEmailAddress: { emailAddress: "fixture@example.com" } };

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user };
}
export function useAuth() {
  return { isLoaded: true, isSignedIn: true, getToken: async () => null, signOut: async () => undefined };
}
export function ClerkProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function UserButton() {
  return <span aria-hidden className="inline-block size-7 rounded-full bg-muted" />;
}
export function SignInButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
export function SignIn() {
  return null;
}
export function SignUp() {
  return null;
}
