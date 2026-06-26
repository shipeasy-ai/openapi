import { ApiError } from "../transport.js";
import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";
import { str } from "./util.js";

/**
 * Universe operations — `release experiments universes …` (a nested resource:
 * three path segments). Mirrors `cli/src/commands/universes.ts`.
 */

const GROUP = ["release", "experiments", "universes"];

/** "lo,hi" → [lo,hi]; "" / "null" / undefined → null. (The CLI's parseHoldout.) */
function parseHoldout(raw: string | undefined): [number, number] | null {
  if (raw === undefined || raw === "" || raw === "null") return null;
  const [lo, hi] = raw.split(",").map((s) => Number(s.trim()));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new ApiError("holdout must be 'lo,hi' integers in [0,9999]", 400);
  }
  return [lo, hi];
}

export const universeOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List universes",
    description: "Return every experiment universe (allocation %, holdout %).",
    params: [],
    examples: [{ run: "shipeasy release experiments universes list" }],
    run: (client: AdminClient) => client.universes.listAll(),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Create a universe",
    description: "Create an experiment universe (container + optional holdout).",
    params: [
      { name: "name", type: "string", description: "Universe name.", required: true, positional: true },
      { name: "unitType", type: "string", description: "Unit type (e.g. user_id, account_id). Defaults to user_id." },
      { name: "holdout", type: "string", description: "Holdout range as 'lo,hi' (0–9999); omit for no holdout." },
    ],
    examples: [
      { note: "Default user_id unit, no holdout", run: "shipeasy release experiments universes create web" },
      { note: "Holdout 0–999, keyed on account_id", run: "shipeasy release experiments universes create web --unit-type account_id --holdout 0,999" },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.universes.create({
        name: i.name as string,
        unit_type: str(i, "unitType") ?? "user_id",
        holdout_range: parseHoldout(str(i, "holdout")),
      }),
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update a universe's holdout range",
    description: "Update the holdout range. Pass 'null' to clear the holdout.",
    params: [
      { name: "name", type: "string", description: "Universe name.", required: true, positional: true },
      { name: "holdout", type: "string", description: "Holdout range as 'lo,hi' (0–9999), or 'null' to clear." },
    ],
    examples: [
      { note: "Set a 5% holdout", run: "shipeasy release experiments universes update web --holdout 0,499" },
      { note: "Clear the holdout", run: "shipeasy release experiments universes update web --holdout null" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const x = await client.universes.resolve(i.name as string);
      const patch = i.holdout === undefined ? {} : { holdout_range: parseHoldout(str(i, "holdout")) };
      return client.universes.update(x.id, patch);
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive a universe",
    description: "Archive (soft-delete) a universe by name.",
    params: [{ name: "name", type: "string", description: "Universe name.", required: true, positional: true }],
    examples: [{ run: "shipeasy release experiments universes archive web" }],
    run: async (client: AdminClient, i: OpInput) => {
      const x = await client.universes.resolve(i.name as string);
      await client.universes.delete(x.id); // endpoint is DELETE (soft-delete); verb is `archive`
      return { ok: true, archived: i.name };
    },
  },
];
