# Convex query audit และแผน optimize

วันที่: 2026-09-30 · Base commit: `d02f644` + working tree ปัจจุบัน

## ผลตรวจและขอบเขต

ควรเริ่มจากแก้การตัดข้อมูลใน booking overlap/calendar และ iCal cleanup จากนั้นลด read amplification ของ admin chat/knowledge และจำกัดขอบเขต availability query ก่อนพิจารณาแยก presence หรือทำ summary table เพิ่ม

- ตรวจ inventory ของ backend 58 ไฟล์ ไม่รวม generated, seeds, tests และ declaration files: พบ exported query 69 และ internalQuery 16 ฟังก์ชัน ตรวจเส้นทางหลักเชื่อมถึง React callsites และ mutation ที่เกี่ยวข้อง
- ไม่พบ `.collect()` ใน backend ที่นับข้างต้น และไม่พบ database `.filter(q => ...)` จาก static scan แต่มี JavaScript filtering หลัง `take()` และ async iteration ที่ยังอ่านได้มากโดยไม่มีเพดาน
- `npx convex insights --details` รายงาน “No issues found” ใน 72 ชั่วโมงล่าสุด บน deployment `optimistic-turtle-573` ที่ CLI เลือก ไม่มีการใช้ `--prod` จึงไม่สรุปว่า production ผ่านการตรวจ
- ยังไม่มี baseline p95 latency, bytes/read, subscription reruns หรือขนาดตารางจริง การจัดลำดับด้าน performance อาศัย read path ที่เห็นในโค้ด ไม่ใช่ค่าใช้จ่ายที่วัดแล้ว
- Existing tests: 6 files / 93 tests ผ่าน เพิ่ม temporary local probes 3 กรณีเพื่อยืนยันพฤติกรรมเมื่อเกิน 500 records แล้วลบไฟล์ probe ออก การที่ probes ผ่านหมายถึง reproduce ปัญหาได้ ไม่ได้หมายถึงแก้ปัญหาแล้ว
- งานรอบนี้เพิ่มเฉพาะเอกสาร ไม่มี implementation change, deploy, backfill หรือ production mutation

แนวทางที่ใช้: [project Convex guidelines](../../convex/_generated/ai/guidelines.md), [performance audit skill](../../.agents/skills/convex-performance-audit/SKILL.md), [migration helper skill](../../.agents/skills/convex-migration-helper/SKILL.md) และ [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)

## Findings เรียงตามลำดับที่ควรทำ

P1 = ยืนยันปัญหาความถูกต้องภายใต้ข้อมูลจำลอง; P2 = เส้นทางที่อ่านกว้าง/เสี่ยงชน budget; P3 = ปรับปรุงตามข้อมูลการใช้งาน

