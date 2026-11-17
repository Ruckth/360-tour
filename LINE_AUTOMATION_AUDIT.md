# LINE Automation Audit

Use this checklist when LINE receives a message but the guest sees the wrong reply, duplicate replies, no bot reply, an invalid customer link, or an empty admin transcript.

## Expected Production Settings

### LINE Official Account Manager

Open LINE Official Account Manager for `Help guest stay`, then check **Settings -> Response settings**.

- `Webhook`: ON
- `Response method`: manual chat only, not manual chat plus automatic response messages
- `Auto-response messages`: OFF for normal guest messages
- `Greeting message`: optional; keep it separate from normal message automation

If guests see the Thai message that says the account cannot reply to messages, LINE OA automatic responses are still active. That message is not sent by this codebase.

### LINE Developers Console

Open the Messaging API channel used by the official account.

- Webhook URL: `https://wary-toad-189.convex.site/line/webhook` (the production Convex HTTP actions host; see the webhook table in [DEPLOYMENT.md](DEPLOYMENT.md)). The webhook runs inside Convex (`convex/http.ts` → `convex/messaging/ingress.ts`), not on the Next.js site.
- Webhook verification must return HTTP 200
- `LINE_CHANNEL_SECRET`: Basic settings -> Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging API -> Channel access token

If guest replies fail with a 401 from LINE, reissue the channel access token and update it in the Convex production environment (and in Vercel, which still uses it for staff replies from the admin inbox).

### Convex Production Environment

Check the production deployment's environment variables in the Convex dashboard.

```env
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
SITE_URL=https://tour.helpgueststay.com
```

`SITE_URL` must be the public site origin only. Do not set it to the webhook URL or any URL with a path. Vercel keeps `LINE_CHANNEL_ACCESS_TOKEN` for staff replies and `LINE_CHANNEL_SECRET` only as a configuration-status mirror; see [DEPLOYMENT.md](DEPLOYMENT.md).

## Production Smoke Test

After each LINE or environment change, run this test from the LINE app.

1. Send `See prices`.
2. Confirm LINE replies once, without the LINE OA automatic Thai message.
3. Confirm the customer link is `https://tour.helpgueststay.com/booking`.
4. Send `Which villa is best for 4 adults and 2 kids?`.
5. Confirm the AI fallback replies within one message.
6. Open Admin chat and confirm the LINE session shows inbound and assistant messages.
7. Check the Convex production logs for no `/line/webhook` 401 (`Invalid signature`) or 503 (`Could not persist delivery`) responses and no function errors, and the conversation's delivery status in Admin chat.

## Symptom Guide

| Symptom | Most likely cause | What to check |
| --- | --- | --- |
| Thai automatic message appears before the bot reply | LINE OA auto-response is still enabled | Response settings -> response method and auto-response rules |
| Webhook receives events but no guest reply | Invalid or expired `LINE_CHANNEL_ACCESS_TOKEN` | Delivery status in Admin chat and Convex logs, then reissue the token in Convex |
| LINE Developers Verify returns 401 | Wrong `LINE_CHANNEL_SECRET` | Basic settings channel secret and the Convex production env |
| Admin shows a LINE session but no assistant reply | Reply failed after inbound was recorded | Delivery status in the Admin chat detail and Convex logs |
| Customer link contains a webhook path | Convex `SITE_URL` includes a path | Convex production `SITE_URL` |
| Same guest message appears twice | LINE redelivery or retry issue | Convex `channelEvents` (deduplicated by channel and event key) and event status |

## Local Verification

Run before shipping LINE changes.

```sh
pnpm check:fast
pnpm verify
```

The unit tests cover LINE signature verification, exact FAQ matching, postback quick replies, duplicate event idempotency, inbound transcript visibility when replies fail, and customer URL normalization.
