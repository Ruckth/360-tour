"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { TourIntro } from "@/components/tour/TourIntro";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { useModalFocusTrap } from "@/lib/interaction/use-modal-focus";
import { useTranslations } from "@/platform/intl";
import { loadTourViewer } from "@/lib/tour/preload";
import type { TourRenderer } from "@/lib/tour/renderer";

type Viewer = Awaited<ReturnType<typeof loadTourViewer>>;

// Keep intent loads and reopens for the two variants independent.
const loaded = new Map<TourRenderer, Viewer>();
const pending = new Map<TourRenderer, Promise<Viewer>>();

function load(renderer: TourRenderer): Promise<Viewer> {
  const existing = pending.get(renderer);
  if (existing) return existing;

  const request = loadTourViewer(renderer).then(
    (viewer) => {
      loaded.set(renderer, viewer);
      return viewer;
    },
    (error: unknown) => {
      pending.delete(renderer);
      throw error;
    },
  );
  pending.set(renderer, request);
  return request;
}

/**
 * A direct tour can mount as soon as the preloaded module resolves after hydration. Until then (on the server,
 * through hydration and while the import loads) it shows the viewer's own opaque intro, so the room behind it stays
 * covered and Close works: an ordinary link to `closeHref` before hydration, an in-place close (or Escape) after.
 */
export function RoomTourViewer({ closeHref, renderer = "three", ...props }: ComponentProps<Viewer> & {
  closeHref: string;
  renderer?: TourRenderer;
}) {
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const loadingDialogRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ viewer: Viewer } | { error: unknown } | null>(() => {
    const viewer = loaded.get(renderer);
    return viewer ? { viewer } : null;
  });
  const { onClose } = props;
  // The pending intro holds its own reference-counted lock; the viewer takes its own once mounted.
  useBodyScrollLock(!state);
  useModalFocusTrap(loadingDialogRef, !state);
  useEffect(() => {
    if (state) return;
    let active = true;
    const request = load(renderer).catch((error: unknown) => {
      if (active && renderer === "pannellum") return load("three");
      throw error;
    });
    void request.then(
      (viewer) => { if (active) setState({ viewer }); },
      (error: unknown) => { if (active) setState({ error }); },
    );
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [state, onClose, renderer]);
  if (!state) {
    return (
      <div
        ref={loadingDialogRef}
        tabIndex={-1}
        data-testid="tour-viewer-loading"
        data-tour-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-label={tourT("viewerLabel", { propertyName: props.property.name })}
        aria-busy
        className="fixed inset-0 z-[70] bg-black focus:outline-none"
        // Before hydration no lock exists yet: the covering surface refuses page pans itself.
        style={{ touchAction: "none" }}
      >
        <TourIntro
          name={props.property.name}
          closeLabel={a11y("close")}
          loadingLabel={tourT("loading")}
          onClose={onClose}
          closeHref={closeHref}
        />
      </div>
    );
  }
  if ("error" in state) throw state.error;
  const Loaded = state.viewer;
  return <Loaded {...props} />;
}
