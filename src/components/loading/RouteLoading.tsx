function LoadingLine() {
  return (
    <div className="h-px w-full overflow-hidden bg-border">
      <div className="h-full w-1/2 animate-[page-load-line_1.2s_ease-in-out_infinite] bg-gold" />
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

export function HomeLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LoadingLine />
      <section className="relative h-[72svh] min-h-[520px] overflow-hidden bg-muted md:h-screen">
        <SkeletonBlock className="absolute inset-0 rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/30" />
        <div className="absolute left-1/2 top-1/2 h-14 w-72 -translate-x-1/2 -translate-y-1/2 rounded-none bg-navy/80 md:w-96" />
      </section>
      <section className="mx-auto grid max-w-5xl gap-3 px-5 py-6 md:grid-cols-[1fr_auto] md:px-8">
        <SkeletonBlock className="h-24 md:h-12" />
        <SkeletonBlock className="h-12 md:w-32" />
      </section>
    </div>
  );
}

export function BookingLoading() {
  return (
    <div className="min-h-screen bg-background px-4 py-24 text-foreground md:px-6">
      <LoadingLine />
      <div className="mx-auto max-w-6xl">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="mt-4 h-12 w-80 max-w-full" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <section className="rounded-lg border border-border bg-card p-5 md:p-7">
            <SkeletonBlock className="h-12" />
            <SkeletonBlock className="mt-6 h-44" />
            <SkeletonBlock className="mt-5 h-28" />
            <div className="mt-8 flex justify-between">
              <SkeletonBlock className="h-10 w-24" />
              <SkeletonBlock className="h-10 w-28" />
            </div>
          </section>
          <aside className="rounded-lg border border-border bg-card p-5">
            <SkeletonBlock className="h-36" />
          </aside>
        </div>
      </div>
    </div>
  );
}

export function ChatLoading() {
  return (
    <div className="mx-auto flex h-[100dvh] max-w-3xl flex-col bg-card text-foreground">
      <LoadingLine />
      <div className="flex h-14 shrink-0 items-center justify-between bg-navy px-4">
        <SkeletonBlock className="h-8 w-36 bg-white/15" />
        <SkeletonBlock className="h-8 w-8 rounded-full bg-white/15" />
      </div>
      <div className="min-h-0 flex-1 space-y-4 p-5">
        <SkeletonBlock className="h-20 w-4/5" />
        <SkeletonBlock className="ml-auto h-12 w-2/3" />
        <SkeletonBlock className="h-16 w-3/4" />
      </div>
      <div className="border-t border-border p-4">
        <SkeletonBlock className="h-12 rounded-2xl" />
      </div>
    </div>
  );
}

export function PaymentLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LoadingLine />
      <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
        <section className="w-full rounded-2xl border border-border bg-card p-6 shadow-xl">
          <SkeletonBlock className="h-12 w-12 rounded-full" />
          <SkeletonBlock className="mt-5 h-10 w-72 max-w-full" />
          <SkeletonBlock className="mt-4 h-20" />
          <SkeletonBlock className="mt-5 h-12" />
          <SkeletonBlock className="mt-6 h-10" />
        </section>
      </div>
    </div>
  );
}
