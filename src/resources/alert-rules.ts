import { z } from "zod";
import {
  alertRuleCreateSchema,
  alertRuleUpdateSchema,
  alertRuleResponseSchema,
  alertRuleCreateResponseSchema,
  alertRuleDeleteResponseSchema,
  type AlertRuleResponse,
} from "../schemas/alert-rules.js";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

export type AlertRuleCreateInput = z.input<typeof alertRuleCreateSchema>;
export type AlertRuleUpdateInput = z.input<typeof alertRuleUpdateSchema>;

const alertRuleListResponseSchema = z.array(alertRuleResponseSchema);
const alertRuleUpdateResponseSchema = alertRuleCreateResponseSchema;

/**
 * One metric-threshold alert rule. The cron evaluates `agg(metric)` over the
 * trailing `windowHours` and raises an alert at `severity` when the value
 * `comparator` `threshold` holds.
 *
 * `metricId` is fixed at create time — there is no update path for it (the
 * metric also pins the aggregation). Tune `threshold`/`comparator`/
 * `windowHours`/`severity`/`name`/`enabled` instead, or delete + recreate to
 * repoint the rule at a different metric.
 *
 * Shape mirrors `alertRuleResponseSchema` (the single source of truth in the
 * OpenAPI spec) — kept as a `z.infer` alias so the two never drift.
 */
export type AlertRule = AlertRuleResponse;

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

export const alertRulesResource = {
  name: "alert-rules" as const,
  basePath: BASE,
  describeOne: "alert rule",
  describeMany: "alert rules",
  tag: {
    name: "Alert Rules",
    description: [
      "Alert rules: the metric-threshold definitions the analysis cron evaluates each run.",
      "",
      "**What fires.** Each rule binds a `metricId`, a `comparator` (`gt`/`gte`/`lt`/`lte`), and a `threshold`. On every cron pass the cron aggregates the metric over the trailing `windowHours` and raises an alert at `severity` when `value comparator threshold` holds.",
      "",
      "**Immutable metric.** The bound metric (and its aggregation) is fixed at create time — there is no update path for `metricId`. Tune `threshold`/`comparator`/`windowHours`/`severity`/`name`/`enabled` instead, or delete + recreate to repoint the rule at a different metric.",
      "",
      "**Delivery.** `notify` optionally targets a Slack channel and/or email for this rule; `null` falls back to the project's default notification settings. Slack targets require a connected Slack connector.",
    ].join("\n"),
  },
  schemas: {
    create: alertRuleCreateSchema,
    update: alertRuleUpdateSchema,
  },
  actions: [] as const,
  endpoints: [
    {
      operationId: "listAlertRules",
      method: "GET",
      path: "",
      summary: "List alert rules",
      description:
        "Returns every alert rule in the project (not paginated). Each rule carries its bound `metricId`, the denormalised `metricName` (or `null` if the metric was removed), the comparator/threshold/window, severity, enabled flag, and delivery target.",
      response: alertRuleListResponseSchema,
      examples: {
        response: [
          {
            id: "ar_01j7w8a1b2c3d4e5f6g7h8i9j0",
            name: "Checkout error rate",
            metricId: "met_01j6abc2d3e4f5g6h7i8j9k0l1",
            metricName: "checkout_errors",
            comparator: "gt",
            threshold: 50,
            windowHours: 24,
            severity: "warn",
            enabled: true,
            notify: null,
            createdAt: "2026-04-12T10:14:08.000Z",
            updatedAt: "2026-04-12T10:14:08.000Z",
          },
        ],
      },
      useCase:
        "Audit which metrics have alerting configured — for example to confirm an on-call threshold is set before a launch.",
    },
    {
      operationId: "createAlertRule",
      method: "POST",
      path: "",
      summary: "Create an alert rule",
      description: [
        "Creates a metric-threshold alert rule. `name`, `metricId`, `comparator`, and `threshold` are required; `windowHours` defaults to `24`, `severity` to `warn`, and `enabled` to `true`.",
        "",
        "Returns `404` if `metricId` does not resolve, and `400` for a metric with no scalar form over a window (e.g. retention metrics) — the cron can't evaluate those.",
      ].join("\n"),
      successStatus: 201,
      request: alertRuleCreateSchema,
      response: alertRuleCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — alert when a metric exceeds a threshold",
            description:
              "Smallest valid body. Warns when the metric exceeds 50 over the default 24h window, with no per-rule delivery target.",
            value: {
              name: "Checkout error rate",
              metricId: "met_01j6abc2d3e4f5g6h7i8j9k0l1",
              comparator: "gt",
              threshold: 50,
            },
          },
          targeted: {
            summary: "Full — custom window, severity, and Slack/email target",
            description:
              "A `danger` rule over a 1h window that posts to a Slack channel and emails on-call. The Slack channel must come from a connected connector.",
            value: {
              name: "Checkout error spike",
              metricId: "met_01j6abc2d3e4f5g6h7i8j9k0l1",
              comparator: "gt",
              threshold: 100,
              windowHours: 1,
              severity: "danger",
              notify: {
                slackChannel: { id: "C0123ABCD", name: "incidents" },
                email: "oncall@acme.com",
              },
            },
          },
        },
        response: { id: "ar_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: [
        "- **Threshold alert** — warn when an error/latency metric crosses a value over a rolling window.",
        "- **Routed alert** — set `notify` to page a specific Slack channel or on-call email instead of the project default.",
      ].join("\n"),
    },
    {
      operationId: "updateAlertRule",
      method: "PATCH",
      path: "/{id}",
      summary: "Update an alert rule",
      description: [
        "Partial update of a rule's tunable knobs. `metricId` is immutable — it is rejected by the schema (the metric also pins the aggregation), so delete + recreate to repoint a rule.",
        "",
        "Pass `\"notify\": null` to revert the rule's delivery target back to the project default.",
      ].join("\n"),
      pathParams: { id: "Stable opaque alert-rule id (`ar_…`) or the rule's `name`." },
      request: alertRuleUpdateSchema,
      response: alertRuleUpdateResponseSchema,
      examples: {
        requestExamples: {
          raiseThreshold: {
            summary: "Raise the threshold",
            description: "Bump the alerting threshold without touching anything else.",
            value: { threshold: 100 },
          },
          disable: {
            summary: "Disable the rule",
            description: "Stop the cron from evaluating the rule.",
            value: { enabled: false },
          },
          clearTarget: {
            summary: "Revert to the project default target",
            description: "Drop the per-rule Slack/email target and fall back to project defaults.",
            value: { notify: null },
          },
        },
        response: { id: "ar_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: [
        "- **Tune sensitivity** — change `threshold`/`comparator`/`windowHours` as the metric's baseline shifts.",
        "- **Pause without losing config** — `{ \"enabled\": false }` instead of deleting the rule.",
      ].join("\n"),
    },
    {
      operationId: "deleteAlertRule",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete an alert rule",
      description:
        "Deletes the alert rule. The cron stops evaluating it immediately. Use this (then create a new rule) to repoint alerting at a different metric, since `metricId` is immutable.",
      pathParams: { id: "Stable opaque alert-rule id (`ar_…`) or the rule's `name`." },
      response: alertRuleDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Remove an alert rule that is no longer needed, or as the first half of repointing a rule at a different metric.",
    },
  ] as const,
} as const;
