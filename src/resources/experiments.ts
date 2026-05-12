import { z } from "zod";
import {
  experimentCreateSchema,
  experimentUpdateSchema,
  experimentStatusUpdateSchema,
  experimentMetricsUpdateSchema,
  experimentResponseSchema,
  experimentCreateResponseSchema,
  experimentUpdateResponseSchema,
  experimentDeleteResponseSchema,
  experimentStatusResponseSchema,
  experimentMetricsResponseSchema,
  experimentResultsResponseSchema,
  experimentTimeseriesResponseSchema,
  experimentReanalyzeResponseSchema,
} from "@shipeasy/core/schemas/experiments";
import type { Page, PageQuery } from "@shipeasy/core/pagination";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

/**
 * Input shape callers send (defaults still optional). The server applies
 * defaults via `.parse()`, so consumers can omit `significance_threshold`,
 * `min_runtime_days`, `params`, etc. — `z.input` expresses that.
 */
export type ExperimentCreateInput = z.input<typeof experimentCreateSchema>;
export type ExperimentUpdateInput = z.input<typeof experimentUpdateSchema>;

const experimentListResponseSchema = z.object({
  data: z.array(experimentResponseSchema),
  next_cursor: z.string().nullable(),
});

export interface Experiment {
  id: string;
  name: string;
  status: "draft" | "running" | "stopped" | "archived" | string;
  universe: string;
  allocationPct: number;
  significance_threshold?: number;
  min_runtime_days?: number;
  startedAt?: string | null;
  started_at?: string | null;
  updatedAt?: string;
}

export interface ExperimentResult {
  metric: string;
  group_name: string;
  ds: string;
  n: number | null;
  mean: number | null;
  delta_pct: number | null;
  p_value: number | null;
  srm_detected: number | null;
}

export interface ExperimentTimeseriesPoint {
  ds: string;
  group_name: string;
  metric: string;
  value: number | null;
}

export type ExperimentStatus = "draft" | "running" | "stopped" | "archived";

export interface ExperimentMetricsInput {
  metrics: { metric_id: string; role: "goal" | "guardrail" | "secondary" }[];
}

export interface ExperimentsClient {
  list(opts?: Partial<PageQuery>): Promise<Page<Experiment>>;
  listAll(): Promise<Experiment[]>;
  get(id: string): Promise<Experiment>;
  resolve(idOrName: string): Promise<Experiment>;
  create(input: ExperimentCreateInput): Promise<Experiment>;
  update(id: string, input: ExperimentUpdateInput): Promise<Experiment>;
  delete(id: string): Promise<{ ok: true }>;
  setStatus(id: string, status: ExperimentStatus): Promise<Experiment>;
  start(id: string): Promise<Experiment>;
  stop(id: string): Promise<Experiment>;
  archive(id: string): Promise<Experiment>;
  setMetrics(id: string, input: ExperimentMetricsInput): Promise<unknown>;
  results(id: string): Promise<ExperimentResult[]>;
  timeseries(id: string, metric?: string): Promise<ExperimentTimeseriesPoint[]>;
  reanalyze(id: string): Promise<{ ok: true }>;
}

const BASE = "/api/admin/experiments";

