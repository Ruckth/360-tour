import { createFileRoute } from "@tanstack/react-router";
import { IntlProvider } from "use-intl";
import { CustomerDisplay } from "@/components/display/CustomerDisplay";
import messages from "../../../messages/display/en.json";

export const Route = createFileRoute("/display")({
  head: () => ({ meta: [{ title: messages.Display.title }, { name: "robots", content: "noindex, nofollow" }] }),
  component: () => (
    <IntlProvider locale="en" messages={messages} timeZone="Asia/Bangkok">
      <CustomerDisplay />
    </IntlProvider>
  ),
});
