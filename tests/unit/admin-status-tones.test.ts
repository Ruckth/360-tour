import { describe, expect, it } from "vitest";
import { STATUS_LABELS, formatMoney, paymentLabel, sourceLabel, type StatusDomain } from "@/components/admin/labels";
import { STATUS_TONES, TONES, statusMeta } from "@/components/admin/status-tones";

describe("admin status tones", () => {
  it("gives every status a label and a known tone, with no extras on either side", () => {
    for (const domain of Object.keys(STATUS_LABELS) as StatusDomain[]) {
      const labels = STATUS_LABELS[domain] as Record<string, string>;
      const tones = STATUS_TONES[domain] as Record<string, string>;
      expect(Object.keys(tones).sort(), domain).toEqual(Object.keys(labels).sort());
      for (const key of Object.keys(labels)) {
        expect(labels[key].trim(), `${domain}.${key}`).not.toBe("");
        expect(TONES, `${domain}.${key}`).toHaveProperty(tones[key]);
      }
    }
  });

  it("uses one tone per meaning across domains", () => {
    const { hotelBooking, appointment, payment, chatSession, unknownQuestion } = STATUS_TONES;
    // Waiting on someone.
    expect(new Set([hotelBooking.pending, appointment.unpaid, payment.unpaid, payment.pending, chatSession.needs_reply])).toEqual(
      new Set(["warning"]),
    );
    // Ended.
    expect(new Set([hotelBooking.cancelled, appointment.cancelled, chatSession.archived, unknownQuestion.ignored])).toEqual(
      new Set(["muted"]),
    );
    expect(new Set([hotelBooking.paid, payment.paid, appointment.completed])).toEqual(new Set(["success"]));
  });

  it("never gives opposite meanings the same tone", () => {
    const { hotelBooking, appointment, payment } = STATUS_TONES;
    expect(hotelBooking.cancelled).not.toBe(hotelBooking.hostBlock);
    expect(hotelBooking.cancelled).not.toBe(hotelBooking.otaBlock);
    expect(hotelBooking.hostBlock).not.toBe(hotelBooking.otaBlock);
    expect(appointment.cancelled).not.toBe(appointment.no_show);
    expect(payment.paid).not.toBe(payment.failed);
    expect(new Set(Object.values(appointment)).size).toBe(Object.keys(appointment).length);
  });

  it("returns label and tone together", () => {
    expect(statusMeta("appointment", "no_show")).toEqual({ label: "No-show", tone: "danger" });
    expect(statusMeta("hotelBooking", "otaBlock")).toEqual({ label: "OTA block", tone: "accent" });
  });
});

describe("admin labels", () => {
  it("names each channel once, with messenger and facebook as the same channel", () => {
    expect(sourceLabel("web")).toBe("Website");
    expect(sourceLabel("messenger")).toBe("Facebook Messenger");
    expect(sourceLabel("facebook")).toBe("Facebook Messenger");
    expect(sourceLabel("line")).toBe("LINE");
    expect(sourceLabel("admin")).toBe("Manual");
    expect(sourceLabel("booking_com")).toBe("Booking.com");
    expect(sourceLabel("something_new")).toBe("something_new");
    expect(sourceLabel(undefined)).toBe("Unknown");
  });

  it("formats payments and money for people, not as raw values", () => {
    expect(paymentLabel("pending")).toBe("Unpaid");
    expect(paymentLabel("paid", "stripe")).toBe("Paid by card (Stripe)");
    expect(paymentLabel("failed")).toBe("Payment failed");
    expect(formatMoney(12000, "THB")).toBe("฿12,000");
    expect(formatMoney(-500, "THB")).toBe("-฿500");
    expect(formatMoney(99.5, "USD")).toBe("$99.5");
    expect(formatMoney(1500, "SGD")).toBe("SGD 1,500");
  });
});
