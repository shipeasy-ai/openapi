import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { bool, num, str } from "./util.js";

/**
 * Experiment operations — `release experiments …`. The single definition behind
 * both `cli/src/commands/release.ts` and the MCP `release_experiments_*` tools.
 *
 * As of the operations/ deprecation (Phase 1) these `run()`s are **pass-through**:
 * the facade→wire work the registry used to do client-side now lives behind the
 * REST API, so every generated SDK gets the same ergonomics, not just TS:
 *   • goal metric — the `successEvent`/`successAggregation`/`successValue` trio is
 *     forwarded as `goal_metric: {event,aggregation,value}` and the server
 *     compiles the DSL (was `buildGoalMetric`).
 *   • allocation — forwarded as `allocation_percent` (0–100); the server converts
 *     to basis points (was `Math.round(pct*100)`).
 *   • name-or-id — every `{id}` route accepts the experiment name, so the ops
 *     pass the name straight through (was a client-side `resolve()` round-trip).
 *   • verdict — `status` reads the server-computed verdict off `/results` (was
 *     `computeVerdict`).
 *
 * Note: the CLI had both `delete` (hard) and `archive` (soft). Per the
 * registry-wide `delete`→`archive` convention, only `archive` is exposed; the
 * hard delete is UI-only. `restore` reverses an archive (archived → draft).
 */

const GROUP = ["release", "experiments"];

const DEFAULT_GROUPS = [
  { name: "control", weight: 5000, params: {} },
  { name: "test", weight: 5000, params: {} },
];

const AGGREGATIONS = [
  "count_users",
  "count_events",
  "retention_7d",
  "retention_30d",
  "sum",
  "avg",
] as const;

/**
 * Forward the `successEvent`(+`successAggregation`/`successValue`) facade trio as
 * the server's inline `goal_metric` event form — the server compiles it into a
 * DSL query and auto-upserts the event/metric. Returns undefined when no event
 * was supplied (nothing to attach).
 */
function goalMetricInput(i: OpInput): { event: string; aggregation?: string; value?: string } | undefined {
  const event = str(i, "successEvent");
  if (!event) return undefined;
  const aggregation = str(i, "successAggregation");
  const value = str(i, "successValue");
  return {
    event,
    ...(aggregation ? { aggregation } : {}),
    ...(value ? { value } : {}),
  };
}

/**
 * Normalize the `guardrailMetrics` facade arg — a JSON array of metric-DSL query
 * strings or `{ query, name }` objects — into the server's inline-metric array
 * (each entry `{ query, name? }`). Already JSON-parsed by the framework (param
 * type `json`); tolerates a non-array (→ no guardrails). The server upserts each
 * and attaches it with role=guardrail.
 */
function guardrailMetricsInput(raw: unknown): { query: string; name?: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { query: string; name?: string }[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const query = entry.trim();
      if (query) out.push({ query });
    } else if (entry && typeof entry === "object") {
      const o = entry as { query?: unknown; name?: unknown };
      const query = typeof o.query === "string" ? o.query.trim() : "";
      if (query)
        out.push(typeof o.name === "string" && o.name ? { query, name: o.name } : { query });
    }
  }
  return out;
}

