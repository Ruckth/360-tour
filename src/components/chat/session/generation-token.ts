/**
 * Generation (restart) token.
 *
 * A chat "generation" is bumped on every restart. Async work (session hydration,
 * `askConcierge`, late-reply recovery polling) captures the generation it started
 * in; before applying any result it checks the generation is still current. A
 * late reply that lands after the guest restarted belongs to an older generation
 * and is dropped — this is what stops a stale answer from being inserted into a
 * fresh conversation.
 *
 * The hook stores the live generation in a ref; this tiny helper exists so the
 * guard logic is nameable and testable in isolation.
 */

export class GenerationToken {
  private current: number;
  private active = true;
  private controller = new AbortController();

  constructor(initial = 0) {
    this.current = initial;
  }

  get value() {
    return this.current;
  }

  /** Bump to a new generation (on restart) and return it. */
  next() {
    this.controller.abort();
    this.controller = new AbortController();
    this.current += 1;
    return this.current;
  }

  /** Effect setup may run again after Strict Mode's cleanup. */
  activate() {
    this.active = true;
  }

  /** Unmount invalidates pending results and clears every recovery wait immediately. */
  dispose() {
    this.active = false;
    this.next();
  }

  wait(ms: number, generation = this.current): Promise<void> {
    if (this.isStale(generation)) return Promise.resolve();
    const signal = this.controller.signal;
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  /** True when `generation` is still the live one — i.e. its result may be applied. */
  isCurrent(generation: number) {
    return this.active && generation === this.current;
  }

  /** True when `generation` has been superseded and its result must be dropped. */
  isStale(generation: number) {
    return !this.isCurrent(generation);
  }
}
