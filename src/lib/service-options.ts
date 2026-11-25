import { serviceOptions, type ServiceOption } from "convex/shared/serviceOptions";

export { serviceOptions, type ServiceOption };
type Priced = ServiceOption & { options?: readonly ServiceOption[] };

export const hasDurations = (service: Priced) => serviceOptions(service).length > 1;

/** The option with this length, else the default (the service's own length and price). */
export function serviceOption(service: Priced, durationMin?: number): ServiceOption {
  const options = serviceOptions(service);
  return options.find((option) => option.durationMin === durationMin)
    ?? options.find((option) => option.durationMin === service.durationMin)
    ?? options[0];
}

/** "60 / 90 / 120 min", or "60 min" for one length. */
export function durationList(service: Priced, unit = "min") {
  return `${serviceOptions(service).map((option) => option.durationMin).join(" / ")} ${unit}`;
}

/** "60–120 min", or "60 min" for one length. */
export function durationSpan(service: Priced, unit = "min") {
  const options = serviceOptions(service);
  const [first, last] = [options[0].durationMin, options[options.length - 1].durationMin];
  return `${first === last ? first : `${first}–${last}`} ${unit}`;
}

function priceBounds(service: Priced) {
  const prices = serviceOptions(service).map((option) => option.price);
  return [Math.min(...prices), Math.max(...prices)] as const;
}

/** "฿800–1,400" (the symbol once), or "฿800" when every length costs the same. */
export function priceSpan(service: Priced, format: (amount: number) => string) {
  const [low, high] = priceBounds(service);
  if (low === high) return format(low);
  const [lowText, highText] = [format(low), format(high)];
  const symbol = /^\D*/.exec(lowText)![0];
  return `${lowText}–${symbol && highText.startsWith(symbol) ? highText.slice(symbol.length) : highText}`;
}

/** "from ฿800" when prices differ by length, else just the price. */
export function priceFrom(service: Priced, format: (amount: number) => string, from = (price: string) => `from ${price}`) {
  const [low, high] = priceBounds(service);
  return low === high ? format(low) : from(format(low));
}

/** Per-minute rate of the shortest priced length, rounded to ฿50, for a new length. */
export function suggestedPrice(options: readonly ServiceOption[], durationMin: number) {
  const base = options.filter((option) => option.durationMin > 0 && option.price > 0).sort((a, b) => a.durationMin - b.durationMin)[0];
  return base ? Math.round((base.price * durationMin) / base.durationMin / 5000) * 5000 : 0;
}

/** "Thai massage · 90′" on the calendar when the service has several lengths, else just its name. */
export function appointmentServiceLabel(service: (Priced & { name: string }) | undefined, appointment: { start: number; end: number }) {
  if (!service) return "Service";
  return hasDurations(service) ? `${service.name} · ${Math.round((appointment.end - appointment.start) / 60_000)}′` : service.name;
}
