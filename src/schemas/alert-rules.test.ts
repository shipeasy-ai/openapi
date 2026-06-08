import { describe, it, expect } from "vitest";
import { alertRuleCreateSchema, alertRuleUpdateSchema } from "./alert-rules";

describe("alertRuleCreateSchema", () => {
  it("accepts a full valid rule and defaults window/severity/enabled", () => {
    const parsed = alertRuleCreateSchema.parse({
      name: "Checkout error rate",
      metricId: "met_123",
      comparator: "gt",
      threshold: 0,
    });
    expect(parsed.windowHours).toBe(24);
    expect(parsed.severity).toBe("warn");
    expect(parsed.enabled).toBe(true);
  });

  it("requires metricId on create", () => {
    expect(() =>
      alertRuleCreateSchema.parse({ name: "x", comparator: "gt", threshold: 1 }),
    ).toThrow();
  });
});

describe("alertRuleUpdateSchema", () => {
  it("accepts the tunable knobs", () => {
    const parsed = alertRuleUpdateSchema.parse({
      name: "renamed",
      comparator: "lte",
      threshold: 5,
      windowHours: 1,
      severity: "danger",
      enabled: false,
    });
    expect(parsed.threshold).toBe(5);
    expect(parsed.severity).toBe("danger");
  });

  it("allows an empty patch", () => {
    expect(alertRuleUpdateSchema.parse({})).toEqual({});
  });

  // The metric (and its aggregation) is fixed for the rule's life — the update
  // schema is strict, so a stray metricId is rejected rather than silently
  // ignored. This is the core invariant for the alert-rule write surface.
  it("rejects metricId (metric + agg are immutable after create)", () => {
    expect(() => alertRuleUpdateSchema.parse({ metricId: "met_999" })).toThrow();
    expect(() => alertRuleUpdateSchema.parse({ threshold: 3, metricId: "met_999" })).toThrow();
  });
});
