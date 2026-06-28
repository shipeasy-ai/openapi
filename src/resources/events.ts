import { z } from "zod";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";
import {
  eventPropertySchema,
  eventResponseSchema,
  eventCreateSchema,
  eventUpdateSchema,
  eventCreateResponseSchema,
  eventUpdateResponseSchema,
  eventDeleteResponseSchema,
} from "../schemas/events.js";

const eventListResponseSchema = z
  .array(eventResponseSchema)
  .describe("Every catalogued event in the project (including pending auto-discovered names).");

/**
 * Event catalog — the registry of event names (and their typed properties) that
 * metric queries reference. `/collect` auto-discovers unknown names as
 * `pending` rows; `approve` promotes them to usable. Property `name:type`
 * parsing is a CLI/MCP facade concern; the resource takes the already-parsed
 * `properties` array.
 */
export type EventProperty = z.infer<typeof eventPropertySchema>;

export interface CatalogEvent {
  id: string;
  name: string;
  folder: string | null;
  description: string | null;
  properties: EventProperty[];
  pending: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface EventCreateInput {
  name: string;
  folder?: string | null;
  description?: string;
  properties?: EventProperty[];
}

export interface EventUpdateInput {
  folder?: string | null;
  description?: string;
  /** Replaces the full property set (no merge). */
  properties?: EventProperty[];
}

export interface EventsClient {
  list(): Promise<CatalogEvent[]>;
  get(id: string): Promise<CatalogEvent>;
  create(input: EventCreateInput): Promise<{ id: string; name: string }>;
  update(id: string, input: EventUpdateInput): Promise<{ id: string }>;
  /** Promote a pending (auto-discovered) event so metrics can query it. */
  approve(id: string, input?: EventUpdateInput): Promise<{ id: string }>;
  /** Soft-delete (the user-facing verb is `archive`). */
  delete(id: string): Promise<{ ok: true }>;
  /** Resolve by exact id, unique id-prefix, or exact (unique) name. */
  resolve(idOrName: string): Promise<CatalogEvent>;
}

const BASE = "/api/admin/events";

export function eventsClient(t: Transport): EventsClient {
  async function list(): Promise<CatalogEvent[]> {
    return t.request<CatalogEvent[]>("GET", BASE);
  }
  async function resolve(idOrName: string): Promise<CatalogEvent> {
    const all = await list();
    const byId = all.find((e) => e.id === idOrName);
    if (byId) return byId;
    const byPrefix = all.filter((e) => e.id.startsWith(idOrName));
    if (byPrefix.length === 1) return byPrefix[0];
    if (byPrefix.length > 1) throw new ApiError(`Event id prefix '${idOrName}' is ambiguous`, 400);
    const byName = all.filter((e) => e.name === idOrName);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1)
      throw new ApiError(`Event name '${idOrName}' is ambiguous — pass an id`, 400);
    throw new ApiError(`Event '${idOrName}' not found`, 404);
  }
  return {
    list,
    resolve,
    get: (id) => t.request<CatalogEvent>("GET", `${BASE}/${id}`),
    create: (input) => t.request<{ id: string; name: string }>("POST", BASE, input),
    update: (id, input) => t.request<{ id: string }>("PATCH", `${BASE}/${id}`, input),
    approve: (id, input = {}) => t.request<{ id: string }>("POST", `${BASE}/${id}/approve`, input),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
  };
}

