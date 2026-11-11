"use client";

import { CameraOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { CheckoutDialogContent } from "./CheckoutLayers";

export type ScanProblem = "denied" | "noCamera" | "insecure" | "inUse" | "failed";
type ScanState = "starting" | "scanning" | ScanProblem;

/**
 * Sorts a camera start failure. getUserMedia rejects with a DOMException whose name says why;
 * qr-scanner throws the string "Camera not found." when it can't open any camera.
 */
export function scanProblem(error: unknown): ScanProblem {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "noCamera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "inUse";
  if (typeof error === "string" && /camera not found/i.test(error)) return "noCamera";
  return "failed";
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

// Own the stream so closing the dialog also stops cameras still awaiting permission.
export default function CouponScanDialog({ onDecode, onClose }: { onDecode: (text: string) => void; onClose: () => void }) {
  const t = useTranslations("PosCouponScan");
  // State, not a ref: the dialog portal mounts its content after this component's first render.
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [state, setState] = useState<ScanState>("starting");
  const [attempt, setAttempt] = useState(0);
  const decode = useEffectEvent(onDecode);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!element) return;
    if (document.hidden) {
      close();
      return;
    }
    if (!window.isSecureContext) {
      setState("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("noCamera");
      return;
    }
    setState("starting");
    let stopped = false;
    let stream: MediaStream | null = null;
    let scanner: { destroy(): void } | null = null;
    const stop = () => {
      stopped = true;
      scanner?.destroy();
      scanner = null;
      stopStream(stream);
      if (element.srcObject instanceof MediaStream && element.srcObject !== stream) stopStream(element.srcObject);
      stream = null;
      element.srcObject = null;
    };
    // Reopening explicitly keeps background camera restarts inside our permission/error handling.
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      stop();
      close();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    (async () => {
      const [, library] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } }).then((media) => {
          if (stopped) stopStream(media);
          else stream = media;
        }),
        import("qr-scanner"),
      ]);
      if (stopped) return;
      const QrScanner = library.default;
      element.srcObject = stream;
      const instance = new QrScanner(
        element,
        (result) => {
          const text = result.data.trim();
          if (!text || stopped) return;
          stop();
          decode(text);
        },
        { preferredCamera: "environment", maxScansPerSecond: 10, returnDetailedScanResult: true, onDecodeError: () => {} },
      );
      scanner = instance;
      // The stream is already on the video, so this plays it and starts reading frames.
      await instance.start();
      if (!stopped) setState("scanning");
    })().catch((error: unknown) => {
      if (stopped) return;
      stop();
      setState(scanProblem(error));
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [element, attempt]);

  const problem = state !== "starting" && state !== "scanning" ? state : null;
  const retryable = problem === "denied" || problem === "inUse" || problem === "failed";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <CheckoutDialogContent
        className="max-w-md"
        data-testid="coupon-scan-dialog"
        // Without a DialogTrigger, Radix would drop focus on the page; the opener puts it back instead.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
          {/* Never `hidden`: Safari stops a hidden video's stream, so problems cover it instead. */}
          <video ref={setElement} aria-label={t("cameraView")} muted playsInline disablePictureInPicture className="size-full object-cover" />
          {state === "scanning" ? (
            <div aria-hidden className="pointer-events-none absolute inset-[14%] rounded-xl border-2 border-gold shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
          ) : null}
          {state === "starting" ? (
            <div className="absolute inset-0 grid place-items-center text-white">
              <Spinner aria-hidden label={t("starting")} className="size-6 text-current" />
            </div>
          ) : null}
          {problem ? (
            <div className="absolute inset-0 grid place-items-center bg-muted p-4 text-muted-foreground">
              <CameraOff aria-hidden className="size-8" />
            </div>
          ) : null}
        </div>
        {problem ? (
          <p role="alert" data-testid="coupon-scan-problem" className="text-sm text-destructive [overflow-wrap:anywhere]">
            {t(problem)}
          </p>
        ) : (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {state === "scanning" ? t("scanning") : t("starting")}
          </p>
        )}
        <DialogFooter>
          {retryable ? (
            <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {t("tryAgain")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
        </DialogFooter>
      </CheckoutDialogContent>
    </Dialog>
  );
}
