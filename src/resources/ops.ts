import { z } from "zod";
import type { Transport } from "../transport.js";
import {
  opsTypeSchema,
  opsStatusSchema,
  opsListResponseSchema,
  opsItemResponseSchema,
  opsCreateSchema,
  opsUpdateSchema,
  opsLinkPrSchema,
  opsNotifySchema,
  opsCreateResponseSchema,
  opsUpdateResponseSchema,
  opsNotifyResponseSchema,
  slackChannelsResponseSchema,
} from "../schemas/ops.js";

/**
 * Operational queue — the unified table of bug reports, feature requests, and
 * auto-filed error/alert tickets, over `/api/admin/ops`.
 * One resource covers list/get/create/update/link-pr plus the `notify`
 * escalation bell (`/api/admin/notifications`) and the Slack channel reader
 * (`/api/admin/slack/channels`) used to resolve alert-rule targets.
 *
 * Item handles are either the per-project number (`7`) or the full id; the
 * admin API resolves either, so callers pass the handle straight through.
 */
export type OpsType = "bug" | "feature_request" | "error" | "alert";
export type OpsStatus =
  | "open"
  | "triaged"
  | "in_progress"
  | "ready_for_qa"
  | "resolved"
  | "wont_fix";
export type OpsPriority = "nice_to_have" | "medium" | "high" | "critical";

