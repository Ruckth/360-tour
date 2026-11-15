import { PRESETS, customRangeProblem, presetRange, type PresetId, type RangeChoice } from "./report-model";

// The dashboard's date range, remembered per device (rule 5). A preset is stored by name, so it
// follows the calendar; a custom range is stored as its dates and dropped once it stops being valid.

const KEY = "marketing.dashboard.range";

/** The range this device last chose, or null when there is none (or storage is blocked). */
export function rememberedRange(today: string): RangeChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<RangeChoice> | null;
    if (!stored || typeof stored.preset !== "string") return null;
    if (stored.preset === "custom") {
      const { from, to } = stored;
      return typeof from === "string" && typeof to === "string" && !customRangeProblem(from, to, today) ? { preset: "custom", from, to } : null;
    }
    const preset = PRESETS.find((item) => item.id === stored.preset)?.id as PresetId | undefined;
    return preset ? { preset, ...presetRange(preset, today) } : null;
  } catch {
    return null;
  }
}

export function rememberRange(range: RangeChoice) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(range.preset === "custom" ? range : { preset: range.preset }));
  } catch {
    // Ignore: the range just isn't remembered.
  }
}