| ID  | Priority | จุดตรวจ                                                        | หลักฐาน / ผลกระทบ                                                                                                                          | แนวแก้                                                                                  |
| --- | -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| F1  | P1       | `availability.isAvailable`, `lib/bookingWrites.assertStayFree` | `by_property_checkIn` มีแค่ upper bound และ `take(500)` แบบ ascending ประวัติเก่าสามารถบัง booking ใหม่ ทำให้ fallback ตรวจ overlap ไม่ครบ | ใช้ index/range ที่ตัดประวัติเก่า และตรวจครบก่อนบอกว่าว่าง                              |
| F2  | P1       | `adminBookings.listForAdmin`                                   | อ่าน 500 check-ins ล่าสุดก่อน `checkOut > from` ทำให้ long stay ที่ยัง overlap หลุดจาก calendar; dateBlocks ใช้ pattern คล้ายกัน           | range ที่รองรับ overlap + continuation หรือ completeness guard                          |
| F3  | P1       | `ical.removeSource`, `updateSource`, `applySource`             | จัดการแถวของ source แค่ 500; remove ลบ parent แต่เหลือ child ได้                                                                           | batch cleanup ที่ทำจนหมด พร้อมป้องกัน sync ระหว่างลบ                                    |
| F4  | P2       | `availability.getBlockedDatesByProperty`                       | สูงสุด 100 properties × 731 availability rows; actual booking UI ขอทั้งปี ทุก property                                                     | โหลด property ที่เลือก/ช่วงเดือนที่มองเห็น และกำหนด range/read budget                   |
| F5  | P2       | `adminChat.listSessions` และ `chat.touchSession`               | filter 100 sessions เพื่อแสดง 10; latest-message lookup ซ้ำ; heartbeat ทุก 30 วินาที patch session ที่ admin อ่าน                          | ใช้ metadata ที่ตรวจแล้ว, index filter ที่ใช้จริง, ลด join; แยก presence หากผลวัดรองรับ |
| F6  | P2       | `chatKnowledge.adminListAnswers`                               | ต่อ answer อ่านได้ 1,000 approved + 100 suggested + 100 rejected questions พร้อม topics/scopes/property joins                              | แยก list preview กับ detail/edit query; paginate child questions                        |
| F7  | P2       | approved context / unknown groups / curated exact resolution   | จำกัด candidates ก่อนเลือก scope หรือ exact match; unknown panel อ่าน 500 unknown + 300 answers + 1,000 questions                          | จำกัดด้วย scope ก่อน, reuse reads, แยก suggestion/detail work                           |
| F8  | P2       | `adminBookings.searchBookings`, `findGuests`                   | scan 1,000 bookings ต่อ search; ข้อมูลเก่าหลุด, stays เป็นจำนวนใน sample                                                                   | normalized exact indexes + search ที่ระบุ semantics ชัด                                 |
| F9  | P2       | `migrations.backfillChatMessages`                              | อ่าน 5,000 sessions ใน transaction เดียว; รันซ้ำยังเริ่มหน้าเดิม จึงไปไม่ถึง session หลัง 5,000                                            | resumable batched migration และตรวจ completeness                                        |
| F10 | P3       | services/roster, review aggregates, indexes                    | บาง loop อ่าน future appointments ทั้งหมด; review edit recompute ทุก review; prefix indexes หลายคู่                                        | ใช้ early exit/range ที่เหมาะสม แล้ว optimize ตาม metrics                               |

### F1: Booking overlap ต้องอ่านครบ

อ้างอิง: [availability.ts](../../convex/availability.ts), [bookingWrites.ts](../../convex/lib/bookingWrites.ts), [bookings.ts](../../convex/bookings.ts), [availabilityWrites.ts](../../convex/lib/availabilityWrites.ts)

Probe: ใส่ 500 confirmed bookings ในอดีต แล้วใส่ confirmed booking วันที่ 2030-01-01 โดยไม่มี availability mirror เรียก `isAvailable` สำหรับคืนเดียวกัน ได้ `true` และ `bookings.create` ยอมสร้าง pending booking

เงื่อนไขสำคัญ: หาก availability mirror ครบ เส้นทางปัจจุบันยังตรวจ conflict จาก mirror ได้ ผลนี้ยืนยันว่า fallback บน bookings ไม่ปลอดภัยเมื่อมี legacy/inconsistent mirrors ไม่ใช่หลักฐานว่าทุก booking ปัจจุบันเกิด double booking

แผน:

1. รวม overlap predicate เป็น helper ใช้ทั้ง `isAvailable` และ `assertStayFree`; รักษา `[checkIn, checkOut)` และ `excludeBookingId`
2. เริ่มจาก `by_property_checkOut` ที่มีอยู่ โดย `propertyId = selected` และ `checkOut > requestedCheckIn` เพื่อไม่อ่านอดีตทั้งหมด ตรวจ `checkIn < requestedCheckOut` และ blocking status ต่อใน bounded iteration
3. ถ้ายังต้อง scan future rows มาก ให้เพิ่ม `by_propertyId_and_status_and_checkIn` แล้วอ่าน confirmed/completed แยกกัน กำหนด lower bound จาก max stay 365 วันได้หลังตรวจว่า legacy rows ปฏิบัติตาม invariant นี้จริงเท่านั้น
4. หากอ่านไม่ครบภายใน budget ต้องคืน explicit error/incomplete state; ห้ามแปลเป็น “available” หรือใช้ `take(500)` เป็นหลักฐานว่าไม่มี conflict
5. ตรวจ mirror writers ทุกเส้นทาง: payment confirmation, admin create/edit/status change, chat confirm/cancel, expiration และ iCal/manual blocks การตัดสินใจจอง/ชำระเงินต้องอยู่ใน mutation ที่ตรวจ conflict แบบ atomic

