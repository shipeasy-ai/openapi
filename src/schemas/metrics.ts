import { z } from "zod";
import { folderSchema } from "./folder";
import { metricNameSchema } from "./metric-name";

/**
 * Admin-API request/response contract for the **metrics** resource. Owned by
 * @shipeasy/openapi so the typed client, the MCP/CLI registry, and the OpenAPI
 * doc all validate against the same shapes. Zod-only — no transport.
 *
 * The richer, server-side metric schema (with `.refine()` cross-field checks
 * and the DSL→IR plumbing) lives in `@shipeasy/core/schemas/metrics`. These
 * schemas are the emitter-friendly mirror: plain `z.object`/`z.array`/`z.enum`,
 * no transforms or refinements on the request body, so the OpenAPI emitter can
 * walk them. A create body must carry exactly one of `query` / `query_ir`; that
 * one-of rule is enforced server-side, not in this (refinement-free) schema.
 */

// Whether a rise or fall in the metric is the desired outcome — drives
// direction-aware trend colouring and the experiment verdict sign.
export const metricDirectionSchema = z
  .enum(["higher_better", "lower_better", "neutral"])
  .describe(
    "Desired direction of movement. `higher_better` (default), `lower_better`, or `neutral` (guardrail).",
  );

const metricLabelNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,63}$/i, "label must be a valid identifier")
  .describe("Event property / label identifier.");

export const metricFilterSchema = z
  .object({
    label: metricLabelNameSchema,
    op: z.enum(["=", "!=", "=~", "!~"]).describe("Match operator (`=~`/`!~` are regex)."),
    value: z.string().max(512).describe("Quoted filter value (coerced for numeric labels)."),
  })
  .describe("One label filter on the source event.");

const metricRatioArmSchema = z
  .object({
    agg: z.enum(["count_users", "count_events"]).describe("Counting mode for this ratio arm."),
    metric: z.string().min(1).max(128).describe("Source event name for this ratio arm."),
    filters: z.array(metricFilterSchema).max(16).optional().describe("Optional label filters."),
  })
  .describe("Numerator or denominator arm of a `ratio` aggregation.");

// Aggregation kind. Discriminated on `kind`; the `quantile` / `retention_Nd` /
// `ratio` variants carry extra fields. No transforms — emitter-friendly.
export const metricAggSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("count_users") }),
    z.object({ kind: z.literal("count_events") }),
    z.object({ kind: z.literal("sum") }),
    z.object({ kind: z.literal("avg") }),
    z.object({ kind: z.literal("min") }),
    z.object({ kind: z.literal("max") }),
    z.object({ kind: z.literal("unique") }),
    z.object({
      kind: z.literal("quantile"),
      p: z
        .union([
          z.literal(0.5),
          z.literal(0.75),
          z.literal(0.9),
          z.literal(0.95),
          z.literal(0.99),
          z.literal(0.999),
        ])
        .describe("Quantile fraction (0.5 = p50 … 0.999 = p999)."),
    }),
    z.object({
      kind: z.literal("retention_Nd"),
      n: z.number().int().min(1).max(90).describe("Retention window in days (1–90)."),
    }),
    z.object({
      kind: z.literal("ratio"),
      numerator: metricRatioArmSchema,
      denominator: metricRatioArmSchema,
    }),
  ])
  .describe("Aggregation function applied to the source event.");

export const metricGroupBySchema = z
  .object({
    op: z.enum(["by", "without"]).describe("`by` keeps the listed labels; `without` drops them."),
    labels: z.array(metricLabelNameSchema).max(5).describe("Labels to group by (max 5)."),
  })
  .describe("Optional group-by clause (ignored for experiment analysis).");

