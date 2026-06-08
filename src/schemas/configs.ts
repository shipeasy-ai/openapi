import { z } from "zod";
import { CONFIG_ENVS, CONFIG_KINDS } from "./constants";
import { folderSchema } from "./folder";

const SEGMENT = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
// `_default` is the reserved folder for legacy single-segment names.
const RESERVED_FOLDER = "_default";

/** Names are exactly two segments — `<folder>.<name>` — so the dashboard can
 *  group rows by folder. `_default` is reserved for the migration that lifts
 *  legacy single-segment names and is the only segment allowed to start with
 *  an underscore. */
export const configNameSchema = z
  .string()
  .max(128)
  .refine(
    (s) => {
      const parts = s.split(".");
      if (parts.length !== 2) return false;
      return parts.every((p, i) => (p === RESERVED_FOLDER && i === 0 ? true : SEGMENT.test(p)));
    },
    {
      message:
        "Must be `folder.name` — exactly two lowercase segments separated by a dot (e.g. `pricing.tiers`).",
    },
  )
  .describe(
    "Stable config key in `folder.name` form (two lowercase segments separated by a dot, e.g. `pricing.tiers`). Used by SDKs as `Shipeasy.getConfig('<name>')`. Immutable after create.",
  );

export const configKindSchema = z.enum(CONFIG_KINDS);

export const configEnvSchema = z
  .enum(CONFIG_ENVS)
  .describe("Target environment. One of the project's configured envs (`dev`, `stage`, `prod`).");

/** JSON Schema describing the shape of a config value.
 * Configs are object-only; the top-level `type` must be `"object"`. */
export const jsonSchemaSchema = z
  .record(z.string(), z.unknown())
  .refine((s) => s.type === "object", { message: "Top-level schema type must be 'object'" })
  .describe(
    "JSON Schema (draft 2020-12) describing the shape of the config value. Top-level `type` must be `'object'`; every published value is validated against this schema.",
  );

export type JsonSchemaInput = z.infer<typeof jsonSchemaSchema>;

/** Seed values for each env at creation time. When omitted, the initial value is applied to all envs. */
const initialValuesSchema = z
  .union([z.unknown(), z.record(configEnvSchema, z.unknown())])
  .describe(
    "Initial config value. Either a single JSON object applied to every env, or a `{ env: value }` map seeding per-env values. Must match `schema`. Defaults to `{}` on every env when omitted.",
  );

export const configCreateSchema = z
  .object({
    name: configNameSchema,
    description: z
      .string()
      .max(512)
      .optional()
      .describe("Optional free-form description shown in the dashboard. Max 512 chars."),
    folder: folderSchema,
    schema: jsonSchemaSchema,
    value: initialValuesSchema.optional(),
  })
  .describe("Body for `POST /api/admin/configs`. `name` + `schema` required.");

/** Flat update — accepts an optional new schema and/or a flat value applied to all envs. */
export const configUpdateSchema = z
  .object({
    schema: jsonSchemaSchema
      .optional()
      .describe(
        "Replacement schema. When supplied, the new schema is validated against every published value before it lands.",
      ),
    value: z
      .unknown()
      .optional()
      .describe(
        "Flat value applied to **every** env. Publishes a new version per env. To target one env, use `PUT /{id}/drafts` then `POST /{id}/publish`.",
      ),
    folder: folderSchema,
  })
  .describe(
    "Body for `PATCH /api/admin/configs/{id}`. Partial — only supplied fields change. `value` republishes on every env.",
  );

/** Schema-only update — does not bump value versions or rebuild KV. */
export const configSchemaUpdateSchema = z
  .object({ schema: jsonSchemaSchema })
  .describe("Schema-only update. Does not bump value versions or rebuild KV.");

export const configDraftUpsertSchema = z
  .object({
    env: configEnvSchema,
    value: z
      .unknown()
      .describe("Draft value to stage on `env`. Validated against the config's current schema."),
  })
  .describe(
    "Body for `PUT /api/admin/configs/{id}/drafts`. Stages a value for a single env without publishing.",
  );

export const configPublishSchema = z
  .object({ env: configEnvSchema })
  .describe(
    "Body for `POST /api/admin/configs/{id}/publish` and `DELETE /api/admin/configs/{id}/drafts`. Names the target env.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
const configEnvPublishedSchema = z.object({
  version: z.number().int().describe("Monotonically increasing version per env."),
  publishedAt: z.string().describe("ISO-8601 publish timestamp."),
  publishedBy: z.string().describe("Email/id of the actor who published this version."),
});

const configDraftSummarySchema = z.object({
  updatedAt: z.string().describe("ISO-8601 last-edit timestamp on the draft."),
  authorEmail: z.string().describe("Email/id of the actor who last edited the draft."),
  baseVersion: z.number().int().describe("Published version the draft was forked from."),
});

export const configResponseSchema = z.object({
  id: z.string().describe("Stable opaque config id (`cfg_…`)."),
  name: configNameSchema,
  description: z.string().nullable(),
  schema: jsonSchemaSchema,
  updatedAt: z.string().describe("ISO-8601 timestamp of last mutation."),
  envs: z
    .record(configEnvSchema, configEnvPublishedSchema)
    .describe("Per-env latest published version metadata."),
  drafts: z
    .record(configEnvSchema, configDraftSummarySchema)
    .describe("Per-env active drafts (if any)."),
  values: z
    .record(configEnvSchema, z.unknown())
    .optional()
    .describe("Per-env latest published values (only returned by `GET /{id}`, not list)."),
  draftValues: z
    .record(configEnvSchema, z.unknown())
    .optional()
    .describe("Per-env draft values (only returned by `GET /{id}`)."),
});

export const configCreateResponseSchema = z.object({
  id: z.string().describe("Newly assigned config id."),
  name: configNameSchema,
});

export const configUpdateResponseSchema = z.object({
  id: z.string().describe("Config id that was updated."),
});

export const configDeleteResponseSchema = z.object({ ok: z.literal(true) });

export const configDraftSaveResponseSchema = z.object({
  id: z.string(),
  env: configEnvSchema,
  baseVersion: z.number().int().describe("Published version the draft is based on."),
  updatedAt: z.string(),
});

export const configDraftDiscardResponseSchema = z.object({ ok: z.literal(true) });

export const configPublishResponseSchema = z.object({
  id: z.string(),
  env: configEnvSchema,
  version: z.number().int().describe("Newly published version on `env`."),
});

export const configActivityEntrySchema = z.object({
  id: z.string(),
  action: z.string().describe("Audit action (e.g. `config.create`, `config.publish`)."),
  actorEmail: z.string(),
  actorType: z.enum(["user", "cli", "system"]),
  payload: z.unknown().nullable(),
  createdAt: z.string().describe("ISO-8601 timestamp."),
});

export const configActivityResponseSchema = z
  .array(configActivityEntrySchema)
  .describe("Recent audit rows for one config, newest first.");

export type ConfigCreateInput = z.infer<typeof configCreateSchema>;
export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;
export type ConfigSchemaUpdateInput = z.infer<typeof configSchemaUpdateSchema>;
export type ConfigDraftUpsertInput = z.infer<typeof configDraftUpsertSchema>;
export type ConfigPublishInput = z.infer<typeof configPublishSchema>;
