// Browser fixtures have no Clerk session: a signed-in placeholder and inert account controls.
import type { ReactNode } from "react";

const user = { primaryEmailAddress: { emailAddress: "fixture@example.com" } };

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user };
}
// Clerk keeps these callbacks stable; changing them each render would repeatedly
// restart effects (including a channel setup check) instead of waiting for Retry.
const getToken = async () => null;
const signOut = async () => undefined;
export function useAuth() {
  return { isLoaded: true, isSignedIn: true, getToken, signOut };
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
export function SignOutButton({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
