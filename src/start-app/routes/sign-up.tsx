import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up")({
  component: () => (
    <div className="flex min-h-screen items-center justify-center px-5 py-24">
      <SignUp routing="hash" />
    </div>
  ),
});
