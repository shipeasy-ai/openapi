import { z } from "zod";
import { folderSchema } from "./folder";
import { metricNameSchema } from "./metric-name";

// Inline metric attachment by DSL string. Used on experiment create/update so callers
// can declare a goal + guardrails in one shot. Each entry compiles via @shipeasy/query-dsl,
// upserts the underlying event (if missing), upserts the metric, and attaches it with
// the named role. `name` is optional — when omitted the handler derives a stable slug
// from the event + agg kind so the same query re-runs are idempotent.
export const experimentInlineMetricSchema = z.object({
  name: metricNameSchema.optional(),
  query: z
    .string()
    .min(1)
    .max(4096)
    .describe("Metric DSL string, e.g. `count_users(checkout_completed)`."),
});

export type ExperimentInlineMetric = z.infer<typeof experimentInlineMetricSchema>;

export const experimentNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?$/)
  .max(128)
  .describe(
    "Stable experiment key. Single segment or `folder.name` (a-z, 0-9, `_`/`-`; max 128 chars). Used by SDKs as `Shipeasy.getExperiment(user, '<name>')`. Immutable after create.",
  );

export const experimentGroupSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .describe("Group label (e.g. `control`, `treatment_a`). Max 64 chars."),
    weight: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .describe(
        "Allocation weight in basis points (0–10000). The sum across all groups must equal exactly **10000** (100%).",
      ),
    params: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Per-group parameter values delivered to the SDK when a caller is hashed into this group. Keys must match the experiment's `params` schema.",
      ),
  })
  .describe("One variant in the experiment. Weights across all groups must sum to 10000.");

export const paramSchemaSchema = z
  .record(z.string(), z.enum(["string", "bool", "number"]))
  .describe(
    "Map of param-name → scalar type. Defines the shape of `groups[].params`. Example: `{ headline: 'string', show_cta: 'bool' }`.",
  );

export const bucketBySchema = z
  .enum(["user_id", "session_id", "device_id"])
  .describe("Identifier used as the bucketing key. `user_id` is sticky across sessions.");

export const experimentCreateSchema = z
  .object({
    name: experimentNameSchema,
    description: z
      .string()
      .max(2000)
      .nullable()
      .default(null)
      .describe("Free-form description. Max 2000 chars, markdown rendered in the dashboard."),
    hypothesis: z
      .string()
      .max(4000)
      .nullable()
      .default(null)
      .describe("Hypothesis statement shown in the editor. Display-only."),
    tag: z
      .string()
      .max(64)
      .nullable()
      .default(null)
      .describe("Short tag chip rendered next to the name. Display-only."),
    owner_email: z
      .string()
      .max(254)
      .nullable()
      .default(null)
      .describe("Owner email. Display-only."),
    audience: z
      .string()
      .max(256)
      .nullable()
      .default(null)
      .describe("Audience label shown in the editor. Display-only."),
    bucket_by: bucketBySchema.nullable().default(null),
    folder: folderSchema,
    universe: z
      .string()
      .min(1)
      .describe(
        "Name of an existing universe in the project. Returns `422` if the universe doesn't exist.",
      ),
    targeting_gate: z
      .string()
      .nullable()
      .default(null)
      .describe(
        "Optional gate name. Only callers that pass the gate are enrolled in the experiment.",
      ),
    allocation_pct: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(0)
      .describe(
        "Share of the (gated) audience allocated to the experiment, in basis points (0–10000 = 0%–100%). `0` = unallocated. Immutable while the experiment is running.",
      ),
    salt: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Hash salt for bucketing. Auto-generated if omitted. Immutable while running."),
    params: paramSchemaSchema.default({}),
    groups: z
      .array(experimentGroupSchema)
      .min(2)
      .describe(
        "Two or more variants. Weights must sum to exactly 10000 (100%). Immutable while running.",
      ),
    significance_threshold: z
      .number()
      .min(0.0001)
      .max(0.5)
      .default(0.05)
      .describe(
        "p-value cutoff used by the analysis pass. Defaults to `0.05`. Values other than 0.05 require Pro plan or higher.",
      ),
    min_runtime_days: z
      .number()
      .int()
      .min(0)
      .max(365)
      .default(0)
      .describe("Minimum days the experiment must run before results are considered conclusive."),
    min_sample_size: z
      .number()
      .int()
      .min(1)
      .default(100)
      .describe("Minimum exposures per group before results are considered conclusive."),
    sequential_testing: z
      .boolean()
      .default(false)
      .describe(
        "Enable sequential testing (always-valid p-values). Requires Premium plan or higher.",
      ),
    goal_metric: experimentInlineMetricSchema
      .optional()
      .describe(
        "Single goal metric defined inline as a DSL query. The underlying event is auto-created if missing.",
      ),
    guardrail_metrics: z
      .array(experimentInlineMetricSchema)
      .max(10)
      .default([])
      .describe(
        "Up to 10 guardrail metrics defined inline. Each is upserted (event + metric) and attached with role=guardrail.",
      ),
  })
  .refine(
    (e) => e.groups.reduce((s, g) => s + g.weight, 0) === 10000,
    "groups weights must sum to exactly 10000",
  )
  .describe(
    "Body for `POST /api/admin/experiments`. `name`, `universe`, and `groups` (≥2, weights sum to 10000) required.",
  );

