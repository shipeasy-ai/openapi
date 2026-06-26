import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { str } from "./util.js";

/**
 * Dynamic-config operations — `release configs …`. Mirrors
 * `cli/src/commands/configs.ts` and the MCP `exp_*_config` tools.
 */

const GROUP = ["release", "configs"];

export const configOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List all configs",
    description: "Return every dynamic config (name, schema, last updated).",
    params: [],
    examples: [{ run: "shipeasy release configs list" }],
    run: (client: AdminClient) => client.configs.listAll(),
  },
  {
    group: GROUP,
    name: "get",
    mutates: false,
    summary: "Show a config by name",
    description: "Resolve a config by name and return its full detail (schema + per-env values + drafts).",
    params: [{ name: "name", type: "string", description: "Config name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release configs get pricing" }],
    run: async (client: AdminClient, i: OpInput) => {
      const c = await client.configs.resolve(i.name as string);
      return client.configs.get(c.id);
    },
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create a config",
    description:
      "Create a dynamic config. Configs are JSON objects validated against a JSON Schema (object-only).",
    params: [
      { name: "name", type: "string", description: "Config name.", required: true, positional: true },
      { name: "schema", type: "json", description: "JSON Schema (top-level type=object). Defaults to a permissive object schema." },
      { name: "value", type: "json", description: "Initial value as a JSON object. Defaults to {}." },
      { name: "description", type: "string", description: "Human-readable description." },
    ],
    examples: [
      { note: "Permissive schema, empty value", run: "shipeasy release configs create pricing" },
      { note: "Seed an initial value", run: 'shipeasy release configs create pricing --value \'{"free_trial_days":14}\'' },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.configs.create({
        name: i.name as string,
        schema: (i.schema as never) ?? { type: "object", properties: {}, additionalProperties: true },
        value: (i.value as never) ?? {},
        ...(i.description ? { description: i.description as string } : {}),
      }),
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update a config's value (flat, all envs)",
    description: "Legacy flat value update across all envs. Use draft + publish for per-env staging.",
    params: [
      { name: "name", type: "string", description: "Config name.", required: true, positional: true },
      { name: "value", type: "json", description: "New value (JSON object).", required: true },
    ],
    examples: [{ note: "Overwrite the value (all envs)", run: 'shipeasy release configs update pricing --value \'{"free_trial_days":30}\'' }],
    run: async (client: AdminClient, i: OpInput) => {
      const c = await client.configs.resolve(i.name as string);
      return client.configs.update(c.id, { value: i.value as never });
    },
  },
  {
    group: GROUP,
    name: "draft",
    mutates: true,
    summary: "Save a draft value for one env",
    description: "Stage a draft value for the given env, to publish later.",
    params: [
      { name: "name", type: "string", description: "Config name.", required: true, positional: true },
      { name: "env", type: "string", description: "Target env (e.g. prod, staging, dev).", required: true },
      { name: "value", type: "json", description: "Draft value (JSON object).", required: true },
    ],
    examples: [{ note: "Stage a prod value", run: 'shipeasy release configs draft pricing --env prod --value \'{"free_trial_days":30}\'' }],
    run: async (client: AdminClient, i: OpInput) => {
      const c = await client.configs.resolve(i.name as string);
      return client.configs.saveDraft(c.id, { env: i.env as never, value: i.value as never });
    },
  },
  {
    group: GROUP,
    name: "publish",
    mutates: true,
    summary: "Publish the saved draft for one env",
    description: "Promote the staged draft for the given env to live.",
    params: [
      { name: "name", type: "string", description: "Config name.", required: true, positional: true },
      { name: "env", type: "string", description: "Target env to publish.", required: true },
    ],
    examples: [{ note: "Promote staged draft to prod", run: "shipeasy release configs publish pricing --env prod" }],
    run: async (client: AdminClient, i: OpInput) => {
      const c = await client.configs.resolve(i.name as string);
      return client.configs.publish(c.id, { env: str(i, "env") as never });
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a config",
    description: "Archive (soft-delete) a config by name.",
    params: [{ name: "name", type: "string", description: "Config name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release configs archive pricing" }],
    run: async (client: AdminClient, i: OpInput) => {
      const c = await client.configs.resolve(i.name as string);
      await client.configs.delete(c.id); // endpoint is DELETE (soft-delete); verb is `archive`
      return { ok: true, archived: i.name };
    },
  },
];
