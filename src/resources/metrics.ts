import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";
import {
  metricCreateSchema,
  metricResponseSchema,
  metricListResponseSchema,
  metricCreateResponseSchema,
  metricDeleteResponseSchema,
  type MetricResponse,
  type MetricCreateInput,
} from "../schemas/metrics.js";

/**
 * Metric definitions — the event-backed queries that power tracking dashboards
 * and experiment success/guardrail metrics. A metric pins one event, one
 * aggregation, and (for sum/avg) a value path, expressed as the metric query
 * DSL or its typed IR form.
 *
 * The admin endpoint accepts either `query` (the DSL string) or `query_ir`
 * (the typed IR). The CLI's vendored DSL parser turns `--query` into IR
 * client-side for an early error; the server validates either form, so the
 * registry op can pass `query` straight through and stay worker-safe (no
 * parser bundled into the shared registry).
 */
export type Metric = MetricResponse;

export type { MetricCreateInput };

export interface MetricsClient {
  /** Every metric in the project (the list endpoint is not paginated). */
  list(): Promise<Metric[]>;
  /** Fetch one metric by its full id. */
  get(id: string): Promise<Metric>;
  /** Resolve by exact id, unique id-prefix, or exact (unique) name. */
  resolve(idOrName: string): Promise<Metric>;
  create(input: MetricCreateInput): Promise<{ id: string; name: string }>;
  /** Soft-delete (the user-facing verb is `archive`). */
  delete(id: string): Promise<{ ok: true }>;
}

const BASE = "/api/admin/metrics";

export function metricsClient(t: Transport): MetricsClient {
  async function list(): Promise<Metric[]> {
    return t.request<Metric[]>("GET", BASE);
  }
  async function resolve(idOrName: string): Promise<Metric> {
    const all = await list();
    const byId = all.find((m) => m.id === idOrName);
    if (byId) return byId;
    const byPrefix = all.filter((m) => m.id.startsWith(idOrName));
    if (byPrefix.length === 1) return byPrefix[0];
    if (byPrefix.length > 1) throw new ApiError(`Metric id prefix '${idOrName}' is ambiguous`, 400);
    const byName = all.filter((m) => m.name === idOrName);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1)
      throw new ApiError(`Metric name '${idOrName}' is ambiguous — pass an id`, 400);
    throw new ApiError(`Metric '${idOrName}' not found`, 404);
  }
  return {
    list,
    resolve,
    get: (id) => t.request<Metric>("GET", `${BASE}/${id}`),
    create: (input) => t.request<{ id: string; name: string }>("POST", BASE, input),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
  };
}

export const metricsResource = {
  name: "metrics" as const,
  basePath: BASE,
  describeOne: "metric",
  describeMany: "metrics",
  tag: {
    name: "Metrics",
    description: [
      "Metrics: the event-backed queries that drive tracking dashboards and",
      "experiment success / guardrail measurement.",
      "",
      "**Definition.** Each metric pins one source event (`event_name`), one",
      "aggregation, and (for `sum`/`avg`/quantile) a numeric value label. The",
      "query is expressed as the DSL string (`query`, e.g. `sum(purchase, amount)`)",
      "or its typed IR (`query_ir`) — supply exactly one.",
      "",
      "**Identity.** Keyed by a stable `name` (single segment or `folder.name`).",
      "Resolve endpoints accept the `id` or the `name`.",
      "",
      "**Deletion.** Archive (soft-delete). Blocked while the metric is attached",
      "to a running experiment — stop those first.",
    ].join("\n"),
  },
  schemas: {
    create: metricCreateSchema,
  },
  actions: [] as const,
  endpoints: [
    {
      operationId: "listMetrics",
      method: "GET",
      path: "",
      summary: "List metrics",
      description:
        "Returns every metric in the project (not paginated) — name, folder, source event, aggregation, and the rendered query.",
      response: metricListResponseSchema,
      examples: {
        response: [
          {
            id: "met_01j7w8a1b2c3d4e5f6g7h8i9j0",
            name: "checkouts",
            folder: null,
            eventName: "checkout_completed",
            aggregation: "count_users",
            valuePath: null,
            query: "count_users(checkout_completed)",
            direction: "higher_better",
          },
        ],
      },
      useCase:
        "Audit every metric defined in the project — for example to find the metric id to attach as an experiment's success metric.",
    },
    {
      operationId: "getMetric",
      method: "GET",
      path: "/{id}",
      summary: "Get a metric",
      description: "Fetch one metric by its id or name, including the rendered DSL query and the typed IR.",
      pathParams: { id: "Stable opaque metric id (`met_…`) or the metric's `name`." },
      response: metricResponseSchema,
      examples: {
        response: {
          id: "met_01j7w8a1b2c3d4e5f6g7h8i9j0",
          name: "revenue",
          folder: "checkout",
          eventName: "purchase",
          aggregation: "sum",
          valuePath: "amount",
          query: "sum(purchase, amount)",
          direction: "higher_better",
          winsorizePct: 99,
        },
      },
      useCase: "Inspect a single metric's full definition before reusing it in an experiment or alert rule.",
    },
    {
      operationId: "createMetric",
      method: "POST",
      path: "",
      summary: "Create a metric",
      description: [
        "Creates an event-backed metric. Pass the query as the DSL string (`query`) **or**",
        "the typed IR (`query_ir`) — exactly one. `event_name` must equal the event the",
        "query references.",
        "",
        "Returns `409` if a metric with the same `name` already exists, and `422` if the",
        "query is invalid or references an unregistered event / label.",
      ].join("\n"),
      successStatus: 201,
      request: metricCreateSchema,
      response: metricCreateResponseSchema,
      examples: {
        requestExamples: {
          countUsers: {
            summary: "Count unique users (DSL)",
            description: "Unique users who completed checkout, expressed with the query DSL.",
            value: {
              name: "checkouts",
              event_name: "checkout_completed",
              query: "count_users(checkout_completed)",
            },
          },
          sumRevenue: {
            summary: "Sum a value label (DSL)",
            description: "Total revenue, summing the `amount` property of the `purchase` event.",
            value: {
              name: "revenue",
              folder: "checkout",
              event_name: "purchase",
              query: "sum(purchase, amount)",
              direction: "higher_better",
            },
          },
          typedIr: {
            summary: "Typed IR",
            description: "Same metric supplied as the structured `query_ir` instead of the DSL.",
            value: {
              name: "checkouts",
              event_name: "checkout_completed",
              query_ir: {
                agg: { kind: "count_users" },
                metric: "checkout_completed",
                filters: [],
              },
            },
          },
        },
        response: { id: "met_01j7w8a1b2c3d4e5f6g7h8i9j0", name: "checkouts" },
      },
      useCase: [
        "- **Track an event** — `count_users(<event>)` for unique-user counts.",
        "- **Sum a value** — `sum(<event>, <label>)` for revenue / quantity metrics.",
        "- **Experiment success metric** — create the metric, then attach its id to an experiment.",
      ].join("\n"),
    },
    {
      operationId: "deleteMetric",
      method: "DELETE",
      path: "/{id}",
      summary: "Archive a metric",
      description:
        "Soft-deletes (archives) the metric. Returns `409` if it is attached to a running experiment — stop those experiments first.",
      pathParams: { id: "Stable opaque metric id (`met_…`) or the metric's `name`." },
      response: metricDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Retire a metric once no running experiment depends on it (the user-facing verb is `archive`).",
    },
  ] as const,
} as const;
