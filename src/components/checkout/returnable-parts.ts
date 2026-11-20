import type { Id } from "convex/_generated/dataModel";
import type { ApprovalId, OrderLine, OrderView, ReturnablePart, ReturnableVisitPart } from "./backend";

/*
 * What a commerce receipt can still give back, from each row's frozen sale snapshot and the
 * benefits and visits the receipt read returns. This module stays light: the receipt loads it to
 * decide whether a row shows Return items; the sheet itself (ReturnItemsSheet) loads on demand.
 * The server re-checks every part and amount; nothing here decides money.
 */

/** Sessions and voucher value come back as a whole package or one by one; goods also ask their condition; a visit is refunded or its session restored. */
export type DeskPartKind = "whole" | "sessions" | "voucher" | "goods" | "units" | "visit" | "restore";
export type DeskPart = ReturnablePart & {
  kind: DeskPartKind;
  lineId: Id<"orderLines">;
  contentKey: string | null;
  /** The row's own name (the package, product or voucher). */
  rowName: string;
  /** A voucher sold on its own: only "sold by mistake" and unspent returns it for money (D8). */
  voucherSale: boolean;
  /** Goods on an open room-charge handover: what stays with the guest stays charged (D17). */
  custody: boolean;
};

const left = (item: { units: number; returnedUnits: number }) => Math.max(0, item.units - item.returnedUnits);

/** Visits the server can refund or restore from this receipt (pos.orders.getOrder commerce.returnableVisitParts). */
function returnableVisitParts(view: Pick<OrderView, "commerce">): ReturnableVisitPart[] {
  return view.commerce && "returnableVisitParts" in view.commerce ? view.commerce.returnableVisitParts ?? [] : [];
}

const isVisit = (view: OrderView, line: OrderLine) =>
  line.kind === "appointment" || Boolean(line.appointmentId || line.coverage) ||
  view.links.some((link) => link.lineId === line._id && link.status === "active" && link.kind === "appointment");

/** Room stays and their links belong to the booking page (D17); no return opens here. */
const bookingOwned = (view: OrderView, line: OrderLine) =>
  line.kind === "booking" || line.kind === "room" || Boolean(line.bookingId) ||
  view.links.some((link) => link.lineId === line._id && link.status === "active" && link.kind === "booking");

/** Sessions still unused and paid: the receipt's grant read, else what the snapshot sold. */
function unusedSessions(view: OrderView, lineId: Id<"orderLines">, content: { contentKey: string; units: number; returnedUnits: number }) {
  const benefit = view.commerce?.issuedBenefits.find((item) => item.lineId === lineId && item.contentKey === content.contentKey);
  const paid = benefit && "unusedPaidSessions" in benefit ? benefit.unusedPaidSessions : undefined;
  return typeof paid === "number" ? Math.min(left(content), paid) : left(content);
}

/** Lines with goods still in the guest's room-charge custody. */
function custodyLines(view: OrderView) {
  const lines = new Set<string>();
  for (const handover of view.commerce?.handovers ?? []) {
    if (handover.status !== "open") continue;
    lines.add(handover.successorOrderId === view.order._id && handover.successorLineId ? handover.successorLineId : handover.lineId);
  }
  return lines;
}

/** Everything still returnable on a settled commerce receipt, in receipt order. */
export function returnableParts(view: OrderView): DeskPart[] {
  if (!view.commerce || view.order.status !== "paid" || view.paymentRecord.voidUnreceived) return [];
  const visits = returnableVisitParts(view);
  const custody = custodyLines(view);
  return view.lines.flatMap((line): DeskPart[] => {
    const snapshot = line.saleSnapshot;
    if (!snapshot || bookingOwned(view, line)) return [];
    const base = { lineId: line._id, rowName: snapshot.label, upcomingVisits: [], voucherSale: false, custody: custody.has(line._id) };
    if (isVisit(view, line)) {
      // Refunded or restored through the visit's own money adapter; only what the server offers opens.
      const visit = visits.find((item) => item.lineId === line._id);
      if (!visit) return [];
      const restore = visit.part.kind === "restoreSession";
      return [{
        ...base, kind: restore ? "restore" : "visit", partKey: line._id, label: visit.label || snapshot.label, contentKey: null,
        part: visit.part, maxUnits: 1, needsDisposition: false,
      }];
    }
    if (line.kind === "package") {
      const contents = snapshot.contents.flatMap((content) => {
        const kind: DeskPartKind = content.grantId ? "sessions" : content.voucherId ? "voucher" : content.stockMovementId ? "goods" : "units";
        const units = kind === "sessions" ? unusedSessions(view, line._id, content) : left(content);
        return units > 0 ? [{ content, kind, units: kind === "voucher" ? 1 : units }] : [];
      });
      if (!contents.length) return [];
      const whole: DeskPart = {
        ...base, kind: "whole", partKey: `${line._id}:whole`, label: snapshot.label, contentKey: null,
        part: { kind: "cancelPackage", lineId: line._id }, maxUnits: 1, needsDisposition: false,
      };
      return [whole, ...contents.map(({ content, kind, units }): DeskPart => ({
        ...base, kind, partKey: `${line._id}:${content.contentKey}`, label: content.label, contentKey: content.contentKey,
        part: { kind: "content", lineId: line._id, contentKey: content.contentKey, units }, maxUnits: units, needsDisposition: kind === "goods",
      }))];
    }
    const tracked = line.kind === "product" || line.kind === "voucher";
    const units = tracked ? (snapshot.contents[0] ? left(snapshot.contents[0]) : 0) : Math.max(0, line.qty - snapshot.returnedUnits);
    if (!units) return [];
    const goods = line.kind === "product";
    const voucher = line.kind === "voucher";
    return [{
      ...base, kind: goods ? "goods" : voucher ? "voucher" : "units", partKey: line._id, label: snapshot.label, contentKey: null,
      part: { kind: "line", lineId: line._id, units: voucher ? 1 : units }, maxUnits: voucher ? 1 : units, needsDisposition: goods,
      voucherSale: voucher,
    }];
  });
}

/** Whether a receipt row shows Return items: something on it can still go back, and no return is open. */
export const rowReturnable = (view: OrderView, lineId: Id<"orderLines">) =>
  !view.activeReturn && returnableParts(view).some((part) => part.lineId === lineId);

// ─── Refusals ────────────────────────────────────────────────────────────────────────────────────

/** A return command's refusal ({ code, message, … }), or null for anything else, including a lost answer. */
export type ReturnRefusal = { code: string; message: string; returnId?: Id<"orderReturns">; requestId?: ApprovalId; orderId?: Id<"orders"> };
export function returnRefusal(err: unknown): ReturnRefusal | null {
  const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") return null;
  const { code, message } = data as { code?: unknown; message?: unknown };
  return typeof code === "string" ? { ...(data as object), code, message: typeof message === "string" ? message : "" } as ReturnRefusal : null;
}
