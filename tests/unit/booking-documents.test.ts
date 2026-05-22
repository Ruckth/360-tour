import { describe, expect, it } from "vitest";
import { buildInvoicePdf, buildReceiptPdf, type BookingDocumentData } from "@/lib/utils/booking-documents";

const documentData: BookingDocumentData = {
  resortName: "Seaview Residence",
  resortAddress: "88/8 Moo 3, Bophut, Koh Samui, Surat Thani 84320",
  resortEmail: "stay@seaviewresidence.com",
  resortPhone: "+66 77 123 456",
  propertyName: "Pool Villa",
  guestName: "Maya Chen",
  guestEmail: "maya@example.com",
  guestPhone: "+66 81 234 5678",
  checkIn: "2026-06-01",
  checkOut: "2026-06-04",
  nights: 3,
  guests: 2,
  subtotal: 36000,
  discountAmount: 5400,
  total: 30600,
  currency: "THB",
  confirmationCode: "SVR-DEMO",
  createdAt: Date.UTC(2026, 4, 22),
  paidAt: Date.UTC(2026, 4, 22),
};

describe("booking PDF documents", () => {
  it("builds localized PDFs for Latin and non-Latin public locales", async () => {
    for (const locale of ["de", "hi", "ja", "ko", "ru", "th", "zh-CN"]) {
      const invoice = await buildInvoicePdf(documentData, locale).catch((error: unknown) => {
        throw new Error(`${locale} invoice failed: ${String(error)}`);
      });
      const receipt = await buildReceiptPdf(documentData, locale).catch((error: unknown) => {
        throw new Error(`${locale} receipt failed: ${String(error)}`);
      });

      expect(invoice.byteLength, `${locale} invoice`).toBeGreaterThan(0);
      expect(receipt.byteLength, `${locale} receipt`).toBeGreaterThan(0);
    }
  });
});