export const experimentOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List experiments",
    description: "Return every experiment (status, universe, allocation).",
    params: [],
    examples: [{ run: "shipeasy release experiments list" }],
    run: (client: AdminClient) => client.experiments.listAll(),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create an experiment",
    description:
      "Create an experiment draft with groups, params, optional targeting gate, a success (goal) " +
      "metric, optional guardrail metrics, and full statistical config. Pass `successEvent` " +
      "(+ `successAggregation`) to attach the goal metric inline — required before the experiment " +
      "can be started. Defaults to a 50/50 control-vs-test split at 100% allocation in the " +
      "`default` universe. Does NOT start — call `start`.",
    params: [
      { name: "name", type: "string", description: "Experiment name.", required: true, positional: true },
      { name: "universe", type: "string", description: "Universe name. Defaults to 'default'." },
      { name: "allocation", type: "number", description: "Allocation percentage, 0–100. Defaults to 100." },
      { name: "groups", type: "json", description: "Groups as JSON [{name,weight,params}]. weight is basis points." },
      { name: "params", type: "json", description: "Parameter schema {name: type}." },
      { name: "targetingGate", type: "string", description: "Targeting gate name." },
      { name: "bucketBy", type: "string", description: "Attribute to bucket by (defaults to the universe unit)." },
      { name: "salt", type: "string", description: "Override hash salt." },
      { name: "successEvent", type: "string", description: "Event name for the inline goal metric. Attaching one makes the draft startable." },
      { name: "successAggregation", type: "string", description: `Goal-metric reducer. Defaults to count_users.`, enum: [...AGGREGATIONS] },
      { name: "successValue", type: "string", description: "Numeric event property for sum/avg goal metrics." },
      { name: "guardrailMetrics", type: "json", description: "Up to 10 guardrail metrics: JSON array of DSL query strings or {query,name}." },
      { name: "significance", type: "number", description: "Significance threshold (0.0001–0.5). Defaults to 0.05." },
      { name: "minRuntimeDays", type: "number", description: "Minimum runtime in days." },
      { name: "minSampleSize", type: "number", description: "Minimum sample size." },
      { name: "sequentialTesting", type: "boolean", description: "Enable sequential testing (always-valid p-values; Premium+)." },
      { name: "description", type: "string", description: "Human-readable description." },
    ],
    examples: [
      { note: "Default 50/50, full traffic", run: "shipeasy release experiments create pricing-page" },
      {
        note: "Attach a goal metric so it's startable",
        run: "shipeasy release experiments create checkout-cta --universe web --success-event checkout_completed",
      },
    ],
    run: (client: AdminClient, i: OpInput) => {
      const goal_metric = goalMetricInput(i);
      const guardrail_metrics = guardrailMetricsInput(i.guardrailMetrics);
      return client.experiments.create({
        name: i.name as string,
        universe: str(i, "universe") ?? "default",
        // Forward percent; the server converts to basis points.
        allocation_percent: num(i, "allocation") ?? 100,
        groups: (i.groups as never) ?? DEFAULT_GROUPS,
        params: (i.params as never) ?? {},
        targeting_gate: (str(i, "targetingGate") ?? null) as never,
        ...(str(i, "bucketBy") ? { bucket_by: str(i, "bucketBy") as never } : {}),
        ...(str(i, "description") !== undefined ? { description: str(i, "description") as never } : {}),
        ...(i.salt ? { salt: i.salt as string } : {}),
        ...(num(i, "significance") !== undefined ? { significance_threshold: num(i, "significance") } : {}),
        ...(num(i, "minRuntimeDays") !== undefined ? { min_runtime_days: num(i, "minRuntimeDays") } : {}),
        ...(num(i, "minSampleSize") !== undefined ? { min_sample_size: num(i, "minSampleSize") } : {}),
        ...(bool(i, "sequentialTesting") !== undefined ? { sequential_testing: bool(i, "sequentialTesting") } : {}),
        ...(goal_metric ? { goal_metric } : {}),
        ...(guardrail_metrics.length ? { guardrail_metrics } : {}),
      } as never);
    },
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update an experiment",
    description:
      "Patch allocation, groups, params, targeting gate, or stats thresholds. Pass `targetingGate` " +
      "= 'null' to clear it.",
    params: [
      { name: "name", type: "string", description: "Experiment name.", required: true, positional: true },
      { name: "allocation", type: "number", description: "Allocation percentage, 0–100." },
      { name: "groups", type: "json", description: "Groups as JSON [{name,weight,params}]." },
      { name: "params", type: "json", description: "Parameter schema {name: type}." },
      { name: "targetingGate", type: "string", description: "Targeting gate name ('null' to clear)." },
      { name: "bucketBy", type: "string", description: "Attribute to bucket by (empty string clears)." },
      { name: "successEvent", type: "string", description: "Attach/replace the goal metric from this event." },
      { name: "successAggregation", type: "string", description: "Goal-metric reducer (with successEvent).", enum: [...AGGREGATIONS] },
      { name: "successValue", type: "string", description: "Numeric event property for sum/avg goal metrics." },
      { name: "guardrailMetrics", type: "json", description: "Replace the guardrail set: JSON array of DSL queries or {query,name}." },
      { name: "significance", type: "number", description: "Significance threshold (0.0001–0.5)." },
      { name: "minRuntimeDays", type: "number", description: "Minimum runtime in days." },
      { name: "minSampleSize", type: "number", description: "Minimum sample size." },
      { name: "sequentialTesting", type: "boolean", description: "Enable sequential testing (always-valid p-values)." },
    ],
    examples: [
      { note: "Dial allocation to 50%", run: "shipeasy release experiments update pricing-page --allocation 50" },
      { note: "Clear targeting + tighten significance", run: "shipeasy release experiments update checkout-cta --targeting-gate null --significance 0.01" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const patch: Record<string, unknown> = {};
      const allocation = num(i, "allocation");
      // Forward percent; the server converts to basis points.
      if (allocation !== undefined) patch.allocation_percent = allocation;
      if (i.groups !== undefined) patch.groups = i.groups;
      if (i.params !== undefined) patch.params = i.params;
      if (i.targetingGate !== undefined)
        patch.targeting_gate = i.targetingGate === "null" ? null : i.targetingGate;
      if (str(i, "bucketBy") !== undefined) patch.bucket_by = str(i, "bucketBy") || null;
      if (i.significance !== undefined) patch.significance_threshold = i.significance;
      if (i.minRuntimeDays !== undefined) patch.min_runtime_days = i.minRuntimeDays;
      if (i.minSampleSize !== undefined) patch.min_sample_size = i.minSampleSize;
      if (bool(i, "sequentialTesting") !== undefined) patch.sequential_testing = bool(i, "sequentialTesting");
      if (i.guardrailMetrics !== undefined)
        patch.guardrail_metrics = guardrailMetricsInput(i.guardrailMetrics);
      // Attach/replace the goal metric so a draft missing one can be made startable.
      const goal_metric = goalMetricInput(i);
      if (goal_metric) patch.goal_metric = goal_metric;
      // The {id} path param accepts the name — no client-side resolve().
      return client.experiments.update(i.name as string, patch);
    },
  },
  {
    group: GROUP,
    name: "start",
    mutates: true,
    summary: "Start an experiment",
    description: "Move an experiment from draft to running.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments start pricing-page" }],
    run: (client: AdminClient, i: OpInput) => client.experiments.start(i.name as string),
  },
  {
    group: GROUP,
    name: "stop",
    mutates: true,
    summary: "Stop a running experiment",
    description:
      "Stop a running experiment. Optionally name a `promoteGroup` to record an intent note (actual " +
      "promotion happens in the dashboard).",
    params: [
      { name: "name", type: "string", description: "Experiment name.", required: true, positional: true },
      { name: "promoteGroup", type: "string", description: "Group to note as the winner to promote." },
    ],
    examples: [{ run: "shipeasy release experiments stop pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const name = i.name as string;
      const result = await client.experiments.stop(name);
      const promote = str(i, "promoteGroup");
      return {
        ...(result as object),
        ...(promote
          ? {
              promote_group_note: `Manual promotion needed: promote group '${promote}' in the dashboard or via PATCH /api/admin/experiments/${name}.`,
            }
          : {}),
      };
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a stopped experiment",
    description: "Archive (soft-delete) a stopped experiment, hiding it from the default list while preserving results.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments archive pricing-page" }],
    run: (client: AdminClient, i: OpInput) => client.experiments.archive(i.name as string),
  },
  {
    group: GROUP,
    name: "restore",
    mutates: true,
    summary: "Restore an archived experiment to draft",
    description:
      "Restore a soft-deleted (archived) experiment back to `draft`. Allowed only if it never started; one that already ran must be cloned instead. Preserves the goal metric.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments restore pricing-page" }],
    run: (client: AdminClient, i: OpInput) => client.experiments.restore(i.name as string),
  },
  {
    group: GROUP,
    name: "reanalyze",
    mutates: true,
    summary: "Re-run the analysis pass",
    description: "Trigger a fresh analysis pass for an experiment.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments reanalyze pricing-page" }],
    run: (client: AdminClient, i: OpInput) => client.experiments.reanalyze(i.name as string),
  },
  {
    group: GROUP,
    name: "status",
    mutates: false,
    summary: "Show experiment status, verdict, and latest results",
    description:
      "Return the experiment, its latest per-metric results (enrolment, deltas, p-values), and the " +
      "server-computed ship/hold/wait/invalid/draft verdict (from the goal metric + guardrails + " +
      "SRM vs. the significance threshold and minimum runtime).",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments status pricing-page" }],
    // Pass-through: the {id} route accepts the name and `/results` already carries
    // the verdict + experiment + rows (server owns the policy — was computeVerdict).
    run: (client: AdminClient, i: OpInput) => client.experiments.results(i.name as string),
  },
];
