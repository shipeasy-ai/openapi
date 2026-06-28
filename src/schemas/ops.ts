import { z } from "zod";

/**
 * Operational queue (`feedback` table) — bugs, feature requests, and the
 * auto-filed error/alert tickets, surfaced over `/api/admin`. These schemas
 * model the request bodies and response shapes of the ops resource for the
 * OpenAPI spec; no transforms/refines on request bodies (emitter-friendly).
 */

// ── Enums (mirror the OpsType / OpsStatus / OpsPriority TS unions) ────────────
export const opsTypeSchema = z
  .enum(["bug", "feature_request", "error", "alert"])
  .describe(
    "Queue item type. `bug` and `feature_request` are user-fileable; `error` and `alert` tickets are auto-filed by the platform.",
  );

export const opsStatusSchema = z
  .enum(["open", "triaged", "in_progress", "ready_for_qa", "resolved", "wont_fix"])
  .describe("Lifecycle status of a queue item.");

export const opsPrioritySchema = z
  .enum(["nice_to_have", "medium", "high", "critical"])
  .describe("Triage priority of a queue item.");

// ── Item response shape ──────────────────────────────────────────────────────
//
// The `feedback` row is wide and type-dependent (bug rows carry
// stepsToReproduce/actualResult/expectedResult, feature rows carry
// description/useCase, tickets carry sourceRef, etc.), so the response is
// modelled as an open object: the stable fields are typed and any additional
// columns are allowed through.
export const opsItemResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque item id."),
    number: z
      .number()
      .nullable()
      .describe("Per-project item number (the `#7` handle), or `null` if unnumbered."),
    type: opsTypeSchema,
    title: z.string().describe("One-line item title."),
    status: opsStatusSchema,
    priority: opsPrioritySchema
      .nullable()
      .describe("Triage priority, or `null` if not yet set."),
    sourceRef: z
      .string()
      .nullable()
      .optional()
      .describe("Source reference for auto-filed tickets (e.g. an error fingerprint)."),
    createdAt: z.string().describe("ISO-8601 creation timestamp."),
  })
  .catchall(z.unknown())
  .describe("One queue item — any type.");

export const opsListResponseSchema = z
  .array(opsItemResponseSchema)
  .describe("A page of queue items, newest first.");

// ── Create (bug / feature request) ───────────────────────────────────────────
//
// Models OpsCreateInput minus the `type` discriminator (the type is encoded in
// the endpoint path: POST /bugs vs POST /feature-requests).
export const opsCreateSchema = z
  .object({
    title: z.string().min(1).max(200).describe("One-line title of the bug or feature request."),
    body: z
      .string()
      .optional()
      .describe("Detailed description / steps to reproduce."),
    priority: opsPrioritySchema.optional().describe("Initial triage priority."),
    stepsToReproduce: z
      .string()
      .optional()
      .describe("Reproduction steps (bugs)."),
    pageUrl: z
      .string()
      .optional()
      .describe("URL of the page the item relates to."),
  })
  .describe("Body for `POST /api/admin/bugs` and `POST /api/admin/feature-requests`.");

// Distinct exports so the docs can label each create endpoint, but both share
// the same shape.
export const opsBugCreateSchema = opsCreateSchema.describe("Body for `POST /api/admin/bugs`.");
export const opsFeatureCreateSchema = opsCreateSchema.describe(
  "Body for `POST /api/admin/feature-requests`.",
);

// ── Update (cross-type status/priority PATCH) ────────────────────────────────
export const opsUpdateSchema = z
  .object({
    status: opsStatusSchema.optional().describe("New lifecycle status."),
    priority: opsPrioritySchema.optional().describe("New triage priority."),
  })
  .describe(
    "Body for `PATCH /api/admin/feedback/{handle}`. Pass at least one of `status` / `priority`.",
  );

// ── Link PR ──────────────────────────────────────────────────────────────────
export const opsLinkPrSchema = z
  .object({
    prNumber: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("PR number to record on the item. `null` unlinks the PR."),
    prUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Explicit PR URL. Required for error/alert tickets (no GitHub issue to derive the URL from).",
      ),
  })
  .describe("Body for `POST /api/admin/feedback/{handle}/link-pr`.");

// ── Notify (ops.attention escalation bell) ───────────────────────────────────
export const opsNotifySchema = z
  .object({
    title: z.string().min(1).max(200).describe("One-line headline of what's blocked."),
    summary: z
      .string()
      .min(1)
      .max(280)
      .describe("One sentence: why it can't be fixed in code."),
    steps: z
      .array(z.string())
      .optional()
      .describe("Ordered steps the human should take to unblock."),
    href: z
      .string()
      .optional()
      .describe("Dashboard-relative deep link to the related item."),
    dedupeKey: z
      .string()
      .optional()
      .describe("Stable per-escalation key (e.g. `feedback:7`) so re-runs dedupe to one row."),
  })
  .describe("Body for `POST /api/admin/notifications`.");

// ── Slack channels ───────────────────────────────────────────────────────────
export const slackChannelSchema = z
  .object({
    id: z.string().describe("Slack channel id."),
    name: z.string().describe("Slack channel name (without the leading `#`)."),
    isPrivate: z.boolean().optional().describe("Whether the channel is private."),
  })
  .describe("One Slack channel the project can post to.");

export const slackChannelsResponseSchema = z
  .object({
    connected: z.boolean().describe("Whether a Slack connector is connected and authenticated."),
    channels: z
      .array(slackChannelSchema)
      .describe("The project's Slack channels (empty when no Slack is connected)."),
  })
  .describe("Response for `GET /api/admin/slack/channels`.");

// ── Tiny response shapes ─────────────────────────────────────────────────────
export const opsCreateResponseSchema = z
  .object({
    id: z.string().describe("Newly created item id."),
    number: z
      .number()
      .nullable()
      .optional()
      .describe("Per-project item number assigned to the new item."),
  })
  .describe("Response for the create endpoints.");

export const opsUpdateResponseSchema = z
  .object({ id: z.string().describe("Item id that was updated.") })
  .describe("Response for the update / link-pr endpoints.");

export const opsNotifyResponseSchema = z
  .object({
    dedupeKey: z.string().describe("The dedupe key the escalation was recorded under."),
    dispatched: z
      .boolean()
      .describe("`true` if a new escalation was dispatched; `false` on an idempotent repeat."),
  })
  .describe("Response for `POST /api/admin/notifications`.");

// ── Inferred types ───────────────────────────────────────────────────────────
export type OpsItem = z.infer<typeof opsItemResponseSchema>;
export type OpsCreateInput = z.infer<typeof opsCreateSchema>;
export type OpsUpdateInput = z.infer<typeof opsUpdateSchema>;
export type OpsLinkPrInput = z.infer<typeof opsLinkPrSchema>;
export type OpsNotifyInput = z.infer<typeof opsNotifySchema>;
export type SlackChannel = z.infer<typeof slackChannelSchema>;
export type SlackChannelsResponse = z.infer<typeof slackChannelsResponseSchema>;
