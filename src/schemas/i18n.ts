import { z } from "zod";

/**
 * i18n (String Manager) admin-API schemas — the worker-safe REST parts shared
 * by CLI and MCP: locale profiles, the insert-only key push, single-key update,
 * the read-only key/draft listings, and the profile-wide publish.
 *
 * Request bodies carry NO transforms/refines (emitter-friendly). The fs/AST
 * parts (`scan`, `validate`, `install-loader`, `codemod`) are NOT modeled here
 * — they never hit the API and stay hand-written in the fs-having consumers.
 */

// ── Profiles ────────────────────────────────────────────────────────────────
export const i18nProfileResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque profile id."),
    name: z.string().describe("Profile handle, e.g. `en:prod` or `fr:prod`."),
    isDefault: z
      .number()
      .optional()
      .describe("`1` for the project's single default profile (always seeded as `en:prod`), else `0`."),
    createdAt: z.string().optional().describe("ISO-8601 timestamp of creation."),
    deletedAt: z.string().nullable().optional().describe("ISO-8601 soft-delete timestamp, or `null` if live."),
  })
  .describe("One i18n locale profile.");

export const i18nProfileCreateSchema = z
  .object({
    name: z.string().describe("Profile handle to create, e.g. `en:prod` or `fr:prod`."),
    locales: z
      .array(z.string())
      .optional()
      .describe("Locales this profile carries, e.g. `[\"fr\", \"fr-CA\"]`. Defaults to `[\"en\"]`."),
    default_locale: z
      .string()
      .optional()
      .describe("Default locale for the profile. Defaults to the first entry of `locales`."),
  })
  .describe("Body for `POST /api/admin/i18n/profiles`. Only `name` is required.");

export const i18nProfileCreateResponseSchema = z
  .object({
    id: z.string().describe("Newly assigned profile id."),
    name: z.string().describe("Profile handle that was created."),
  })
  .describe("Created profile id + name.");

// ── Keys ──────────────────────────────────────────────────────────────────────
export const i18nKeyResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque key id."),
    key: z.string().describe("Dotted key path, e.g. `home.cta`."),
    value: z.string().describe("Current translated value for the key."),
    description: z.string().nullable().optional().describe("Optional human note stored with the key."),
    variables: z
      .array(z.string())
      .nullable()
      .optional()
      .describe("`{{var}}` placeholder names in the value, or `null` when there are none."),
    profileId: z.string().optional().describe("Owning profile id."),
    chunkId: z.string().optional().describe("Owning chunk (authoring grouping) id."),
    updatedAt: z.string().optional().describe("ISO-8601 timestamp of the last edit."),
    updatedBy: z.string().optional().describe("Actor email that last edited the key."),
  })
  .catchall(z.unknown())
  .describe("One i18n key row.");

export const i18nKeyListResponseSchema = z
  .object({
    keys: z.array(i18nKeyResponseSchema).describe("The page of matching keys."),
    total: z.number().describe("Total matching keys across all pages (ignores `limit`/`offset`)."),
  })
  .describe("A page of i18n keys plus the total count. (The client also tolerates a bare array.)");

export const i18nPushKeysSchema = z
  .object({
    profile_id: z.string().describe("Target profile id to add keys to."),
    chunk: z
      .string()
      .optional()
      .describe("Logical grouping the new keys are filed under. Defaults to `default`."),
    keys: z
      .array(
        z.object({
          key: z.string().describe("Dotted key path, e.g. `home.cta`."),
          value: z.string().describe("Translated value for the key."),
        }),
      )
      .describe("Keys to add. Insert-only — existing keys are reported back as `skipped`."),
  })
  .describe(
    "Body for `POST /api/admin/i18n/keys`. Insert-only: keys that already exist are never overwritten — use `PUT /keys/{id}` to change a value.",
  );

export const i18nPushResultSchema = z
  .object({
    added: z.array(z.string()).describe("Key names that were newly inserted."),
    skipped: z.array(z.string()).describe("Key names that already existed and were left untouched."),
    pushed_count: z.number().describe("Number of keys inserted (== `added.length`)."),
    skipped_count: z.number().describe("Number of keys skipped (== `skipped.length`)."),
    chunk: z.string().optional().describe("The chunk the keys were filed under."),
  })
  .describe("Result of an insert-only key push.");

export const i18nKeyUpdateSchema = z
  .object({
    value: z.string().describe("New value for the key (the only overwrite path)."),
    description: z.string().optional().describe("Optional human note to store with the key."),
  })
  .describe("Body for `PUT /api/admin/i18n/keys/{id}`. Updates one existing key's value.");

export const i18nKeyUpdateResponseSchema = z
  .object({ id: z.string().describe("Id of the key that was updated.") })
  .describe("Updated key id.");

// ── Drafts ────────────────────────────────────────────────────────────────────
export const i18nDraftResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque draft id."),
    name: z.string().optional().describe("Draft name, e.g. the target locale being staged."),
    profileId: z.string().optional().describe("Profile the draft targets."),
    sourceProfileId: z
      .string()
      .nullable()
      .optional()
      .describe("Profile the draft was seeded from, or `null`."),
    status: z
      .enum(["open", "merged", "abandoned"])
      .optional()
      .describe("Lifecycle state of the draft."),
    createdBy: z.string().optional().describe("Actor email that created the draft."),
    createdAt: z.string().optional().describe("ISO-8601 timestamp of creation."),
    publishedAt: z.string().nullable().optional().describe("ISO-8601 merge/publish timestamp, or `null`."),
  })
  .catchall(z.unknown())
  .describe("One staged translation draft.");

// ── Publish ───────────────────────────────────────────────────────────────────
export const i18nPublishSchema = z
  .object({
    chunk: z
      .string()
      .optional()
      .describe(
        "Optional chunk label to stamp on the audit log. Publishing is profile-wide regardless — the whole profile is snapshotted into one KV blob.",
      ),
  })
  .describe("Body for `POST /api/admin/i18n/profiles/{profileId}/publish`. The `chunk` is an audit label only.");

export const i18nPublishResponseSchema = z
  .object({
    ok: z.literal(true).describe("Always `true` on success."),
    profile_id: z.string().describe("Profile that was published."),
    chunk: z.string().nullable().describe("Audit chunk label, or `null` when none was given."),
    published_at: z.string().describe("ISO-8601 timestamp of the publish."),
    version: z.string().describe("New KV snapshot version that was shipped."),
    key_count: z.number().describe("Number of keys in the published snapshot."),
    changed: z.boolean().describe("Whether the snapshot's contents actually changed since the last publish."),
    purged: z
      .enum(["purged", "skipped", "failed"])
      .describe("CDN purge outcome: `purged` ok, `skipped` (no creds), or `failed` (edge still stale)."),
    kv_verified: z.boolean().describe("Whether a KV read-back confirmed the new version persisted."),
    warning: z.string().optional().describe("Human-readable caveat when the publish landed but is not fully live."),
  })
  .describe("Result of a profile-wide publish.");

export type I18nProfileCreateInput = z.infer<typeof i18nProfileCreateSchema>;
export type I18nPushKeysInput = z.infer<typeof i18nPushKeysSchema>;
export type I18nKeyUpdateInput = z.infer<typeof i18nKeyUpdateSchema>;
export type I18nPublishInput = z.infer<typeof i18nPublishSchema>;
