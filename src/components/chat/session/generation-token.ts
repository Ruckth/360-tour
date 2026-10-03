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

  constructor(initial = 0) {
    this.current = initial;
  }

  get value() {
    return this.current;
  }

  /** Bump to a new generation (on restart) and return it. */
  next() {
    this.current += 1;
    return this.current;
  }

  /** True when `generation` is still the live one — i.e. its result may be applied. */
  isCurrent(generation: number) {
    return generation === this.current;
  }

  /** True when `generation` has been superseded and its result must be dropped. */
  isStale(generation: number) {
    return generation !== this.current;
  }
}
