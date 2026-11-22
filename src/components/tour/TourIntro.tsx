import { X } from "lucide-react";
import type { MouseEvent } from "react";

const closeClass =
  "absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white";

/**
 * The opaque tour intro: the villa name, a progress line and Close. TourViewer shows it until the first panorama
 * draw. The room's loading shell renders the same intro on the server; there `closeHref` makes Close an ordinary
 * link to the room page before hydration, and an in-place close after it.
 */
export function TourIntro({
  name,
  closeLabel,
  loadingLabel,
  loaded = false,
  onClose,
  closeHref,
}: {
  name: string;
  closeLabel: string;
  loadingLabel?: string;
  loaded?: boolean;
  onClose: () => void;
  closeHref?: string;
}) {
  const icon = <X className="h-5 w-5" />;
  const closeLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose();
  };
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-black px-6">
      {closeHref ? (
        <a href={closeHref} onClick={closeLink} className={closeClass} aria-label={closeLabel}>
          {icon}
        </a>
      ) : (
        <button type="button" onClick={onClose} className={closeClass} aria-label={closeLabel}>
          {icon}
        </button>
      )}
      <p className="font-serif text-3xl font-semibold text-white md:text-4xl">{name}</p>
      <div className="mt-6 h-px w-32 overflow-hidden bg-white/10">
        <div className="h-full bg-gold transition-all duration-200" style={{ width: loaded ? "100%" : "62%" }} />
      </div>
      {loadingLabel ? <p className="mt-3 text-xs text-white/30">{loadingLabel}</p> : null}
    </div>
  );
}
