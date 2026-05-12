import { z } from "zod";
import {
  configCreateSchema,
  configUpdateSchema,
  configDraftUpsertSchema,
  configPublishSchema,
  configResponseSchema,
  configCreateResponseSchema,
  configUpdateResponseSchema,
  configDeleteResponseSchema,
  configDraftSaveResponseSchema,
  configDraftDiscardResponseSchema,
  configPublishResponseSchema,
  configActivityResponseSchema,
} from "@shipeasy/core/schemas/configs";
import type { Page, PageQuery } from "@shipeasy/core/pagination";
import type { Transport } from "../transport.js";
import { ApiError } from "../transport.js";

/** Use input types so callers can omit fields the server defaults. */
export type ConfigCreateInput = z.input<typeof configCreateSchema>;
export type ConfigUpdateInput = z.input<typeof configUpdateSchema>;
export type ConfigDraftUpsertInput = z.input<typeof configDraftUpsertSchema>;
export type ConfigPublishInput = z.input<typeof configPublishSchema>;

const configListResponseSchema = z.object({
  data: z.array(configResponseSchema),
  next_cursor: z.string().nullable(),
});

export interface Config {
  id: string;
  name: string;
  description?: string | null;
  schema: Record<string, unknown>;
  values?: Record<string, unknown>;
  drafts?: Record<string, unknown>;
  updatedAt: string;
}

export interface ConfigActivityEntry {
  id: string;
  action: string;
  env?: string | null;
  actor?: string | null;
  payload?: unknown;
  createdAt: string;
}

export interface ConfigsClient {
  list(opts?: Partial<PageQuery>): Promise<Page<Config>>;
  listAll(): Promise<Config[]>;
  get(id: string): Promise<Config>;
  resolve(idOrName: string): Promise<Config>;
  create(input: ConfigCreateInput): Promise<Config>;
  update(id: string, input: ConfigUpdateInput): Promise<Config>;
  delete(id: string): Promise<{ ok: true }>;
  /** Save a draft value for the given env (PUT /:id/drafts). */
  saveDraft(id: string, input: ConfigDraftUpsertInput): Promise<unknown>;
  /** Discard a draft for the given env (DELETE /:id/drafts with body). */
  discardDraft(id: string, input: ConfigPublishInput): Promise<unknown>;
  /** Publish a previously saved draft (POST /:id/publish). */
  publish(id: string, input: ConfigPublishInput): Promise<unknown>;
  activity(id: string, limit?: number): Promise<ConfigActivityEntry[]>;
}

const BASE = "/api/admin/configs";

