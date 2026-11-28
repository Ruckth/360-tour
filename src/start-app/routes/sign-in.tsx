import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({
  component: () => (
    <div className="flex min-h-dvh items-center justify-center px-4 pb-12 pt-20 md:px-5 md:py-24">
      <SignIn routing="hash" />
    </div>
  ),
});
