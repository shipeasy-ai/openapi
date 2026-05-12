import { z } from "zod";
import {
  killswitchCreateSchema,
  killswitchUpdateSchema,
  killswitchSwitchSetSchema,
  killswitchSwitchUnsetSchema,
  killswitchResponseSchema,
  killswitchCreateResponseSchema,
  killswitchUpdateResponseSchema,
  killswitchDeleteResponseSchema,
  killswitchSwitchSetResponseSchema,
  killswitchSwitchUnsetResponseSchema,
} from "@shipeasy/core/schemas/killswitches";
import type { Page, PageQuery } from "@shipeasy/core/pagination";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

export type KillswitchCreateInput = z.input<typeof killswitchCreateSchema>;
export type KillswitchUpdateInput = z.input<typeof killswitchUpdateSchema>;
export type KillswitchSwitchSetInput = z.input<typeof killswitchSwitchSetSchema>;
export type KillswitchSwitchUnsetInput = z.input<typeof killswitchSwitchUnsetSchema>;

const killswitchListResponseSchema = z.object({
  data: z.array(killswitchResponseSchema),
  next_cursor: z.string().nullable(),
});

export interface Killswitch {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  envs: Record<
    string,
    { value: boolean; switches?: Record<string, boolean>; version: number; publishedAt: string }
  >;
}

export interface KillswitchesClient {
  list(opts?: Partial<PageQuery>): Promise<Page<Killswitch>>;
  listAll(): Promise<Killswitch[]>;
  get(id: string): Promise<Killswitch>;
  resolve(idOrName: string): Promise<Killswitch>;
  create(input: KillswitchCreateInput): Promise<{ id: string; name: string }>;
  update(id: string, input: KillswitchUpdateInput): Promise<{ id: string }>;
  delete(id: string): Promise<{ ok: true }>;
  setSwitch(id: string, input: KillswitchSwitchSetInput): Promise<unknown>;
  unsetSwitch(id: string, input: KillswitchSwitchUnsetInput): Promise<unknown>;
}

const BASE = "/api/admin/killswitches";

