"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { DisplayDriver } from 'convex/shared/displayTypes';
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { formatDistanceStrict } from "date-fns";
import { ArrowRightLeft, Check, Copy, ExternalLink, Link2, MonitorSmartphone, RefreshCw, Share2, X } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useId, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { QRCodeProps } from "react-qr-code";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { CheckoutDialogContent } from "@/components/checkout/CheckoutLayers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorText, useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useDisplayDriver } from "./useDisplayDriver";

const PairingQRCode = memo(lazy<ComponentType<QRCodeProps>>(async () => {
  try {
    return await import("react-qr-code");
  } catch {
    return { default: () => <p role="status" className="text-sm">QR unavailable. Copy the link.</p> };
  }
}));

const ONLINE_MS = 60_000;
const THIS_COMPUTER = "This computer";
const CODE_LENGTH = 6;
type Mode = "link" | "code" | "computer";
const MODES = [
  { value: "link", label: "Send link" },
  { value: "code", label: "Enter code" },
  { value: "computer", label: "This computer" },
] as const;

type Display = { _id: Id<"displays">; name: string; lastSeenAt: number | null };

const isOnline = (display: Display, now: number) => display.lastSeenAt !== null && now - display.lastSeenAt < ONLINE_MS;

/** Pairing codes as convex/displays.ts reads them: letters and digits, upper case. */
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** convex/displays.ts throws ConvexError({ code, message }) for pairing problems; anything else is a plain Error. */
function displayErrorText(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data?.message === "string") return error.data.message as string;
  return errorText(error, fallback);
}

function StatusDot({ online }: { online: boolean }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", online ? "bg-emerald-500" : "bg-muted-foreground/40")} />;
}

/** What pairing another display does to the one paired now, shown where staff commit to it. */
function ReplaceNote({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{children}</p>;
}

export type CustomerDisplayControls = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showTrigger: boolean;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Live display status and pairing for the current checkout. */
export function CustomerDisplayControl({ orderId, controls }: { orderId: string | null | undefined; controls?: CustomerDisplayControls }) {
  const { clientId, displays, driver = "none" } = useDisplayDriver();
  const now = useNow(5_000);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controls?.open ?? localOpen;
  const onOpenChange = controls?.onOpenChange ?? setLocalOpen;
  const showTrigger = controls?.showTrigger ?? true;
  const display = displays?.[0];
  const online = display ? isOnline(display, now) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showTrigger ? <DialogTrigger asChild>
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
              <span className="shrink-0 text-xs text-muted-foreground">{online ? "Online" : "Offline"}</span>
            </>
          ) : (
            <>
              <MonitorSmartphone aria-hidden className="size-4" />
              <span>Connect display</span>
            </>
          )}
        </Button>
      </DialogTrigger> : null}
      {/* The panel draws the dialog's one close control, so paired success can offer Done alone. */}
      <CheckoutDialogContent showCloseButton={false} onCloseAutoFocus={controls?.onCloseAutoFocus} className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        {open && clientId && displays ? (
          <PairingPanel clientId={clientId} orderId={orderId} displays={displays} driver={driver} now={now} />
        ) : open ? (
          <>
            <DialogHeader>
              <DialogTitle>Customer display</DialogTitle>
              <DialogDescription className="sr-only">Loading the display&apos;s status.</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-40 place-items-center"><Spinner label="Loading display" className="size-5" /></div>
            <CloseButton />
          </>
        ) : null}
      </CheckoutDialogContent>
    </Dialog>
  );
}

function CloseButton() {
  return (
    <DialogClose className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <X aria-hidden className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </DialogClose>
  );
}

type PairLink = { url: string; expiresAt: number };

/**
 * Mounted only while the dialog is open, so a link made here is shown for one opening of the dialog.
 * With a display paired, its status leads and setup waits behind "Pair a different display"; with
 * none, setup shows straight away. A display paired from here (code, link or this computer) ends
 * on "Paired with …" and Done, which closes the dialog.
 */