ไม่เสนอ compound index ที่ใส่ inequality บนทั้ง `checkIn` และ `checkOut` พร้อมกัน: Convex index range รองรับ equality prefix ตามด้วย range ของ field ถัดไป จึงยังต้องมี residual overlap predicate หรือ data model สำหรับ occupancy โดยเฉพาะ ดู [Indexes](https://docs.convex.dev/database/reading-data/indexes/)

### F2: Calendar อย่าจำกัด candidates ก่อนตรวจ overlap

อ้างอิง: [adminBookings.ts](../../convex/adminBookings.ts)

Probe: confirmed stay 2030-01-01 ถึง 2030-04-01 และ 500 cancelled bookings check-in 2030-02-01 เมื่อเปิด calendar 2030-03-01 ถึง 2030-03-08 ผลลัพธ์ไม่มี confirmed stay นั้น

- กำหนด max calendar range ให้สอดคล้อง UI; validate `from < to`
- ใช้ bounded overlap window หลัง verify max duration ของ legacy bookings; อย่าซ่อน pending/cancelled หาก UI ยังต้องแสดง
- หาก window มี records เกินเพดาน ให้ paginate candidates พร้อม continuation และบอก completeness หรือแยกตาม selected property; ห้าม slice แล้วทำเหมือนข้อมูลครบ
- ตรวจ `dateBlocks` ซึ่งอ่าน 100 blocks ก่อน filter `end > from` และ OTA rows ที่จำกัด 400 ด้วย หลาย source สามารถมีหลาย availability rows ต่อวัน

### F3: iCal cleanup และ sync ที่จบครบทุกแถว

อ้างอิง: [ical.ts](../../convex/ical.ts), [schema.ts](../../convex/schema.ts)

Probe: source มี 501 availability rows หลัง `removeSource` parent หาย แต่เหลือ blocked row 1 แถวที่อ้าง source เดิม

- เพิ่ม lifecycle เช่น optional `deleting` หรือ state ของ source แล้วให้ `applySource` ข้าม source ที่กำลังลบ
- ลบ child rows เป็น batch โดยใช้ existing `by_icalSourceId` แล้ว schedule continuation ผ่าน internal mutation; ลบ parent เมื่อไม่มี child เหลือ
- `updateSource` เปลี่ยน platform และ `applySource` reconciliation ต้องจัดการมากกว่า 500 rows ได้ครบเช่นกัน
- Normal sync ขอ rolling feed 366 วันและ reconcile old rows ดังนั้น source ที่สะอาดและใช้ writer นี้อย่างเดียวควรอยู่ในขอบเขตนี้ กรณี >500 ต้องมี legacy/imported/inconsistent rows หรือ internal caller ที่ส่ง dates เกิน horizon; ยังไม่ได้ตรวจว่ามีข้อมูลลักษณะนี้ใน deployment จริง
- Internal `applySource` ยังไม่ได้ enforce จำนวน dates/horizon และ remove/update สมมติว่า rows ไม่เกิน 500 จึงควรตรวจ invariant และทำ cleanup ให้ครบสำหรับข้อมูลเก่าก่อนใช้ cap เป็น correctness guarantee
- หากแยก sync หลาย transactions ต้องมี source version/generation guard กันผล sync เก่ามาเขียนหลัง URL เปลี่ยน/ลบ source และรักษา blocks ของ booking/manual/OTA source อื่น
- `syncAll` paginate sources อยู่แล้ว แต่ sync feeds แบบ sequential ทั้งหมดใน action เดียว; เมื่อมี source มาก ให้ schedule งานต่อ source พร้อมจำกัด concurrency ไม่เพิ่ม fan-out โดยไม่มี metrics

### F4: Availability แคบตามสิ่งที่ผู้ใช้กำลังดู

อ้างอิง: [availability.ts](../../convex/availability.ts), [BookingFunnel.tsx](../../src/components/booking/BookingFunnel.tsx), [ChatBookingCard.tsx](../../src/components/chat/ChatBookingCard.tsx), [inventory-cache.ts](../../src/lib/booking/inventory-cache.ts)

ทั้ง funnel และ chat booking card ขอทุก active property สำหรับทั้งปี แม้มี selected property; query ยังโหลด full property docs เพื่อใช้ `_id`

- โหลด catalog ก่อน แล้วโหลด blocked dates ของ property ที่เลือกตามช่วงเดือนที่แสดง โดยมี prefetch เดือนข้างเคียง
- หากหน้าเลือก property ต้องการ availability ทุก villa ให้จำกัดเป็นช่วงสั้นหรือแบ่ง property IDs เป็น batch พร้อม max range และ max IDs
- validation ของ `getForProperty`, `getBlockedDates`, `getBlockedDatesByProperty`, `isAvailable` ต้องมี range limit ที่สัมพันธ์กับ operation; จำนวนคืนไม่เท่ากับจำนวน rows เพราะ OTA หลาย source อาจซ้ำวัน
- พิจารณา `by_propertyId_and_status_and_date` เมื่อ measured rows ส่วนใหญ่เป็น available แล้วค่อยอ่าน booked/blocked แยกกัน ไม่เพิ่ม index ถ้า rows ส่วนใหญ่เป็น blocked อยู่แล้ว
- คง revalidation ใน booking mutation; sessionStorage TTL 5 นาทีเป็นเพียง UX cache

Worst-case เชิงโค้ด: 100 × 731 = 73,100 availability rows ใน invocation เดียว; แม้ UI ขอราว 366 วัน ถ้ามี 100 properties และมีทุกวัน ก็เป็น 36,600 rows แล้ว ตัวเลขนี้เป็น theoretical bound ไม่ใช่ขนาด deployment ที่วัดได้ และสูงกว่า 32,000 documents-scanned limit ปัจจุบัน ดู [Convex Limits](https://docs.convex.dev/production/state/limits)

### F5: Admin chat ลด candidate scans และ heartbeat invalidation

อ้างอิง: [adminChat.ts](../../convex/adminChat.ts), [adminChatMetadata.ts](../../convex/lib/adminChatMetadata.ts), [chat.ts](../../convex/chat.ts), [useChatSession.ts](../../src/components/chat/useChatSession.ts), [ChatsView.tsx](../../src/components/admin/ChatsView.tsx)

- list ใช้ `by_latestMessageAt` สำหรับ non-empty และ `by_adminSortAt` สำหรับส่วนอื่น แต่ channel/adminStatus/property/status ส่วนมากยัง filter ใน JS หลัง source page 100
- needs-reply และ date filters อ่าน latest stored message; decoration อ่าน latest stored message อีกครั้ง และอ่าน webhook event + property ตาม session
- heartbeat ทุก 30 วินาที patch `lastSeenAt`, `lastOpenedAt` พร้อม rebuild admin metadata บน `chatSessions` แม้ข้อมูล contact/path ไม่เปลี่ยน transcript query ยังอ่าน session เพื่อเช็ค existence ด้วย
- search ทำ 50 contact hits + 100 message hits + 200 fuzzy candidates, hydrate sessions แล้วใช้ offset slicing; แต่ละหน้าทำ candidate search ใหม่และ cap ก่อน filter

แผนรอบแรก:

1. ตรวจ/backfill `messageCount` และ `latestMessageAt` ให้ครบแล้วใช้ metadata ก่อน fallback; reuse latest-message lookup ภายใน invocation และ cache property joins ตาม ID
2. เพิ่มเฉพาะ indexes ตาม filter ที่มี traffic จริง เช่น `by_channel_and_latestMessageAt`, `by_adminStatus_and_latestMessageAt` หรือใช้ existing property indexes; อย่าเพิ่มทุก combination
3. Normalized admin status ต้องจัดการ legacy `undefined = open` ก่อน switch ไป `eq('adminStatus', 'open')`; metadata optional ห้าม assume backfill สำเร็จจาก comment
4. Search index filter fields เช่น channel/adminStatus/propertySlug ต้องมี normalized values ก่อนใช้งาน; อย่าทิ้ง typo tolerance เพราะ native text search ไม่มี typo tolerance
5. ลด no-op metadata writes และ property slug lookup ใน heartbeat ที่ unchanged โดยยังส่ง heartbeat ที่ presence semantics ต้องใช้

แผนรอบถัดไปเมื่อวัด reruns แล้วเห็นผลชัด: แยก `chatSessionPresence` ออกจาก stable session data ให้ heartbeat เขียนเฉพาะ presence; คง live presence subscription เฉพาะ surface ที่แสดง online state การแยกตารางจะไม่ช่วยถ้า list/detail ยัง join presence ทุก session เหมือนเดิม ต้องออกแบบ query boundary ด้วย

Client ทำ current-page subscription และ skip detail เมื่อไม่ได้เลือกอยู่แล้ว ควรรักษา behavior นี้ Transcript เป็น live pagination ที่ถูกต้องสำหรับแชท ไม่เสนอปิด realtime ของแชททั้งหมด

### F6: Knowledge list ไม่ควรโหลด edit payload ทุกแถว

อ้างอิง: [chatKnowledge.ts](../../convex/chatKnowledge.ts), [QuestionsView.tsx](../../src/components/admin/QuestionsView.tsx), [AnswerFormDialog.tsx](../../src/components/admin/AnswerFormDialog.tsx)

`adminListAnswers` เรียก `withAnswerDetails` ทุก answer แล้วอ่าน questions ทั้ง 3 statuses พร้อม topics/scopes/property. UI page size 25 จึงอ่าน questions ได้ 30,000 rows ก่อน joins; search branch คืนได้ 50 answers จึงมี theoretical bound 60,000 questions

- ออกแบบ `adminListAnswers` สำหรับ title/answer preview/status/primary question/scopes และ counts หรือ capped previews
- เพิ่ม `adminGetAnswerDetail` และ paginated questions เมื่อเปิดแถวหรือ edit dialog; UI ปัจจุบันแสดง question chips จึงต้องมี preview/load more ไม่ใช่ตัดข้อมูลโดยไม่มีทางอ่านต่อ
- Edit form ปัจจุบัน round-trip approved questions ต้องโหลดครบหรือเปลี่ยนเป็น add/remove/update commands มิฉะนั้นการบันทึกจาก preview จะลบ questions ที่ไม่ได้โหลด
- `usePaginatedQuery` keeps loaded pages live; ลด payload ต่อหน้าก่อนพิจารณาเปลี่ยนวิธี fetch
- pending-variants query ทำงานแม้ไม่ได้เปิด tab เพื่อแสดง badge; หากแพงให้ badge ใช้ bounded count/query เบา แล้วโหลด full variants เฉพาะ tab

### F7: Knowledge resolution และ unknown panel

อ้างอิง: [chatKnowledge.ts](../../convex/chatKnowledge.ts), [chatSuggestions.ts](../../convex/chatSuggestions.ts), [chatAi.ts](../../convex/chatAi.ts), [UnknownQuestionsPanel.tsx](../../src/components/admin/UnknownQuestionsPanel.tsx)

- `getApprovedContext` อ่าน approved answers 100 ล่าสุดของทั้งระบบ ก่อน scope filtering และ return 30; relevant property answer ที่เก่ากว่า 100 อาจไม่เข้าบริบท AI
- `getExactCandidates` อ่าน exact question 100 แล้ว join answer/scopes ตามลำดับ; deduplicate answer reads และ scopes ภายใน invocation ก่อนทำ data model เพิ่ม
- Multi-property/custom scopes อยู่ใน `chatAnswerPropertyScopes`; การใช้ `question.propertyId` อย่างเดียวจะไม่รักษา semantics ปัจจุบัน ต้องอ่าน scope joins/มี resolution mapping ที่ครอบคลุม global + custom + real property
- `resolveCuratedExact` โหลด score-ranked 100 global + 100 property candidates แล้ว exact-match รวม translations; low-score exact match อาจหลุด เมื่อแยก exact path ให้ทำ normalized locale variants index ที่ lookup ได้จริง; semantic ranking ยังใช้ candidate cap ได้
- unknown groups อ่าน 500 unknowns + 300 approved answers + 1,000 approved questions ทุก refresh และ join sessions เพื่อ channel; แยก answer suggestion ไปทำเฉพาะกลุ่ม/แถวที่ต้องใช้ก่อนเสนอ summary table
- `generateConciergeReply` โหลด properties → settings → approved context → recent history แบบ sequential บางข้อมูลอิสระรวมเป็น internal context query เพื่อ snapshot consistency หรือ parallel reads ถ้ายอมรับ independent snapshots ได้ อย่ารวม writes ข้าม booking tool steps/AI pause guards
- siblings ของ webhook LINE/Facebook/Instagram/WhatsApp มี flow คล้ายกัน ต้องเปลี่ยนพร้อมกัน ไม่ cache/bypass checks `isAiPaused` ที่ป้องกัน auto reply หลัง staff takeover

### F8–F10: Search, migration และงานรอง

Booking search:

- เพิ่ม normalized phone/email/code fields และ indexes สำหรับ exact lookup ก่อน full-text search; query เดิม exact phone ยังอ่าน 1,000 recent rows เสมอ
- Full-text search เป็น token/prefix ไม่ใช่ arbitrary `.includes()` โดยอัตโนมัติ และไม่มี typo tolerance; ต้องรักษาหรือระบุ UX semantics ของ name/email/phone/code อย่างชัดเจน ดู [Full Text Search](https://docs.convex.dev/search/text-search)
- `findGuests.stays` ปัจจุบันเป็น sample count; ถ้าจะให้เป็น lifetime count ต้องมี aggregation ที่ update ถูกต้องทุก booking writer มิฉะนั้นใช้ชื่อ/label ที่บอกว่าเป็นจำนวนในประวัติที่โหลด
- lead dedup ใช้ email index + 50 rows ก่อนตรวจ source/property จึงอาจ insert duplicate หลัง 50 matches; แก้ด้วย `by_email_and_source_and_propertyId` และ verify/deduplicate legacy data ก่อน `unique()`

Migration:

- `backfillChatMessages` เปลี่ยนเป็น cursor/batch หรือ migrations component และอย่า migrate embedded messages จำนวนมากทั้งหมดใน transaction เดียว
- `backfillChatSessionAdminMetadata` paginate sessions แล้ว แต่ messageCount เป็น lower bound เมื่อ transcript เกิน messageScanLimit; ถ้าจะใช้ count เป็น exact counter ต้องทำ backfill แบบนับครบพร้อม resume และรักษา concurrent message writes
- `recomputeAllSocialProof` อ่าน 200 properties แล้ว scan reviews ทุก property ใน transaction เดียว ต้อง paginate maintenance work เมื่อข้อมูลโต

Services/reviews/indexes:

- `countUpcoming` อ่านทุก future appointment ใน owner range; archive blocker ควรใช้ existence/early exit หากไม่ต้องแสดง exact total; ถ้าแสดง count ให้ระบุ capped count หรือ aggregate ไม่ตัด correctness check
- `listSchedule` มี 14-day range guard ที่ดี แต่ selected staff ยังอ่าน appointments ของทุกคนก่อน filter; ใช้ `by_staff_start` เมื่อเลือกคนจำนวนน้อย และ bounded fan-out ตามจำนวน staff
- `findOpenSlots` อ่าน appointment ranges ใน slot helper แล้วอ่านอีกรอบเพื่อ auto assignment; reuse busy/count data ภายใน invocation ได้
- review edits เรียก `recomputeSocialProof` scan reviews ทุกครั้ง: เมื่อโตใช้ ratingSum + reviewCount delta สำหรับ create/update/delete และ derive rounded average; repair job ยังต้องตรวจครบ ไม่รีบใส่ component สำหรับ traffic ต่ำ
- prefix index ไม่ได้ redundant เสมอ: `bookings.by_property` ใช้ chronological pagination, เปลี่ยนเป็น `by_property_checkIn` จะเปลี่ยน ordering; `by_status` กับ `by_status_createdAt` ก็ต้องตรวจ `_creationTime` เทียบ `createdAt` ก่อนลบ ดูข้อยกเว้นใน [Best Practices](https://docs.convex.dev/understanding/best-practices/)
- อย่า rename indexes ทุกตัวเพื่อ naming cleanup ใน performance rollout; indexes ใหม่ใช้ชื่อรวมทุก field ตาม project guideline
- อย่าอ้างว่า `Date.now()` ทำให้ cache ใช้ไม่ได้ทั้งหมด: Convex รองรับ deterministic time ระหว่าง execution ควรส่ง coarse time arg เฉพาะ query ที่ต้องการ time refresh ตาม UX และวัดผลจริง อย่าตัด expiry checks ของ booking/payment ดู [Queries](https://docs.convex.dev/functions/query-functions) และ [Runtimes](https://docs.convex.dev/functions/runtimes)

## แผน implementation เป็นชุดงาน

| ลำดับ | งานที่ review ได้แยกกัน                                                   | Done เมื่อ                                                                                                 | Dependency         |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| 1     | เพิ่ม permanent regression tests ของ F1–F3 และเก็บ baseline query metrics | tests เดิมผ่าน, new regressions แสดง failure ก่อน fix, metrics แยก cold/cache/invalidated reads            | ไม่มี              |
| 2     | แก้ overlap helper และ calendar completeness                              | >500 historical/cancelled rows ไม่บัง conflicts/long stays; range validation และ budget exhaustion ชัดเจน  | 1                  |
| 3     | iCal batch lifecycle/reconciliation                                       | >500 source rows ถูกจัดการครบ; parallel sync/delete/URL change ไม่สร้าง stale blocks                       | 1                  |
| 4     | Availability ตาม property/month                                           | funnel/chat card ได้ข้อมูลครบ, navigation/prefetch ถูกต้อง, read size ขึ้นกับ visible range                | 2                  |
| 5     | Chat metadata/backfill + joins/index selection                            | ไม่มี legacy row ตกหล่น, filters/cursors เดิมถูกต้อง, read amplification ลดตาม fixture                     | 1                  |
| 6     | Knowledge list/detail + scoped resolution                                 | edit ไม่ทิ้ง variants, global/custom/property answer precedence เท่าเดิม, older relevant answers ถูกค้นได้ | 1                  |
| 7     | Booking search + normalized fields + lead dedup                           | old/new rows match, semantic search cases และ duplicate behavior ผ่าน                                      | migration workflow |
| 8     | Conditional presence split/review counters/service query tuning           | baseline ยืนยันความคุ้มค่า และ transaction/subscription metrics ลด                                         | 4–7 + metrics      |

ไม่แนะนำเริ่มด้วย digest tables ทุก table, เปลี่ยน admin ทั้งหมดเป็น non-reactive หรือเพิ่ม indexes ทุก filter combination Public villa content ใช้ server cache 60 วินาที + per-request dedup อยู่แล้ว และ list/reviews ใช้ bounded indexed reads จึงให้ priority ต่ำกว่าเส้นทางด้านบน

## Rollout ที่รักษาข้อมูลเก่า

ใช้ widen → migrate → verify → cutover → narrow เมื่อเพิ่ม normalized fields, needsReply metadata, counts หรือ presence table:

1. เพิ่ม optional fields/tables/indexes และอัปเดต writers ทุก sibling ให้เขียนรูปแบบใหม่ก่อน
2. Readers ระหว่าง migration รองรับ old/new; ห้าม default missing fields เป็น false/open แล้ว query เฉพาะรูปแบบใหม่จน records เก่าหาย
3. ใช้ resumable bounded backfill พร้อม dry run และ progress; non-trivial migration ใช้ `@convex-dev/migrations` ตาม skill (ยังไม่มี component นี้ใน dependencies)
4. Verify coverage และ parity ในข้อมูลจำลอง/selected deployment ก่อน cutover; การเพิ่ม index บน existing fields ทำ index backfill โดย Convex ได้ ไม่ต้องสร้าง data migration ถ้า shape ไม่เปลี่ยน
5. Switch readers หลัง backfill ครบ เก็บ compatibility ตามที่จำเป็นสำหรับ rollback แล้วค่อย narrow schema ภายหลัง
6. แยก readiness ของแต่ละ migration ไม่ใช้ global counter/document ที่ทุก heartbeat หรือ booking ต้องเขียนร่วมกัน

## Verification และเกณฑ์ยอมรับ

Correctness:

- Booking: >500 historical bookings, conflict หลัง cutoff, long stay ข้ามเดือน, checkout boundary, self edit, cancelled vs confirmed/completed, legacy ไม่มี mirror, concurrent confirmation
- iCal: >500 historical/current source rows, empty feed, two OTA sources วันเดียวกัน, manual/direct blocks, sync/delete และ URL/version races
- Chat: sparse channel/status filters ผ่านหลายหน้า, no skipped/duplicate cursor results, `undefined = open`, missing metadata, settled guest message, admin reply, reopen และ AI pause guards
- Knowledge: >100 unrelated latest answers, multi/custom/global scopes, 1,000 approved variants, edit จาก list preview, capped search กับ complete edit detail
- Availability: หลาย OTA rows ต่อวัน, visible month transitions, property switch, stale client cache แต่ booking mutation ยัง reject conflict

Performance:

- บันทึก duration p50/p95, documents/bytes read, payload bytes, query executions และ OCC retries สำหรับ flow เดิมก่อน/หลังด้วย fixture และ deployment/traffic เดียวกัน
- วัด reruns ของ chat list/detail/transcript เมื่อ heartbeat โดยไม่มี message รวมถึงเมื่อมี message จริง; อย่าคิดว่า subscriptions ซ้ำจาก components เท่ากับ server executions ซ้ำเสมอ เพราะ Convex share/cache identical queries ได้
- เป้าหมายเชิงโครงสร้าง: overlap ไม่ขึ้นกับ accumulated past bookings, availability ไม่อ่านทั้ง catalog/year ในทุก card, list ไม่โหลด edit payload ทั้งหมด, source cleanup จบครบทุกแถว
- ใช้ `maximumRowsRead`/`maximumBytesRead` ใน pagination ที่เหมาะสม; SDK ที่ติดตั้งมี options นี้ แต่ไม่พบ `ctx.meta.getTransactionMetrics()` ใน local server API จึงอย่า copy API ใหม่จาก docs โดยไม่ตรวจ version ก่อน
- อย่าตั้ง percentage savings จนมี baseline; tests ของ `convex-test` ยืนยัน logic แต่ไม่ได้ยืนยัน production latency/OCC/subscription cost

ชุดทดสอบเดิมที่รันใน audit:

```sh
pnpm exec vitest run convex/adminChat.test.ts convex/adminBookings.test.ts convex/ical.test.ts convex/listPagination.test.ts convex/adminServices.test.ts convex/publicProperties.test.ts
```

ผล: 6 files, 93 tests ผ่าน; temporary scale probes อีก 3 tests reproduce F1–F3 ได้ ไฟล์ชั่วคราวถูกลบแล้ว ส่วน implementation ต้องเพิ่ม regression tests ถาวรก่อนแก้แต่ละ behavior
