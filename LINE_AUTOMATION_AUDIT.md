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

- Webhook URL: `https://tour.helpgueststay.com/api/line/webhook`
- Webhook verification must return HTTP 200
- `LINE_CHANNEL_SECRET`: Basic settings -> Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging API -> Channel access token

If Vercel logs show `LINE reply failed (401)` or `Authentication failed`, reissue the channel access token, update Vercel, and redeploy production.

### Vercel Production Environment

Check the production environment variables.

```env
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
SITE_URL=https://tour.helpgueststay.com
```

`SITE_URL` must be the public site origin only. Do not set it to the webhook URL or any URL with a path. After changing any environment variable, redeploy production.

## Production Smoke Test

After each LINE/Vercel change, run this test from the LINE app.

1. Send `See prices`.
2. Confirm LINE replies once, without the LINE OA automatic Thai message.
3. Confirm the customer link is `https://tour.helpgueststay.com/booking`.
4. Send `Which villa is best for 4 adults and 2 kids?`.
5. Confirm the AI fallback replies within one message.
6. Open Admin chat and confirm the LINE session shows inbound and assistant messages.
7. Check Vercel logs for no `Invalid LINE signature`, no `LINE reply failed (401)`, and no Convex mutation error.

## Symptom Guide

| Symptom | Most likely cause | What to check |
| --- | --- | --- |
| Thai automatic message appears before the bot reply | LINE OA auto-response is still enabled | Response settings -> response method and auto-response rules |
| Webhook receives events but no guest reply | Invalid or expired `LINE_CHANNEL_ACCESS_TOKEN` | Vercel logs for `401`, then reissue token and redeploy |
| LINE Developers Verify returns 401 | Wrong `LINE_CHANNEL_SECRET` | Basic settings channel secret and Vercel env |
| Admin shows a LINE session but no assistant reply | Reply failed after inbound was recorded | Admin LINE delivery panel and Vercel logs |
| Customer link contains `/api/line/webhook/...` | `SITE_URL` includes a path or old deployment is still live | Vercel env and latest deployment commit |
| Same guest message appears twice | LINE redelivery or retry issue | Convex `lineWebhookEvents` duplicate handling and event status |

## Local Verification

Run before shipping LINE changes.

```sh
pnpm check
pnpm lint
pnpm test:unit
pnpm build
```

The unit tests cover LINE signature verification, exact FAQ matching, postback quick replies, duplicate event idempotency, inbound transcript visibility when replies fail, and customer URL normalization.
