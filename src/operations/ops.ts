import type { AdminClient } from "../resources/index.js";
import type { OpsType, OpsStatus, OpsPriority } from "../resources/ops.js";
import { ApiError } from "../transport.js";
import type { Operation, OpInput } from "./types.js";
import { num, str } from "./util.js";

/**
 * Operational module — `ops …`. One module covers the unified feedback queue
 * (bugs + feature requests + auto-filed error/alert tickets) AND alert rules
 * (`ops alerts …`); there is no separate `feedback` or `alert-rules` module.
 *
 * The deleted CLI `feedback` module and the retired MCP `file_bug`/`file_feature`
 * tools are subsumed by `ops create --type` here — one canonical create op on
 * both surfaces (the CLI had no `ops create` before; this is a CLI gain). The
 * CLI additionally mounts a per-type alias subtree (`ops bug …`, `ops feature …`)
 * consumer-side; MCP stays flat with one `ops_create` + a `type` arg.
 */

const QUEUE = ["ops"];
const ALERTS = ["ops", "alerts"];

const TYPES: OpsType[] = ["bug", "feature_request", "error", "alert"];
const STATUSES: OpsStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "ready_for_qa",
  "resolved",
  "wont_fix",
];
const PRIORITIES: OpsPriority[] = ["nice_to_have", "medium", "high", "critical"];
const COMPARATORS = ["gt", "gte", "lt", "lte"];
const SEVERITIES = ["danger", "warn", "info"];