export function killswitchesClient(t: Transport): KillswitchesClient {
  async function list(opts: Partial<PageQuery> = {}): Promise<Page<Killswitch>> {
    const query: Record<string, string> = {};
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    if (opts.cursor) query.cursor = opts.cursor;
    return t.request<Page<Killswitch>>("GET", BASE, undefined, query);
  }
  async function listAll(): Promise<Killswitch[]> {
    const out: Killswitch[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 500, cursor });
      out.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return out;
  }
  async function resolve(idOrName: string) {
    try {
      return await t.request<Killswitch>("GET", `${BASE}/${idOrName}`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
    const all = await listAll();
    const found = all.find((k) => k.name === idOrName);
    if (!found) throw new ApiError(`Killswitch '${idOrName}' not found`, 404);
    return found;
  }
  return {
    list,
    listAll,
    resolve,
    get: (id) => t.request<Killswitch>("GET", `${BASE}/${id}`),
    create: (input) =>
      t.request<{ id: string; name: string }>("POST", BASE, killswitchCreateSchema.parse(input)),
    update: (id, input) =>
      t.request<{ id: string }>("PATCH", `${BASE}/${id}`, killswitchUpdateSchema.parse(input)),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
    setSwitch: (id, input) =>
      t.request("PUT", `${BASE}/${id}/switch`, killswitchSwitchSetSchema.parse(input)),
    unsetSwitch: (id, input) =>
      t.request("DELETE", `${BASE}/${id}/switch`, killswitchSwitchUnsetSchema.parse(input)),
  };
}

const SAMPLE_KS = {
  id: "ksw_01j7w9d8h2k4m6n8p0q2r4s6t8",
  name: "payments.checkout",
  description: "Master kill for the checkout flow. Trip to fall back to the legacy provider.",
  updatedAt: "2026-05-09T18:22:11.000Z",
  envs: {
    dev: { value: false, version: 3, publishedAt: "2026-05-09T18:22:11.000Z" },
    stage: { value: false, version: 3, publishedAt: "2026-05-09T18:22:11.000Z" },
    prod: {
      value: false,
      switches: { eu_region: true },
      version: 5,
      publishedAt: "2026-05-09T18:22:11.000Z",
    },
  },
};

export const killswitchesResource = {
  name: "killswitches" as const,
  basePath: BASE,
  describeOne: "killswitch",
  describeMany: "killswitches",
  tag: {
    name: "Killswitches",
    description: [
      "Killswitches: per-env boolean overrides for kill-style operational toggles. Optimised for incident response — no rules, no rollout, just a flat boolean (plus optional per-key overrides) versioned per environment.",
      "",
      "**Identity.** Each killswitch is keyed by `name` in `folder.name` form (e.g. `payments.checkout`). Immutable after create.",
      "",
      "**Per-env values.** Every killswitch stores one version stream per env (`dev`, `stage`, `prod`). A `PATCH` with `value`/`switches` applies to **every** env in one shot (publishes a new version per env). To touch a single env, use `PUT /{id}/switch` and friends.",
      "",
      "**Switches map.** Optional `switches: { key: bool }` overrides the flat `value` for specific named call sites — useful for region/feature-scoped kills.",
      "",
      "**Versioning.** Each publish (create, update, set-switch, unset-switch) bumps the per-env `version` monotonically. SDKs deliver the latest published version.",
    ].join("\n"),
  },
  schemas: {
    create: killswitchCreateSchema,
    update: killswitchUpdateSchema,
    setSwitch: killswitchSwitchSetSchema,
    unsetSwitch: killswitchSwitchUnsetSchema,
  },
  actions: [
    { name: "setSwitch", description: "Set or update one switch entry on one env" },
    { name: "unsetSwitch", description: "Remove one switch entry from one env" },
  ] as const,
  endpoints: [
    {
      operationId: "listKillswitches",
      method: "GET",
      path: "",
      summary: "List killswitches",
      description:
        "Returns a single page of killswitches ordered by `updated_at desc, id desc`. Each row includes the latest published `value`/`switches`/`version` per env.",
      response: killswitchListResponseSchema,
      examples: { response: { data: [SAMPLE_KS], next_cursor: null } },
      useCase:
        "Snapshot every killswitch in the project — e.g. to render an incident-response runbook listing every kill and its current trip state.",
    },
    {
      operationId: "getKillswitch",
      method: "GET",
      path: "/{id}",
      summary: "Get one killswitch",
      description:
        "Returns the killswitch metadata plus the latest published `value`/`switches`/`version` per env.",
      pathParams: { id: "Stable opaque killswitch id (`ksw_…`)." },
      response: killswitchResponseSchema,
      examples: { response: SAMPLE_KS },
      useCase:
        "Fetch the current state of one killswitch — e.g. to verify a trip propagated before declaring an incident mitigated.",
    },
    {
      operationId: "createKillswitch",
      method: "POST",
      path: "",
      summary: "Create a killswitch",
      description: [
        "Creates a new killswitch with `value` (default `false`) applied to **every** env at version 1.",
        "",
        "Returns `409` if `name` already exists in the project.",
      ].join("\n"),
      successStatus: 201,
      request: killswitchCreateSchema,
      response: killswitchCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — name only, untripped",
            description:
              "Smallest valid body. Creates a killswitch with `value: false` on every env.",
            value: { name: "payments.checkout" },
          },
          preTripped: {
            summary: "Pre-tripped on create",
            description:
              "Ship the killswitch already tripped (`value: true`) — useful when provisioning a kill ahead of a deploy you want to ship with the feature off.",
            value: {
              name: "payments.checkout",
              description: "Master kill for the new checkout flow.",
              value: true,
            },
          },
          withSwitches: {
            summary: "With per-region switches",
            description:
              "Seed a `switches` map so specific named call sites can be tripped independently of the flat `value`.",
            value: {
              name: "payments.checkout",
              value: false,
              switches: { eu_region: true, apac_region: false },
            },
          },
        },
        response: { id: "ksw_01j7w9d8h2k4m6n8p0q2r4s6t8", name: "payments.checkout" },
      },
      useCase: [
        '- **Untripped create** — `{ "name": "payments.checkout" }`. Provision the kill ahead of an incident.',
        '- **Pre-tripped** — `{ "value": true }` to ship the killswitch already engaged.',
        "- **With switches** — seed `switches` to carve out per-region/per-tenant kills from day one.",
      ].join("\n"),
    },
    {
      operationId: "updateKillswitch",
      method: "PATCH",
      path: "/{id}",
      summary: "Update a killswitch",
      description: [
        "Partial update applied to **every** env. Setting `value`/`switches` publishes a new version per env. Description-only patches don't bump versions.",
        "",
        "To change a single switch on a single env, use `PUT /{id}/switch` instead.",
      ].join("\n"),
      pathParams: { id: "Stable opaque killswitch id." },
      request: killswitchUpdateSchema,
      response: killswitchUpdateResponseSchema,
      examples: {
        requestExamples: {
          trip: {
            summary: "Trip the killswitch on every env",
            description: "Sets `value: true` on dev/stage/prod, bumping each env's version by one.",
            value: { value: true },
          },
          untrip: {
            summary: "Untrip on every env",
            description: "Sets `value: false` on every env.",
            value: { value: false },
          },
          replaceSwitches: {
            summary: "Replace switches map",
            description:
              "Replaces the per-key overrides wholesale on every env. Pass `{}` to clear.",
            value: { switches: { eu_region: true, apac_region: true } },
          },
          updateDescription: {
            summary: "Description-only update",
            description: "Doesn't bump versions or trigger a republish — only metadata changes.",
            value: { description: "Master kill — owner: payments-platform" },
          },
        },
        response: { id: "ksw_01j7w9d8h2k4m6n8p0q2r4s6t8" },
      },
      useCase: [
        '- **Trip everywhere** — `{ "value": true }`. Kills the feature across dev/stage/prod in one call.',
        '- **Untrip everywhere** — `{ "value": false }`.',
        "- **Replace switches** — send the full new map; per-key edits use `PUT /{id}/switch`.",
        "- **Update description** — metadata-only patches don't bump versions.",
      ].join("\n"),
    },
    {
      operationId: "deleteKillswitch",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete a killswitch",
      description:
        "Soft-deletes the killswitch and rebuilds the project's flags KV blob so SDKs stop seeing it.",
      pathParams: { id: "Stable opaque killswitch id." },
      response: killswitchDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Tear down a killswitch after the feature it protected has been removed.",
    },
    {
      operationId: "setKillswitchSwitch",
      method: "PUT",
      path: "/{id}/switch",
      summary: "Set one switch entry",
      description: [
        "Sets or updates a single `switchKey` on a single `env`. Publishes one new version on that env only — other envs untouched.",
        "",
        "Use this for surgical per-env, per-key flips during incident response (e.g. trip `eu_region` on prod without touching the flat `value` or other envs).",
      ].join("\n"),
      pathParams: { id: "Stable opaque killswitch id." },
      request: killswitchSwitchSetSchema,
      response: killswitchSwitchSetResponseSchema,
      examples: {
        requestExamples: {
          tripRegion: {
            summary: "Trip eu_region on prod",
            description:
              "Sets `switches.eu_region = true` on prod only. Other envs and the flat `value` are unchanged.",
            value: { env: "prod", switchKey: "eu_region", value: true },
          },
          untripRegion: {
            summary: "Untrip eu_region on prod",
            description: "Flip the same entry back off without removing it from the map.",
            value: { env: "prod", switchKey: "eu_region", value: false },
          },
        },
        response: {
          id: "ksw_01j7w9d8h2k4m6n8p0q2r4s6t8",
          env: "prod",
          switchKey: "eu_region",
          value: true,
        },
      },
      useCase: [
        '- **Trip a region** — `{ "env": "prod", "switchKey": "eu_region", "value": true }`.',
        "- **Untrip without removing** — same payload with `value: false`. To remove the entry entirely use `DELETE /{id}/switch`.",
      ].join("\n"),
    },
    {
      operationId: "unsetKillswitchSwitch",
      method: "DELETE",
      path: "/{id}/switch",
      summary: "Remove one switch entry",
      description: [
        "Removes a single `switchKey` from the `switches` map on a single `env`. Publishes a new version on that env.",
        "",
        "Returns `{ removed: false }` if the entry didn't exist (idempotent no-op).",
      ].join("\n"),
      pathParams: { id: "Stable opaque killswitch id." },
      request: killswitchSwitchUnsetSchema,
      response: killswitchSwitchUnsetResponseSchema,
      examples: {
        requestExamples: {
          removeRegion: {
            summary: "Remove eu_region from prod",
            description:
              "Drops the `eu_region` override on prod so the flat `value` applies again.",
            value: { env: "prod", switchKey: "eu_region" },
          },
        },
        response: {
          id: "ksw_01j7w9d8h2k4m6n8p0q2r4s6t8",
          env: "prod",
          switchKey: "eu_region",
          removed: true,
        },
      },
      useCase:
        "Clean up a per-region override after the incident is resolved so the flat `value` governs again.",
    },
  ] as const,
} as const;
