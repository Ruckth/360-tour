import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({
  component: () => (
    <div className="flex min-h-screen items-center justify-center px-5 py-24">
      <SignIn routing="hash" />
    </div>
  ),
});
