import { z } from "zod";
import {
  universeCreateSchema,
  universeUpdateSchema,
  universeResponseSchema,
  universeCreateResponseSchema,
  universeUpdateResponseSchema,
  universeDeleteResponseSchema,
  type UniverseCreateInput,
  type UniverseUpdateInput,
} from "@shipeasy/core/schemas/universes";
import type { Page, PageQuery } from "@shipeasy/core/pagination";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

const universeListResponseSchema = z.object({
  data: z.array(universeResponseSchema),
  next_cursor: z.string().nullable(),
});

export interface Universe {
  id: string;
  name: string;
  unitType: string;
  holdoutRange: [number, number] | null;
  allocationPct?: number;
  holdoutPct?: number;
  updatedAt?: string;
}

export interface UniversesClient {
  list(opts?: Partial<PageQuery>): Promise<Page<Universe>>;
  listAll(): Promise<Universe[]>;
  resolve(idOrName: string): Promise<Universe>;
  create(input: UniverseCreateInput): Promise<Universe>;
  update(id: string, input: UniverseUpdateInput): Promise<Universe>;
  delete(id: string): Promise<{ ok: true }>;
}

const BASE = "/api/admin/universes";

export function universesClient(t: Transport): UniversesClient {
  async function list(opts: Partial<PageQuery> = {}): Promise<Page<Universe>> {
    const query: Record<string, string> = {};
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    if (opts.cursor) query.cursor = opts.cursor;
    return t.request<Page<Universe>>("GET", BASE, undefined, query);
  }
  async function listAll(): Promise<Universe[]> {
    const out: Universe[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 500, cursor });
      out.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return out;
  }
  async function resolve(idOrName: string) {
    const all = await listAll();
    const found = all.find((u) => u.id === idOrName) ?? all.find((u) => u.name === idOrName);
    if (!found) throw new ApiError(`Universe '${idOrName}' not found`, 404);
    return found;
  }

  return {
    list,
    listAll,
    resolve,
    create: (input) => t.request<Universe>("POST", BASE, universeCreateSchema.parse(input)),
    update: (id, input) =>
      t.request<Universe>("PATCH", `${BASE}/${id}`, universeUpdateSchema.parse(input)),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
  };
}

export const universesResource = {
  name: "universes" as const,
  basePath: BASE,
  describeOne: "universe",
  describeMany: "universes",
  tag: {
    name: "Universes",
    description: [
      "Universes: the shared bucketing space all experiments draw from.",
      "",
      "**Identity.** Each universe is keyed by a stable `name` (a-z, 0-9, `_`/`-`, max 64 chars). Experiments reference it via `universe: '<name>'`. The name is immutable.",
      "",
      "**Unit of randomisation.** `unit_type` selects the attribute hashed into a 0–9999 bucket — default `user_id` for per-user randomisation, `account_id` to keep a whole account in the same group.",
      "",
      "**Holdout.** `holdout_range` is an inclusive `[lo, hi]` bucket range (0–9999) reserved for measurement — callers hashed into the holdout are excluded from every experiment in the universe. Pro plan or higher.",
      "",
      "**Deletion.** Blocked while any non-archived experiment references the universe — archive those first.",
    ].join("\n"),
  },
  schemas: {
    create: universeCreateSchema,
    update: universeUpdateSchema,
  },
  actions: [] as const,
  endpoints: [
    {
      operationId: "listUniverses",
      method: "GET",
      path: "",
      summary: "List universes",
      description:
        "Returns a single page of universes ordered by `created_at desc, id desc`. The universes table has no `updated_at`, so this list is keyed on creation time.",
      response: universeListResponseSchema,
      examples: {
        response: {
          data: [
            {
              id: "uni_01j7w8a1b2c3d4e5f6g7h8i9j0",
              name: "primary_users",
              unitType: "user_id",
              holdoutRange: [9500, 9999],
              createdAt: "2026-04-12T10:14:08.000Z",
            },
          ],
          next_cursor: null,
        },
      },
      useCase:
        "Snapshot every universe in the project — for example to audit which `unit_type` and `holdout_range` are in use before launching a new experiment.",
    },
    {
      operationId: "createUniverse",
      method: "POST",
      path: "",
      summary: "Create a universe",
      description: [
        "Creates a new universe. Only `name` is required — `unit_type` defaults to `user_id` and `holdout_range` defaults to `null` (no holdout).",
        "",
        "Returns `409` if `name` already exists in the project. Returns `403` if you supply `holdout_range` on a plan below Pro.",
      ].join("\n"),
      successStatus: 201,
      request: universeCreateSchema,
      response: universeCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — name only",
            description: "Smallest valid body. Creates a `user_id`-keyed universe with no holdout.",
            value: { name: "primary_users" },
          },
          holdout: {
            summary: "Holdout — reserve 5% for measurement",
            description:
              "Reserves buckets 9500–9999 (5% of callers) as the holdout. Pro plan or higher.",
            value: { name: "primary_users", holdout_range: [9500, 9999] },
          },
          accountLevel: {
            summary: "Account-level randomisation",
            description: "Bucket whole accounts together via `unit_type: 'account_id'`.",
            value: { name: "saas_accounts", unit_type: "account_id" },
          },
        },
        response: { id: "uni_01j7w8a1b2c3d4e5f6g7h8i9j0", name: "primary_users" },
      },
      useCase: [
        '- **Default universe** — `{ "name": "primary_users" }`. Per-user randomisation, no holdout.',
        "- **Reserved holdout** — supply `holdout_range` to carve out a measurement slice excluded from all experiments.",
        "- **Account-level** — `unit_type: 'account_id'` so multi-seat accounts see one consistent variant.",
      ].join("\n"),
    },
    {
      operationId: "updateUniverse",
      method: "PATCH",
      path: "/{id}",
      summary: "Update a universe",
      description: [
        "Partial update. Only `holdout_range` is mutable — `name` and `unit_type` are immutable after create.",
        "",
        'Pass `"holdout_range": null` to remove an existing holdout.',
      ].join("\n"),
      pathParams: { id: "Stable opaque universe id (`uni_…`)." },
      request: universeUpdateSchema,
      response: universeUpdateResponseSchema,
      examples: {
        requestExamples: {
          setHoldout: {
            summary: "Set holdout — reserve 5%",
            description: "Reserve buckets 9500–9999 as the holdout. Pro plan or higher.",
            value: { holdout_range: [9500, 9999] },
          },
          removeHoldout: {
            summary: "Remove holdout",
            description: "Disable the holdout entirely.",
            value: { holdout_range: null },
          },
        },
        response: { id: "uni_01j7w8a1b2c3d4e5f6g7h8i9j0" },
      },
      useCase: [
        "- **Adjust holdout** — change the reserved measurement slice without recreating experiments.",
        '- **Remove holdout** — `{ "holdout_range": null }`.',
      ].join("\n"),
    },
    {
      operationId: "deleteUniverse",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete a universe",
      description:
        "Soft-deletes the universe. Returns `409` if any non-archived experiment still references it — archive those experiments first.",
      pathParams: { id: "Stable opaque universe id." },
      response: universeDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Tear down a universe after every experiment that used it has been archived.",
    },
  ] as const,
} as const;

export type { UniverseCreateInput, UniverseUpdateInput };