export function configsClient(t: Transport): ConfigsClient {
  async function list(opts: Partial<PageQuery> = {}): Promise<Page<Config>> {
    const query: Record<string, string> = {};
    if (opts.limit !== undefined) query.limit = String(opts.limit);
    if (opts.cursor) query.cursor = opts.cursor;
    return t.request<Page<Config>>("GET", BASE, undefined, query);
  }
  async function listAll(): Promise<Config[]> {
    const out: Config[] = [];
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
      return await t.request<Config>("GET", `${BASE}/${idOrName}`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
    const all = await listAll();
    const found = all.find((c) => c.name === idOrName);
    if (!found) throw new ApiError(`Config '${idOrName}' not found`, 404);
    return found;
  }

  return {
    list,
    listAll,
    resolve,
    get: (id) => t.request<Config>("GET", `${BASE}/${id}`),
    create: (input) => t.request<Config>("POST", BASE, configCreateSchema.parse(input)),
    update: (id, input) =>
      t.request<Config>("PATCH", `${BASE}/${id}`, configUpdateSchema.parse(input)),
    delete: (id) => t.request<{ ok: true }>("DELETE", `${BASE}/${id}`),
    saveDraft: (id, input) =>
      t.request("PUT", `${BASE}/${id}/drafts`, configDraftUpsertSchema.parse(input)),
    discardDraft: (id, input) =>
      t.request("DELETE", `${BASE}/${id}/drafts`, configPublishSchema.parse(input)),
    publish: (id, input) =>
      t.request("POST", `${BASE}/${id}/publish`, configPublishSchema.parse(input)),
    activity: (id, limit) =>
      t.request<ConfigActivityEntry[]>(
        "GET",
        `${BASE}/${id}/activity`,
        undefined,
        limit ? { limit: String(limit) } : undefined,
      ),
  };
}

const SAMPLE_CFG = {
  id: "cfg_01j7wae5h6j7k8l9m0n1p2q3r4",
  name: "pricing.tiers",
  description: "Pricing tier definitions consumed by the checkout flow.",
  schema: {
    type: "object",
    properties: {
      tiers: { type: "array", items: { type: "object" } },
    },
    required: ["tiers"],
  },
  updatedAt: "2026-05-09T18:22:11.000Z",
  envs: {
    dev: { version: 5, publishedAt: "2026-05-09T18:22:11.000Z", publishedBy: "ana@example.com" },
    stage: { version: 4, publishedAt: "2026-05-08T11:05:22.000Z", publishedBy: "ana@example.com" },
    prod: { version: 4, publishedAt: "2026-05-08T11:05:22.000Z", publishedBy: "ana@example.com" },
  },
  drafts: {
    dev: {
      updatedAt: "2026-05-10T09:31:00.000Z",
      authorEmail: "bo@example.com",
      baseVersion: 5,
    },
  },
};

export const configsResource = {
  name: "configs" as const,
  basePath: BASE,
  describeOne: "config",
  describeMany: "configs",
  tag: {
    name: "Configs",
    description: [
      "Dynamic configs: JSON-Schema-validated structured values delivered to SDKs and editable per environment with a draft/publish workflow.",
      "",
      "**Identity.** Each config is keyed by `name` in `folder.name` form (e.g. `pricing.tiers`). Immutable after create.",
      "",
      "**Schema-first.** Every config carries a JSON Schema (draft 2020-12, top-level `type: 'object'`). Every published value is validated against it.",
      "",
      "**Drafts → publish.** Per-env edits go through `PUT /{id}/drafts` (stages a value) then `POST /{id}/publish` (promotes to a new version). The flat `PATCH /{id}` republishes on **every** env in one shot — bypassing drafts.",
      "",
      "**Versioning.** Each publish bumps the per-env `version` monotonically. SDKs deliver the latest published version for each env.",
    ].join("\n"),
  },
  schemas: {
    create: configCreateSchema,
    update: configUpdateSchema,
    saveDraft: configDraftUpsertSchema,
    publish: configPublishSchema,
  },
  actions: [
    { name: "publish", description: "Publish a config draft for an env" },
    { name: "saveDraft", description: "Save a draft value for an env" },
    { name: "discardDraft", description: "Discard a draft for an env" },
  ] as const,
  endpoints: [
    {
      operationId: "listConfigs",
      method: "GET",
      path: "",
      summary: "List dynamic configs",
      description:
        "Returns a single page of configs ordered by `updated_at desc, id desc`. Each row includes the latest published `version` per env and any active drafts.",
      response: configListResponseSchema,
      examples: { response: { data: [SAMPLE_CFG], next_cursor: null } },
      useCase:
        "Snapshot every config in the project — e.g. CI check that asserts no env is stuck on a stale default or that every config has a published value on prod.",
    },
    {
      operationId: "getConfig",
      method: "GET",
      path: "/{id}",
      summary: "Get one config",
      description:
        "Returns config metadata plus the latest published values per env and any active draft values. Use this to fetch the JSON the editor renders.",
      pathParams: { id: "Stable opaque config id (`cfg_…`) or the config's `name`." },
      response: configResponseSchema,
      examples: {
        response: {
          ...SAMPLE_CFG,
          values: {
            dev: { tiers: [{ name: "free" }, { name: "pro" }] },
            stage: { tiers: [{ name: "free" }, { name: "pro" }] },
            prod: { tiers: [{ name: "free" }, { name: "pro" }] },
          },
          draftValues: {
            dev: { tiers: [{ name: "free" }, { name: "pro" }, { name: "enterprise" }] },
          },
        },
      },
      useCase: "Fetch one config's current published values and any in-flight drafts.",
    },
    {
      operationId: "createConfig",
      method: "POST",
      path: "",
      summary: "Create a dynamic config",
      description: [
        "Creates a new config with the given `schema`. The initial `value` (or an empty object) is published as version 1 on **every** env.",
        "",
        "Returns `409` if `name` already exists in the project, `400` if `value` doesn't validate against `schema`.",
      ].join("\n"),
      successStatus: 201,
      request: configCreateSchema,
      response: configCreateResponseSchema,
      examples: {
        requestExamples: {
          minimal: {
            summary: "Minimal — name + schema",
            description: "Smallest valid body. Initial value defaults to `{}` on every env.",
            value: {
              name: "pricing.tiers",
              schema: {
                type: "object",
                properties: { tiers: { type: "array" } },
                required: ["tiers"],
              },
            },
          },
          seededValue: {
            summary: "Seeded — schema + initial value",
            description: "Seed the same JSON object on every env at version 1.",
            value: {
              name: "pricing.tiers",
              description: "Pricing tier definitions consumed by checkout.",
              schema: {
                type: "object",
                properties: { tiers: { type: "array" } },
                required: ["tiers"],
              },
              value: { tiers: [{ name: "free" }, { name: "pro" }] },
            },
          },
          perEnvSeed: {
            summary: "Per-env seed",
            description: "Pass a `{ env: value }` map to seed different initial values per env.",
            value: {
              name: "pricing.tiers",
              schema: {
                type: "object",
                properties: { tiers: { type: "array" } },
                required: ["tiers"],
              },
              value: {
                dev: { tiers: [{ name: "free" }, { name: "pro" }, { name: "enterprise" }] },
                stage: { tiers: [{ name: "free" }, { name: "pro" }] },
                prod: { tiers: [{ name: "free" }, { name: "pro" }] },
              },
            },
          },
        },
        response: { id: "cfg_01j7wae5h6j7k8l9m0n1p2q3r4", name: "pricing.tiers" },
      },
      useCase: [
        "- **Minimal create** — `name` + `schema`. Initial value defaults to `{}`.",
        "- **Seeded create** — supply a flat `value` to publish the same object on every env.",
        "- **Per-env seed** — supply a `{ env: value }` map for different per-env starting values.",
      ].join("\n"),
    },
    {
      operationId: "updateConfig",
      method: "PATCH",
      path: "/{id}",
      summary: "Update a dynamic config",
      description: [
        "Partial update. When `value` is supplied it is **republished on every env** (new version per env). When `schema` is supplied it replaces the current schema; every existing value is re-validated.",
        "",
        "For env-scoped edits, use the draft/publish flow (`PUT /{id}/drafts` then `POST /{id}/publish`) instead.",
      ].join("\n"),
      pathParams: { id: "Stable opaque config id." },
      request: configUpdateSchema,
      response: configUpdateResponseSchema,
      examples: {
        requestExamples: {
          flatValue: {
            summary: "Flat value — republish on every env",
            description: "Sets the same JSON object as a new version on dev/stage/prod.",
            value: { value: { tiers: [{ name: "free" }, { name: "pro" }] } },
          },
          schemaOnly: {
            summary: "Schema-only update",
            description:
              "Replaces the schema. Existing values must still validate or the update fails.",
            value: {
              schema: {
                type: "object",
                properties: {
                  tiers: { type: "array" },
                  trial_days: { type: "integer" },
                },
                required: ["tiers"],
              },
            },
          },
        },
        response: { id: "cfg_01j7wae5h6j7k8l9m0n1p2q3r4" },
      },
      useCase: [
        '- **Republish flat value** — `{ "value": {…} }` sets the same value on every env.',
        '- **Schema migration** — `{ "schema": {…} }` replaces the schema; existing values are re-validated.',
        "- **Env-scoped edits** — use `PUT /{id}/drafts` + `POST /{id}/publish` instead of PATCH.",
      ].join("\n"),
    },
    {
      operationId: "deleteConfig",
      method: "DELETE",
      path: "/{id}",
      summary: "Delete a dynamic config",
      description: "Soft-deletes the config and rebuilds the project's flags KV blob.",
      pathParams: { id: "Stable opaque config id." },
      response: configDeleteResponseSchema,
      examples: { response: { ok: true } },
      useCase: "Tear down a config after its consumers have stopped reading it.",
    },
    {
      operationId: "saveConfigDraft",
      method: "PUT",
      path: "/{id}/drafts",
      summary: "Save a draft value",
      description: [
        "Stages a value for one env without publishing. The draft is validated against the config's current schema and stored alongside the `baseVersion` it was forked from.",
        "",
        "Saving over an existing draft overwrites it. Use `POST /{id}/publish` to promote it to a new published version.",
      ].join("\n"),
      pathParams: { id: "Stable opaque config id." },
      request: configDraftUpsertSchema,
      response: configDraftSaveResponseSchema,
      examples: {
        requestExamples: {
          stageDev: {
            summary: "Stage a dev draft",
            description: "Stages a new value on dev without touching stage/prod.",
            value: {
              env: "dev",
              value: { tiers: [{ name: "free" }, { name: "pro" }, { name: "enterprise" }] },
            },
          },
        },
        response: {
          id: "cfg_01j7wae5h6j7k8l9m0n1p2q3r4",
          env: "dev",
          baseVersion: 5,
          updatedAt: "2026-05-10T09:31:00.000Z",
        },
      },
      useCase:
        "Iterate on a config value on dev without affecting prod — preview in staging, then publish.",
    },
    {
      operationId: "discardConfigDraft",
      method: "DELETE",
      path: "/{id}/drafts",
      summary: "Discard a draft",
      description: "Drops the in-flight draft on one env. Published values are unaffected.",
      pathParams: { id: "Stable opaque config id." },
      request: configPublishSchema,
      response: configDraftDiscardResponseSchema,
      examples: {
        requestExamples: {
          discardDev: {
            summary: "Discard the dev draft",
            description: "Drops the staged dev draft without publishing.",
            value: { env: "dev" },
          },
        },
        response: { ok: true },
      },
      useCase: "Abandon an in-progress draft after deciding not to ship it.",
    },
    {
      operationId: "publishConfigDraft",
      method: "POST",
      path: "/{id}/publish",
      summary: "Publish a draft",
      description: [
        "Promotes the staged draft on one env to a new published version. The draft must still validate against the current schema.",
        "",
        "Returns `404` if there is no draft for the given env.",
      ].join("\n"),
      pathParams: { id: "Stable opaque config id." },
      request: configPublishSchema,
      response: configPublishResponseSchema,
      examples: {
        requestExamples: {
          publishDev: {
            summary: "Publish the dev draft",
            description: "Promotes the dev draft to a new published version on dev.",
            value: { env: "dev" },
          },
          publishProd: {
            summary: "Publish to prod",
            description: "Promotes the prod draft after staging signed off.",
            value: { env: "prod" },
          },
        },
        response: { id: "cfg_01j7wae5h6j7k8l9m0n1p2q3r4", env: "dev", version: 6 },
      },
      useCase: "Ship a staged change once you've validated it on a lower env.",
    },
    {
      operationId: "listConfigActivity",
      method: "GET",
      path: "/{id}/activity",
      summary: "List config activity",
      description:
        "Returns recent audit rows for one config (create, update, draft.save, publish, delete) ordered newest first. Use the `limit` query parameter to cap the result (1–100, default 20).",
      pathParams: { id: "Stable opaque config id." },
      queryParams: {
        limit: {
          schema: z.coerce.number().int().min(1).max(100).default(20),
          description: "Max rows to return (1–100). Defaults to 20.",
        },
      },
      response: configActivityResponseSchema,
      examples: {
        response: [
          {
            id: "act_01j7waf01a2b3c4d5e6f7g8h9i",
            action: "config.publish",
            actorEmail: "ana@example.com",
            actorType: "user",
            payload: { env: "dev", version: 6 },
            createdAt: "2026-05-10T09:31:42.000Z",
          },
        ],
      },
      useCase:
        "Render the activity panel in the config editor or drive a slack notification on publish events.",
    },
  ] as const,
} as const;
