import { z } from "zod";
import { configEnvSchema, configNameSchema } from "./configs";
import { folderSchema } from "./folder";

/** A switch key is a single lowercase segment (no dots). */
export const SWITCH_KEY_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export const switchKeySchema = z
  .string()
  .max(64)
  .regex(SWITCH_KEY_RE, {
    message: "Switch keys must be lowercase, no dots.",
  })
  .describe(
    "Single-segment switch key (lowercase letters, digits, `_`/`-`; no dots). Used as the nested switch entry inside a killswitch's `switches` map.",
  );

/** The fixed runtime payload delivered to clients:
 *
 *   { value: <bool>, switches?: { <switch_key>: <bool>, … } }
 *
 * `switches` is optional. When present, an entry takes precedence over `value`
 * for that specific switch_key on the client. */
export const killswitchValueSchema = z
  .object({
    value: z
      .boolean()
      .describe(
        "Default boolean delivered when no `switches` entry matches the caller's switch key.",
      ),
    switches: z
      .record(switchKeySchema, z.boolean())
      .optional()
      .describe(
        "Per-switch overrides. When present, a matching key takes precedence over `value` on the client.",
      ),
  })
  .describe("Runtime killswitch payload returned to SDKs.");

export type KillswitchValue = z.infer<typeof killswitchValueSchema>;

export const killswitchCreateSchema = z
  .object({
    name: configNameSchema.describe(
      "Stable killswitch key in `folder.name` form (two lowercase segments separated by a dot — e.g. `payments.checkout`). Immutable after create.",
    ),
    description: z
      .string()
      .max(512)
      .optional()
      .describe("Optional free-form description shown in the dashboard. Max 512 chars."),
    folder: folderSchema,
    value: z
      .boolean()
      .optional()
      .describe(
        "Default value applied to every env at creation. Defaults to `false`. Use `true` to ship the killswitch pre-tripped.",
      ),
    switches: z
      .record(switchKeySchema, z.boolean())
      .optional()
      .describe(
        "Initial per-switch overrides applied to every env. Empty/omitted leaves the killswitch with only the flat `value`.",
      ),
  })
  .describe("Body for `POST /api/admin/killswitches`. Only `name` is required.");

export const killswitchUpdateSchema = z
  .object({
    description: z
      .string()
      .max(512)
      .nullish()
      .describe("New description, or `null` to clear it. Max 512 chars."),
    folder: folderSchema,
    value: z
      .boolean()
      .optional()
      .describe(
        "Flat value applied to every env. Publishes a new version per env when set. Omit to leave values unchanged.",
      ),
    switches: z
      .record(switchKeySchema, z.boolean())
      .optional()
      .describe(
        "Replace the switches map wholesale on every env. To edit a single entry on a single env use `PUT /{id}/switch` instead.",
      ),
  })
  .describe(
    "Body for `PATCH /api/admin/killswitches/{id}`. Partial — only supplied fields change. `switches` replaces wholesale (no merge).",
  );

/** PUT one switch entry on one env. */
export const killswitchSwitchSetSchema = z
  .object({
    env: configEnvSchema.describe("Target environment (`dev`/`stage`/`prod`)."),
    switchKey: switchKeySchema.describe("Switch key to set."),
    value: z.boolean().describe("New boolean value for this `switchKey` on this `env`."),
  })
  .describe(
    "Body for `PUT /api/admin/killswitches/{id}/switch`. Sets or updates one switch entry on one env.",
  );

/** PATCH the flat default value for one env (dashboard quick-toggle). */
export const killswitchValueSetSchema = z
  .object({
    env: configEnvSchema.describe("Target environment whose flat default flips."),
    value: z
      .boolean()
      .describe("New flat default for this env. Existing switches carry forward unchanged."),
  })
  .describe(
    "Body for the killswitch quick-toggle. Sets the flat `value` on one env without touching its switches.",
  );

/** DELETE one switch entry on one env. */
export const killswitchSwitchUnsetSchema = z
  .object({
    env: configEnvSchema.describe("Target environment."),
    switchKey: switchKeySchema.describe("Switch key to remove."),
  })
  .describe(
    "Body for `DELETE /api/admin/killswitches/{id}/switch`. Removes one switch entry from one env.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
const killswitchEnvEntrySchema = z.object({
  value: z.boolean().describe("Flat boolean published for this env."),
  switches: z.record(switchKeySchema, z.boolean()).optional(),
  version: z.number().int().describe("Monotonically increasing version per env."),
  publishedAt: z.string().describe("ISO-8601 publish timestamp for this version."),
});

export const killswitchResponseSchema = z.object({
  id: z.string().describe("Stable opaque killswitch id."),
  name: configNameSchema,
  description: z.string().nullable().describe("Free-form description or `null`."),
  updatedAt: z.string().describe("ISO-8601 timestamp of last mutation."),
  envs: z
    .record(configEnvSchema, killswitchEnvEntrySchema)
    .describe("Per-env latest value, switches, version, and publish timestamp."),
});

export const killswitchCreateResponseSchema = z.object({
  id: z.string().describe("Newly assigned killswitch id."),
  name: configNameSchema,
});

export const killswitchUpdateResponseSchema = z.object({
  id: z.string().describe("Killswitch id that was updated."),
});

export const killswitchDeleteResponseSchema = z.object({ ok: z.literal(true) });

export const killswitchSwitchSetResponseSchema = z.object({
  id: z.string(),
  env: configEnvSchema,
  switchKey: switchKeySchema,
  value: z.boolean(),
});

export const killswitchSwitchUnsetResponseSchema = z.object({
  id: z.string(),
  env: configEnvSchema,
  switchKey: switchKeySchema,
  removed: z.boolean().describe("`true` if the entry existed and was removed, `false` if no-op."),
});

export type KillswitchCreateInput = z.infer<typeof killswitchCreateSchema>;
export type KillswitchUpdateInput = z.infer<typeof killswitchUpdateSchema>;
export type KillswitchSwitchSetInput = z.infer<typeof killswitchSwitchSetSchema>;
export type KillswitchValueSetInput = z.infer<typeof killswitchValueSetSchema>;
export type KillswitchSwitchUnsetInput = z.infer<typeof killswitchSwitchUnsetSchema>;
