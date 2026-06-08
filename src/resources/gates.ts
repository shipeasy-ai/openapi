import { z } from "zod";
import {
  gateCreateSchema,
  gateUpdateSchema,
  gateResponseSchema,
  gateCreateResponseSchema,
  gateUpdateResponseSchema,
  gateDeleteResponseSchema,
  gateToggleResponseSchema,
  type GateCreateInput,
  type GateUpdateInput,
} from "../schemas/gates.js";
import type { Page, PageQuery } from "../schemas/pagination.js";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

// Reusable page envelope for the gate list endpoint. Built from the gate
// response schema so the OpenAPI generator emits it as `ListGatesResponse`.
const gateListResponseSchema = z.object({
  data: z.array(gateResponseSchema),
  next_cursor: z.string().nullable(),
});

/** Gate row as returned by `GET /api/admin/gates`. Booleans come back as 0/1 from D1. */
export interface Gate {
  id: string;
  name: string;
  enabled: number | boolean;
  rolloutPct: number;
  rules?: unknown[];
  salt?: string;
  updatedAt: string;
}

export interface GatesClient {
  /** Single page of gates ordered `(updated_at desc, id desc)`. */
  list(opts?: Partial<PageQuery>): Promise<Page<Gate>>;
  /** Drain every page. Use for small datasets or batch CLI jobs. */
  listAll(): Promise<Gate[]>;
  /** Server has no GET /:id endpoint — resolved by paging through and filtering. */
  getByName(name: string): Promise<Gate>;
  /** Same as getByName but accepts either `id` or `name` (id wins if both match). */
  resolve(idOrName: string): Promise<Gate>;
  create(input: GateCreateInput): Promise<{ id: string; name: string }>;
  update(id: string, input: GateUpdateInput): Promise<{ id: string }>;
  delete(id: string): Promise<{ ok: true }>;
  enable(id: string): Promise<{ id: string; enabled: boolean }>;
  disable(id: string): Promise<{ id: string; enabled: boolean }>;
  /** Convenience: resolve by name, then PATCH rollout_pct. `pct` is 0–100 (decimals OK). */
  setRollout(name: string, pct: number): Promise<{ id: string }>;
}

const BASE = "/api/admin/gates";

export function gatesClient(t: Transport): GatesClient {
  async function list(opts: Partial<PageQuery> = {}): Promise<Page<Gate>> {
    const query: Record<string, string> = {};
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    if (opts.cursor) query.cursor = opts.cursor;
    return t.request<Page<Gate>>("GET", BASE, undefined, query);
  }

  async function listAll(): Promise<Gate[]> {
    const out: Gate[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 500, cursor });
      out.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return out;
  }

  async function resolve(idOrName: string): Promise<Gate> {
    const all = await listAll();
    const found = all.find((g) => g.id === idOrName) ?? all.find((g) => g.name === idOrName);
    if (!found) throw new ApiError(`Gate '${idOrName}' not found`, 404);
    return found;
  }

  return {
    list,
    listAll,
    resolve,
    getByName: async (name: string) => {
      const found = (await listAll()).find((g) => g.name === name);
      if (!found) throw new ApiError(`Gate '${name}' not found`, 404);
      return found;
    },
    create: (input: GateCreateInput) =>
      t.request<{ id: string; name: string }>("POST", BASE, gateCreateSchema.parse(input)),
    update: (id: string, input: GateUpdateInput) =>
      t.request<{ id: string }>("PATCH", `${BASE}/${id}`, gateUpdateSchema.parse(input)),
    delete: (id: string) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
    enable: (id: string) =>
      t.request<{ id: string; enabled: boolean }>("POST", `${BASE}/${id}/enable`),
    disable: (id: string) =>
      t.request<{ id: string; enabled: boolean }>("POST", `${BASE}/${id}/disable`),
    setRollout: async (name: string, pct: number) => {
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new ApiError("rollout must be a number between 0 and 100", 400);
      }
      const gate = await resolve(name);
      return t.request<{ id: string }>("PATCH", `${BASE}/${gate.id}`, {
        rollout_pct: Math.round(pct * 100),
      });
    },
  };
}

/**
 * Resource descriptor for the registry. MCP iterates this to auto-generate
 * its tool catalog; CLI iterates it to auto-wire commander subcommands.
 *
 * `inputSchema` fields are zod schemas — convert with `z.toJSONSchema()` for
 * MCP `inputSchema` JSON Schema, parse directly for CLI option validation.
 */
