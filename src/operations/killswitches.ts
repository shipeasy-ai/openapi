import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { bool, str } from "./util.js";

/**
 * Kill-switch operations — `release killswitch …` (CLI alias `ks` is a CLI-only
 * nicety, not modelled here). Mirrors `cli/src/commands/killswitches.ts` and the
 * MCP `exp_*_killswitch*` tools, collapsed to one definition each.
 */

const GROUP = ["release", "killswitch"];
const ENVS = ["dev", "staging", "prod"];

export const killswitchOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List all kill switches",
    description: "Return every kill switch with its per-env default value and switch count.",
    params: [],
    examples: [{ run: "shipeasy release killswitch list" }],
    run: (client: AdminClient) => client.killswitches.listAll(),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create a kill switch",
    description:
      "Create a kill switch (a static `{ value, switches }` config shipped in the flags KV blob). " +
      "Name must be `folder.name`. Switches take precedence over `value` for that switch_key.",
    params: [
      { name: "name", type: "string", description: "`folder.name` — two lowercase segments.", required: true, positional: true },
      { name: "description", type: "string", description: "Optional description." },
      { name: "value", type: "boolean", description: "Default value (true|false). Defaults to false." },
      { name: "switches", type: "json", description: "JSON object of { switch_key: bool }; takes precedence over value." },
    ],
    examples: [
      { note: "Default OFF", run: "shipeasy release killswitch create payments.stripe-gateway" },
      { note: "Pre-seed per-key switches", run: 'shipeasy release killswitch create payments.stripe-gateway --switches \'{"refunds":true,"payouts":false}\'' },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.killswitches.create({
        name: i.name as string,
        description: str(i, "description"),
        value: bool(i, "value") ?? false,
        switches: i.switches as Record<string, boolean> | undefined,
      }),
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update a kill switch's default value, switches map, or description",
    description: "Patch a kill switch. `switches` replaces the map wholesale; pass an empty description to clear it.",
    params: [
      { name: "name", type: "string", description: "Kill switch name.", required: true, positional: true },
      { name: "value", type: "boolean", description: "Default value (true|false)." },
      { name: "switches", type: "json", description: "JSON { switch_key: bool } — replaces wholesale." },
      { name: "description", type: "string", description: "Description (empty string clears it)." },
    ],
    examples: [{ note: "Flip the default ON", run: "shipeasy release killswitch update payments.stripe-gateway --value true" }],
    run: async (client: AdminClient, i: OpInput) => {
      const k = await client.killswitches.resolve(i.name as string);
      const patch: Record<string, unknown> = {};
      if (i.value !== undefined) patch.value = i.value;
      if (i.switches !== undefined) patch.switches = i.switches;
      if (i.description !== undefined) patch.description = i.description === "" ? null : i.description;
      return client.killswitches.update(k.id, patch);
    },
  },
  {
    group: GROUP,
    name: "set",
    mutates: true,
    summary: "Set one switch entry on one env",
    description:
      "Set or update a single named switch on one environment (default `prod`), leaving the rest untouched.",
    params: [
      { name: "name", type: "string", description: "Kill switch name.", required: true, positional: true },
      { name: "switchKey", type: "string", description: "Switch key to set.", required: true, positional: true },
      { name: "value", type: "boolean", description: "true|false.", required: true, positional: true },
      { name: "env", type: "string", description: `Env: ${ENVS.join(" | ")} (default prod).`, enum: ENVS },
    ],
    examples: [
      { note: "Kill refunds in prod", run: "shipeasy release killswitch set payments.stripe-gateway refunds true" },
      { note: "Target staging instead", run: "shipeasy release killswitch set payments.stripe-gateway refunds true --env staging" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const k = await client.killswitches.resolve(i.name as string);
      return client.killswitches.setSwitch(k.id, {
        env: (str(i, "env") ?? "prod") as "dev" | "staging" | "prod",
        switchKey: i.switchKey as string,
        value: i.value as boolean,
      });
    },
  },
  {
    group: GROUP,
    name: "unset",
    mutates: true,
    summary: "Remove one switch entry from one env",
    description: "Remove a single named switch from one environment (default `prod`), reverting it to the default.",
    params: [
      { name: "name", type: "string", description: "Kill switch name.", required: true, positional: true },
      { name: "switchKey", type: "string", description: "Switch key to remove.", required: true, positional: true },
      { name: "env", type: "string", description: `Env: ${ENVS.join(" | ")} (default prod).`, enum: ENVS },
    ],
    examples: [{ run: "shipeasy release killswitch unset payments.stripe-gateway refunds" }],
    run: async (client: AdminClient, i: OpInput) => {
      const k = await client.killswitches.resolve(i.name as string);
      return client.killswitches.unsetSwitch(k.id, {
        env: (str(i, "env") ?? "prod") as "dev" | "staging" | "prod",
        switchKey: i.switchKey as string,
      });
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a kill switch",
    description: "Archive (soft-delete) a kill switch by name.",
    params: [{ name: "name", type: "string", description: "Kill switch name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release killswitch archive payments.stripe-gateway" }],
    run: async (client: AdminClient, i: OpInput) => {
      const k = await client.killswitches.resolve(i.name as string);
      await client.killswitches.delete(k.id); // endpoint is DELETE (soft-delete); verb is `archive`
      return { ok: true, archived: i.name };
    },
  },
];
