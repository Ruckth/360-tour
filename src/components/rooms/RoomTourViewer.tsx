"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { TourIntro } from "@/components/tour/TourIntro";
import { useBodyScrollLock } from "@/lib/interaction/use-body-scroll-lock";
import { useTranslations } from "@/platform/intl";
import { loadTourViewer } from "@/lib/tour/preload";

type Viewer = Awaited<ReturnType<typeof loadTourViewer>>;

// One shared load per page session: StrictMode's effect replay and later reopens reuse it. A failed import is
// forgotten so the next mount retries.
let loaded: Viewer | undefined;
let pending: Promise<Viewer> | undefined;
function load() {
  pending ??= loadTourViewer().then(
    (viewer) => {
      loaded = viewer;
      return viewer;
    },
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

/**
 * A direct tour can mount as soon as the preloaded module resolves after hydration. Until then (on the server,
 * through hydration and while the import loads) it shows the viewer's own opaque intro, so the room behind it stays
 * covered and Close works: an ordinary link to `closeHref` before hydration, an in-place close (or Escape) after.
 */
export function RoomTourViewer({ closeHref, ...props }: ComponentProps<Viewer> & { closeHref: string }) {
  const tourT = useTranslations("Tour");
  const a11y = useTranslations("A11y");
  const [state, setState] = useState<{ viewer: Viewer } | { error: unknown } | null>(() =>
    loaded ? { viewer: loaded } : null,
  );
  const { onClose } = props;
  // The pending intro holds its own reference-counted lock; the viewer takes its own once mounted.
  useBodyScrollLock(!state);
  useEffect(() => {
    if (state) return;
    let active = true;
    void load().then(
      (viewer) => { if (active) setState({ viewer }); },
      (error: unknown) => { if (active) setState({ error }); },
    );
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [state, onClose]);
  if (!state) {
    return (
      <div
        data-testid="tour-viewer-loading"
        role="dialog"
        aria-label={props.property.name}
        aria-busy
        className="fixed inset-0 z-[70] bg-black"
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