export const gatesResource = {
  name: "gates" as const,
  basePath: BASE,
  describeOne: "feature gate",
  describeMany: "feature gates",
  tag: {
    name: "Gates",
    description: [
      "Feature gates: boolean flags evaluated at runtime against project rules + a percentage rollout.",
      "",
      "**Identity.** Each gate is keyed by a stable `name` (a-z, 0-9, `_`/`-`, max 64 chars) which is what SDKs pass to `Shipeasy.checkGate(user, '<name>')`. The `name` is immutable — rename means delete + recreate.",
      "",
      "**Evaluation model.** A gate returns `true` when (a) `enabled` is true, and (b) the caller satisfies the gate's rules. There are two evaluation shapes:",
      "- **Flat** — `rules` (AND-combined predicates) gate the caller, then `rollout_pct` (basis points, 0–10000) hashes them into a bucket. Used for simple `is in X% rollout` gates.",
      "- **Gatekeeper stack** — an ordered array of `condition` and `rollout` sub-gates, evaluated top-to-bottom; first match wins. Used to express `internal-only ∪ 1% beta ∪ 50% public` in one gate. When `stack` is present it takes precedence over the flat fields.",
      "",
      "**Rules.** Each rule is `{ attr, op, value }`. Supported ops: `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`, `regex`. Attribute names match the keys on the SDK evaluation context (e.g. `country`, `plan`, `email`).",
      "",
      "**Rollout basis points.** `rollout_pct` is in **basis points**, not percent. `0` = 0%, `100` = 1%, `5000` = 50%, `10000` = 100%. This allows sub-1% precision (e.g. `7` = 0.07%).",
      "",
      "**Lifecycle.** Create dark (`rollout_pct: 0`) → attach rules → ramp via PATCH → flip kill-switch via `disable`/`enable` → delete once retired. Deletion is blocked while a running experiment references the gate as a targeting gate.",
    ].join("\n"),
  },
  schemas: {
    create: gateCreateSchema,
    update: gateUpdateSchema,
  },
  /** Custom action endpoints beyond CRUD (POST <basePath>/:id/<action>). */
  actions: [
    { name: "enable", description: "Enable a gate" },
    { name: "disable", description: "Disable a gate" },
  ] as const,
  /**
   * Full operation list for the OpenAPI doc. Order here is the order shown in
   * the docs sidebar. The typed client (`gatesClient`) is the runtime contract;
   * this is the documented surface.
   */
  endpoints: [
    {
      operationId: "listGates",
      method: "GET",
      path: "",
      summary: "List feature gates",
      description:
        "Returns a single page of gates ordered by `updated_at desc, id desc`. Use the `cursor` query parameter to paginate.",
      response: gateListResponseSchema,
      examples: {
        response: {
          data: [
            {
              id: "gat_01j7w7m9q4hxbf6npe6s9zr3vc",
              name: "checkout_v2",
              enabled: 1,
              rolloutPct: 5000,
              rules: [
                { attr: "country", op: "in", value: ["US", "CA", "GB"] },
                { attr: "plan", op: "neq", value: "free" },
              ],
              salt: "9c1f4f1f2c0c4a5fa1c2b6d3e7c8e3a1",
              title: "Checkout v2",
              description: "New checkout flow. Pro users in US/CA/GB only.",
              folder: "checkout",
              groupName: "growth",
              ownerEmail: "ana@example.com",
              stack: null,
              updatedAt: "2026-05-09T16:01:22.000Z",
            },
          ],
          next_cursor: null,
        },
      },
      useCase:
        "Snapshot every gate in the project — for example to render an admin overview or to drive a CI check that asserts no gate is left at 100% in staging.",
    },
    {
      operationId: "createGate",
      method: "POST",
      path: "",
      summary: "Create a feature gate",
      description: [
        "Creates a new gate. Default `enabled: true` at the supplied `rollout_pct` (`0` = fully dark).",
        "",
        "Only `name` is required. Request fields use snake_case (`owner_email`); the GET response returns camelCase (`ownerEmail`, `groupName`).",
        "",
        "Returns `409` if `name` already exists in the project (case-sensitive).",
      ].join("\n"),
      successStatus: 201,
      request: gateCreateSchema,
      response: gateCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — dark gate, name only",
            description:
              "Smallest valid body. The gate is created `enabled: true` at `rollout_pct: 0`, with no rules. Ramp it later via PATCH.",
            value: { name: "checkout_v2" },
          },
          targeted: {
            summary: "Targeted rollout — rules + percentage",
            description:
              "Gate Pro users in US/CA/GB, then hash 10% of that audience into the on-bucket (`rollout_pct: 1000` = 10.00%). Adds dashboard metadata so the gate is self-documenting.",
            value: {
              name: "checkout_v2",
              rollout_pct: 1000,
              rules: [
                { attr: "country", op: "in", value: ["US", "CA", "GB"] },
                { attr: "plan", op: "neq", value: "free" },
              ],
              title: "Checkout v2",
              description: "New checkout flow. Pro users in US/CA/GB only.",
              folder: "checkout",
              group: "growth",
              owner_email: "ana@example.com",
            },
          },
          gatekeeperStack: {
            summary: "Gatekeeper stack — internal ∪ beta ∪ public",
            description:
              "Three-layer fall-through: employees always on, opted-in beta accounts always on, then 25% of everyone else. First match wins; evaluation stops as soon as one entry returns `true`.",
            value: {
              name: "checkout_v2",
              title: "Checkout v2",
              owner_email: "ana@example.com",
              stack: [
                {
                  id: "01HKJ0EMP",
                  type: "condition",
                  name: "Employees",
                  pass: "any",
                  rules: [{ attr: "email", op: "regex", value: "@acme\\.com$" }],
                },
                {
                  id: "01HKJ0BETA",
                  type: "condition",
                  name: "Beta opt-in",
                  pass: "all",
                  rules: [{ attr: "beta_opt_in", op: "eq", value: true }],
                },
                {
                  id: "01HKJ0PUB",
                  type: "rollout",
                  name: "Public",
                  rolloutPct: 2500,
                  bucketBy: "userID",
                  locked: true,
                },
              ],
            },
          },
          disabledOnCreate: {
            summary: "Disabled on create — provision then enable later",
            description:
              "Create with `enabled: false` so the gate evaluates to `false` for every caller until a follow-up `POST /{id}/enable`. Useful when provisioning ahead of a launch.",
            value: { name: "checkout_v2", enabled: false, rollout_pct: 0 },
          },
        },
        response: { id: "gat_01j7w7m9q4hxbf6npe6s9zr3vc", name: "checkout_v2" },
      },
      useCase: [
        '- **Dark create + ramp later** — `{ "name": "checkout_v2" }` at 0% rollout. Ramp via PATCH after deploy validation.',
        "- **Targeted rollout** — supply `rules` to gate the caller (e.g. only `plan = pro` users) plus a `rollout_pct` to bucket within that audience.",
        "- **Gatekeeper stack** — supply `stack` instead of `rules`/`rollout_pct` for `internal ∪ beta ∪ public` fall-through. Stack entries evaluated top-to-bottom; first match wins.",
        "- **Dashboard metadata** — populate `title`, `description`, `folder`, `group`, `owner_email` so the admin UI is self-documenting from day one.",
        "- **Disabled on create** — pre-provision with `enabled: false` for a future launch; flip on with `POST /{id}/enable` at go-live.",
      ].join("\n"),
    },
    {
      operationId: "updateGate",
      method: "PATCH",
      path: "/{id}",
      summary: "Update a feature gate",
      description: [
        "Partial update — only supplied fields change. Array fields (`rules`, `stack`) **replace** wholesale; there is no merge or append.",
        "",
        "`name` and the gate id are immutable. The response carries only `{ id }` — re-fetch via `GET /api/admin/gates` for the new row.",
      ].join("\n"),
      pathParams: { id: "Stable opaque gate id (`gat_…`)." },
      request: gateUpdateSchema,
      response: gateUpdateResponseSchema,
      examples: {
        requestExamples: {
          rampRollout: {
            summary: "Ramp rollout — 0 → 50%",
            description: "Single-field patch. `5000` basis points = 50%.",
            value: { rollout_pct: 5000 },
          },
          killSwitch: {
            summary: "Kill switch — disable the gate",
            description:
              "Forces evaluation to `false` for every caller, regardless of rules or rollout. Same effect as `POST /{id}/disable` but composable with other patches.",
            value: { enabled: false },
          },
          extendInRule: {
            summary: "Add a value to an `in` rule",
            description:
              "Array fields replace wholesale — there is no per-rule patch. To add `'AU'` to a country whitelist that previously held `['US','CA','GB']`, send the full new `rules` array. Same pattern applies to `not_in`.",
            value: {
              rules: [
                { attr: "country", op: "in", value: ["US", "CA", "GB", "AU"] },
                { attr: "plan", op: "neq", value: "free" },
              ],
            },
          },
          replaceStack: {
            summary: "Replace gatekeeper stack",
            description:
              'Stack is replace-wholesale. Send the full new ordered list. Pass `"stack": null` to revert the gate to flat `rules` + `rollout_pct` evaluation.',
            value: {
              stack: [
                {
                  id: "01HKJ0EMP",
                  type: "condition",
                  name: "Employees",
                  pass: "any",
                  rules: [{ attr: "email", op: "regex", value: "@acme\\.com$" }],
                },
                {
                  id: "01HKJ0PUB",
                  type: "rollout",
                  name: "Public",
                  rolloutPct: 5000,
                  locked: true,
                },
              ],
            },
          },
          updateMetadata: {
            summary: "Update dashboard metadata",
            description:
              "Any subset of `title`, `description`, `folder`, `group`, `owner_email`. Snake-case in the request; the GET response returns camelCase (`groupName`, `ownerEmail`).",
            value: {
              title: "Checkout v2 (50%)",
              description: "Bumped to 50% after passing canary. Added AU.",
              folder: "checkout",
              owner_email: "ana@example.com",
            },
          },
        },
        response: { id: "gat_01j7w7m9q4hxbf6npe6s9zr3vc" },
      },
      useCase: [
        '- **Ramp rollout** — `{ "rollout_pct": 5000 }` for 50%. Basis points (0–10000); `100` = 1%.',
        '- **Kill switch** — `{ "enabled": false }`. Forces evaluation to `false` for every caller regardless of rules/rollout. Re-enable with `POST /{id}/enable` or `{ "enabled": true }`.',
        '- **Modify a rule\'s `in` set** — send the full new `rules` array. To add `\'GB\'` to `[\'US\',\'CA\']`: `{ "rules": [{ "attr": "country", "op": "in", "value": ["US","CA","GB"] }] }`. No per-rule patch endpoint.',
        '- **Add targeting from scratch** — `{ "rules": [{ "attr": "email", "op": "regex", "value": "@acme\\\\.com$" }] }`.',
        '- **Switch to gatekeeper stack** — send a non-null `stack`. To revert to flat eval, send `{ "stack": null }`.',
        "- **Update metadata** — any subset of `title`, `description`, `folder`, `group`, `owner_email`.",
      ].join("\n"),
    },
    {
      operationId: "deleteGate",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete a feature gate",
      description:
        "Soft-deletes the gate. Returns 409 if the gate is still referenced by a running experiment as a targeting gate — stop the experiment first.",
      pathParams: { id: "Stable opaque gate id (`gat_…`)." },
      response: gateDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase:
        "Tear down a gate after a feature has fully shipped and the rollout flag is no longer needed.",
    },
    {
      operationId: "enableGate",
      method: "POST",
      path: "/{id}/enable",
      summary: "Enable a gate",
      description: "Sets `enabled: true`. The current `rollout_pct` is preserved.",
      pathParams: { id: "Stable opaque gate id." },
      response: gateToggleResponseSchema,
      examples: { response: { id: "gat_01j7w7m9q4hxbf6npe6s9zr3vc", enabled: true } },
      useCase: "Re-enable a previously disabled gate without re-issuing a full update.",
    },
    {
      operationId: "disableGate",
      method: "POST",
      path: "/{id}/disable",
      summary: "Disable a gate",
      description:
        "Sets `enabled: false` so the gate evaluates to `false` for every caller, regardless of `rollout_pct` or `rules`. Use as a quick kill switch.",
      pathParams: { id: "Stable opaque gate id." },
      response: gateToggleResponseSchema,
      examples: { response: { id: "gat_01j7w7m9q4hxbf6npe6s9zr3vc", enabled: false } },
      useCase:
        "Flip a gate off in production without redeploying — the canonical kill-switch flow.",
    },
  ] as const,
} as const;

export type { GateCreateInput, GateUpdateInput };