function PairingPanel({ clientId, orderId, displays, driver, now }: { clientId: string; orderId: string | null | undefined; displays: Display[]; driver: DisplayDriver; now: number }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("link");
  const [setupShown, setSetupShown] = useState(false);
  const [codePaired, setCodePaired] = useState<string | null>(null);
  // The displays paired when staff asked for a link or a display window. A display not among them
  // since then was paired by it: the link is used up, and the dialog says so.
  const [pairingFrom, setPairingFrom] = useState<ReadonlySet<string> | null>(null);
  const pairLink = usePairLink(clientId);
  const linkPaired = pairingFrom ? displays.find((display) => !pairingFrom.has(display._id))?.name : undefined;
  const paired = codePaired ?? linkPaired ?? null;
  const replacing = displays.length > 0 ? displays.map((display) => display.name).join(", ") : null;
  const showSetup = !replacing || setupShown;

  const watchForPairing = () => setPairingFrom(new Set(displays.map((display) => display._id)));
  function createLink() {
    watchForPairing();
    return pairLink.create();
  }
  // Revealing setup removes the button that did it, so focus moves to the selected pairing tab.
  function revealSetup() {
    flushSync(() => setSetupShown(true));
    document.getElementById(`${id}-tab-${mode}`)?.focus();
  }

  if (paired) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Customer display</DialogTitle>
          <DialogDescription className="sr-only">The display is paired.</DialogDescription>
        </DialogHeader>
        <div role="status" className="grid min-h-56 place-items-center text-center">
          <div className="grid gap-3">
            <p className="text-base font-semibold">Paired with {paired}</p>
            {driver === "here" ? <p className="text-sm text-muted-foreground">It now shows the order open at this checkout.</p> : null}
            <DialogClose asChild>
              <Button type="button" className="mx-auto" autoFocus>
                Done
              </Button>
            </DialogClose>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Customer display</DialogTitle>
        <DialogDescription>
          A screen facing the guest that shows the order open at this checkout, then a thank-you once it is paid. One
          display at a time.
        </DialogDescription>
      </DialogHeader>
      {driver === "elsewhere" ? <TakeOver clientId={clientId} orderId={orderId} /> : null}
      {displays.length ? (
        <DisplayStatus
          displays={displays}
          driver={driver}
          now={now}
          onPairAnother={setupShown ? undefined : revealSetup}
        />
      ) : null}
      {showSetup ? (
        <section aria-labelledby={replacing ? `${id}-setup` : undefined} className={cn("grid gap-3", replacing && "border-t border-border pt-4")}>
          {replacing ? <h3 id={`${id}-setup`} className="admin-eyebrow">Pair a different display</h3> : null}
          <SegmentedTabs id={id} tabs={MODES} value={mode} onValueChange={setMode} label="How to pair" fill />
          <div {...tabPanelProps(id, mode)} className="min-h-56">
            {mode === "link" ? (
              <SendLink {...pairLink} create={createLink} replacing={replacing} />
            ) : mode === "code" ? (
              <EnterCode clientId={clientId} replacing={replacing} onPaired={setCodePaired} />
            ) : (
              <ThisComputer clientId={clientId} replacing={replacing} onOpen={watchForPairing} />
            )}
          </div>
        </section>
      ) : null}
      <CloseButton />
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

const FOLLOWING: Record<DisplayDriver, string> = {
  here: "Showing this checkout",
  elsewhere: "Showing another checkout",
  none: "Not showing a checkout",
};

/**
 * The paired display first: its name, whether it is online (or when it was last seen), and which
 * checkout it follows. Disconnect acts at once, so it sits after the safer "Pair a different display".
 */
function DisplayStatus({ displays, driver, now, onPairAnother }: { displays: Display[]; driver: DisplayDriver; now: number; onPairAnother?: () => void }) {
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
    <section aria-label="Paired display" className="grid gap-2">
      <ul className="grid gap-2">
        {displays.map((display) => {
          const online = isOnline(display, now);
          return (
            <li key={display._id} className="grid gap-3 rounded-xl border border-border p-3">
              <div className="flex min-w-0 items-start gap-3">
                <MonitorSmartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{display.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot online={online} />
                    {online
                      ? "Online"
                      : display.lastSeenAt
                        ? `Offline · last seen ${formatDistanceStrict(display.lastSeenAt, now)} ago`
                        : "Not seen yet"}
                    <span aria-hidden>·</span>
                    {FOLLOWING[driver]}
                  </p>
                  {!online ? <p className="mt-1 text-xs text-muted-foreground">Check the screen is on and online. It reconnects by itself.</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {onPairAnother ? (
                  <Button type="button" variant="outline" onClick={onPairAnother}>
                    Pair a different display
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" disabled={pending === display._id} onClick={() => void disconnect(display._id)}>
                  Disconnect
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
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

function SendLink({ link, error: createError, loading, create, replacing }: ReturnType<typeof usePairLink> & { replacing: string | null }) {
  const now = useNow(1_000);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const expired = link !== null && link.expiresAt <= now;
  const error = copyError ?? createError;

  // A new link has not been copied yet.
  const [shownLink, setShownLink] = useState(link);
  if (shownLink !== link) {
    setShownLink(link);
    setCopied(false);
    setCopyError(null);
  }

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
          <p>Make a one-time link to open on the display, by QR or sent to the device.</p>
          {replacing ? <ReplaceNote>Opening the link on another display disconnects {replacing}.</ReplaceNote> : null}
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
        <Suspense fallback={<div className="grid size-[152px] place-items-center"><Spinner label="Loading QR code" className="size-5" /></div>}>
          <PairingQRCode value={link.url} size={152} level="M" aria-label="QR code for the display link" />
        </Suspense>
      </div>
      <div className="grid min-w-0 gap-3">
        <p className="text-sm text-muted-foreground">
          Open this link on the display (scan the QR, or send it to the device). No camera needed on the display.
        </p>
        <p className="text-sm font-medium">
          {expired ? "This link has expired." : `Works once, for the next ${formatDistanceStrict(link.expiresAt, now)}.`}
        </p>
        {replacing && !expired ? <ReplaceNote>Opening it disconnects {replacing}.</ReplaceNote> : null}
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

function EnterCode({ clientId, replacing, onPaired }: { clientId: string; replacing: string | null; onPaired: (name: string) => void }) {
  const approveCode = useMutation(api.pos.displays.approveCode);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const clean = normalizeCode(code);
  const ready = clean.length === CODE_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { name } = await approveCode({ code: clean, clientId });
      onPaired(name);
    } catch (approveError) {
      // A wrong or expired code changes nothing: any paired display stays paired.
      setError(displayErrorText(approveError, "Unable to pair that display."));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 pt-2">
      <label htmlFor={inputId} className="text-sm font-semibold">
        Code shown on the display
      </label>
      <p className="-mt-1 text-sm text-muted-foreground">
        Open <span className="font-mono">{typeof window === "undefined" ? "/display" : `${window.location.host}/display`}</span> on
        the display. It shows a {CODE_LENGTH}-character code for 10 minutes.
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
        <Button type="submit" className="h-12" disabled={!ready || saving}>
          {saving ? <Spinner label="Pairing" className="size-4" /> : null}
          Pair
        </Button>
      </div>
      {replacing ? <ReplaceNote>Pairing disconnects {replacing}.</ReplaceNote> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

/**
 * A display window on this computer: an ordinary paired display, opened with a one-time link (listed
 * as "This computer" and disconnected like any other). Pairing it disconnects the previous display.
 */
function ThisComputer({ clientId, replacing, onOpen }: { clientId: string; replacing: string | null; onOpen: () => void }) {
  const createPairLink = useMutation(api.pos.displays.createPairLink);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    // Opened within the click so popup blockers allow it; the link is sent once it exists. An open
    // display window is reused, and picks the new link up from its fragment.
    const popup = window.open("", "customer-display", "popup,width=1280,height=800");
    if (!popup) return setError("The browser blocked the window. Allow pop-ups for this site and try again.");
    onOpen();
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
        full screen.
      </p>
      {replacing ? <ReplaceNote>Opening it disconnects {replacing}.</ReplaceNote> : null}
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
