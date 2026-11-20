import { maskVoucherCodes } from "@/components/display/voucher-mask";
import type { ChangeValue, FieldChange, PartValue, StoredFields } from "./backend";

/**
 * What a History row's stored fields changed, before → after, for the staff History sheet. Only
 * EditHistory (loaded on demand) imports this, so checkout's first screen doesn't carry it.
 */

type StoredValue = StoredFields[string];
const scalar = (value: unknown): value is string | number | boolean | null => value === null || ["string", "number", "boolean"].includes(typeof value);
const mask = (value: string | number | boolean | null) => (typeof value === "string" ? maskVoucherCodes(value) : value);

/** A stored value as a change shows it: scalars and lists of them as they are, anything bigger as its size. */
function changeValue(value: unknown): ChangeValue {
  if (value === undefined) return undefined;
  if (scalar(value)) return mask(value);
  if (Array.isArray(value)) return value.every(scalar) ? value.map(mask) : { items: value.length };
  return { items: Object.keys(value as object).length };
}

/** "pause.endsAt" → its value: objects open one level, so a settings group shows each field that changed. */
function flatFields(fields: StoredFields | undefined) {
  const flat = new Map<string, unknown>();
  for (const [key, value] of Object.entries(fields ?? {}) as [string, StoredValue][]) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, leaf] of Object.entries(value)) flat.set(`${key}.${inner}`, leaf);
    } else flat.set(key, value);
  }
  return flat;
}

type StoredPart = Record<string, unknown>;
const isPartList = (value: unknown): value is StoredPart[] =>
  Array.isArray(value) && value.some((item) => item !== null && typeof item === "object");
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
/** "hotStone60" → "Hot stone60": a part's key as words, when its writer stored no label. */
const words = (key: string) => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const partKey = (item: StoredPart, index: number) => text(item.contentKey) ?? text(item.key) ?? `#${index + 1}`;

function partValue(item: StoredPart, index: number): PartValue {
  const key = partKey(item, index);
  return {
    part: maskVoucherCodes(text(item.label) ?? text(item.name) ?? (key.startsWith("#") ? key : words(key))),
    count: number(item.units),
    amount: number(item.faceValue) ?? number(item.amount),
    sessions: item.kind === "session" || item.kind === "sessions",
  };
}

/**
 * A list of parts (a package's contents), matched by content key: one change per part that differs.
 * A part removed and one added in the same edit read as a substitution, in their recorded order.
 */
function partChanges(field: string, before: unknown, after: unknown): FieldChange[] {
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is StoredPart => item !== null && typeof item === "object") : []);
  const keyed = (items: StoredPart[]) => new Map(items.map((item, index) => [partKey(item, index), { item, value: partValue(item, index) }]));
  const was = keyed(list(before));
  const now = keyed(list(after));
  const changes: FieldChange[] = [];
  const removed = [...was].filter(([key]) => !now.has(key)).map(([, part]) => part.value);
  const added: PartValue[] = [];
  for (const [key, part] of now) {
    const old = was.get(key);
    if (!old) added.push(part.value);
    else if (JSON.stringify(old.item) !== JSON.stringify(part.item)) changes.push({ field, before: old.value, after: part.value });
  }
  for (let i = 0; i < Math.max(removed.length, added.length); i++) changes.push({ field, before: removed[i], after: added[i] });
  return changes;
}

/** Each field an edit changed, before → after, in the order the edit recorded them; unchanged fields are left out. */
export function fieldChanges(before: StoredFields | undefined, after: StoredFields | undefined): FieldChange[] {
  const was = flatFields(before);
  const now = flatFields(after);
  const fields = [...new Set([...now.keys(), ...was.keys()])];
  return fields.flatMap((field) => {
    if (isPartList(was.get(field)) || isPartList(now.get(field))) return partChanges(field, was.get(field), now.get(field));
    const change = { field, before: changeValue(was.get(field)), after: changeValue(now.get(field)) };
    return JSON.stringify(change.before) === JSON.stringify(change.after) ? [] : [change];
  });
}