export function experimentsClient(t: Transport): ExperimentsClient {
  async function list(opts: Partial<PageQuery> = {}): Promise<Page<Experiment>> {
    const query: Record<string, string> = {};
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    if (opts.cursor) query.cursor = opts.cursor;
    return t.request<Page<Experiment>>("GET", BASE, undefined, query);
  }
  async function listAll(): Promise<Experiment[]> {
    const out: Experiment[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 500, cursor });
      out.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return out;
  }
  async function resolve(idOrName: string) {
    try {
      return await t.request<Experiment>("GET", `${BASE}/${idOrName}`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
    const all = await listAll();
    const found = all.find((e) => e.name === idOrName);
    if (!found) throw new ApiError(`Experiment '${idOrName}' not found`, 404);
    return found;
  }
  async function setStatus(id: string, status: ExperimentStatus) {
    return t.request<Experiment>(
      "POST",
      `${BASE}/${id}/status`,
      experimentStatusUpdateSchema.parse({ status }),
    );
  }

  return {
    list,
    listAll,
    resolve,
    get: (id: string) => t.request<Experiment>("GET", `${BASE}/${id}`),
    create: (input) => t.request<Experiment>("POST", BASE, experimentCreateSchema.parse(input)),
    update: (id, input) =>
      t.request<Experiment>("PATCH", `${BASE}/${id}`, experimentUpdateSchema.parse(input)),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
    setStatus,
    start: (id) => setStatus(id, "running"),
    stop: (id) => setStatus(id, "stopped"),
    archive: (id) => setStatus(id, "archived"),
    setMetrics: (id, input) =>
      t.request("POST", `${BASE}/${id}/metrics`, experimentMetricsUpdateSchema.parse(input)),
    results: (id) => t.request<ExperimentResult[]>("GET", `${BASE}/${id}/results`),
    timeseries: (id, metric) =>
      t.request<ExperimentTimeseriesPoint[]>(
        "GET",
        `${BASE}/${id}/timeseries`,
        undefined,
        metric ? { metric } : undefined,
      ),
    reanalyze: (id) => t.request<{ ok: true }>("POST", `${BASE}/${id}/reanalyze`),
  };
}

const SAMPLE_EXP = {
  id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1",
  name: "checkout_button_color",
  description: "Test green vs. blue CTA on the checkout page.",
  tag: "checkout",
  status: "running",
  universe: "primary_users",
  targetingGate: null,
  allocationPct: 5000,
  salt: "8d3e9a1f6b7c4a5fa1c2b6d3e7c8e3a1",
  params: { cta_color: "string" },
  groups: [
    { name: "control", weight: 5000, params: { cta_color: "blue" } },
    { name: "treatment", weight: 5000, params: { cta_color: "green" } },
  ],
  significanceThreshold: 0.05,
  minRuntimeDays: 7,
  minSampleSize: 1000,
  sequentialTesting: false,
  startedAt: "2026-05-01T12:00:00.000Z",
  stoppedAt: null,
  updatedAt: "2026-05-09T18:22:11.000Z",
};

export const experimentsResource = {
  name: "experiments" as const,
  basePath: BASE,
  describeOne: "experiment",
  describeMany: "experiments",
  tag: {
    name: "Experiments",
    description: [
      "A/B/n experiments: randomised group assignment plus the analysis pipeline (t-test, sequential testing, SRM detection) on top of a universe.",
      "",
      "**Identity.** Stable `name` (a-z, 0-9, `_`/`-`, max 64 chars). Immutable after create.",
      "",
      "**Lifecycle.** `draft → running → stopped → archived`. Transition via `POST /{id}/status`. Restarting an archived experiment is not allowed.",
      "",
      "**Allocation.** `allocation_pct` (basis points, 0–10000) is the share of the targeted audience enrolled; `groups[].weight` (must sum to 10000) splits the enrolled audience. `targeting_gate` narrows the eligible audience before allocation.",
      "",
      "**Immutable while running.** `allocation_pct`, `groups`, `salt`, `universe`, `params` cannot be edited on a running experiment — stop it first.",
      "",
      "**Metrics.** Attach via `POST /{id}/metrics`. Each metric has a role: `goal` drives the decision, `guardrail` blocks ship on regression, `secondary` is informational.",
      "",
      "**Analysis.** Daily cron writes results to D1. Read via `GET /{id}/results` (latest per metric/group/day) or `GET /{id}/timeseries` (full history). `POST /{id}/reanalyze` requeues the analysis pass.",
    ].join("\n"),
  },
  schemas: {
    create: experimentCreateSchema,
    update: experimentUpdateSchema,
  },
  actions: [
    { name: "start", description: "Transition draft experiment to running" },
    { name: "stop", description: "Stop a running experiment" },
    { name: "archive", description: "Archive a stopped experiment" },
    { name: "reanalyze", description: "Re-run analysis pass for the experiment" },
  ] as const,
  endpoints: [
    {
      operationId: "listExperiments",
      method: "GET",
      path: "",
      summary: "List experiments",
      description:
        "Returns a single page of non-archived experiments ordered by `updated_at desc, id desc`. Use the `cursor` query parameter to paginate.",
      response: experimentListResponseSchema,
      examples: { response: { data: [SAMPLE_EXP], next_cursor: null } },
      useCase:
        "Snapshot every active experiment in the project — e.g. render an overview dashboard or drive a CI check that no experiment has been running past its `min_runtime_days`.",
    },
    {
      operationId: "getExperiment",
      method: "GET",
      path: "/{id}",
      summary: "Get one experiment",
      description:
        "Returns the full experiment row including groups, params, allocation, and lifecycle timestamps.",
      pathParams: { id: "Stable opaque experiment id (`exp_…`) or the experiment's `name`." },
      response: experimentResponseSchema,
      examples: { response: SAMPLE_EXP },
      useCase:
        "Fetch one experiment to render the detail page or to inspect its current allocation and group weights.",
    },
    {
      operationId: "createExperiment",
      method: "POST",
      path: "",
      summary: "Create an experiment",
      description: [
        "Creates a new experiment in `draft` status. `name`, `universe`, and `groups` are required; everything else has sensible defaults.",
        "",
        "Returns `409` if `name` already exists, `422` if the named universe doesn't exist, `403` if a plan-gated option is set (`sequential_testing`, custom `significance_threshold`) on a plan that doesn't include it.",
      ].join("\n"),
      successStatus: 201,
      request: experimentCreateSchema,
      response: experimentCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — two-group 50/50",
            description: "Smallest valid body. Two groups at 50/50, no allocation, no targeting.",
            value: {
              name: "checkout_button_color",
              universe: "primary_users",
              groups: [
                { name: "control", weight: 5000 },
                { name: "treatment", weight: 5000 },
              ],
            },
          },
          targeted: {
            summary: "Targeted — gate + allocation + params",
            description:
              "Gate the audience with a `targeting_gate`, allocate 50% of it, and parameterise the variants.",
            value: {
              name: "checkout_button_color",
              description: "Green CTA on checkout for Pro users.",
              universe: "primary_users",
              targeting_gate: "pro_plan_only",
              allocation_pct: 5000,
              params: { cta_color: "string" },
              groups: [
                { name: "control", weight: 5000, params: { cta_color: "blue" } },
                { name: "treatment", weight: 5000, params: { cta_color: "green" } },
              ],
            },
          },
          multivariant: {
            summary: "Multivariant — three groups",
            description: "Three variants splitting 40/30/30. Requires the sum to equal 10000.",
            value: {
              name: "headline_test",
              universe: "primary_users",
              groups: [
                { name: "control", weight: 4000 },
                { name: "alt_a", weight: 3000 },
                { name: "alt_b", weight: 3000 },
              ],
            },
          },
          sequential: {
            summary: "Sequential testing — Premium plan",
            description: "Enable always-valid sequential tests. Requires Premium plan or higher.",
            value: {
              name: "checkout_button_color",
              universe: "primary_users",
              groups: [
                { name: "control", weight: 5000 },
                { name: "treatment", weight: 5000 },
              ],
              sequential_testing: true,
              min_runtime_days: 14,
            },
          },
        },
        response: { id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1", name: "checkout_button_color" },
      },
      useCase: [
        "- **Minimal 50/50** — `name` + `universe` + two equal-weight groups.",
        "- **Targeted rollout** — supply `targeting_gate` to restrict the eligible audience and `allocation_pct` to enrol a slice of it.",
        "- **Multivariant** — three or more groups with weights summing to 10000.",
        "- **Sequential testing** — `sequential_testing: true` for Premium plans.",
      ].join("\n"),
    },
    {
      operationId: "updateExperiment",
      method: "PATCH",
      path: "/{id}",
      summary: "Update an experiment",
      description: [
        "Partial update. `allocation_pct`, `groups`, `salt`, `universe`, `params` are **immutable while running** — returns `409` if you try. Stop the experiment first.",
        "",
        "Editing `groups` while in `draft` is fine; weights must still sum to 10000.",
      ].join("\n"),
      pathParams: { id: "Stable opaque experiment id." },
      request: experimentUpdateSchema,
      response: experimentUpdateResponseSchema,
      examples: {
        requestExamples: {
          rampAllocation: {
            summary: "Ramp allocation — 0 → 50%",
            description:
              "Bumps the share of the targeted audience enrolled. Allowed only when the experiment is in `draft`.",
            value: { allocation_pct: 5000 },
          },
          changeWeights: {
            summary: "Change group weights",
            description: "Replace the groups array — weights must still sum to 10000.",
            value: {
              groups: [
                { name: "control", weight: 2500 },
                { name: "treatment", weight: 7500 },
              ],
            },
          },
          tighterSignificance: {
            summary: "Tighter significance threshold",
            description: "Drop the p-value cutoff from 0.05 → 0.01. Requires Pro plan or higher.",
            value: { significance_threshold: 0.01 },
          },
          updateMetadata: {
            summary: "Update metadata",
            description: "Change description/tag/targeting_gate freely on running experiments.",
            value: {
              description: "Bumped to 50% after passing canary on 25%.",
              tag: "checkout",
            },
          },
        },
        response: { id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1" },
      },
      useCase: [
        "- **Update metadata** — `description`, `tag`, `targeting_gate` editable any time.",
        "- **Ramp before launch** — set `allocation_pct` while still in `draft`.",
        "- **Tighten significance** — `significance_threshold` (Pro+).",
        "- **Rewire groups** — replace `groups` wholesale while in `draft`; immutable once running.",
      ].join("\n"),
    },
    {
      operationId: "deleteExperiment",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete an experiment",
      description:
        "Archives the experiment (soft-delete via status transition). Returns `409` if the experiment is still `running` — stop it first.",
      pathParams: { id: "Stable opaque experiment id." },
      response: experimentDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Tear down an experiment after the analysis is signed off.",
    },
    {
      operationId: "setExperimentStatus",
      method: "POST",
      path: "/{id}/status",
      summary: "Transition experiment status",
      description: [
        "Drives the experiment lifecycle. Allowed transitions:",
        "",
        "- `draft → running` — starts allocation. Bumps the `startedAt` timestamp.",
        "- `running → stopped` — halts allocation. Existing exposures stay in the dataset.",
        "- `stopped → archived` — soft-delete.",
        "- `draft → archived` — discard an unstarted experiment.",
        "",
        "Restarting an `archived` experiment is not allowed; clone instead. Returns `409` on illegal transitions and `429` if the plan's `experiments_running` limit is exceeded on `→ running`.",
      ].join("\n"),
      pathParams: { id: "Stable opaque experiment id." },
      request: experimentStatusUpdateSchema,
      response: experimentStatusResponseSchema,
      examples: {
        requestExamples: {
          start: {
            summary: "Start — draft → running",
            description:
              "Begins allocation. The experiment counts against the plan's `experiments_running` limit.",
            value: { status: "running" },
          },
          stop: {
            summary: "Stop — running → stopped",
            description: "Halts allocation. Existing exposures remain analysable.",
            value: { status: "stopped" },
          },
          archive: {
            summary: "Archive — stopped → archived",
            description:
              "Soft-deletes the experiment. List endpoints exclude archived rows by default.",
            value: { status: "archived" },
          },
        },
        response: { id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1", status: "running" },
      },
      useCase: [
        '- **Start** — `{ "status": "running" }` after wiring up the SDK and verifying targeting on staging.',
        '- **Stop** — `{ "status": "stopped" }` once the experiment hits its `min_runtime_days` and conclusive results land.',
        '- **Archive** — `{ "status": "archived" }` to soft-delete after sign-off.',
      ].join("\n"),
    },
    {
      operationId: "setExperimentMetrics",
      method: "POST",
      path: "/{id}/metrics",
      summary: "Attach metrics",
      description: [
        "Replaces the experiment's metric attachments wholesale. Each entry pairs an existing `metric_id` with a `role` (`goal` / `guardrail` / `secondary`).",
        "",
        "Returns `422` if any `metric_id` doesn't exist in the project. Pass `{ metrics: [] }` to detach everything.",
      ].join("\n"),
      pathParams: { id: "Stable opaque experiment id." },
      request: experimentMetricsUpdateSchema,
      response: experimentMetricsResponseSchema,
      examples: {
        requestExamples: {
          standard: {
            summary: "Standard — one goal + one guardrail",
            description: "Attaches one decision metric and one safety metric.",
            value: {
              metrics: [
                { metric_id: "met_checkout_completed", role: "goal" },
                { metric_id: "met_page_errors", role: "guardrail" },
              ],
            },
          },
          detach: {
            summary: "Detach all",
            description: "Send an empty array to clear every metric.",
            value: { metrics: [] },
          },
        },
        response: {
          id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1",
          metrics: [
            { metric_id: "met_checkout_completed", role: "goal" },
            { metric_id: "met_page_errors", role: "guardrail" },
          ],
        },
      },
      useCase: [
        "- **Standard setup** — one `goal`, one or two `guardrail`, optional `secondary` metrics for diagnostics.",
        '- **Detach all** — send `{ "metrics": [] }` before archiving.',
      ].join("\n"),
    },
    {
      operationId: "getExperimentResults",
      method: "GET",
      path: "/{id}/results",
      summary: "Get analysis results",
      description:
        "Returns the latest analysis output for the experiment — one row per metric/group/day, including sample size, mean, % delta vs. control, p-value, and a sample-ratio mismatch flag.",
      pathParams: { id: "Stable opaque experiment id." },
      response: experimentResultsResponseSchema,
      examples: {
        response: {
          experiment: {
            id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1",
            name: "checkout_button_color",
            status: "running",
          },
          results: [
            {
              metric: "checkout_completed",
              group_name: "control",
              ds: "2026-05-09",
              n: 12421,
              mean: 0.1834,
              delta_pct: null,
              p_value: null,
              srm_detected: 0,
            },
            {
              metric: "checkout_completed",
              group_name: "treatment",
              ds: "2026-05-09",
              n: 12519,
              mean: 0.1922,
              delta_pct: 4.8,
              p_value: 0.018,
              srm_detected: 0,
            },
          ],
        },
      },
      useCase:
        "Render the results table on the experiment detail page or drive an automated decision once a `goal` metric reaches significance.",
    },
    {
      operationId: "getExperimentTimeseries",
      method: "GET",
      path: "/{id}/timeseries",
      summary: "Get analysis timeseries",
      description:
        "Same row shape as `/results`, but returns every daily slice rather than the latest. Filter to a single metric with the `metric` query parameter.",
      pathParams: { id: "Stable opaque experiment id." },
      queryParams: {
        metric: {
          schema: z.string().optional(),
          description: "Optional metric name to filter the series.",
        },
      },
      response: experimentTimeseriesResponseSchema,
      examples: {
        response: {
          experiment: {
            id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1",
            name: "checkout_button_color",
            status: "running",
          },
          series: [
            {
              metric: "checkout_completed",
              group_name: "treatment",
              ds: "2026-05-08",
              n: 11200,
              mean: 0.1903,
              delta_pct: 3.9,
              p_value: 0.034,
              srm_detected: 0,
            },
            {
              metric: "checkout_completed",
              group_name: "treatment",
              ds: "2026-05-09",
              n: 12519,
              mean: 0.1922,
              delta_pct: 4.8,
              p_value: 0.018,
              srm_detected: 0,
            },
          ],
        },
      },
      useCase:
        "Drive a chart of metric movement over the experiment runtime, or sanity-check the lift is monotonic before deciding.",
    },
    {
      operationId: "reanalyzeExperiment",
      method: "POST",
      path: "/{id}/reanalyze",
      summary: "Re-queue analysis",
      description:
        "Requeues the daily analysis pass for this experiment outside the normal cron cadence. Useful after attaching a new metric or correcting an event taxonomy. The job runs asynchronously.",
      pathParams: { id: "Stable opaque experiment id." },
      response: experimentReanalyzeResponseSchema,
      examples: { response: { id: "exp_01j7wb12c3d4e5f6g7h8j9k0l1", queued: true } },
      useCase:
        "Force-refresh results after wiring up a new metric without waiting for the next nightly cron tick.",
    },
  ] as const,
} as const;
