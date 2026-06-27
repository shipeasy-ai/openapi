import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

/**
 * Event catalog — the registry of event names (and their typed properties) that
 * metric queries reference. `/collect` auto-discovers unknown names as
 * `pending` rows; `approve` promotes them to usable. Property `name:type`
 * parsing is a CLI/MCP facade concern; the resource takes the already-parsed
 * `properties` array.
 */
export interface EventProperty {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}

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
