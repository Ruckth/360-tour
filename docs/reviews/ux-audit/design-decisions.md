# Locked design decisions

Taste calls that fresh graders reversed between rounds. They are settled; graders should score defects in how they're executed, not re-argue the choice.

| Topic | Decision | Why |
|---|---|---|
| Choice-control tones | *Strong* (`bg-foreground` selected) only for the checkout tender/mode track; *subtle* (`tone="subtle"`) for every other filter, view switch, form toggle and the per-payment method picker in split. | The tender choice is the one money-critical selection on screen; everything else should recede. |
| Receipt line "Refund" | Ghost button, neutral text; "Link appointment" outline. | Refund is the rarer, secondary action on a paid line. |
| Hotel month grid | Rows grow with content; the page scrolls, never an inner scroller; "+N more" only on real overflow. | Hiding stays behind "+N more" in an otherwise empty week cost more than a taller page. |
| Coupon summary | Single `max-w-3xl` column; Summary card appears below the form once a valid discount exists. | Removes both the empty right column and the layout jump on first digit. |
| Team rows | The ⋯ column is reserved on every row at every width. | Change buttons align in one column. |
| Invite state | Pending = amber warning badge "Invited · expires <date>"; expired = destructive. | Distinct from neutral role badges; amber = waiting on someone. |
| Appointment "Mark arrived" | Inline with the status badge, default size. | It changes that status; it belongs beside it. |
| Split summary | "Covered ✓" only when every payment has an amount; "Over by" when over; otherwise just the validation line. | Never claim money is allocated while a payment is empty. |
| Approval expiry | Display only ("Expiring now"); the server decides. | A fast device clock must never block a valid approval. |
| Browser Back/Forward with unsaved drafts | Not intercepted; reload/close and in-app links are guarded. | App Router offers no reliable interception; faking history entries breaks navigation. |
