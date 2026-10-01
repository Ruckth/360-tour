# แผนรวม Date / Time Picker กลาง

สถานะ: ตรวจ source และจัดทำแผนแล้ว ยังไม่ได้แก้ application code

## ผลการตรวจ

โปรเจกต์มี `Calendar` กลางใน `src/components/ui/calendar.tsx` แล้ว ทุกจุดที่ import calendar สำหรับเลือกวันใช้ไฟล์นี้ ไม่มีการสร้าง `DayPicker` อีกชุดใน feature ต่าง ๆ

สิ่งที่ยังไม่เป็นมาตรฐานคือ native popup ของ date/time input และการประกอบ trigger + popover + calendar ซ้ำในหน้า admin แม้ `Input` ที่ครอบ native input จะใช้ styling กลาง แต่ popup เลือกวันที่ยังเป็นของ browser/OS

ตาม [shadcn Date Picker (Radix)](https://ui.shadcn.com/docs/components/radix/date-picker) ตัวเลือกวันที่ประกอบจาก `Popover` และ `Calendar` ไม่มี DatePicker root สำเร็จรูป ดังนั้นสิ่งที่ต้องเพิ่มคือ module กลางสำหรับโปรเจกต์บน primitives ที่มีอยู่

### Inventory

| จุดใช้งาน | สถานะปัจจุบัน | แนวทาง |
| --- | --- | --- |
| `PropertyReviewsEditor.tsx:207` | Native `type="date"`; required; defaultValue; อ่านด้วย FormData | ย้ายไป DatePicker กลางพร้อม form adapter |
| `AdminStaffTimeOff.tsx:75,81` | Native date 2 ช่องใน `TimeOffFields`; มี min/defaults; From required ตาม caller, To optional | ย้าย 2 ช่อง; รักษาความหมาย whole-day และ To ว่าง |
| `AdminDateTimeFilterField.tsx:98` | ใช้ Calendar กลาง แต่ประกอบ UI และ parse/serialize เอง; hour/minute Select 2 ช่อง | ใช้ DateTimePicker กลาง; wrapper เก็บ label และ filter defaults |
| `StaffRosterView.tsx:375` | Popover + Calendar เขียนในหน้า; helper `isoToLocalDate` ซ้ำ | ใช้ DatePicker กลาง; caller คำนวณ Monday และ week label |
| `AdminStaffBookingsView.tsx:1075` | Popover + Calendar เขียนใน dialog; helper `isoToLocalDate` ซ้ำ | ใช้ DatePicker กลาง; caller เก็บ past-date restriction และ reset selected slot |
| `BookingDatePicker.tsx` | `BookingRangePicker` ใช้ Calendar กลางแล้ว; locale และ classNames อยู่ใน feature | เก็บ booking selection logic; ย้าย date formatting และ calendar appearance ที่ใช้ร่วมได้ |
| `AdminCalendarHeader.tsx:42` → REUI `EventCalendarDatePicker` | ใช้ Calendar กลางแล้ว; REUI Button/Popover เป็น Base UI | เก็บ adapter ของ REUI; ใช้มาตรฐาน Calendar เดียวกัน |

Native date มี **3 declaration sites ใน 2 ไฟล์**; `TimeOffFields` ถูกใช้ทั้ง bulk leave, เพิ่มพนักงาน และแก้ time off จึงกระทบหลายหน้าจอ

Native time ที่ควรรวมในรอบเดียวกัน:

| ไฟล์ | ช่องที่พบ |
| --- | --- |
| `AdminStaffTimeOff.tsx:78,84` | เวลาเริ่ม/จบ optional; step 15 นาที |
| `AdminStaffServicesManager.tsx:501,504,517,520` | เวลา shift และ break; required; step 15 นาที |
| `StaffRosterView.tsx:797` | TimeField กลางเฉพาะไฟล์ ใช้กับ start/end และ break start/end |
| `AdminSettingsView.tsx:117,118,257` | Check-in / Check-out ผ่าน field config แบบ dynamic |

ไม่พบ native `datetime-local` หรือ native month picker จากการค้น source รอบนี้

`BookingRangePicker` ใช้ร่วมแล้วใน 6 feature callers: HomeQuickBooking, BookingFunnel, ChatBookingCard, NewBookingDialog, BookingSheet และ DateBlockDialog

### ข้อบกพร่องและความต่างที่ต้องจัดการ

1. **Date parser ไม่ตรวจวันที่จริง** — `src/lib/booking/dates.ts:16` ตรวจรูปแบบ แต่ `new Date(year, month - 1, day)` normalize วัน/เดือนที่เกินเอง ทวน expression แล้วได้ `2026-02-31 → 2026-03-03`, `2026-13-01 → 2027-01-01` และ `2026-00-10 → 2025-12-10`; tests ปัจจุบันตรวจ malformed strings แต่ยังไม่ตรวจกรณีนี้
2. **Single selection styling ยังอ่อนจาก source** — `calendar.tsx:38` กำหนด `selected` เพียง `text-foreground` ต่างจาก range ที่มีสีพื้น ต้องกำหนดสี selected single ให้ชัดและตรวจจริงใน light/dark theme
3. **Date-time filter ไม่ระบุเดือนเริ่มต้น** — `AdminDateTimeFilterField.tsx:98` มี selected แต่ไม่มี defaultMonth/month และไม่มี controlled open ที่ปิดหลังเลือก ต่างจาก roster และ appointment picker ควรเปิดเดือนที่เลือกและปิดหลังเลือกวัน
4. **Parsing/formatting กระจาย** — มี `isoToLocalDate` ซ้ำ 2 หน้า, parse/serialize date-time ใน filter และ formatting ตาม browser locale, fixed English, app locale คนละตำแหน่ง
5. **Timezone มีหลายความหมายที่ตั้งใจใช้ต่างกัน** — Chat filter แปลง local wall-clock ด้วย `new Date(value)`; staff schedules ใช้ `Asia/Bangkok`; date-only booking ไม่ใช่ timestamp ต้องกำหนด contract ให้ชัดก่อนรวม helper
6. **Booking calendar override classNames จำนวนมาก** — เปลี่ยน styling ของ Calendar กลางอย่างเดียวจึงไม่ครอบคลุม booking appearance ต้องย้าย styling ชุดนี้มาเป็น appearance ที่มีชื่อชัดเจน

ข้อสังเกตด้าน UI มาจาก source; รอบนี้ยังไม่ได้เปิด browser ทดสอบ interaction หรือ visual rendering

## รูปแบบ module กลางที่เสนอ

### 1. Date utilities — `src/lib/dates/`

Interface ใช้ date-only `YYYY-MM-DD`, time `HH:mm`, local date-time `YYYY-MM-DDTHH:mm` และค่าว่าง `""` ให้ชัดเจน

- รวม strict parsing, local Date ↔ date-only string และ parse/serialize local date-time
- ตรวจ round-trip ของปี/เดือน/วัน; reject impossible dates และ invalid hour/minute
- รวม locale mapping / caption / weekday / trigger-date formatting ที่ปัจจุบันอยู่ใน BookingDatePicker
- ใช้ local date parts สำหรับ DayPicker; ห้าม serialize วันที่ที่ผู้ใช้เลือกด้วย `toISOString().slice(0, 10)` เพราะเป็น UTC
- เก็บ resort timestamp conversion ใน `staff-bookings.ts` และ booking-specific range/night helpers ใน `booking/dates.ts`; ให้ import utilities กลาง
- รักษา exports เดิมของ `booking/dates.ts` ระหว่าง migration เพื่อลดจำนวน caller ที่ต้องแก้พร้อมกัน
- UTC arithmetic ที่ใช้คำนวณวันใน roster/blocked-months ไม่ใช่การ serialize local selection จึงไม่ควรแทนที่แบบ search-and-replace

### 2. DatePicker — `src/components/ui/date-picker.tsx`

Interface หลัก: `value`, `onValueChange`, `id`, `locale`, `placeholder`, `min/max`, `disabled`, `clearable`, `weekStartsOn` และ trigger presentation สำหรับ toolbar ที่มีอยู่จริง

Implementation รับผิดชอบ Button + Popover + Calendar, เปิดเดือนของค่าที่เลือก, ปิดหลังเลือก, focus return, clear action และ display formatting

Caller เก็บ label/helper/error และ domain side effects เช่น reset appointment slot หรือ Monday-of-week ไม่ให้ generic picker รู้จัก booking/staff/Convex

Form adapter ที่อยู่ใน module เดียวกันรองรับ `name` และ `defaultValue` สำหรับ FormData callers โดยมี interface แยกจาก controlled picker ให้ชัด; รองรับ reset/reopen dialog และ submit validation

**Validation:** hidden input ช่วยส่ง FormData แต่ `required/min/max` บน hidden input ไม่ได้แทน native validation ต้อง validate ก่อน mutation, แสดง inline error และ focus picker เมื่อผิด; ใช้ validator เดียวกันกับข้อจำกัดของ UI และรักษา field names เดิม

### 3. TimePicker — `src/components/ui/time-picker.tsx`

ใช้ shadcn Select ที่มีอยู่แล้วสำหรับ hour/minute; Interface รับ `value`, `onValueChange`, `minuteStep`, `allowEmpty` และ accessibility/form adapter แบบเดียวกับ DatePicker

- Filter ใช้ step 1 นาที และ defaults 00:00 / 23:59
- Shift/leave ใช้ step 15 นาที; settings ใช้ 1 นาทีตามความละเอียดเดิม
- Empty time ใน time off ต้องแปลว่า whole day; ห้ามแทนด้วย 00:00 โดยอัตโนมัติ
- Existing off-step values ต้องแสดงและแก้ได้โดยไม่ปัดเวลาเงียบ ๆ; แยก policy ว่าช่องใดต้อง enforce step ตาม validation เดิม
- Optional time ต้อง clear ได้ทั้งค่า และ selection ของแต่ละส่วนต้องมี default ชัดเจนเมื่อเริ่มจาก empty
- มี wheel-picker primitive อยู่แต่ยังไม่มี caller; แผนนี้ใช้ Select ก่อนเพราะ filter ใช้ pattern นี้แล้วและไม่ต้องเพิ่ม dependency

### 4. DateTimePicker — `src/components/ui/date-time-picker.tsx`

ประกอบ DatePicker + TimePicker ใช้ local wall-clock string; รับ default time และ locale; disable time จนเลือกวัน

เก็บ `AdminDateTimeFilterField` เป็น adapter บาง ๆ สำหรับ label/defaults; ให้ ChatsView เก็บการแปลง filter เป็น timestamp และ end boundary `+59_999` ตาม behavior ปัจจุบัน

### 5. Calendar และ booking adapters

- `ui/calendar.tsx` เป็นจุดรวม single/range selected appearance และ focus styles; เพิ่ม appearance ที่รองรับ default และ booking ตามการใช้งานจริง
- `BookingRangePicker` เก็บ check-in → check-out, clear behavior, unavailable dates, onMonthChange สำหรับ availability loading, compact trigger และ test IDs เดิม
- Booking range ใช้ checkout เป็น end-exclusive สำหรับ occupied nights; time-off To แบบ whole-day เป็น inclusive day สุดท้าย จึงใช้ adapter ต่างกัน
- REUI ใช้ Calendar กลางต่อไป แต่ไม่เปลี่ยน Base UI Popover เป็น Radix ระหว่างงานนี้ เพราะ render interface และ calendar-context navigation ต่างกัน
- Public ใช้ app locale และปี พ.ศ. ภาษาไทยเดิม; admin ระบุ locale ให้แน่นอน (ค่าเริ่มต้น English ตามส่วนใหญ่ของหน้า) โดยไม่เพิ่มงานแปล admin ทั้งระบบใน refactor นี้

## ลำดับดำเนินการ

| ขั้น | การเปลี่ยน | เกณฑ์ผ่าน |
| --- | --- | --- |
| 1 | เพิ่ม strict date utilities และรวม locale helpers; รักษา booking exports | Invalid dates ถูก reject; round-trip และ timezone cases ผ่าน; existing date/staff tests ผ่าน |
| 2 | สร้าง DatePicker + form adapter; ปรับ selected single styling | Controlled/form usage, clear, required/min/max, initial month, keyboard/focus และ dialog nesting ใช้งานได้ |
| 3 | ย้าย reviews และ TimeOffFields ก่อน แล้ว roster กับ appointment | ทั้ง 3 native date declaration sites ถูกย้าย; labels/FormData/defaults เดิม; roster Monday และ appointment slot reset ยังถูกต้อง |
| 4 | สร้าง TimePicker/DateTimePicker; ย้าย filter, leave, shifts, roster, settings | Empty whole-day, minute precision, step policy, filter default และ settings touched/error state ถูกต้อง |
| 5 | ย้าย booking locale/calendar appearance มารวม; ตรวจ REUI adapter | Booking 6 callers, availability loading, Thai year, unavailable dates และ calendar navigation ทำงานเดิม |
| 6 | ตรวจครบทั้ง source และหน้าจอจริง | ไม่เหลือ page-local generic date UI/helper ซ้ำ; native date/time sites ใน scope ถูก migrate; verification ผ่าน |

ทำเป็น commits เล็กตามแต่ละขั้น; ไม่ต้องเปลี่ยน database schema หรือรูปแบบ payload ที่ส่ง Convex

## การตรวจหลัง implementation

- Unit: impossible dates, leap year, invalid month, empty values, date-only round-trip, local date-time precision และ date-only ใน timezone ต่างกัน
- Unit/domain: nightsBetweenIso, checkout end-exclusive, time-off whole-day inclusive To, Bangkok timestamp และ optional To fallback
- UI interaction: open/close, selected month, keyboard selection, Escape/focus return, clear required/optional, min/max, controlled updates และ FormData/reset
- Visual/browser: single selected/today/disabled/range ใน light/dark, mobile width, popover ภายใน Dialog/Sheet และ Radix/Base UI adapters
- Feature regression: รีวิว create/edit, bulk/individual time off, staff shift/break, copy/custom roster, appointment date→slot, settings dirty/error states, chat filter start/end/reset
- Public regression: `/`, `/booking`, public chat และ `/th/booking`; คง lazy loading และ availability onMonthChange
- ใช้ existing booking/home E2E แล้วเพิ่ม targeted interaction cases สำหรับหน้าที่ migrate; ไม่ทำ source-text tests ที่เพียงตรวจชื่อ component
- รัน `pnpm check`, `pnpm lint`, `pnpm test:unit`, targeted E2E และ `pnpm build` เมื่อ implementation เสร็จ

## Verification ที่ทำแล้วในรอบ audit

ค้น source ครอบคลุม literal/dynamic date/time inputs, Calendar imports, picker callers, date conversion helpers และ tests ที่เกี่ยวข้อง

รัน:

```sh
pnpm exec vitest run tests/unit/booking-dates.test.ts tests/unit/booking-blocked-months.test.ts tests/unit/staff-time-off.test.ts tests/unit/staff-booking-helpers.test.ts
```

ผล: **4 test files / 19 tests ผ่าน**; existing tests ยังไม่ครอบคลุม impossible dates ที่พบด้านบน ยังไม่ได้รัน full suite หรือ browser verification เพราะรอบนี้เป็น check + plan
