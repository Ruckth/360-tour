"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { DisplayDriver } from "convex/pos/model";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { formatDistanceStrict } from "date-fns";
import { ArrowRightLeft, Check, Copy, ExternalLink, Link2, MonitorSmartphone, RefreshCw, Share2 } from "lucide-react";
import { memo, useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import QRCode from "react-qr-code";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { CheckoutDialogContent } from "@/components/checkout/CheckoutLayers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorText, useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useDisplayDriver } from "./useDisplayDriver";

const MemoQRCode = memo(QRCode);

const ONLINE_MS = 60_000;
const THIS_COMPUTER = "This computer";
type Mode = "link" | "code" | "computer";
const MODES = [
  { value: "link", label: "Send link" },
  { value: "code", label: "Enter code" },
  { value: "computer", label: "This computer" },
] as const;

type Display = { _id: Id<"displays">; name: string; lastSeenAt: number | null };

const isOnline = (display: Display, now: number) => display.lastSeenAt !== null && now - display.lastSeenAt < ONLINE_MS;

/** convex/pos/displays.ts throws ConvexError({ code, message }) for pairing problems; anything else is a plain Error. */
function displayErrorText(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data?.message === "string") return error.data.message as string;
  return errorText(error, fallback);
}

function StatusDot({ online }: { online: boolean }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", online ? "bg-emerald-500" : "bg-muted-foreground/40")} />;
}

/**
 * Checkout top-strip button that opens the pairing dialog: "Display · Front iPad" (green when seen in
 * the last minute) when this checkout tab drives it, "Display · on another checkout" when another does.
 * `orderId` is this tab's order, shown at once if staff take the display over; undefined while a
 * booking link is still opening its order, when take-over waits.
 */
export function CustomerDisplayControl({ orderId }: { orderId: string | null | undefined }) {
  const { clientId, displays = [], driver = "none" } = useDisplayDriver();
  const now = useNow(5_000);
  const [open, setOpen] = useState(false);
  const display = displays[0];
  const online = display ? isOnline(display, now) : false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="max-w-64">
          {driver === "elsewhere" ? (
            <>
              <MonitorSmartphone aria-hidden className="size-4" />
              <span className="truncate">Display · on another checkout</span>
            </>
          ) : display ? (
            <>
              <StatusDot online={online} />
              <span className="truncate">Display · {display.name}</span>
              <span className="sr-only">{online ? "(online)" : "(offline)"}</span>
            </>
          ) : (
            <>
              <MonitorSmartphone aria-hidden className="size-4" />
              <span>Connect display</span>
            </>
          )}
        </Button>
      </DialogTrigger>
      <CheckoutDialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        {open && clientId ? <PairingPanel clientId={clientId} orderId={orderId} displays={displays} driver={driver} now={now} /> : null}
      </CheckoutDialogContent>
    </Dialog>
  );
}

type PairLink = { url: string; expiresAt: number };

/** Mounted only while the dialog is open, so a link made here is shown for one opening of the dialog. */
function PairingPanel({ clientId, orderId, displays, driver, now }: { clientId: string; orderId: string | null | undefined; displays: Display[]; driver: DisplayDriver; now: number }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("link");
  const pairLink = usePairLink(clientId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Customer display</DialogTitle>
        <DialogDescription>
          A screen facing the guest that shows the order open at this checkout, then a thank-you once it is paid. Pairing
          a new display disconnects the previous one.
        </DialogDescription>
      </DialogHeader>
      {driver === "elsewhere" ? <TakeOver clientId={clientId} orderId={orderId} /> : null}
      <SegmentedTabs id={id} tabs={MODES} value={mode} onValueChange={setMode} label="How to pair" fill />
      <div {...tabPanelProps(id, mode)} className="min-h-56">
        {mode === "link" ? <SendLink {...pairLink} /> : mode === "code" ? <EnterCode clientId={clientId} onPaired={() => setMode("link")} /> : <ThisComputer clientId={clientId} />}
      </div>
      <DisplayList displays={displays} now={now} />
    </>
  );
}