export const experimentUpdateSchema = z
  .object({
    name: experimentNameSchema.optional(),
    description: z.string().max(2000).nullable().optional(),
    hypothesis: z.string().max(4000).nullable().optional(),
    tag: z.string().max(64).nullable().optional(),
    owner_email: z.string().max(254).nullable().optional(),
    audience: z.string().max(256).nullable().optional(),
    bucket_by: bucketBySchema.nullable().optional(),
    folder: folderSchema,
    targeting_gate: z.string().nullable().optional(),
    allocation_pct: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe("Basis-points allocation (0–10000). Immutable while the experiment is running."),
    salt: z.string().min(1).max(64).optional().describe("Hash salt. Immutable while running."),
    universe: z
      .string()
      .optional()
      .describe(
        "New universe name. Immutable while running. Returns `422` if the universe doesn't exist.",
      ),
    params: paramSchemaSchema.optional(),
    groups: z
      .array(experimentGroupSchema)
      .min(2)
      .optional()
      .describe("Replacement groups. Weights must sum to 10000. Immutable while running."),
    significance_threshold: z.number().min(0.0001).max(0.5).optional(),
    min_runtime_days: z.number().int().min(0).max(365).optional(),
    min_sample_size: z.number().int().min(1).optional(),
    sequential_testing: z.boolean().optional(),
    goal_metric: experimentInlineMetricSchema
      .optional()
      .describe("Replaces the goal metric (event auto-upserted)."),
    guardrail_metrics: z
      .array(experimentInlineMetricSchema)
      .max(10)
      .optional()
      .describe("Replaces the guardrail set wholesale (event auto-upserted per entry)."),
  })
  .describe(
    "Body for `PATCH /api/admin/experiments/{id}`. Partial — only supplied fields change. `allocation_pct`, `groups`, `salt`, `universe`, `params` are immutable while the experiment is running (stop first).",
  );

export const experimentStatusUpdateSchema = z
  .object({
    status: z
      .enum(["draft", "running", "stopped", "archived"])
      .describe(
        "Target status. Allowed transitions: `draft → running`, `running → stopped`, `stopped → archived`, `draft → archived`. Restarting an archived experiment is not allowed.",
      ),
  })
  .describe("Body for `POST /api/admin/experiments/{id}/status`.");

export const experimentMetricsUpdateSchema = z
  .object({
    metrics: z
      .array(
        z.object({
          metric_id: z.string().describe("Existing metric id in the project."),
          role: z
            .enum(["goal", "guardrail", "secondary"])
            .describe(
              "Metric role. `goal` drives the decision, `guardrail` blocks ship if degraded, `secondary` is informational.",
            ),
        }),
      )
      .describe("Replacement metrics list — replaces the current attachments wholesale."),
  })
  .describe(
    "Body for `POST /api/admin/experiments/{id}/metrics`. Replaces the experiment's metric attachments wholesale. Returns `422` if any `metric_id` is unknown.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
export const experimentResponseSchema = z.object({
  id: z.string().describe("Stable opaque experiment id (`exp_…`)."),
  name: experimentNameSchema,
  description: z.string().nullable(),
  hypothesis: z.string().nullable(),
  tag: z.string().nullable(),
  ownerEmail: z.string().nullable(),
  audience: z.string().nullable(),
  bucketBy: bucketBySchema.nullable(),
  folder: z.string().nullable(),
  status: z.enum(["draft", "running", "stopped", "archived"]),
  universe: z.string().describe("Universe name this experiment draws from."),
  targetingGate: z.string().nullable(),
  allocationPct: z.number().int().describe("Allocation in basis points (0–10000)."),
  salt: z.string(),
  params: z.record(z.string(), z.enum(["string", "bool", "number"])),
  groups: z.array(experimentGroupSchema),
  significanceThreshold: z.number(),
  minRuntimeDays: z.number().int(),
  minSampleSize: z.number().int(),
  sequentialTesting: z.boolean(),
  startedAt: z
    .string()
    .nullable()
    .describe("ISO-8601 timestamp the experiment last transitioned to `running`, or `null`."),
  stoppedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
});

export const experimentCreateResponseSchema = z.object({
  id: z.string().describe("Newly assigned experiment id."),
  name: experimentNameSchema,
});

export const experimentUpdateResponseSchema = z.object({
  id: z.string().describe("Experiment id that was updated."),
});

export const experimentDeleteResponseSchema = z.object({ ok: z.literal(true) });

export const experimentStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "running", "stopped", "archived"]),
});

export const experimentMetricsResponseSchema = z.object({
  id: z.string(),
  metrics: z.array(
    z.object({
      metric_id: z.string(),
      role: z.enum(["goal", "guardrail", "secondary"]),
    }),
  ),
});

const experimentResultRowSchema = z.object({
  metric: z.string(),
  group_name: z.string(),
  ds: z.string().describe("Date slice (`YYYY-MM-DD`)."),
  n: z.number().nullable(),
  mean: z.number().nullable(),
  delta_pct: z.number().nullable(),
  p_value: z.number().nullable(),
  srm_detected: z.number().nullable().describe("`1` if sample-ratio mismatch detected, else `0`."),
});

export const experimentResultsResponseSchema = z.object({
  experiment: z.object({
    id: z.string(),
    name: experimentNameSchema,
    status: z.enum(["draft", "running", "stopped", "archived"]),
  }),
  results: z.array(experimentResultRowSchema),
});

export const experimentTimeseriesResponseSchema = z.object({
  experiment: z.object({
    id: z.string(),
    name: experimentNameSchema,
    status: z.enum(["draft", "running", "stopped", "archived"]),
  }),
  series: z.array(experimentResultRowSchema),
});

export const experimentReanalyzeResponseSchema = z.object({
  id: z.string(),
  queued: z.literal(true),
});

export type ExperimentCreateInput = z.infer<typeof experimentCreateSchema>;
export type ExperimentUpdateInput = z.infer<typeof experimentUpdateSchema>;