export const eventsResource = {
  name: "events" as const,
  basePath: BASE,
  describeOne: "event",
  describeMany: "events",
  tag: {
    name: "Events",
    description: [
      "Events: the catalog of event names (and their typed properties) that metric queries reference.",
      "",
      "**Auto-discovery.** The SDK's `/collect` ingest path records any unknown event name it receives as a `pending` row (`pending: 1`) so you can review it. Metrics defined on a pending event fail until it is approved.",
      "",
      "**Approval.** `POST /{id}/approve` promotes a pending event to usable (`pending: 0`), optionally declaring its folder/description/properties in the same call. Registering a brand-new event via `POST` that matches a pending name approves it instead of failing with a conflict.",
      "",
      "**Properties.** Each event can declare typed properties (`name`, `type` of `string|number|boolean`, `required`). On update/approve the `properties` array replaces the full set — there is no merge.",
      "",
      "**Deletion.** Soft-delete (the user-facing verb is `archive`). Blocked while any metric still references the event — delete those metrics first.",
    ].join("\n"),
  },
  schemas: {
    create: eventCreateSchema,
    update: eventUpdateSchema,
  },
  actions: [] as const,
  endpoints: [
    {
      operationId: "listEvents",
      method: "GET",
      path: "",
      summary: "List events",
      description:
        "Returns every catalogued event in the project, including pending auto-discovered names. Pass `?pending=true` to return only the unapproved queue.",
      queryParams: {
        pending: {
          schema: z.boolean().optional(),
          description:
            "When `true`, return only pending (auto-discovered, unapproved) events. Omit to return the full catalog.",
        },
      },
      response: eventListResponseSchema,
      examples: {
        response: [
          {
            id: "evt_01j7w8a1b2c3d4e5f6g7h8i9j0",
            name: "checkout_completed",
            folder: "checkout",
            description: "Fired when a customer finishes checkout.",
            properties: [{ name: "amount", type: "number", required: true, description: "" }],
            pending: 0,
            createdAt: "2026-04-12T10:14:08.000Z",
          },
        ],
      },
      useCase:
        "Snapshot the event catalog — for example to review the `pending` auto-discovery queue (`?pending=true`) before approving names, or to confirm which events your metrics can reference.",
    },
    {
      operationId: "getEvent",
      method: "GET",
      path: "/{id}",
      summary: "Get an event",
      description:
        "Returns one event's full detail. Resolves by exact id, unique id-prefix, or exact (unique) name.",
      pathParams: { id: "Stable opaque event id (`evt_…`) or the event's `name`." },
      response: eventResponseSchema,
      examples: {
        response: {
          id: "evt_01j7w8a1b2c3d4e5f6g7h8i9j0",
          name: "checkout_completed",
          folder: "checkout",
          description: "Fired when a customer finishes checkout.",
          properties: [{ name: "amount", type: "number", required: true, description: "" }],
          pending: 0,
          createdAt: "2026-04-12T10:14:08.000Z",
        },
      },
      useCase: "Inspect one event's declared properties and pending state by id or name.",
    },
    {
      operationId: "createEvent",
      method: "POST",
      path: "",
      summary: "Register an event",
      description: [
        "Registers a new event name and (optionally) its typed properties. Only `name` is required.",
        "",
        "If the name matches an existing **pending** (auto-discovered) row, this approves that row instead of returning a conflict. Otherwise an already-registered name returns `409`.",
      ].join("\n"),
      successStatus: 201,
      request: eventCreateSchema,
      response: eventCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — name only",
            description: "Smallest valid body. Registers the event with no properties.",
            value: { name: "checkout_completed" },
          },
          withProperty: {
            summary: "With a typed, required property",
            description: "Declare a required numeric `amount` property and file it under `checkout`.",
            value: {
              name: "purchase",
              folder: "checkout",
              properties: [{ name: "amount", type: "number", required: true }],
            },
          },
        },
        response: { id: "evt_01j7w8a1b2c3d4e5f6g7h8i9j0", name: "checkout_completed" },
      },
      useCase: [
        '- **Register a known event** — `{ "name": "checkout_completed" }` so metrics can reference it.',
        "- **Declare typed properties** — supply `properties` to document the event's payload shape.",
      ].join("\n"),
    },
    {
      operationId: "updateEvent",
      method: "PATCH",
      path: "/{id}",
      summary: "Update an event",
      description: [
        "Partial update of an event's folder, description, or properties. `name` is immutable.",
        "",
        "`properties` replaces the full set (no merge) — omit it to leave properties unchanged.",
      ].join("\n"),
      pathParams: { id: "Stable opaque event id (`evt_…`) or the event's `name`." },
      request: eventUpdateSchema,
      response: eventUpdateResponseSchema,
      examples: {
        requestExamples: {
          refile: {
            summary: "Move to a folder",
            description: "File the event under `checkout`.",
            value: { folder: "checkout" },
          },
          setProperties: {
            summary: "Replace the property set",
            description: "Overwrite the full property list (no merge).",
            value: { properties: [{ name: "amount", type: "number", required: true }] },
          },
        },
        response: { id: "evt_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: "Refile an event, update its description, or redeclare its typed properties.",
    },
    {
      operationId: "approveEvent",
      method: "POST",
      path: "/{id}/approve",
      summary: "Approve a pending event",
      description: [
        "Promotes a pending (auto-discovered) event to usable so metrics can query it (`pending` → `0`).",
        "",
        "You may optionally declare the event's folder, description, or properties in the same call — the body is the same shape as update, and may be empty.",
      ].join("\n"),
      pathParams: { id: "Stable opaque event id (`evt_…`) or the event's `name`." },
      request: eventUpdateSchema,
      response: eventUpdateResponseSchema,
      examples: {
        requestExamples: {
          bare: {
            summary: "Approve as-is",
            description: "Promote the pending event with no further changes.",
            value: {},
          },
          withProperties: {
            summary: "Approve and declare properties",
            description: "Promote the event and document its payload shape at the same time.",
            value: {
              folder: "checkout",
              properties: [{ name: "amount", type: "number", required: true }],
            },
          },
        },
        response: { id: "evt_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase:
        "Clear an auto-discovered event out of the pending queue so metrics defined on it start resolving.",
    },
    {
      operationId: "deleteEvent",
      method: "DELETE",
      path: "/{id}",
      summary: "Archive an event",
      description:
        "Soft-deletes (archives) the event. Returns `409` if any metric still references it — delete those metrics first.",
      pathParams: { id: "Stable opaque event id (`evt_…`) or the event's `name`." },
      response: eventDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Retire an event from the catalog once no metric depends on it.",
    },
  ] as const,
} as const;