/** Another checkout tab drives the display: an explicit take-over, which shows this tab's order in the same step. */
function TakeOver({ clientId, orderId }: { clientId: string; orderId: string | null | undefined }) {
  const takeDisplay = useMutation(api.pos.displays.takeDisplay);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function take() {
    if (orderId === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await takeDisplay({ clientId, orderId });
    } catch (takeError) {
      setError(displayErrorText(takeError, "Unable to take over the display."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted/50 p-3 text-sm">
      <p className="text-muted-foreground">The display isn&apos;t following this checkout. Show this checkout&apos;s order on it instead?</p>
      <Button type="button" className="justify-self-start" onClick={() => void take()} disabled={saving || orderId === undefined}>
        {saving ? <Spinner label="Taking over" className="size-4" /> : <ArrowRightLeft aria-hidden className="size-4" />}
        Show this checkout on the display
      </Button>
      {orderId === undefined ? <p className="text-muted-foreground">Wait for the booking&apos;s order to open first.</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A link only when staff ask for one: opening the dialog to check status, take over or disconnect
 * puts no QR on screen. Making a new link cancels the last one (convex/pos/displays.ts).
 */
function usePairLink(clientId: string) {
  const createPairLink = useMutation(api.pos.displays.createPairLink);
  const [link, setLink] = useState<PairLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const create = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      // This browser drives the display once the link is claimed.
      const { secret, expiresAt } = await createPairLink({ clientId });
      // The secret rides in the fragment, which browsers never send to servers or in Referer headers.
      setLink({ url: `${window.location.origin}/display#pair=${secret}`, expiresAt });
    } catch (createError) {
      setError(displayErrorText(createError, "Unable to create a link."));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [createPairLink, clientId]);

  return { link, error, loading, create };
}

function SendLink({ link, error: createError, loading, create }: ReturnType<typeof usePairLink>) {
  const now = useNow(1_000);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const expired = link !== null && link.expiresAt <= now;
  const error = copyError ?? createError;

  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [link]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopyError("Copy failed. Select the link and copy it instead.");
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (!link) {
    return (
      <div className="grid min-h-56 place-items-center text-center text-sm text-muted-foreground">
        <div className="grid max-w-sm justify-items-center gap-3">
          <p>
            Make a one-time link to open on the display, by QR or sent to the device. It works for 10 minutes and stops
            working once a display pairs or is disconnected.
          </p>
          <Button type="button" onClick={() => void create()} disabled={loading}>
            {loading ? <Spinner label="Creating link" className="size-4" /> : <Link2 aria-hidden className="size-4" />}
            Create link
          </Button>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 pt-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
      <div className={cn("mx-auto rounded-xl border border-border bg-white p-3", expired && "opacity-30")}>
        {/* Rendered locally; the secret never goes to a QR service. */}
        <MemoQRCode value={link.url} size={152} level="M" aria-label="QR code for the display link" />
      </div>
      <div className="grid min-w-0 gap-3">
        <p className="text-sm text-muted-foreground">
          Open this link on the display (scan the QR, or send it to the device). It works once
          {expired ? "" : `, for the next ${formatDistanceStrict(link.expiresAt, now)}`}. No camera needed on the display.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={link.url} aria-label="Display link" onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={copy} disabled={expired} aria-label={copied ? "Copied" : "Copy link"}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {canShare ? (
            <Button type="button" variant="outline" disabled={expired} onClick={() => void navigator.share({ url: link.url }).catch(() => undefined)}>
              <Share2 className="size-4" />
              Share
            </Button>
          ) : null}
          <Button type="button" variant={expired ? "default" : "ghost"} onClick={() => void create()} disabled={loading}>
            <RefreshCw className="size-4" />
            {expired ? "Link expired · New link" : "New link"}
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

function EnterCode({ clientId, onPaired }: { clientId: string; onPaired: () => void }) {
  const approveCode = useMutation(api.pos.displays.approveCode);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { name } = await approveCode({ code: clean, clientId });
      setPaired(name);
      setCode("");
    } catch (approveError) {
      setError(displayErrorText(approveError, "Unable to pair that display."));
    } finally {
      setSaving(false);
    }
  }

  if (paired) {
    return (
      <div className="grid min-h-56 place-items-center text-center">
        <div className="grid gap-3">
          <p className="text-base font-semibold">Paired with {paired}</p>
          <p className="text-sm text-muted-foreground">It now shows the order open at this checkout.</p>
          <Button type="button" variant="outline" className="mx-auto" onClick={onPaired}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 pt-2">
      <label htmlFor={inputId} className="text-sm font-semibold">
        Code shown on the display
      </label>
      <p className="-mt-1 text-sm text-muted-foreground">
        Open <span className="font-mono">{typeof window === "undefined" ? "/display" : `${window.location.host}/display`}</span> on
        the display. It shows a 6-character code for 10 minutes.
      </p>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          maxLength={8}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC123"
          aria-invalid={error ? true : undefined}
          className="h-12 font-mono text-2xl uppercase tracking-[0.3em]"
        />
        <Button type="submit" className="h-12" disabled={clean.length !== 6 || saving}>
          {saving ? <Spinner label="Pairing" className="size-4" /> : null}
          Pair
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

/**
 * A display window on this computer: an ordinary paired display, opened with a one-time link (listed
 * as "This computer" and disconnected like any other). Pairing it disconnects the previous display.
 */
function ThisComputer({ clientId }: { clientId: string }) {
  const createPairLink = useMutation(api.pos.displays.createPairLink);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    // Opened within the click so popup blockers allow it; the link is sent once it exists. An open
    // display window is reused, and picks the new link up from its fragment.
    const popup = window.open("", "customer-display", "popup,width=1280,height=800");
    if (!popup) return setError("The browser blocked the window. Allow pop-ups for this site and try again.");
    try {
      const { secret } = await createPairLink({ clientId });
      popup.location.href = `${window.location.origin}/display#pair=${secret}&name=${encodeURIComponent(THIS_COMPUTER)}`;
    } catch (openError) {
      popup.close();
      setError(displayErrorText(openError, "Unable to open the display window."));
    }
  }

  return (
    <div className="grid gap-3 pt-2">
      <p className="text-sm text-muted-foreground">
        Opens the display in a new window on this computer. Drag it to the screen that faces the guest and make it
        full screen. It replaces any other paired display.
      </p>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        onClick={() => void open()}
      >
        <ExternalLink className="size-4" />
        Open display window
      </Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function DisplayList({ displays, now }: { displays: Display[]; now: number }) {
  const revoke = useMutation(api.pos.displays.revoke);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(displayId: Id<"displays">) {
    setPending(displayId);
    setError(null);
    try {
      await revoke({ displayId });
    } catch (revokeError) {
      setError(displayErrorText(revokeError, "Unable to disconnect the display. Try again."));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="border-t border-border pt-4">
      <h3 className="admin-eyebrow mb-2">Paired display</h3>
      {displays.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="grid gap-2">
          {displays.map((display) => {
            const online = isOnline(display, now);
            return (
              <li key={display._id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <Link2 aria-hidden className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{display.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot online={online} />
                    {online
                      ? "Online"
                      : display.lastSeenAt
                        ? `Last seen ${formatDistanceStrict(display.lastSeenAt, now)} ago`
                        : "Not seen yet"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending === display._id}
                  onClick={() => void disconnect(display._id)}
                >
                  Disconnect
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