/** Resolve a Slack channel by exact id or exact (unique) name against the real channel list. */
async function resolveSlackChannel(
  client: AdminClient,
  idOrName: string,
): Promise<{ id: string; name: string }> {
  const res = await client.ops.channels();
  if (!res.connected)
    throw new ApiError("No Slack connector — connect Slack in Settings → Notifications first.", 400);
  const stripped = idOrName.replace(/^#/, "");
  const byId = res.channels.find((c) => c.id === idOrName);
  if (byId) return { id: byId.id, name: byId.name };
  const byName = res.channels.filter((c) => c.name === stripped);
  if (byName.length === 1) return { id: byName[0].id, name: byName[0].name };
  if (byName.length > 1)
    throw new ApiError(`Slack channel name '${stripped}' is ambiguous — pass a channel id`, 400);
  throw new ApiError(`Slack channel '${idOrName}' not found (run 'ops alerts channels')`, 404);
}

export const opsOperations: Operation[] = [
  // ── unified queue ──────────────────────────────────────────────────────────
  {
    group: QUEUE,
    name: "list",
    mutates: false,
    summary: "List the operational queue",
    description:
      "List the unified queue — bugs, feature requests, and auto-filed error/alert tickets. " +
      "Filter by `type`, `status`, or `priority`.",
    params: [
      { name: "type", type: "string", description: "Filter by type.", enum: [...TYPES, "all"] },
      { name: "status", type: "string", description: "Filter by status.", enum: [...STATUSES, "all"] },
      { name: "priority", type: "string", description: "Filter by priority.", enum: PRIORITIES },
      { name: "limit", type: "number", description: "Max rows (default 200)." },
    ],
    examples: [
      { note: "Open critical items only", run: "shipeasy ops list --priority critical" },
      { note: "Just error tickets", run: "shipeasy ops list --type error" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      let items = await client.ops.list({
        type: (str(i, "type") as OpsType | "all") ?? "all",
        status: (str(i, "status") as OpsStatus | "all") ?? "open",
        limit: num(i, "limit") ?? 200,
      });
      const priority = str(i, "priority");
      if (priority) items = items.filter((x) => x.priority === priority);
      return items;
    },
  },
  {
    group: QUEUE,
    name: "get",
    mutates: false,
    summary: "Show one queue item",
    description: "Show one queue item by number (#7 → 7) or id — any type.",
    params: [{ name: "handle", type: "string", description: "Item number or id.", required: true, positional: true }],
    examples: [{ note: "By queue number", run: "shipeasy ops get 7" }],
    run: (client: AdminClient, i: OpInput) => client.ops.get(i.handle as string),
  },
  {
    group: QUEUE,
    name: "create",
    mutates: true,
    summary: "File a bug or feature request",
    description:
      "File an operational item — a bug report or feature request — against the bound project. " +
      "Fires the project's connectors (GitHub issue, Slack). error/alert tickets are auto-filed " +
      "and cannot be created here.",
    params: [
      { name: "type", type: "string", description: "Item type.", required: true, enum: ["bug", "feature_request"] },
      { name: "title", type: "string", description: "One-line title.", required: true, positional: true },
      { name: "body", type: "string", description: "Detailed description." },
      { name: "priority", type: "string", description: "Priority.", enum: PRIORITIES },
      { name: "stepsToReproduce", type: "string", description: "Repro steps (bugs)." },
      { name: "pageUrl", type: "string", description: "Page URL the item relates to." },
    ],
    examples: [
      { note: "File a bug", run: 'shipeasy ops create "Checkout 500s on Safari" --type bug' },
      { note: "File a feature request", run: 'shipeasy ops create "Dark mode" --type feature_request --priority medium' },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.ops.create({
        type: i.type as "bug" | "feature_request",
        title: i.title as string,
        ...(i.body ? { body: i.body as string } : {}),
        ...(i.priority ? { priority: i.priority as OpsPriority } : {}),
        ...(i.stepsToReproduce ? { stepsToReproduce: i.stepsToReproduce as string } : {}),
        ...(i.pageUrl ? { pageUrl: i.pageUrl as string } : {}),
      }),
  },
  {
    group: QUEUE,
    name: "update",
    mutates: true,
    summary: "Update a queue item's status/priority",
    description: "Flip a queue item's status (any type) and optionally its priority.",
    params: [
      { name: "handle", type: "string", description: "Item number or id.", required: true, positional: true },
      { name: "status", type: "string", description: "New status.", enum: STATUSES },
      { name: "priority", type: "string", description: "New priority.", enum: PRIORITIES },
    ],
    examples: [
      { note: "Resolve item #7", run: "shipeasy ops update 7 --status resolved" },
      { note: "Bump priority", run: "shipeasy ops update 7 --priority high" },
    ],
    run: (client: AdminClient, i: OpInput) => {
      const patch: { status?: OpsStatus; priority?: OpsPriority } = {};
      if (i.status !== undefined) patch.status = i.status as OpsStatus;
      if (i.priority !== undefined) patch.priority = i.priority as OpsPriority;
      if (!Object.keys(patch).length)
        throw new ApiError("Nothing to update — pass status and/or priority.", 400);
      return client.ops.update(i.handle as string, patch);
    },
  },
  {
    group: QUEUE,
    name: "link-pr",
    mutates: true,
    summary: "Link the PR that fixed an item",
    description:
      "Link the PR that fixed a queue item (any type). Records connector_data.github.pr. " +
      "Pass `remove` to unlink.",
    params: [
      { name: "handle", type: "string", description: "Item number or id.", required: true, positional: true },
      { name: "prNumber", type: "number", description: "PR number.", positional: true },
      { name: "url", type: "string", description: "Explicit PR URL (required for error/alert tickets)." },
      { name: "remove", type: "boolean", description: "Unlink the PR instead of setting one." },
    ],
    examples: [
      { note: "Link the fixing PR", run: "shipeasy ops link-pr 7 42 --url https://github.com/acme/app/pull/42" },
    ],
    run: (client: AdminClient, i: OpInput) => {
      if (i.remove) return client.ops.linkPr(i.handle as string, { prNumber: null });
      const prNumber = num(i, "prNumber");
      if (prNumber === undefined || !Number.isInteger(prNumber) || prNumber <= 0)
        throw new ApiError("Pass a positive PR number (or --remove to unlink).", 400);
      return client.ops.linkPr(i.handle as string, {
        prNumber,
        ...(i.url ? { prUrl: i.url as string } : {}),
      });
    },
  },
  {
    group: QUEUE,
    name: "notify",
    mutates: true,
    summary: "Raise a 'needs your attention' bell notification",
    description:
      "Raise an attention bell notification (agent escalation, create-only). Idempotent on the " +
      "dedupe key — pass `item` to derive `feedback:<n>`, or an explicit `key`.",
    params: [
      { name: "title", type: "string", description: "One-line headline of what's blocked.", required: true },
      { name: "summary", type: "string", description: "One sentence: why it can't be fixed in code.", required: true },
      { name: "steps", type: "json", description: 'Steps the human should take, as a JSON array of strings.' },
      { name: "href", type: "string", description: "Dashboard-relative deep link." },
      { name: "item", type: "string", description: "Queue item number this is about (sets dedupe key feedback:<n>)." },
      { name: "key", type: "string", description: "Explicit dedupe key (overrides item)." },
    ],
    examples: [
      { note: "Escalate a blocked item", run: 'shipeasy ops notify --item 7 --title "Needs a DB migration" --summary "Fix requires a schema change I can\'t apply in code"' },
    ],
    run: (client: AdminClient, i: OpInput) => {
      const item = str(i, "item");
      const dedupeKey = str(i, "key") ?? (item ? `feedback:${item.replace(/^#/, "")}` : undefined);
      return client.ops.notify({
        title: i.title as string,
        summary: i.summary as string,
        steps: (i.steps as string[]) ?? [],
        ...(i.href ? { href: i.href as string } : {}),
        ...(dedupeKey ? { dedupeKey } : {}),
      });
    },
  },

  // ── alert rules (ops alerts …) ───────────────────────────────────────────────
  {
    group: ALERTS,
    name: "list",
    mutates: false,
    summary: "List alert rules",
    description: "List the project's metric-threshold alert rules the analysis cron evaluates.",
    params: [],
    examples: [{ run: "shipeasy ops alerts list" }],
    run: (client: AdminClient) => client.alertRules.list(),
  },
  {
    group: ALERTS,
    name: "channels",
    mutates: false,
    summary: "List the project's Slack channels",
    description: "List the project's Slack channels (for the `slackChannel` alert target).",
    params: [],
    examples: [{ run: "shipeasy ops alerts channels" }],
    run: (client: AdminClient) => client.ops.channels(),
  },
  {
    group: ALERTS,
    name: "create",
    mutates: true,
    summary: "Create an alert rule",
    description:
      "Create a metric-threshold alert rule. The metric (and its aggregation) is fixed for the " +
      "rule's life — delete + recreate to repoint it. Optionally target a Slack channel/email.",
    params: [
      { name: "name", type: "string", description: "Rule name.", required: true, positional: true },
      { name: "metric", type: "string", description: "Metric to evaluate (id or name).", required: true },
      { name: "comparator", type: "string", description: "Comparison operator.", required: true, enum: COMPARATORS },
      { name: "threshold", type: "number", description: "Threshold the metric value is compared against.", required: true },
      { name: "window", type: "number", description: "Lookback window in whole hours (1–720). Defaults to 24." },
      { name: "severity", type: "string", description: "Severity. Defaults to warn.", enum: SEVERITIES },
      { name: "disabled", type: "boolean", description: "Create the rule disabled." },
      { name: "slackChannel", type: "string", description: "Slack channel to post to (id or name)." },
      { name: "email", type: "string", description: "Email address to notify." },
    ],
    examples: [
      { note: "Alert when error rate exceeds 50 / 24h", run: "shipeasy ops alerts create high-error-rate --metric api-errors --comparator gt --threshold 50" },
      { note: "Post to a Slack channel + email on-call", run: "shipeasy ops alerts create high-error-rate --metric api-errors --comparator gt --threshold 50 --slack-channel '#incidents' --email oncall@acme.com" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const metric = await client.metrics.resolve(i.metric as string);
      const slackChannel = str(i, "slackChannel");
      const email = str(i, "email");
      const notify =
        slackChannel || email
          ? {
              slackChannel: slackChannel ? await resolveSlackChannel(client, slackChannel) : null,
              email: email ?? null,
            }
          : undefined;
      return client.alertRules.create({
        name: i.name as string,
        metricId: metric.id,
        comparator: i.comparator as "gt" | "gte" | "lt" | "lte",
        threshold: num(i, "threshold")!,
        windowHours: num(i, "window") ?? 24,
        severity: (str(i, "severity") as "danger" | "warn" | "info") ?? "warn",
        enabled: !i.disabled,
        ...(notify ? { notify } : {}),
      });
    },
  },
  {
    group: ALERTS,
    name: "update",
    mutates: true,
    summary: "Update an alert rule",
    description:
      "Update an alert rule's tunable knobs (by id, id-prefix, or unique name). The metric is " +
      "immutable. Pass `clearTarget` to revert the rule's target to the project default.",
    params: [
      { name: "rule", type: "string", description: "Rule id, id-prefix, or name.", required: true, positional: true },
      { name: "name", type: "string", description: "New human label." },
      { name: "comparator", type: "string", description: "Comparison operator.", enum: COMPARATORS },
      { name: "threshold", type: "number", description: "New threshold." },
      { name: "window", type: "number", description: "New lookback window in whole hours (1–720)." },
      { name: "severity", type: "string", description: "New severity.", enum: SEVERITIES },
      { name: "enabled", type: "boolean", description: "Enable/disable the rule." },
      { name: "slackChannel", type: "string", description: "Set the Slack channel target (id or name)." },
      { name: "email", type: "string", description: "Set the email target." },
      { name: "clearTarget", type: "boolean", description: "Clear the target back to the project default." },
    ],
    examples: [
      { note: "Raise the threshold", run: "shipeasy ops alerts update high-error-rate --threshold 100" },
      { note: "Disable a rule", run: "shipeasy ops alerts update high-error-rate --enabled false" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const rule = await client.alertRules.resolve(i.rule as string);
      const patch: Parameters<AdminClient["alertRules"]["update"]>[1] = {};
      if (i.name !== undefined) patch.name = i.name as string;
      if (i.comparator !== undefined) patch.comparator = i.comparator as "gt" | "gte" | "lt" | "lte";
      if (i.threshold !== undefined) patch.threshold = num(i, "threshold");
      if (i.window !== undefined) patch.windowHours = num(i, "window");
      if (i.severity !== undefined) patch.severity = i.severity as "danger" | "warn" | "info";
      if (i.enabled !== undefined) patch.enabled = i.enabled as boolean;
      const slackChannel = str(i, "slackChannel");
      const email = str(i, "email");
      if (i.clearTarget) {
        patch.notify = { slackChannel: null, email: null };
      } else if (slackChannel || email) {
        patch.notify = {
          slackChannel: slackChannel
            ? await resolveSlackChannel(client, slackChannel)
            : (rule.notify?.slackChannel ?? null),
          email: email ?? rule.notify?.email ?? null,
        };
      }
      if (!Object.keys(patch).length)
        throw new ApiError("Nothing to update — pass at least one field to change.", 400);
      return client.alertRules.update(rule.id, patch);
    },
  },
  {
    group: ALERTS,
    name: "archive",
    mutates: true,
    summary: "Archive an alert rule",
    description: "Archive (delete) an alert rule by id, id-prefix, or unique name.",
    params: [{ name: "rule", type: "string", description: "Rule id, id-prefix, or name.", required: true, positional: true }],
    examples: [{ run: "shipeasy ops alerts archive high-error-rate" }],
    run: async (client: AdminClient, i: OpInput) => {
      const rule = await client.alertRules.resolve(i.rule as string);
      await client.alertRules.delete(rule.id);
      return { ok: true, archived: rule.name };
    },
  },
];
