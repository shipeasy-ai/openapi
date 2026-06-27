import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

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
export interface Metric {
  id: string;
  name: string;
  folder: string | null;
  eventName: string;
  aggregation: string;
  valuePath: string | null;
  queryIr?: unknown;
  [key: string]: unknown;
}

export interface MetricCreateInput {
  name: string;
  event_name: string;
  folder?: string | null;
  winsorize_pct?: number;
  min_detectable_effect?: number | null;
  /** Metric query DSL string, e.g. `sum(purchase, amount)`. */
  query?: string;
  /** Typed IR form (alternative to `query`). */
  query_ir?: unknown;
}

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
