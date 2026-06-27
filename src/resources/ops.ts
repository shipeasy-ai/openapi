import type { Transport } from "../transport.js";

/**
 * Operational queue — the unified feedback table of bug reports, feature
 * requests, and auto-filed error/alert tickets, over `/api/admin/feedback`.
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

const FEEDBACK = "/api/admin/feedback";
const NOTIFY = "/api/admin/notifications";

/** Bug/feature create endpoints are still per-type, even though list/get/update are unified. */
const CREATE_PATH: Record<OpsCreateInput["type"], string> = {
  bug: "/api/admin/bugs",
  feature_request: "/api/admin/feature-requests",
};

function itemPath(handle: string): string {
  return `${FEEDBACK}/${encodeURIComponent(handle)}`;
}

export function opsClient(t: Transport): OpsClient {
  return {
    list: (query = {}) => {
      const q: Record<string, string> = {};
      if (query.type) q.type = query.type;
      if (query.status) q.status = query.status;
      if (query.limit !== undefined) q.limit = String(query.limit);
      return t.request<OpsItem[]>("GET", FEEDBACK, undefined, q);
    },
    get: (handle) => t.request<OpsItem>("GET", itemPath(handle)),
    create: ({ type, ...body }) =>
      t.request<{ id: string; number?: number | null }>("POST", CREATE_PATH[type], body),
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
