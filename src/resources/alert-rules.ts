import { z } from "zod";
import {
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
} from "../schemas/alert-rules.js";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

export type AlertRuleCreateInput = z.input<typeof alertRuleCreateSchema>;
export type AlertRuleUpdateInput = z.input<typeof alertRuleUpdateSchema>;

/**
 * One metric-threshold alert rule. The cron evaluates `agg(metric)` over the
 * trailing `windowHours` and raises an alert at `severity` when the value
 * `comparator` `threshold` holds.
 *
 * `metricId` is fixed at create time — there is no update path for it (the
 * metric also pins the aggregation). Tune `threshold`/`comparator`/
 * `windowHours`/`severity`/`name`/`enabled` instead, or delete + recreate to
 * repoint the rule at a different metric.
 */
export interface AlertRule {
  id: string;
  name: string;
  metricId: string;
  metricName: string | null;
  comparator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  windowHours: number;
  severity: "danger" | "warn" | "info";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRulesClient {
  /** All alert rules for the bound project (the list endpoint is not paginated). */
  list(): Promise<AlertRule[]>;
  /** Resolve a rule by exact id, unique id-prefix, or exact (unique) name. */
  resolve(idOrName: string): Promise<AlertRule>;
  create(input: AlertRuleCreateInput): Promise<{ id: string }>;
  /** Patch tunable knobs. `metricId` is rejected by the schema (immutable). */
  update(id: string, input: AlertRuleUpdateInput): Promise<{ id: string }>;
  delete(id: string): Promise<{ ok: true }>;
}

const BASE = "/api/admin/alert-rules";

export function alertRulesClient(t: Transport): AlertRulesClient {
  async function list(): Promise<AlertRule[]> {
    return t.request<AlertRule[]>("GET", BASE);
  }
  async function resolve(idOrName: string): Promise<AlertRule> {
    const all = await list();
    const byId = all.find((r) => r.id === idOrName);
    if (byId) return byId;
    const byPrefix = all.filter((r) => r.id.startsWith(idOrName));
    if (byPrefix.length === 1) return byPrefix[0];
    if (byPrefix.length > 1)
      throw new ApiError(`Alert rule id prefix '${idOrName}' is ambiguous`, 400);
    const byName = all.filter((r) => r.name === idOrName);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1)
      throw new ApiError(
        `Alert rule name '${idOrName}' is ambiguous — pass an id instead`,
        400,
      );
    throw new ApiError(`Alert rule '${idOrName}' not found`, 404);
  }
  return {
    list,
    resolve,
    create: (input) =>
      t.request<{ id: string }>("POST", BASE, alertRuleCreateSchema.parse(input)),
    update: (id, input) =>
      t.request<{ id: string }>("PATCH", `${BASE}/${id}`, alertRuleUpdateSchema.parse(input)),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
  };
}
