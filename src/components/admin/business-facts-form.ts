import type { Id } from "convex/_generated/dataModel";

/**
 * Business-fact authoring shapes and pure helpers.
 *
 * Validation/normalization here mirrors the server limits in `convex/businessFacts.ts`
 * (title 160, body 2400, searchText 1200, source 500) so the editor fails fast and shows
 * the same message the mutation would, before any round trip. The server stays authoritative;
 * these helpers never relax a server rule, they only pre-check it.
 */

export type BusinessFactStatus = "draft" | "approved" | "archived";
export const BUSINESS_FACT_STATUSES: readonly BusinessFactStatus[] = ["draft", "approved", "archived"];

/** A business fact as returned by `api.businessFacts.adminList`. */
export type AdminBusinessFact = {
  _id: Id<"businessFacts">;
  title: string;
  body: string;
  searchText: string;
  source: string;
  propertyId?: Id<"properties">;
  status: BusinessFactStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
  createdByAdminEmail: string;
  updatedByAdminEmail: string;
};

/** A property the fact can be scoped to (from `properties.adminList`). Only active ones are selectable. */
export type AdminFactProperty = {
  _id: Id<"properties">;
  name: string;
  slug: string;
  status: string;
};

/** Field limits, matching the server. */
export const FACT_LIMITS = { title: 160, body: 2400, searchText: 1200, source: 500 } as const;

/** The editable fields of the fact form (scope is `propertyId`, "" means all properties). */
export type FactFormValues = {
  title: string;
  body: string;
  searchText: string;
  source: string;
  propertyId: string;
  status: BusinessFactStatus;
};

export const EMPTY_FACT_FORM: FactFormValues = {
  title: "",
  body: "",
  searchText: "",
  source: "",
  propertyId: "",
  status: "draft",
};

/** Values pre-filled into the form when editing an existing fact. */
export function factFormValues(fact: AdminBusinessFact): FactFormValues {
  return {
    title: fact.title,
    body: fact.body,
    searchText: fact.searchText,
    source: fact.source,
    propertyId: fact.propertyId ?? "",
    status: fact.status,
  };
}

export type FactField = "title" | "body" | "searchText" | "source";
const FIELD_LABELS: Record<FactField, string> = {
  title: "Title",
  body: "Fact",
  searchText: "English search terms",
  source: "Source",
};

/** The first validation error, or null when the form is valid. Mirrors the server's `text()` checks. */
export function validateFactForm(values: FactFormValues): { field: FactField; message: string } | null {
  for (const field of ["title", "body", "searchText", "source"] as const) {
    const clean = values[field].trim();
    const limit = FACT_LIMITS[field];
    if (!clean || clean.length > limit) {
      return { field, message: `${FIELD_LABELS[field]} must contain 1–${limit} characters.` };
    }
  }
  return null;
}

/** The trimmed payload for `adminSave`; `propertyId` becomes undefined for all-properties scope. */
export type FactSavePayload = {
  title: string;
  body: string;
  searchText: string;
  source: string;
  propertyId: Id<"properties"> | undefined;
  status: BusinessFactStatus;
};

export function factSavePayload(values: FactFormValues): FactSavePayload {
  return {
    title: values.title.trim(),
    body: values.body.trim(),
    searchText: values.searchText.trim(),
    source: values.source.trim(),
    propertyId: values.propertyId ? (values.propertyId as Id<"properties">) : undefined,
    status: values.status,
  };
}

/**
 * Whether an approved fact can resolve a missing-information report for the reported property.
 * A global fact (no property) applies everywhere; a property-scoped fact must match the report's
 * property. This mirrors the server's `adminSave` rule for `unknownQuestionId` resolution.
 */
export function isFactCompatibleWithProperty(
  factPropertyId: Id<"properties"> | undefined,
  reportPropertyId: Id<"properties"> | undefined,
): boolean {
  if (!factPropertyId) return true;
  return factPropertyId === reportPropertyId;
}

/** The approved facts that may resolve a report, keeping only property-compatible ones. */
export function compatibleFacts<T extends { propertyId?: Id<"properties"> }>(
  facts: readonly T[],
  reportPropertyId: Id<"properties"> | undefined,
): T[] {
  return facts.filter((fact) => isFactCompatibleWithProperty(fact.propertyId, reportPropertyId));
}

/** Scope label for a fact: the property name, or "All properties" when global. */
export function factScopeLabel(
  propertyId: Id<"properties"> | undefined,
  properties: readonly AdminFactProperty[],
): string {
  if (!propertyId) return "All properties";
  return properties.find((property) => property._id === propertyId)?.name ?? "Unknown property";
}

/** The structured sources a missing-information report can be resolved against. */
export const STRUCTURED_SOURCES = [
  { value: "settings", label: "Business settings" },
  { value: "property_details", label: "Property details" },
  { value: "services", label: "Services" },
  { value: "pricing_availability", label: "Pricing & availability" },
] as const;
export type StructuredSource = (typeof STRUCTURED_SOURCES)[number]["value"];

export function structuredSourceLabel(source: StructuredSource): string {
  return STRUCTURED_SOURCES.find((entry) => entry.value === source)?.label ?? source;
}
