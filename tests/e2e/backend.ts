import { expect, type Locator, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** If a multi-branch session shows the first-visit branch chooser, pick the first branch and continue. */
export async function chooseBranchIfPrompted(page: Page, target: Locator) {
  const chooser = page.getByRole("heading", {
    name: "Choose a branch to start",
    exact: true,
  });
  await target.or(chooser).first().waitFor({ state: "visible" });
  if (await chooser.isVisible()) {
    await page.getByRole("listitem").getByRole("button").first().click();
    await chooser.waitFor({ state: "hidden" });
  }
}

export function localBackend() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname))
    throw new Error("Only checkout-local Convex is permitted");
  return new ConvexHttpClient(url);
}
export async function signedInBackend(
  page: Page,
  role: "OWNER" | "CASHIER" | "NONSTAFF" = "OWNER",
) {
  await page.goto("/admin/chats");
  await clerk.signIn({ page, emailAddress: process.env[`E2E_${role}_EMAIL`]! });
  const token = await page.evaluate(() =>
    window.Clerk.session!.getToken({ template: "convex" }),
  );
  expect(Boolean(token)).toBe(true);
  const client = localBackend();
  client.setAuth(token!);
  return client;
}
/** Actual persisted web transcript; staff replies stay on the web channel and never send externally. */
export async function seedTranscript(
  page: Page,
  label: string,
  messages: { role: "user" | "assistant"; content: string }[],
) {
  const ownerContext = await page.context().browser()!.newContext();
  const ownerPage = await ownerContext.newPage();
  let clerkSessionId: string | undefined;
  try {
    const owner = await signedInBackend(ownerPage);
    clerkSessionId = await ownerPage.evaluate(() => window.Clerk.session?.id);
    const guest = localBackend();
    const credentials = await guest.mutation(api.messaging.chat.createSession, {
      channel: "web",
      visitorId: `e2e:${label}:${crypto.randomUUID()}`,
    });
    await owner.mutation(api.messaging.adminChat.setAiPaused, {
      sessionId: credentials.sessionId,
      paused: true,
    });
    for (const message of messages) {
      if (message.role === "user")
        await guest.mutation(api.messaging.chat.sendMessage, {
          ...credentials,
          content: message.content,
          clientMessageId: crypto.randomUUID(),
        });
      else {
        const requestId = crypto.randomUUID();
        await owner.mutation(api.messaging.adminReply.claim, {
          sessionId: credentials.sessionId,
          requestId,
          content: message.content,
        });
        await owner.mutation(api.messaging.adminReply.complete, { requestId });
      }
    }
    await owner.mutation(api.messaging.adminChat.setAiPaused, {
      sessionId: credentials.sessionId,
      paused: false,
    });
    await page.addInitScript(({ sessionId, guestToken }) => {
      localStorage.setItem("sv_chat_session_id", sessionId);
      localStorage.setItem(`sv_chat_session_id:token:${sessionId}`, guestToken);
    }, credentials);
    return credentials.sessionId;
  } finally {
    try {
      if (clerkSessionId) {
        if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
          throw new Error("Only test-tenant session cleanup is permitted");
        const { clerkClient } = await import("@clerk/tanstack-react-start/server");
        await clerkClient({
          secretKey: process.env.CLERK_SECRET_KEY,
        }).sessions.revokeSession(clerkSessionId);
      }
    } finally {
      await ownerContext.close();
    }
  }
}
export async function serverTranscript(page: Page) {
  const credentials = await storedGuestCredentials(page);
  return localBackend().query(api.messaging.chat.getMessages, credentials);
}

async function storedGuestCredentials(page: Page) {
  const credentials = await page.evaluate(() => {
    const sessionId = localStorage.getItem("sv_chat_session_id")!;
    return {
      sessionId,
      guestToken: localStorage.getItem(
        `sv_chat_session_id:token:${sessionId}`,
      )!,
    };
  });
  return {
    ...credentials,
    sessionId: credentials.sessionId as Id<"conversations">,
  };
}

/** Wait for persisted impressions so follow-up checks cannot accidentally pass on untracked fallback chips. */
export async function expectInitialSuggestionsTracked(page: Page) {
  await page.waitForFunction(() => {
    const id = localStorage.getItem("sv_chat_session_id");
    return id && localStorage.getItem(`sv_chat_session_id:token:${id}`);
  });
  const credentials = await storedGuestCredentials(page);
  for (const batch of [["availability", "totalPrice", "direct", "tour", "guests"], ["contact"]] as const) {
    await expect.poll(() => localBackend().query(api.messaging.chatSuggestions.nextForSession, {
      ...credentials, candidateSuggestionIds: [...batch], limit: 5,
    })).toEqual([]);
  }
}

export async function expectServerReplies(page: Page, count: number) {
  await expect
    .poll(
      async () =>
        (await serverTranscript(page)).filter((row) => row.role === "assistant")
          .length,
    )
    .toBe(count);
  const replies = (await serverTranscript(page)).filter(
    (row) => row.role === "assistant",
  );
  for (const reply of replies)
    await expect(
      page
        .getByTestId("chat-messages")
        .getByText(reply.content, { exact: true })
        .first(),
    ).toBeVisible();
}
