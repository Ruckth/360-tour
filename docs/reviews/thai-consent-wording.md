# Thai consent banner wording: proposals for native review

Status: **awaiting a native Thai speaker.** Nothing here has been applied. `messages/th.json` → `Consent` is unchanged.

The banner (`src/components/global/AnalyticsConsent.tsx`) asks guests whether we may measure their visits. Its English source is `messages/en.json` → `Consent`. Each proposal below must keep the English meaning exactly. It may not widen what the guest agrees to, add purposes, drop the "stays off until you agree" promise, or make declining harder to find.

How to review: for each key, approve the proposal, approve the current text, or write your own wording. If you write your own, please add a back-translation so the meaning can be checked against the English.

## `Consent.label`

The accessible name of the banner dialog. Screen readers announce it; it is not shown on screen.

| | |
|---|---|
| English source | Measurement choice |
| Current Thai | ตัวเลือกการวัดผล |
| Proposed Thai | ตัวเลือกการวัดผล (no change proposed) |
| Back-translation | Measurement choice |
| Meaning check | Unchanged. The current text is already a direct, natural rendering, so no change is proposed. |

## `Consent.message`

| | |
|---|---|
| English source | May we count page views and remember your visits for 30 days, to learn which of our links and QR codes work? Nothing is shared with advertisers, and this stays off until you agree. |
| Current Thai | เราขอนับการเข้าชมหน้าเว็บและจดจำการเข้าชมของคุณเป็นเวลา 30 วัน เพื่อดูว่าลิงก์และคิวอาร์โค้ดใดของเราได้ผลได้ไหม เราไม่แชร์ข้อมูลใดกับผู้ลงโฆษณา และจะปิดอยู่จนกว่าคุณจะยินยอม |
| Proposed Thai | เราขอนับการเข้าชมหน้าเว็บและจดจำการเข้าชมของคุณไว้ 30 วันได้ไหม เพื่อดูว่าลิงก์และคิวอาร์โค้ดใดของเราได้ผล เราไม่แชร์ข้อมูลใดกับผู้ลงโฆษณา และการวัดผลนี้จะปิดอยู่จนกว่าคุณจะยินยอม |
| Back-translation | May we count page views and remember your visits for 30 days, to see which of our links and QR codes work? We don't share any information with advertisers, and this measurement stays off until you agree. |
| Meaning check | Unchanged. The same three actions are covered (count page views, remember visits, for 30 days), with the same single purpose (which links and QR codes work), the same no-advertisers statement and the same off-until-you-agree default. |

What changes and why:

- In the current text, the question particle ได้ไหม comes after ได้ผล, so the end of the sentence reads "...to see whether our links and QR codes can work". The request for permission gets lost. The proposal moves ได้ไหม to the end of the request ("...for 30 days, may we?") so the sentence asks permission, as the English does.
- The last clause, จะปิดอยู่จนกว่าคุณจะยินยอม, has no subject ("[it] will stay off..."). The proposal names it, การวัดผลนี้ ("this measurement"). The English "this" refers to the measurement, so the meaning is the same.
- เป็นเวลา 30 วัน becomes ไว้ 30 วัน ("keep for 30 days"), which reads more naturally after จดจำ. The duration is the same.

A more formal alternative, if the reviewer prefers a statement over a question:
เราขออนุญาตนับการเข้าชมหน้าเว็บและจดจำการเข้าชมของคุณไว้ 30 วัน เพื่อดูว่าลิงก์และคิวอาร์โค้ดใดของเราได้ผล เราไม่แชร์ข้อมูลใดกับผู้ลงโฆษณา และการวัดผลนี้จะปิดอยู่จนกว่าคุณจะยินยอม
(Back-translation: "We ask your permission to count page views and remember your visits for 30 days, to see which of our links and QR codes work. ..." The rest is the same as the proposal.) This keeps the meaning too: it still asks for permission, and nothing is on until the guest agrees.

## `Consent.details`

The link to the privacy policy.

| | |
|---|---|
| English source | Privacy policy |
| Current Thai | นโยบายความเป็นส่วนตัว |
| Proposed Thai | นโยบายความเป็นส่วนตัว (no change proposed) |
| Back-translation | Privacy policy |
| Meaning check | Unchanged. This is the standard Thai term, and the privacy page title (`Legal.privacy.title`) uses the same words. |

## `Consent.decline`

The button that refuses measurement.

| | |
|---|---|
| English source | No thanks |
| Current Thai | ไม่ ขอบคุณ |
| Proposed Thai | ไม่อนุญาต |
| Back-translation | Don't allow |
| Meaning check | Unchanged in effect: the button still refuses the request, and nothing is measured. It now pairs with the accept button (อนุญาต, "Allow"), so the two choices read as clear opposites. |

Why: ไม่ ขอบคุณ, with a space, is a word-for-word copy of the English and reads as translated text. ไม่เป็นไร ("never mind") was considered and rejected, because on a consent button some readers could take it as "that's fine", meaning yes. ไม่อนุญาต cannot be misread. If the reviewer wants something less formal, ไม่ล่ะ ขอบคุณ ("No, thank you") also keeps the meaning.

## `Consent.accept`

The button that allows measurement.

| | |
|---|---|
| English source | Allow |
| Current Thai | อนุญาต |
| Proposed Thai | อนุญาต (no change proposed) |
| Back-translation | Allow |
| Meaning check | Unchanged. Direct and natural. |

## Questions for the reviewer

1. `Consent.message`: should the banner ask a question (the proposal, ending in ได้ไหม) or make the more formal ขออนุญาต request (the alternative)?
2. `Consent.decline`: is ไม่อนุญาต too blunt for a guest-facing hotel site? If so, is ไม่ล่ะ ขอบคุณ acceptable?
3. The privacy page now uses the same words as the banner: การวัดผล (measurement), คิวอาร์โค้ด (QR code), ผู้ลงโฆษณา (advertisers). Please also read the new `Legal` strings in `messages/th.json`, especially:
   - `Legal.privacy.measurementConsent`: the new retention sentence, บันทึกการเข้าชมและบันทึกการเปิดลิงก์ฉบับดิบ ("raw visit and link-open records"). Does ฉบับดิบ read naturally, or is something like ข้อมูลดิบ better?
   - `Legal.choice.*`: the on/off status and the "for this page only" explanation.
   - `Legal.lastUpdated`: it uses the Buddhist Era year (2569 = 2026 CE). Is that right for this page, or should it show 2026?
