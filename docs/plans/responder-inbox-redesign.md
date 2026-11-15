# Responder inbox redesign — HTML prototype

## โจทย์
ให้คนตอบแชตเห็นว่าใครรออยู่ อ่านข้อความ ตอบ และปิดเคสได้โดยมีสิ่งรบกวนน้อยลง อ้างอิงภาพหน้าจอของผู้ใช้และโครงสร้างปัจจุบันใน `ChatsView`, `AdminSessionDetail`, `AdminSessionActions`.

## สิ่งที่ปรับ
| ปัจจุบัน | ข้อเสนอ | เหตุผล |
| --- | --- | --- |
| Setup banner ขนาดใหญ่ | ย้ายไป Settings / onboarding | ไม่เกี่ยวกับการตอบเคสปัจจุบัน |
| Needs reply / Live / All / Inactive + Open / Resolved / Archived | ใช้ Waiting / Open / Done; Archive อยู่ใน filter เพิ่มเติม | แยกคิวงานออกจาก presence; รวมสถานะที่ปิดงานแล้วใน Done |
| ชื่อ + Offline + Last seen + ปุ่มหลายแถว | header สั้น: ชื่อ, ช่องทาง, บริบท, Resolve | Offline ไม่ใช่เหตุผลที่ตอบไม่ได้ |
| Reopen / Archive / Take over แสดงพร้อมกัน | primary action ตามสถานะ; Archive และ AI control ใน More | ลดตัวเลือกที่ไม่เกี่ยวกับงานตรงหน้า |
| Contact & details รวม ID / device / logs | Details เปิดเมื่อจำเป็น | ข้อมูลช่องทางและ property ยังมองเห็นทันที |
| Shortcut help แสดงตลอด | เมนู Help | ไม่แย่งพื้นที่คิว |
| Save as answer ใต้ทุกข้อความ | hover/focus action ต่อข้อความ | เป็นงานดูแล knowledge ไม่ใช่งานหลักของผู้ตอบ |
| Page 1 / Previous / Next ในรายการว่าง | Load more เมื่อมีข้อมูลเพิ่มเติมจริง | ไม่สร้างปุ่มที่กดไม่ได้โดยไม่มีประโยชน์ |
| แชตเก่ายังแสดงเมื่อ filter ว่าง | ล้าง selection และแสดง empty state ของ filter นั้น | ป้องกันเข้าใจว่าแชตอยู่ใน filter ที่เลือก |
| ช่องพิมพ์และ Send disabled เมื่อหมดเวลา | กล่องสถานะอธิบายสั้น ๆ แทน composer | เห็นข้อจำกัดและขั้นตอนถัดไปได้ทันที |

## สามทางเลือก
- **A — Calm inbox (แนะนำเป็นจุดเริ่มต้น):** คิวทางซ้าย + บทสนทนาทางขวา คุ้นเคยและสลับเคสได้เร็ว ใช้โทนสว่างอุ่นและ accent สีทองจากแอปเดิม
- **B — Focus mode:** บทสนทนาเดียวอยู่กลางจอ + เคสถัดไปด้านบน คิวเปิดเป็น drawer เหมาะกับตอบต่อเนื่องทีละเคส ใช้ dark theme และสีทองที่ใกล้ของเดิม
- **C — Queue desk:** ตารางรวมชื่อ ช่องทาง ข้อความล่าสุด เวลารอ และสถานะ เลือกเคสแล้วเปิดแผงตอบทางขวา เหมาะกับการไล่คิวและดูงานภาพรวม

## ขอบเขต HTML
`public/prototypes/responder-inbox.html` เป็นไฟล์ HTML/CSS/JS เดียว ใช้ข้อมูลจำลองในหน่วยความจำ ไม่มี backend mutation และไม่มีข้อความส่งออกจริง. UI ภาษาอังกฤษให้เทียบกับภาพเดิม; คำอธิบาย variant ภาษาไทย.

รองรับสลับ variant ผ่าน `?variant=A|B|C`, search, filter, เลือกเคส, local draft ต่อเคส, quick reply, ส่งข้อความจำลอง, resolve / reopen / archive, AI takeover ใน More, details drawer, empty state, keyboard variant switch, responsive mobile. ทดสอบสถานะ WhatsApp closed ผ่านรายการ Mali ใน Done หรือ All.

## ลำดับหลังเลือกดีไซน์
1. เลือกโครงสร้างและความหนาแน่นจาก HTML นี้ หรือผสมองค์ประกอบที่ต้องการ
2. ยืนยันชื่อคิว: Waiting = open ที่ต้องการ staff reply; Open = open ทั้งหมด; Done = resolved + archived
3. นำ layout ที่เลือกเข้า `ChatsView` / `AdminSessionDetail` โดยคง query, permissions, delivery errors และ draft state เดิม
4. สถานะ Send ต้องตรวจ reply window จาก backend; ห้ามใช้ online/offline เป็นสิทธิ์การตอบ. Takeover ต้องรักษาพฤติกรรม pause AI เดิม
5. ตรวจ keyboard, mobile, loading/error/empty, filter-selection consistency และเคสปิด reply window ก่อนนำขึ้นใช้งาน

## เกณฑ์ประเมิน
- ผู้ตอบหาเคสที่รอได้โดยไม่ต้องใช้ filter ซ้อน
- ชื่อ ช่องทาง ข้อความล่าสุด และเวลารออ่านได้ในการกวาดตาครั้งเดียว
- action หลักไม่เกินหนึ่งตัวใน header; Send อยู่ติด draft
- ข้อมูลสำคัญต่อการตอบยังเข้าถึงได้ในหนึ่งคลิก
- ปิดเคสแล้วไปเคสถัดไปได้; draft ของเคสอื่นไม่หาย
- รายการว่างต้องไม่แสดงบทสนทนาที่หลุดจาก filter

หลักฐาน research: [responder-inbox-redesign.md](../research/responder-inbox-redesign.md). ข้อเสนอ layout และความเร็วเป็นสมมติฐานที่ต้องทดลองกับผู้ตอบจริง ไม่ใช่ผล usability test.

## เปิด preview
จาก root repository: `python3 -m http.server 8768 --bind 127.0.0.1 --directory public`

จากนั้นเปิด `http://localhost:8768/prototypes/responder-inbox.html?variant=A`.

## Verification — 2026-09-30
Browser DOM smoke checks ผ่าน: draft แยกตามเคส, ส่งจำลอง, pause AI, Resolve ไปเคสถัดไป, empty search ล้าง selection, WhatsApp ปิดหน้าต่างแม้ Reopen, B queue/details drawer, C panel เปิด/ปิด, ไม่มี resource error หรือ horizontal overflow บน desktop. Responsive ตรวจด้วย iframe viewport 390 × 844, 375 × 667 และ desktop 1440 × 900 ใน browser เดียวกัน; ไม่ใช่การทดสอบบนอุปกรณ์จริง. T3 screenshot automation ล้มเหลว จึงยังไม่มี visual screenshot evidence.

พบ B title wrap บน mobile ทำให้ comparison bar ทับ composer; แก้ด้วย flex layout ที่หักพื้นที่ตาม heading จริง. ตรวจซ้ำทั้ง 3 variants ทุก viewport ข้างต้น: ไม่มี horizontal overflow และ Send อยู่เหนือ comparison bar.
