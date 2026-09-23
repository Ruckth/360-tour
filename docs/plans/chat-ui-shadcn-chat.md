# Plan: Chat UI refresh with shadcn-chat

Reference: https://github.com/jakobhoeg/shadcn-chat

## Goal
Make the web chat look and feel cleaner with shadcn-chat components, without breaking the existing behaviour:
- sessions
- message cache
- suggestions
- booking card
- browser handoff
- mobile keyboard handling

## Current state
- `src/components/chat/AIChatWidget.tsx` is ~2,260 lines. It mixes logic with UI and includes hand-tuned mobile keyboard inset code (see commit `b125a85`, "Fix mobile chat composer").
- Supporting UI (keep these):
  - `ChatBookingCard.tsx`
  - `ChatVillaTourCard.tsx`
  - `MessagingButtons.tsx`
  - `ContactAppBrandIcon.tsx`
- shadcn/ui is already set up (`components.json`, `src/components/ui/*`).

## Approach: change only the visual parts, keep the logic

1. **Spike (½ day)**
   - Install the shadcn-chat components through the shadcn registry: `ChatBubble` (avatar / message / timestamp / loading), `ChatMessageList`, `ChatInput`, `ExpandableChat`.
   - Check they work with Tailwind v4 + React 19. If they don't install cleanly, copy the component source into `src/components/ui/chat/` and adapt it.
2. **Refactor first, with no visual change**
   - Split `AIChatWidget.tsx` into:
     - `useChatSession.ts`: session, cache, send/recover, suggestions, booking-intent state
     - `ChatShell.tsx`: panel/page container, keyboard inset, sticky-bar open
     - `ChatMessages.tsx`
     - `ChatComposer.tsx`
   - Existing unit + Playwright tests must still pass before any styling changes.
3. **Swap the components**
   - Message rendering → `ChatBubble`. Keep `renderMessage` for links/markdown.
   - `TypingIndicator` → `ChatBubble` loading variant.
   - Message area → `ChatMessageList` (auto-scroll). Remove the custom scroll code it replaces.
   - Composer → `ChatInput` (Enter to send, Shift+Enter for a newline). Keep the current input handling so the keyboard inset logic keeps working.
   - Floating widget → `ExpandableChat`. The `/chat` full page uses the same pieces without the expandable wrapper.
   - Render `ChatBookingCard`, `ChatVillaTourCard`, `SuggestionChips` and the contact buttons inside or below assistant bubbles.
4. **Admin reuse (optional)**
   - Use `ChatBubble` in the `AdminChatDashboard` transcript so the admin and guest views match.
5. **Verify**
   - `pnpm verify` + `pnpm test:e2e`.
   - Before/after screenshots:
     - desktop widget
     - `/chat` page
     - mobile widget with the keyboard open
     - Thai text and a very long message
   - Manual checks on iOS Safari and in the LINE / Facebook in-app browsers (keyboard + external-browser handoff). Use Codex computer use for the device clicking.

## Out of scope
- Changing AI behaviour or booking logic (see `ai-chat-booking.md`).
- New visual branding. Keep the current colours and fonts, mapped onto shadcn tokens.

## Risks
- Regressions in the mobile keyboard / composer. Mitigation: refactor first (step 2), then swap one component at a time, one commit each.
- shadcn-chat may not be actively maintained. We own the copied source, so there is no runtime dependency on the repo.

## Order / PRs
1. PR 1: Refactor split (no visual change).
2. PR 2: Swap components + screenshots.
3. PR 3 (optional): Admin transcript reuse.
