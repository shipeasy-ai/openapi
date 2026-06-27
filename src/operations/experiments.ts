import type { AdminClient } from "../resources/index.js";
import type { ExperimentResult } from "../resources/experiments.js";
import type { Operation, OpInput } from "./types.js";
import { num, str } from "./util.js";

/**
 * Experiment operations — `release experiments …`. Mirrors
 * `cli/src/commands/experiments.ts` and the MCP `exp_*_experiment` tools.
 *
 * Note: the CLI had both `delete` (hard) and `archive` (soft). Per the
 * registry-wide `delete`→`archive` convention (and experiment deletion being
 * UI-only), only `archive` is exposed here. `restore` reverses an archive
 * (archived → draft), preserving the MCP `exp_restore_experiment` capability.
 */

const GROUP = ["release", "experiments"];

const DEFAULT_GROUPS = [
  { name: "control", weight: 5000, params: {} },
  { name: "test", weight: 5000, params: {} },
];

export const experimentOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List experiments",
    description: "Return every experiment (status, universe, allocation).",
    params: [],
    examples: [{ run: "shipeasy release experiments list" }],
    run: (client: AdminClient) => client.experiments.listAll(),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create an experiment",
    description:
      "Create an experiment. Defaults to a 50/50 control-vs-test split at 100% allocation in the " +
      "`default` universe; pass `groups` to customise variants and weights.",
    params: [
      { name: "name", type: "string", description: "Experiment name.", required: true, positional: true },
      { name: "universe", type: "string", description: "Universe name. Defaults to 'default'." },
      { name: "allocation", type: "number", description: "Allocation percentage, 0–100. Defaults to 100." },
      { name: "groups", type: "json", description: "Groups as JSON [{name,weight,params}]. weight is basis points." },
      { name: "params", type: "json", description: "Parameter schema {name: type}." },
      { name: "targetingGate", type: "string", description: "Targeting gate name." },
      { name: "salt", type: "string", description: "Override hash salt." },
    ],
    examples: [
      { note: "Default 50/50, full traffic", run: "shipeasy release experiments create pricing-page" },
      { note: "Dial allocation + named universe", run: "shipeasy release experiments create checkout-cta --universe web --allocation 100" },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.experiments.create({
        name: i.name as string,
        universe: str(i, "universe") ?? "default",
        allocation_pct: Math.round((num(i, "allocation") ?? 100) * 100),
        groups: (i.groups as never) ?? DEFAULT_GROUPS,
        params: (i.params as never) ?? {},
        targeting_gate: (str(i, "targetingGate") ?? null) as never,
        ...(i.salt ? { salt: i.salt as string } : {}),
      }),
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update an experiment",
    description:
      "Patch allocation, groups, params, targeting gate, or stats thresholds. Pass `targetingGate` " +
      "= 'null' to clear it.",
    params: [
      { name: "name", type: "string", description: "Experiment name.", required: true, positional: true },
      { name: "allocation", type: "number", description: "Allocation percentage, 0–100." },
      { name: "groups", type: "json", description: "Groups as JSON [{name,weight,params}]." },
      { name: "params", type: "json", description: "Parameter schema {name: type}." },
      { name: "targetingGate", type: "string", description: "Targeting gate name ('null' to clear)." },
      { name: "significance", type: "number", description: "Significance threshold (0.0001–0.5)." },
      { name: "minRuntimeDays", type: "number", description: "Minimum runtime in days." },
      { name: "minSampleSize", type: "number", description: "Minimum sample size." },
    ],
    examples: [
      { note: "Dial allocation to 50%", run: "shipeasy release experiments update pricing-page --allocation 50" },
      { note: "Clear targeting + tighten significance", run: "shipeasy release experiments update checkout-cta --targeting-gate null --significance 0.01" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      const patch: Record<string, unknown> = {};
      const allocation = num(i, "allocation");
      if (allocation !== undefined) patch.allocation_pct = Math.round(allocation * 100);
      if (i.groups !== undefined) patch.groups = i.groups;
      if (i.params !== undefined) patch.params = i.params;
      if (i.targetingGate !== undefined)
        patch.targeting_gate = i.targetingGate === "null" ? null : i.targetingGate;
      if (i.significance !== undefined) patch.significance_threshold = i.significance;
      if (i.minRuntimeDays !== undefined) patch.min_runtime_days = i.minRuntimeDays;
      if (i.minSampleSize !== undefined) patch.min_sample_size = i.minSampleSize;
      return client.experiments.update(e.id, patch);
    },
  },
  {
    group: GROUP,
    name: "start",
    mutates: true,
    summary: "Start an experiment",
    description: "Move an experiment from draft to running.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments start pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      return client.experiments.start(e.id);
    },
  },
  {
    group: GROUP,
    name: "stop",
    mutates: true,
    summary: "Stop a running experiment",
    description: "Stop a running experiment.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments stop pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      return client.experiments.stop(e.id);
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a stopped experiment",
    description: "Archive (soft-delete) a stopped experiment, hiding it from the default list while preserving results.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments archive pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      return client.experiments.archive(e.id);
    },
  },
  {
    group: GROUP,
    name: "restore",
    mutates: true,
    summary: "Restore an archived experiment to draft",
    description:
      "Restore a soft-deleted (archived) experiment back to `draft`. Allowed only if it never started; one that already ran must be cloned instead. Preserves the goal metric.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments restore pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      return client.experiments.restore(e.id);
    },
  },
  {
    group: GROUP,
    name: "reanalyze",
    mutates: true,
    summary: "Re-run the analysis pass",
    description: "Trigger a fresh analysis pass for an experiment.",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments reanalyze pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      return client.experiments.reanalyze(e.id);
    },
  },
  {
    group: GROUP,
    name: "status",
    mutates: false,
    summary: "Show experiment status and latest results",
    description: "Return the experiment plus its latest per-metric results (enrolment, deltas, p-values).",
    params: [{ name: "name", type: "string", description: "Experiment name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments status pricing-page" }],
    run: async (client: AdminClient, i: OpInput) => {
      const e = await client.experiments.resolve(i.name as string);
      const results = await client.experiments.results(e.id).catch(() => [] as ExperimentResult[]);
      return { experiment: e, results };
    },
  },
];