// The typed IR form of a metric query — the structured alternative to the DSL
// `query` string. Mirrors `@shipeasy/core`'s `metricQueryIrSchema` shape.
export const metricQueryIrSchema = z
  .object({
    agg: metricAggSchema,
    metric: z.string().min(1).max(128).describe("Source event name (must equal `event_name`)."),
    valueLabel: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe("Numeric property summed/averaged for `sum`/`avg`/quantile aggregations."),
    filters: z.array(metricFilterSchema).max(16).default([]).describe("Label filters on the event."),
    groupBy: metricGroupBySchema.optional(),
  })
  .describe("Typed query IR — the structured alternative to the DSL `query` string.");

// ── Request body ───────────────────────────────────────────────────────────
export const metricCreateSchema = z
  .object({
    name: metricNameSchema.describe(
      "Stable metric key. Single segment or `folder.name`; lowercase letters, digits, `_`/`-`; max 128 chars.",
    ),
    folder: folderSchema,
    event_name: z.string().min(1).describe("Source event the query reads from."),
    query: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe("Metric query DSL string, e.g. `sum(purchase, amount)`. Provide this OR `query_ir`."),
    query_ir: metricQueryIrSchema
      .optional()
      .describe("Typed query IR — the structured alternative to `query`. Provide this OR `query`."),
    winsorize_pct: z
      .number()
      .int()
      .min(1)
      .max(99)
      .default(99)
      .describe("Winsorise percentile (1–99) to clamp outliers. Defaults to 99."),
    min_detectable_effect: z
      .number()
      .nullable()
      .default(null)
      .describe("Minimum detectable effect (relative, 0–1) for power planning. `null` to omit."),
    direction: metricDirectionSchema.default("higher_better"),
  })
  .describe(
    "Body for `POST /api/admin/metrics`. Requires `name`, `event_name`, and exactly one of `query` / `query_ir`.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
export const metricResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque metric id."),
    name: z.string().describe("Metric key."),
    folder: z.string().nullable().describe("Folder grouping the metric, or `null`."),
    eventName: z.string().describe("Source event name (camelCase in response)."),
    aggregation: z
      .string()
      .describe("Legacy aggregation enum derived from the IR (`count_users`, `sum`, `ratio`, …)."),
    valuePath: z.string().nullable().describe("Numeric value label for sum/avg metrics, or `null`."),
    query: z
      .string()
      .nullable()
      .optional()
      .describe("Rendered DSL text form of the query, or `null` if it could not be rendered."),
    queryIr: metricQueryIrSchema
      .optional()
      .describe("Typed query IR stored for the metric."),
    direction: metricDirectionSchema.optional(),
    winsorizePct: z.number().optional().describe("Winsorise percentile applied to the metric."),
    minDetectableEffect: z.number().nullable().optional().describe("Configured MDE, or `null`."),
    createdAt: z.string().optional().describe("ISO-8601 creation timestamp."),
    updatedAt: z.string().optional().describe("ISO-8601 last-update timestamp."),
  })
  .catchall(z.unknown())
  .describe("A metric definition.");

export const metricListResponseSchema = z
  .array(metricResponseSchema)
  .describe("Every metric in the project (the list endpoint is not paginated).");

export const metricCreateResponseSchema = z
  .object({
    id: z.string().describe("Newly assigned metric id."),
    name: z.string().describe("Metric name that was created."),
  })
  .describe("Result of a successful metric create.");

export const metricDeleteResponseSchema = z
  .object({ ok: z.literal(true) })
  .describe("Soft-delete (archive) acknowledgement.");

// Use the *input* type (pre-defaults) so callers needn't supply fields that
// have a server-side default (`winsorize_pct`, `min_detectable_effect`,
// `direction`). `query_ir` is widened to `unknown` on the client input type:
// the registry op forwards the raw IR JSON without bundling the strict IR type,
// and the server re-validates it. The schema itself keeps the strict IR so the
// OpenAPI spec documents the real shape.
export type MetricCreateInput = Omit<z.input<typeof metricCreateSchema>, "query_ir"> & {
  query_ir?: unknown;
};
export type MetricResponse = z.infer<typeof metricResponseSchema>;
export type MetricQueryIRInput = z.infer<typeof metricQueryIrSchema>;
