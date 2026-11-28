import {
  buildInvalidLocaleNotFoundData,
  isStartRoomLoadError,
  isStartRoomNotFoundData,
  isStartRoomUnavailableError,
} from "./room-route";

export function StartRoomNotFound({ data }: { data?: unknown }) {
  const resolved = isStartRoomNotFoundData(data) ? data : buildInvalidLocaleNotFoundData();

  return (
    <div className="flex min-h-screen items-center justify-center pt-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">{resolved.title}</h1>
        <a href={resolved.homeHref} className="mt-4 inline-block text-primary hover:underline">
          {resolved.backHomeLabel}
        </a>
      </div>
    </div>
  );
}

export function StartRoomError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const unavailable = isStartRoomUnavailableError(error);
  const loadError = isStartRoomLoadError(error);
  const heading =
    (unavailable || loadError ? error.heading : undefined) ??
    (unavailable
      ? "Villa details are temporarily unavailable"
      : "Something went wrong");
  const detail =
    (unavailable || loadError ? error.detail : undefined) ??
    (unavailable
      ? "We could not reach the villa catalog right now. Please try again in a moment."
      : "We could not load this villa right now. Please try again.");
  const retryLabel = (unavailable || loadError ? error.retryLabel : undefined) ?? "Try again";
  const homeHref = unavailable || loadError ? error.homeHref : "/";
  const backHomeLabel = unavailable || loadError ? error.backHomeLabel : "Back to Home";

  return (
    <div
      role="alert"
      data-status={unavailable ? "503" : "500"}
      className="flex min-h-screen items-center justify-center px-5 pt-16"
    >
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground">{heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        <div className="mt-6 flex items-center justify-center gap-4">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              {retryLabel}
            </button>
          ) : null}
          <a href={homeHref} className="text-sm font-medium text-primary hover:underline">
            {backHomeLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
