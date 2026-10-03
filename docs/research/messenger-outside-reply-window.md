# Messenger replies after the messaging window

Researched 2026-10-01 against Meta primary documentation. Scope: the screenshot shows a Facebook guest asking about availability, with the last guest message 111 days ago. No confirmed booking or marketing subscription is established in that screenshot.

## Conclusion for this guest

Payment can enable a **different Messenger product: paid Marketing Messages**. It does not turn an expired ordinary reply into an unrestricted `RESPONSE` send. A paid direct send can target a particular customer and contain personalized freeform content, **provided that customer is an eligible subscriber and the business/app is onboarded**. Therefore the next practical step is to check this Page's subscription tokens for this guest, rather than unlock the ordinary composer. [Meta Marketing Messages overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger), [Meta FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq), [Get subscription tokens](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/get-subscription-tokens)

## Options and boundaries

| Route | What Meta permits | Consequence for the 111-day conversation |
| --- | --- | --- |
| Ordinary Messenger reply | Standard window is generally 24 hours; it may last up to seven days after a person's first message following a Click-to-Messenger ad. | Both are long expired. [Policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/) |
| Human Agent | A human may respond within a separate seven-day period. | Does not cover 111 days. [Policy](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview/) |
| Paid Marketing Message | Initiate chat with subscribers outside the standard window; direct-send supports customized freeform messages to specified individuals. | Potentially usable if the guest already has a valid subscription token and all eligibility requirements pass. [Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger), [FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq) |
| Click-to-Messenger ad | An ad attracts a customer back to chat; onboarded businesses' customers who click **and respond** are subscribed. | Paid re-engagement opportunity, not guaranteed delivery of a reply to this particular old PSID. [Audience guide](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/grow-marketing-messages-audience) |
| Utility Message | Approved non-marketing templates for order/account updates and appointment/event reminders. Requires `page_utility_messaging`, Page token, recipient PSID, and template management. | A real booking confirmation/reminder can fit. An arbitrary availability/sales follow-up is not established as an eligible utility use case by this transcript. [Utility guide](https://developers.facebook.com/docs/messenger-platform/send-messages/utility-messages/) |
| Legacy Sponsored Messages | Creation was deprecated in Marketing API v20 and all versions from August 19, 2024. | Do not propose the old sponsored-message ad format as a new integration. [v20 changelog](https://developers.facebook.com/docs/graph-api/changelog/version20.0/) |

The general policy page still mentions sponsored messages and message tags. For sponsored-message creation, the explicit dated v20 changelog takes precedence over that generic description. Do not implement old tag examples based only on undated snippets.

## Paid Marketing Messages: requirements and cost

The current overview requires a tech-provider app with Meta App Review for `ads_management`, `pages_messaging`, and `paid_marketing_messages` **or** `marketing_messages_messenger`, plus Facebook Login for Business and business onboarding. Existing businesses must re-login to agree to the additional permissions. The overview also describes direct business integration; whether this existing app meets the provider/access requirements must be checked in Meta, not inferred from its current ability to send normal Messenger replies. [Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger)

**Thailand is an eligible business location.** Recipient locations excluded by the current overview are EU, Japan, South Korea, Australia, and UK. The guest's location is not established by the screenshot. [Overview](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger)

Meta bills the sending business for messages **delivered to the user's device**, on the same bill as Meta ads. A valid payment method/ad account and daily or lifetime budget are needed. The FAQ limits a Page to one marketing message per unique user per day. Pricing is estimated using Ads Manager or the Estimation API; the FAQ's $1 example is hypothetical, not a quoted price. No fixed Thai per-message price was verified. [FAQ, updated September 28, 2026](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq)

## Getting consent/subscription

A bare PSID is not a marketing subscription. Meta's current subscriber methods include an existing subscription, an explicit in-thread opt-in after the customer messages, Click-to-Messenger click-and-response, and a CRM customer-list upload. [Audience guide, updated June 21, 2026](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/grow-marketing-messages-audience)

CRM uploads require email or phone; **PSIDs cannot be uploaded**. Meta's guide describes uploading people already subscribed/consented to marketing communication. Subscription-token retrieval from an uploaded audience requires at least **100 matched users**, so uploading this single old PSID is not a supported shortcut. [Audience guide](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/grow-marketing-messages-audience), [FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq)

Page subscription-token lookup returns PSID for normal subscriptions; CRM-created token responses omit individual recipient IDs. Check token status, expiry, and next eligible send time before claiming this specific guest can receive a direct paid message. [Token guide](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/get-subscription-tokens)

Legacy recurring notifications are not the recommended new integration: Meta's current FAQ says they stopped globally on February 10, 2026, except AU/EU/JP/KR/UK. Thailand is not an exception. [FAQ](https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger/faq)

## Recommended product direction

Keep the expired ordinary reply disabled. Replace the absolute implication “you can only wait” with accurate conditional guidance: paid marketing may be available for subscribed guests; utility messages may be available for approved service updates. Before showing an actionable paid-send button, integrate account eligibility, subscription lookup, budgets/estimation, and send/reporting. Until those checks exist, show the current reply-window restriction without pretending that all other Meta products are impossible.

No messages were sent, no ad campaigns created, and no implementation changed during this research.

## Evidence access

The web fetcher received HTTP 429 for several Meta developer URLs. Public primary pages were successfully downloaded directly with `curl`/Python urllib and parsed without login. Local research caches: `/tmp/meta-new-overview-md.txt` (English Markdown); `/tmp/meta-new-faq.txt` (English, September 28, 2026); `/tmp/meta-new-grow.txt` (English, June 21, 2026); `/tmp/meta-new-tokens.txt`; `/tmp/meta-policy-en.txt`; `/tmp/meta-utility-en.txt`; `/tmp/meta-v20.html`; `/tmp/meta-blog-en.txt`. These are verification caches, not repository deliverables. Only Meta sources support the conclusions above.
