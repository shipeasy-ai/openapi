import type { AdminClient } from "../resources/index.js";
import type { EventProperty } from "../resources/events.js";
import type { Operation, OpInput } from "./types.js";
import { bool, str } from "./util.js";

/**
 * Event-catalog operations — `events …` (mounted under `metrics events` on the
 * CLI). The single definition behind `cli/src/commands/events.ts` and the new
 * MCP `events_*` tools.
 *
 * Properties are passed as a JSON array (`props`) — `[{name,type,required}]` —
 * rather than the CLI's old repeatable `--prop name:type` facade, so the one op
 * works identically on the CLI and MCP (same pattern as gates' `rules`/`stack`).
 */

const GROUP = ["events"];

const PROPS_DESC =
  'Event properties as a JSON array, e.g. \'[{"name":"amount","type":"number","required":true}]\'. ' +
  "type is one of string|number|boolean. Replaces the full set on update/approve.";

function props(i: OpInput): EventProperty[] | undefined {
  return i.props === undefined ? undefined : (i.props as EventProperty[]);
}

export const eventOperations: Operation[] = [
  {
    group: GROUP,
    name: "list",
    mutates: false,
    summary: "List catalogued events",
    description:
      "List every catalogued event (including pending auto-discovered names). Pass `pending` " +
      "to show only the unapproved queue.",
    params: [{ name: "pending", type: "boolean", description: "Show only pending (unapproved) events." }],
    examples: [
      { run: "shipeasy metrics events list" },
      { note: "Review the auto-discovered queue", run: "shipeasy metrics events list --pending true" },
    ],
    run: async (client: AdminClient, i: OpInput) => {
      const rows = await client.events.list();
      return bool(i, "pending") ? rows.filter((e) => e.pending === 1) : rows;
    },
  },
  {
    group: GROUP,
    name: "get",
    mutates: false,
    summary: "Show one catalogued event",
    description: "Resolve an event by id, id-prefix, or name and return its full detail.",
    params: [{ name: "event", type: "string", description: "Event id or name.", required: true, positional: true }],
    examples: [{ run: "shipeasy metrics events get checkout_completed" }],
    run: (client: AdminClient, i: OpInput) => client.events.resolve(i.event as string),
  },
  {
    group: GROUP,
    name: "create",
    mutates: true,
    summary: "Register a new event",
    description: "Register a new event name and (optionally) its typed properties.",
    params: [
      { name: "name", type: "string", description: "Event name.", required: true, positional: true },
      { name: "folder", type: "string", description: "Folder to file it under." },
      { name: "description", type: "string", description: "Human-readable description." },
      { name: "props", type: "json", description: PROPS_DESC },
    ],
    examples: [
      { run: "shipeasy metrics events create checkout_completed" },
      { note: "With a typed, required property", run: 'shipeasy metrics events create purchase --props \'[{"name":"amount","type":"number","required":true}]\'' },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.events.create({
        name: i.name as string,
        folder: str(i, "folder") ?? null,
        ...(i.description ? { description: i.description as string } : {}),
        properties: props(i) ?? [],
      }),
  },
  {
    group: GROUP,
    name: "update",
    mutates: true,
    summary: "Update an event",
    description: "Update an event's folder, description, or properties (props replace the full set).",
    params: [
      { name: "event", type: "string", description: "Event id.", required: true, positional: true },
      { name: "folder", type: "string", description: "New folder." },
      { name: "description", type: "string", description: "New description." },
      { name: "props", type: "json", description: PROPS_DESC },
    ],
    examples: [{ run: "shipeasy metrics events update evt_3f9a --folder checkout" }],
    run: (client: AdminClient, i: OpInput) => {
      const patch: Parameters<AdminClient["events"]["update"]>[1] = {};
      if (i.folder !== undefined) patch.folder = i.folder as string;
      if (i.description !== undefined) patch.description = i.description as string;
      const p = props(i);
      if (p) patch.properties = p;
      return client.events.update(i.event as string, patch);
    },
  },
  {
    group: GROUP,
    name: "approve",
    mutates: true,
    summary: "Approve a pending event",
    description: "Promote a pending (auto-discovered) event so metrics can query it. Optionally declare its folder/props on approval.",
    params: [
      { name: "event", type: "string", description: "Event id.", required: true, positional: true },
      { name: "folder", type: "string", description: "Folder to file it under." },
      { name: "description", type: "string", description: "Description." },
      { name: "props", type: "json", description: PROPS_DESC },
    ],
    examples: [{ note: "Promote an auto-discovered event", run: "shipeasy metrics events approve evt_3f9a" }],
    run: (client: AdminClient, i: OpInput) => {
      const body: Parameters<AdminClient["events"]["approve"]>[1] = {};
      if (i.folder !== undefined) body.folder = i.folder as string;
      if (i.description !== undefined) body.description = i.description as string;
      const p = props(i);
      if (p) body.properties = p;
      return client.events.approve(i.event as string, body);
    },
  },
  {
    group: GROUP,
    name: "archive",
    mutates: true,
    summary: "Archive an event",
    description: "Archive (remove) an event from the catalog by id.",
    params: [{ name: "event", type: "string", description: "Event id.", required: true, positional: true }],
    examples: [{ run: "shipeasy metrics events archive evt_3f9a" }],
    run: async (client: AdminClient, i: OpInput) => {
      await client.events.delete(i.event as string);
      return { ok: true, archived: i.event };
    },
  },
];
