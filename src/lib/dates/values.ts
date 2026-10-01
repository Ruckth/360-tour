/** Calendar values are local date parts, never UTC timestamps. */
export function dateToIso(date: Date | undefined): string {
  if (!date || !Number.isFinite(date.getTime())) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isoToDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31)
    return undefined;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return dateToIso(date) === value ? date : undefined;
}

export function todayIsoLocal(date = new Date()): string {
  return dateToIso(date);
}

export function isTimeValue(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function parseLocalDateTime(
  value: string,
): { date: string; time: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const [date, time, extra] = value.split("T");
  return !extra && isoToDate(date) && isTimeValue(time ?? "")
    ? { date, time }
    : undefined;
}

export function dateValueProblem(
  value: string,
  {
    required,
    min,
    max,
  }: { required?: boolean; min?: string; max?: string } = {},
): string {
  if (!value) return required ? "Choose a date." : "";
  if (!isoToDate(value)) return "Choose a valid date.";
  if (min && value < min) return `Choose ${min} or a later date.`;
  if (max && value > max) return `Choose ${max} or an earlier date.`;
  return "";
}

export function timeValueProblem(
  value: string,
  {
    required,
    minuteStep = 1,
  }: { required?: boolean; minuteStep?: number } = {},
): string {
  if (!value) return required ? "Choose a time." : "";
  if (!isTimeValue(value)) return "Choose a valid time.";
  if (Number(value.slice(3)) % minuteStep !== 0)
    return `Choose a time in ${minuteStep}-minute steps.`;
  return "";
}

/** Include an existing off-step minute so opening a picker never rounds saved data. */
export function timeMinuteOptions(minuteStep: number, value = ""): string[] {
  if (
    !Number.isInteger(minuteStep) ||
    minuteStep < 1 ||
    minuteStep > 60 ||
    60 % minuteStep !== 0
  ) {
    throw new Error("minuteStep must divide 60.");
  }
  const options = Array.from({ length: 60 / minuteStep }, (_, index) =>
    String(index * minuteStep).padStart(2, "0"),
  );
  if (isTimeValue(value) && !options.includes(value.slice(3)))
    options.push(value.slice(3));
  return options.sort();
}
