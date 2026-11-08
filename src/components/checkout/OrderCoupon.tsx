"use client";

import { ChevronRight, TicketPercent, TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { formatMoney } from "@/components/admin/labels";
import { CouponChip } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { couponInputMessage, parseCouponInput, posCouponMessage } from "convex/lib/posCoupons";
import { useCheckoutBackend, type OrderView } from "./backend";
import { couponRefusal } from "./checkout-ui";
import type { Run } from "./useOrderWrites";

/** Links look like links while typed; codes read as codes. */
const looksLikeLink = (text: string) => /[/.:]/.test(text);

/**
 * On short screens (phone landscape, small phones) the closed "Add coupon" row would push the
 * tenders off screen, so OrderPanel puts a compact trigger in its header instead.
 */
export const SHORT_SCREEN_HIDDEN = "[@media(max-height:40rem)]:hidden";
export const SHORT_SCREEN_ONLY = "hidden [@media(max-height:40rem)]:inline-flex";

/** Whether the order can take a coupon now (and has none yet). */
export const canAddCoupon = (view: OrderView | null | undefined): view is OrderView =>
  Boolean(view && view.order.state === "unpaid" && view.lines.length && !view.promotion);

/**
 * The order's one coupon, above the totals: "Add coupon" opens a field that takes a typed code, a
 * pasted offer link, or what a USB/Bluetooth scanner types (it ends with Enter). Applied, it shows
 * what it saves and its terms; when an edit leaves it not fitting the order, a warning with Remove.
 * Only open orders with items have one. Writes go through `run`, after any edit still saving.
 */
export function OrderCoupon({ view, run, busy, open, onOpenChange: setOpen }: { view: OrderView; run: Run; busy: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useCheckoutBackend().useActions();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const orderId = view.order._id;
  const promotion = view.promotion;

  if (view.order.state !== "unpaid" || !view.lines.length) return null;

  const remove = () => run(() => actions.removeOrderCoupon({ orderId }));

  if (promotion?.problem) {
    return (
      <div role="status" data-testid="order-coupon-problem" className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            <span className="font-mono">{promotion.code}</span> not applied
          </p>
          <p className="[overflow-wrap:anywhere]">{posCouponMessage(promotion.problem)}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 shrink-0 bg-transparent" disabled={busy} onClick={remove}>
          Remove
        </Button>
      </div>
    );
  }

  if (promotion) {
    return (
      <div data-testid="order-coupon" className="mb-2 grid gap-1 rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CouponChip code={promotion.code} />
          <span className="text-sm font-medium tabular-nums">Saves {formatMoney(promotion.discount)}</span>
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" disabled={busy} onClick={remove} aria-label={`Remove coupon ${promotion.code}`}>
            Remove
          </Button>
        </div>
        {promotion.terms ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{promotion.terms}</p> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("mb-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-left text-sm font-medium text-muted-foreground transition hover:border-gold/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", SHORT_SCREEN_HIDDEN)}
      >
        <TicketPercent aria-hidden className="size-4 shrink-0 text-gold-text" />
        <span className="min-w-0 flex-1">Add coupon</span>
        <span className="shrink-0 text-xs font-normal">Code, QR or link</span>
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (applying || busy) return;
    const parsed = parseCouponInput(value, window.location.origin);
    if (parsed.kind === "invalid") {
      setMessage(couponInputMessage(parsed.reason));
      return;
    }
    setApplying(true);
    setMessage("");
    let failure = "";
    await run(async () => {
      try {
        await actions.applyOrderCoupon(parsed.kind === "code" ? { orderId, code: parsed.code } : { orderId, slug: parsed.slug });
      } catch (err) {
        failure = couponRefusal(err)?.message ?? errorText(err, "The coupon didn't apply. Try again.");
      }
    });
    setApplying(false);
    if (!failure) {
      setOpen(false);
      setValue("");
      return;
    }
    setMessage(failure);
    // The field was disabled while checking; put the cursor back for the next scan or a correction.
    requestAnimationFrame(() => input.current?.select());
  }

  const close = () => {
    setOpen(false);
    setValue("");
    setMessage("");
  };
  const locked = busy || applying;

  return (
    <form onSubmit={submit} noValidate className="mb-2 grid gap-1.5" aria-label="Add coupon">
      <Label htmlFor={`${id}-coupon`} className="sr-only">Coupon code or offer link</Label>
      <div className="flex gap-2">
        <Input
          ref={input}
          id={`${id}-coupon`}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          placeholder="Code, or scan or paste a link"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={500}
          disabled={locked}
          aria-invalid={message ? true : undefined}
          aria-describedby={`${id}-status`}
          className={cn(
            "h-10 min-w-0 flex-1 font-mono font-semibold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:tracking-normal",
            !looksLikeLink(value) && "uppercase placeholder:normal-case",
          )}
        />
        <Button type="submit" className="h-10 shrink-0" disabled={locked}>
          {applying ? <Spinner label="Checking the coupon" className="text-current" /> : null}
          Apply
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-10 shrink-0" onClick={close} aria-label="Cancel coupon">
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <p id={`${id}-status`} aria-live="polite" className={cn("text-xs [overflow-wrap:anywhere]", message ? "text-destructive" : "sr-only")}>
        {message || (busy && !applying ? "Saving the order first…" : "")}
      </p>
    </form>
  );
}
