import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { num, str } from "./util.js";

/**
 * Metric operations — `metrics …`. The single definition behind both
 * `cli/src/commands/metrics.ts` and the new MCP `metrics_*` tools (the
 * assistant gains metric CRUD it never had).
 *
 * `grammar` is a PURE op: it ignores the client and returns the DSL grammar
 * string. The DSL→IR parse the CLI runs as an early check stays CLI-side
 * (vendored parser); the op passes `query` straight through and the server
 * validates, so nothing parser-shaped is bundled into the worker-safe registry.
 */

const GROUP = ["metrics"];

/** The metric query DSL grammar — the single source for `metrics grammar` on every surface. */
export const METRIC_GRAMMAR = `Shipeasy metric query DSL
=========================

Query        := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
AggFunc      := count_users | count | sum | avg | min | max | unique |
                p50 | p75 | p90 | p95 | p99 | p999 |
                retention_<N>d            (N in 1..90)
Selector     := Identifier ("{" Filter ("," Filter)* ","? "}")?
Filter       := Identifier MatchOp StringLiteral
MatchOp      := "=" | "!=" | "=~" | "!~"
StringLiteral := double-quoted, supports \\" and \\\\
GroupBy      := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"

Examples
--------
  count_users(checkout_completed)
  sum(purchase{country="US"}, amount)
  p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
  retention_7d(session_start)
  avg(req_dur{tier!="free"}, ms) without (region)

Notes
-----
- One event selector per query (no formulas).
- "count" maps to count_events (per-row count); "count_users" is uniq-by-user.
- For experiments, "by (label)" is ignored — per-user reducer is applied.
- Filter values must be quoted strings, even for numeric labels (they are coerced).
- Filter labels and value labels must be declared on the source event.
`;

export const metricOperations: Operation[] = [
  {
    group: GROUP,
    name: "grammar",
    mutates: false,
    summary: "Print the metric query DSL grammar",
    description:
      "Return the full metric query DSL grammar — aggregation functions, event selectors, " +
      "label filters, and group-by. A pure op: it ignores the client and never hits the API.",
    params: [],
    examples: [{ run: "shipeasy metrics grammar" }],
    run: async () => ({ grammar: METRIC_GRAMMAR }),
  },
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List all metrics",
    description: "Return every metric in the project (name, folder, source event, aggregation).",
    params: [],
    examples: [{ run: "shipeasy metrics list" }],
    run: (client: AdminClient) => client.metrics.list(),
  },
  {
    group: GROUP,
    name: "show",
    mutates: false,
    summary: "Show one metric",
    description: "Resolve a metric by id, id-prefix, or name and return its full detail.",
    params: [{ name: "metric", type: "string", description: "Metric id or name.", required: true, positional: true }],
    examples: [{ run: "shipeasy metrics show checkouts" }],
    run: (client: AdminClient, i: OpInput) => client.metrics.resolve(i.metric as string),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create a metric",
    description:
      "Create an event-backed metric. Pass the query as the DSL string (`query`) or the typed " +
      "IR form (`queryIr`). `event` must match the event the query references. Run " +
      "`metrics grammar` for the DSL syntax.",
    params: [
      { name: "name", type: "string", description: "Metric name.", required: true, positional: true },
      { name: "event", type: "string", description: "Source event name (must equal the query's event).", required: true },
      { name: "query", type: "string", description: "Query DSL string, e.g. 'sum(purchase, amount)'." },
      { name: "queryIr", type: "json", description: "Typed IR JSON (alternative to query)." },
      { name: "folder", type: "string", description: "Folder to file the metric under." },
      { name: "winsorize", type: "number", description: "Winsorize percentile (1–99). Defaults to 99." },
      { name: "mde", type: "number", description: "Min detectable effect (0–1)." },
    ],
    examples: [
      { note: "Unique users who completed checkout", run: "shipeasy metrics create checkouts --event checkout_completed --query 'count_users(checkout_completed)'" },
      { note: "p99 latency grouped by route", run: "shipeasy metrics create api-latency --event req_dur --query 'p99(req_dur{route=~\"/api/.*\"}, ms) by (route)'" },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.metrics.create({
        name: i.name as string,
        event_name: i.event as string,
        folder: str(i, "folder") ?? null,
        winsorize_pct: num(i, "winsorize") ?? 99,
        min_detectable_effect: num(i, "mde") ?? null,
        ...(i.query ? { query: i.query as string } : {}),
        ...(i.queryIr ? { query_ir: i.queryIr } : {}),
      }),
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a metric",
    description: "Archive (soft-delete) a metric by id or name.",
    params: [{ name: "metric", type: "string", description: "Metric id or name.", required: true, positional: true }],
    examples: [{ run: "shipeasy metrics archive checkouts" }],
    run: async (client: AdminClient, i: OpInput) => {
      const m = await client.metrics.resolve(i.metric as string);
      await client.metrics.delete(m.id); // endpoint is DELETE (soft-delete); verb is `archive`
      return { ok: true, archived: m.name };
    },
  },
];