export interface OpsItem {
  id: string;
  number: number | null;
  type: string;
  title: string;
  status: string;
  priority: string | null;
  sourceRef?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface OpsListQuery {
  type?: OpsType | "all";
  status?: OpsStatus | "all";
  limit?: number;
}

export interface OpsCreateInput {
  /** Only `bug` / `feature_request` are user-fileable; error/alert are auto-filed. */
  type: "bug" | "feature_request";
  title: string;
  body?: string;
  priority?: OpsPriority;
  stepsToReproduce?: string;
  pageUrl?: string;
}

export interface OpsUpdateInput {
  status?: OpsStatus;
  priority?: OpsPriority;
}

export interface OpsNotifyInput {
  title: string;
  summary: string;
  steps?: string[];
  href?: string;
  dedupeKey?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate?: boolean;
}
export interface SlackChannelsResponse {
  connected: boolean;
  channels: SlackChannel[];
}

export interface OpsClient {
  list(query?: OpsListQuery): Promise<OpsItem[]>;
  get(handle: string): Promise<OpsItem>;
  /** File a bug or feature request. Fires project connectors (GitHub/Slack). */
  create(input: OpsCreateInput): Promise<{ id: string; number?: number | null }>;
  update(handle: string, input: OpsUpdateInput): Promise<{ id: string }>;
  linkPr(
    handle: string,
    input: { prNumber: number | null; prUrl?: string },
  ): Promise<{ id: string }>;
  /** Raise a 'needs your attention' bell notification (create-only, idempotent on dedupeKey). */
  notify(input: OpsNotifyInput): Promise<{ dedupeKey: string; dispatched: boolean }>;
  /** The project's Slack channels — used to resolve alert-rule `--slack-channel`. */
  channels(): Promise<SlackChannelsResponse>;
}

const OPS = "/api/admin/ops";
const NOTIFY = "/api/admin/notifications";

function itemPath(handle: string): string {
  return `${OPS}/${encodeURIComponent(handle)}`;
}

export function opsClient(t: Transport): OpsClient {
  return {
    list: (query = {}) => {
      const q: Record<string, string> = {};
      if (query.type) q.type = query.type;
      if (query.status) q.status = query.status;
      if (query.limit !== undefined) q.limit = String(query.limit);
      return t.request<OpsItem[]>("GET", OPS, undefined, q);
    },
    get: (handle) => t.request<OpsItem>("GET", itemPath(handle)),
    create: ({ type, ...body }) =>
      t.request<{ id: string; number?: number | null }>("POST", OPS, { type, ...body }),
    update: (handle, input) => t.request<{ id: string }>("PATCH", itemPath(handle), input),
    linkPr: (handle, input) =>
      t.request<{ id: string }>("POST", `${itemPath(handle)}/link-pr`, input),
    notify: (input) =>
      t.request<{ dedupeKey: string; dispatched: boolean }>("POST", NOTIFY, {
        title: input.title,
        summary: input.summary,
        steps: input.steps ?? [],
        ...(input.href ? { href: input.href } : {}),
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      }),
    channels: () => t.request<SlackChannelsResponse>("GET", "/api/admin/slack/channels"),
  };
}

export const opsResource = {
  name: "ops" as const,
  // The ops surface spans several top-level paths (/ops, /notifications,
  // /slack/channels), so the basePath is the admin root and each endpoint
  // carries its full relative path.
  basePath: "/api/admin",
  describeOne: "queue item",
  describeMany: "queue items",
  tag: {
    name: "Ops",
    description: [
      "Operational queue: the unified table of bug reports, feature requests, and",
      "auto-filed error/alert tickets, all over `/api/admin/ops`. One `create`",
      "endpoint files either user type (`type: bug | feature_request`); list, get,",
      "update, and link-pr are unified across every type. Also exposes the `notify`",
      "escalation bell and the read-only Slack-channels list used to resolve",
      "alert-rule notification targets.",
      "",
      "**Handles.** A queue item is addressed by its per-project `number` (e.g. `7`)",
      "or its full id — the API resolves either.",
    ].join("\n"),
  },
  schemas: {},
  actions: [] as const,
  endpoints: [
    {
      operationId: "listOpsItems",
      method: "GET",
      path: "/ops",
      summary: "List the operational queue",
      description:
        "Returns the unified ops queue (bugs, feature requests, errors, alerts), newest first. Filter by `type` and/or `status`, and cap with `limit`.",
      queryParams: {
        type: {
          schema: opsTypeSchema.or(z.literal("all")).optional(),
          description: "Filter by item type (`bug`/`feature_request`/`error`/`alert`), or `all`.",
        },
        status: {
          schema: opsStatusSchema.or(z.literal("all")).optional(),
          description: "Filter by lifecycle status, or `all`.",
        },
        limit: {
          schema: z.coerce.number().int().min(1).max(500).optional(),
          description: "Max items to return (1–500).",
        },
      },
      response: opsListResponseSchema,
      examples: {
        response: [
          {
            id: "fb_01j7w8a1b2c3d4e5f6g7h8i9j0",
            number: 7,
            type: "bug",
            title: "Checkout button misaligned on mobile",
            status: "open",
            priority: "high",
            createdAt: "2026-06-20T09:14:08.000Z",
          },
        ],
      },
      useCase:
        "Pull the open queue to triage — e.g. every `bug` still `open` — before working items down one by one.",
    },
    {
      operationId: "getOpsItem",
      method: "GET",
      path: "/ops/{handle}",
      summary: "Get one queue item",
      description: "Fetch a single queue item by its per-project `number` or full id.",
      pathParams: { handle: "Per-project item number (e.g. `7`) or the full ops item id." },
      response: opsItemResponseSchema,
      examples: {
        response: {
          id: "fb_01j7w8a1b2c3d4e5f6g7h8i9j0",
          number: 7,
          type: "bug",
          title: "Checkout button misaligned on mobile",
          status: "open",
          priority: "high",
          createdAt: "2026-06-20T09:14:08.000Z",
        },
      },
      useCase: "Inspect one item's full detail before updating its status or linking a PR.",
    },
    {
      operationId: "createOpsItem",
      method: "POST",
      path: "/ops",
      summary: "File a queue item",
      description:
        "Files one queue item — a bug report or a feature request — and fires the project's connectors (GitHub issue / Slack). `type` selects which; only the two user-fileable types are accepted (`error`/`alert` tickets are auto-filed). Returns the new id and per-project number.",
      successStatus: 201,
      request: opsCreateSchema,
      response: opsCreateResponseSchema,
      examples: {
        request: {
          type: "bug",
          title: "Checkout button misaligned on mobile",
          body: "On iOS Safari the primary CTA overlaps the price.",
          priority: "high",
        },
        response: { id: "fb_01j7w8a1b2c3d4e5f6g7h8i9j0", number: 7 },
      },
      useCase: "File a bug or feature request programmatically so it lands in the same queue the dashboard shows.",
    },
    {
      operationId: "updateOpsItem",
      method: "PATCH",
      path: "/ops/{handle}",
      summary: "Update a queue item",
      description: "Update a queue item's `status` and/or `priority`. Other fields are immutable.",
      pathParams: { handle: "Per-project item number (e.g. `7`) or the full ops item id." },
      request: opsUpdateSchema,
      response: opsUpdateResponseSchema,
      examples: {
        request: { status: "in_progress", priority: "high" },
        response: { id: "fb_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: "Move an item through its lifecycle (triage → in_progress → resolved) as you work it.",
    },
    {
      operationId: "linkPrToOpsItem",
      method: "POST",
      path: "/ops/{handle}/link-pr",
      summary: "Link a fixing PR",
      description:
        "Record the pull request that fixes a queue item (and clears the link with `prNumber: null`).",
      pathParams: { handle: "Per-project item number (e.g. `7`) or the full ops item id." },
      request: opsLinkPrSchema,
      response: opsUpdateResponseSchema,
      examples: {
        request: { prNumber: 412, prUrl: "https://github.com/acme/app/pull/412" },
        response: { id: "fb_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: "Tie the fixing PR to the item so closing the PR can flip it to ready_for_qa.",
    },
    {
      operationId: "notifyOps",
      method: "POST",
      path: "/notifications",
      summary: "Raise an attention notification",
      description:
        "Raise a 'needs your attention' bell notification. Create-only and idempotent on `dedupeKey`.",
      successStatus: 201,
      request: opsNotifySchema,
      response: opsNotifyResponseSchema,
      examples: {
        request: {
          title: "Error spike in checkout",
          summary: "5xx rate crossed 2% over the last 30m.",
          href: "https://shipeasy.ai/dashboard",
        },
        response: { dedupeKey: "error:checkout:5xx", dispatched: true },
      },
      useCase: "Escalate something that needs a human, deduped so repeats don't spam the bell.",
    },
    {
      operationId: "listSlackChannels",
      method: "GET",
      path: "/slack/channels",
      summary: "List Slack channels",
      description:
        "List the project's connected Slack channels — used to resolve an alert rule's notification target.",
      response: slackChannelsResponseSchema,
      examples: {
        response: {
          connected: true,
          channels: [
            { id: "C0123", name: "alerts" },
            { id: "C0456", name: "general" },
          ],
        },
      },
      useCase: "Populate a channel picker, or validate an alert rule's `--slack-channel` before saving.",
    },
  ] as const,
} as const;
