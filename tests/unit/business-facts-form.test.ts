import { describe, expect, it } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import {
  EMPTY_FACT_FORM,
  FACT_LIMITS,
  compatibleFacts,
  factSavePayload,
  factScopeLabel,
  isFactCompatibleWithProperty,
  structuredSourceLabel,
  validateFactForm,
  type AdminFactProperty,
  type FactFormValues,
} from "@/components/admin/business-facts-form";

const villa = "villa_1" as Id<"properties">;
const other = "villa_2" as Id<"properties">;

function valid(overrides: Partial<FactFormValues> = {}): FactFormValues {
  return {
    ...EMPTY_FACT_FORM,
    title: "Breakfast policy",
    body: "Breakfast is included for all villa stays.",
    searchText: "breakfast included morning meal",
    source: "Owner email 2026-09",
    status: "approved",
    ...overrides,
  };
}

describe("validateFactForm", () => {
  it("accepts a filled-in form", () => {
    expect(validateFactForm(valid())).toBeNull();
  });

  it.each(["title", "body", "searchText", "source"] as const)("rejects a blank %s", (field) => {
    const result = validateFactForm(valid({ [field]: "   " }));
    expect(result?.field).toBe(field);
  });

  it("rejects fields over the server limit and names the limit", () => {
    const result = validateFactForm(valid({ title: "x".repeat(FACT_LIMITS.title + 1) }));
    expect(result?.field).toBe("title");
    expect(result?.message).toContain(String(FACT_LIMITS.title));
  });

  it("accepts a field exactly at the limit", () => {
    expect(validateFactForm(valid({ body: "y".repeat(FACT_LIMITS.body) }))).toBeNull();
  });
});

describe("factSavePayload", () => {
  it("trims text and maps an empty scope to undefined (all properties)", () => {
    const payload = factSavePayload(valid({ title: "  Pets  ", propertyId: "" }));
    expect(payload.title).toBe("Pets");
    expect(payload.propertyId).toBeUndefined();
  });

  it("keeps a chosen property as the scope", () => {
    expect(factSavePayload(valid({ propertyId: villa })).propertyId).toBe(villa);
  });
});

describe("isFactCompatibleWithProperty", () => {
  it("treats a global fact as compatible with any report", () => {
    expect(isFactCompatibleWithProperty(undefined, villa)).toBe(true);
    expect(isFactCompatibleWithProperty(undefined, undefined)).toBe(true);
  });

  it("requires a property-scoped fact to match the report's property", () => {
    expect(isFactCompatibleWithProperty(villa, villa)).toBe(true);
    expect(isFactCompatibleWithProperty(villa, other)).toBe(false);
    expect(isFactCompatibleWithProperty(villa, undefined)).toBe(false);
  });
});

describe("compatibleFacts", () => {
  const facts = [
    { propertyId: undefined, name: "global" },
    { propertyId: villa, name: "villa1" },
    { propertyId: other, name: "villa2" },
  ];

  it("keeps global facts plus facts for the reported property", () => {
    expect(compatibleFacts(facts, villa).map((fact) => fact.name)).toEqual(["global", "villa1"]);
  });

  it("keeps only global facts for a report with no property", () => {
    expect(compatibleFacts(facts, undefined).map((fact) => fact.name)).toEqual(["global"]);
  });
});

describe("factScopeLabel", () => {
  const properties: AdminFactProperty[] = [
    { _id: villa, name: "Villa One", slug: "villa-one", status: "active" },
  ];

  it("names the property, or All properties when global, or Unknown when missing", () => {
    expect(factScopeLabel(undefined, properties)).toBe("All properties");
    expect(factScopeLabel(villa, properties)).toBe("Villa One");
    expect(factScopeLabel(other, properties)).toBe("Unknown property");
  });
});

describe("structuredSourceLabel", () => {
  it("gives each structured source a human label", () => {
    expect(structuredSourceLabel("settings")).toBe("Business settings");
    expect(structuredSourceLabel("pricing_availability")).toBe("Pricing & availability");
  });
});
