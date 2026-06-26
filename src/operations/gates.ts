import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";

/**
 * Gate operations — the pilot proving one registry can drive the CLI, the MCP
 * server, and the docs.
 *
 * Compare what this replaces:
 *   - CLI: 6 hand-built commander commands in `cli/src/commands/flags.ts`
 *     (list / create / enable / disable / rollout / delete), each repeating
 *     the `Math.round(pct * 100)` + `JSON.parse(rules)` mapping.
 *   - MCP: 3 hand-written tool schemas (`exp_create_gate` / `exp_update_gate` /
 *     `exp_delete_gate`) in `mcp/src/tools/schema.ts`, 3 handlers in
 *     `mcp/src/tools/exp/index.ts` (repeating the SAME mapping), and 3 dispatch
 *     branches in `mcp/src/server.ts`.
 * Here that mapping lives exactly once, in each op's `run`.
 */

// Shared facade fields — identical surface for CLI flags and MCP tool inputs.
const ROLLOUT_DESC = "Rollout percentage, 0–100 (converted to basis points internally).";
const RULES_DESC = 'Targeting rules as a JSON array, e.g. \'[{"attr":"plan","op":"eq","value":"pro"}]\'. AND-combined.';
const STACK_DESC =
  "Gatekeeper stack as a JSON array of ordered first-match-wins tiers (condition/rollout steps, " +
  "rolloutPct in basis points). Takes precedence over flat rules/rollout. Pass to express " +
  "internal ∪ beta ∪ public in one gate.";

const num = (i: OpInput, k: string): number | undefined =>
  i[k] === undefined ? undefined : (i[k] as number);

export const gateOperations: Operation[] = [
  {
    group: ["release", "flags"],
    name: "list",
    mutates: false,
    summary: "List all feature gates",
    description:
      "Return every feature gate in the project (name, enabled, rollout %), ordered by most recently updated.",
    params: [],
    examples: [{ run: "shipeasy release flags list" }],
    run: (client: AdminClient) => client.gates.listAll(),
  },
  {
    group: ["release", "flags"],
    name: "create",
    mutates: true,
    summary: "Create a feature gate",
    description:
      "Create a feature gate. A flat gate is `rules` + a single `rollout` %. For tiered rollouts " +
      "(e.g. 'US @ 50% → bots @ 30% → everyone else @ 10%') pass `stack` — an ordered list of " +
      "steps evaluated first-match-wins; flat `rules`/`rollout` are then ignored.",
    params: [
      { name: "name", type: "string", description: "Gate key (lowercase, digits, _/-).", required: true, positional: true },
      { name: "rollout", type: "number", description: ROLLOUT_DESC },
      { name: "rules", type: "json", description: RULES_DESC },
      { name: "salt", type: "string", description: "Override hash salt (immutable after create)." },
      { name: "stack", type: "json", description: STACK_DESC },
    ],
    examples: [
      { note: "Off by default; flip it on later", run: "shipeasy release flags create checkout-v2" },
      {
        note: "Roll out to 25% of pro-plan users",
        run: 'shipeasy release flags create new-ui --rollout 25 --rules \'[{"attr":"plan","op":"eq","value":"pro"}]\'',
      },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.gates.create({
        name: i.name as string,
        rollout_pct: Math.round((num(i, "rollout") ?? 0) * 100),
        // Validated at runtime by gateCreateSchema.parse inside gates.create().
        rules: (i.rules as never) ?? [],
        ...(i.salt ? { salt: i.salt as string } : {}),
        ...(i.stack ? { stack: i.stack as never } : {}),
      }),
  },
  {
    group: ["release", "flags"],
    name: "update",
    mutates: true,
    summary: "Update a gate's rollout, rules, stack, or enabled flag",
    description:
      "Update a feature gate's rollout, rules, gatekeeper stack, or enabled flag. Pass `stack` to " +
      "replace the tiered rollout wholesale; array fields replace, they do not merge.",
    params: [
      { name: "name", type: "string", description: "Gate name to update.", required: true, positional: true },
      { name: "rollout", type: "number", description: ROLLOUT_DESC },
      { name: "rules", type: "json", description: RULES_DESC + " Replaces the existing rules wholesale." },
      { name: "stack", type: "json", description: STACK_DESC + " Pass null to revert to flat evaluation." },
      { name: "enabled", type: "boolean", description: "Master switch — false forces the gate off for every caller." },
    ],
    examples: [{ note: "Ramp to 50%", run: "shipeasy release flags update checkout-v2 --rollout 50" }],
    run: async (client: AdminClient, i: OpInput) => {
      const gate = await client.gates.resolve(i.name as string);
      const patch: Record<string, unknown> = {};
      const rollout = num(i, "rollout");
      if (rollout !== undefined) patch.rollout_pct = Math.round(rollout * 100);
      if (i.rules !== undefined) patch.rules = i.rules;
      if (i.stack !== undefined) patch.stack = i.stack;
      if (i.enabled !== undefined) patch.enabled = i.enabled;
      return client.gates.update(gate.id, patch);
    },
  },
  {
    group: ["release", "flags"],
    name: "enable",
    mutates: true,
    summary: "Enable a feature gate",
    description: "Set `enabled: true`, preserving the current rollout %.",
    params: [{ name: "name", type: "string", description: "Gate name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release flags enable checkout-v2" }],
    run: async (client: AdminClient, i: OpInput) => {
      const gate = await client.gates.resolve(i.name as string);
      return client.gates.enable(gate.id);
    },
  },
  {
    group: ["release", "flags"],
    name: "disable",
    mutates: true,
    summary: "Disable a feature gate (kill switch)",
    description:
      "Set `enabled: false` so the gate evaluates to `false` for every caller regardless of rules/rollout.",
    params: [{ name: "name", type: "string", description: "Gate name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release flags disable checkout-v2" }],
    run: async (client: AdminClient, i: OpInput) => {
      const gate = await client.gates.resolve(i.name as string);
      return client.gates.disable(gate.id);
    },
  },
  {
    group: ["release", "flags"],
    name: "rollout",
    mutates: true,
    summary: "Set rollout percentage (0–100)",
    description: "Resolve the gate by name and set its rollout percentage (0–100).",
    params: [
      { name: "name", type: "string", description: "Gate name.", required: true, positional: true },
      { name: "pct", type: "number", description: "Rollout percentage, 0–100.", required: true, positional: true },
    ],
    examples: [
      { note: "Ramp to 50%", run: "shipeasy release flags rollout checkout-v2 50" },
      { note: "Instant kill — set to 0", run: "shipeasy release flags rollout checkout-v2 0" },
    ],
    run: (client: AdminClient, i: OpInput) => client.gates.setRollout(i.name as string, num(i, "pct")!),
  },
  {
    group: ["release", "flags"],
    name: "archive",
    mutates: true,
    summary: "Archive a feature gate",
    description:
      "Archive (soft-delete) a feature gate by name. Refuses if a running experiment references it as a targeting gate.",
    params: [{ name: "name", type: "string", description: "Gate name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release flags archive checkout-v2" }],
    run: async (client: AdminClient, i: OpInput) => {
      const gate = await client.gates.resolve(i.name as string);
      // Underlying admin endpoint is DELETE (a soft-delete); the user-facing verb is `archive`.
      await client.gates.delete(gate.id);
      return { ok: true, archived: i.name };
    },
  },
];
