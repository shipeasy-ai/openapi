import { z } from "zod";

export const ALERT_COMPARATORS = ["gt", "gte", "lt", "lte"] as const;
export const ALERT_SEVERITIES = ["danger", "warn", "info"] as const;

export const alertRuleCreateSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .describe("Human label for the rule, shown on the alert and the rules list."),
    metricId: z.string().min(1).describe("Id of the metric to evaluate."),
    comparator: z
      .enum(ALERT_COMPARATORS)
      .describe("How the metric value is compared to the threshold (gt/gte/lt/lte)."),
    threshold: z.number().finite().describe("Threshold the metric value is compared against."),
    windowHours: z
      .number()
      .int()
      .min(1)
      .max(720)
      .default(24)
      .describe("Lookback window (hours) the metric is aggregated over. 1–720."),
    severity: z.enum(ALERT_SEVERITIES).default("warn").describe("Severity of the raised alert."),
    enabled: z.boolean().default(true).describe("Whether the rule is evaluated by the cron."),
  })
  .strict();

// A rule's metric binding is immutable: the metric determines both *what* is
// measured and *how* it's aggregated (`agg`), so changing it would silently
// repurpose the rule. Only the threshold/comparator/window/severity/name/enabled
// knobs are tunable after create. `metricId` is absent, so a stray `metricId`
// in a PATCH body is rejected (strict) rather than silently ignored — to point
// an alert at a different metric, delete the rule and create a new one.
//
// Declared explicitly (rather than `createSchema.omit(...).partial()`) so the
// create-time `.default()`s do NOT leak in: a partial update must touch only
// the fields the caller actually passed, never reset an omitted knob to its
// create-time default.
export const alertRuleUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    comparator: z.enum(ALERT_COMPARATORS),
    threshold: z.number().finite(),
    windowHours: z.number().int().min(1).max(720),
    severity: z.enum(ALERT_SEVERITIES),
    enabled: z.boolean(),
  })
  .partial()
  .strict();

export type AlertRuleCreate = z.infer<typeof alertRuleCreateSchema>;
export type AlertRuleUpdate = z.infer<typeof alertRuleUpdateSchema>;
