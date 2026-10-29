"use client";

import { IMAGE_TYPES } from "convex/lib/imageUploads";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { optimizeAvatar } from "@/lib/staff-avatar-image";

const REMOVING = "Removing photo…";

/**
 * A photo thumbnail as a button: with no photo it opens the file picker, with one it opens a dialog
 * showing the photo large, to change or remove it. Chosen files are optimized here; what happens to
 * the result is up to the caller.
 */
export function PhotoPickerButton({
  photoUrl,
  name,
  unnamed,
  thumb,
  title,
  description,
  shape = "rounded-full",
  label = false,
  disabled = false,
  onPhoto,
  onRemove,
  onError,
  onBusyChange,
}: {
  photoUrl?: string;
  /** Who or what the photo is of, for labels and alt text ("" when not named yet). */
  name: string;
  /** Used in labels while `name` is blank, e.g. "new service". */
  unnamed: string;
  thumb: ReactNode;
  title: string;
  description: string;
  /** Rounding of `thumb`, so the busy overlay and focus ring match it. */
  shape?: "rounded-full" | "rounded-lg";
  /** Show "Add photo" / "Edit photo" next to the thumbnail. */
  label?: boolean;
  disabled?: boolean;
  onPhoto: (photo: Blob) => Promise<unknown> | void;
  onRemove: () => Promise<unknown> | void;
  /** Errors raised while the dialog is closed; "" clears. The dialog shows its own. */
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const thumbButton = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const who = name.trim() || unnamed;
  const action = photoUrl ? "Edit photo" : "Add photo";

  async function run(status: string, task: () => Promise<void>, fallback: string) {
    // One change at a time: a second pick or remove waits for the first to finish.
    if (running.current) return;
    running.current = true;
    setBusy(status);
    onBusyChange?.(true);
    setDialogError("");
    onError("");
    try {
      await task();
      setOpen(false);
    } catch (err) {
      (open ? setDialogError : onError)(errorText(err, fallback));
    } finally {
      running.current = false;
      setBusy(null);
      onBusyChange?.(false);
    }
  }

  const pick = (file: File) =>
    run(
      "Optimizing photo…",
      async () => {
        const photo = await optimizeAvatar(file);
        setBusy("Saving photo…");
        await onPhoto(photo);
      },
      "Could not update the photo. Try again.",
    );

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the same file again still fires a change.
          event.target.value = "";
          if (file) void pick(file);
        }}
      />
      <button
        ref={thumbButton}
        type="button"
        disabled={disabled || busy !== null}
        aria-label={`${action} for ${who}`}
        onClick={() => (photoUrl ? setOpen(true) : input.current?.click())}
        className={`group inline-flex cursor-pointer items-center gap-3 ${shape} text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default`}
      >
        <span className="relative shrink-0 transition group-hover:opacity-80 group-disabled:opacity-100">
          {thumb}
          {busy ? (
            <span className={`absolute inset-0 flex items-center justify-center ${shape} bg-background/70`}>
              <Spinner label={busy} className="text-foreground" />
            </span>
          ) : !photoUrl && !name.trim() ? (
            <Camera aria-hidden className="absolute inset-0 m-auto size-5 text-navy" />
          ) : null}
        </span>
        {label ? <span className="pr-3 text-sm font-medium underline-offset-4 group-hover:underline">{busy ?? action}</span> : null}
      </button>
      {/* Nothing closes the dialog mid-request, so its result (or error) is never lost. */}
      <Dialog open={open} onOpenChange={(next) => busy === null && setOpen(next)}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] max-w-[420px] overflow-y-auto"
          // The thumbnail opened it, but isn't a DialogTrigger (with no photo it opens the file picker).
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            thumbButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={`Photo of ${who}`} className="max-h-[min(55dvh,420px)] w-full rounded-lg bg-muted object-contain" />
          ) : null}
          {dialogError ? <p role="alert" className="text-sm text-destructive">{dialogError}</p> : null}
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => run(REMOVING, async () => void (await onRemove()), "Could not remove the photo. Try again.")}
            >
              {busy === REMOVING ? <Spinner className="text-current" label={busy} /> : <Trash2 aria-hidden className="size-4" />}
              Remove photo
            </Button>
            <Button type="button" disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy && busy !== REMOVING ? <Spinner className="text-current" label={busy} /> : <ImageUp aria-hidden className="size-4" />}
              {busy && busy !== REMOVING ? busy : "Change photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
