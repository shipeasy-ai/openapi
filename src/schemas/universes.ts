import { z } from "zod";
import { folderSchema } from "./folder";

export const universeNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?$/)
  .max(128)
  .describe(
    "Stable universe key. Single segment or `folder.name`. Lowercase letters, digits, `_` or `-`; max 128 chars. Immutable after create.",
  );

export const holdoutRangeSchema = z
  .tuple([z.number().int().min(0).max(9999), z.number().int().min(0).max(9999)])
  .refine(([lo, hi]) => lo <= hi, "lo must be <= hi")
  .nullable()
  .describe(
    "Inclusive `[lo, hi]` bucket range (0–9999) reserved as the **holdout** — callers hashed into this slice are excluded from every experiment in the universe. `null` disables the holdout. Pro plan or higher required.",
  );

export const universeCreateSchema = z
  .object({
    name: universeNameSchema,
    folder: folderSchema,
    unit_type: z
      .string()
      .default("user_id")
      .describe(
        "Unit of randomisation. Typically `user_id`. Use `account_id` to keep whole accounts in the same group across an experiment.",
      ),
    holdout_range: holdoutRangeSchema.default(null),
  })
  .describe("Body for `POST /api/admin/universes`. Only `name` is required.");

export const universeUpdateSchema = z
  .object({
    folder: folderSchema,
    holdout_range: holdoutRangeSchema.optional(),
  })
  .describe(
    "Body for `PATCH /api/admin/universes/{id}`. Only `holdout_range` is mutable — name and unit_type are immutable after create.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
export const universeResponseSchema = z.object({
  id: z.string().describe("Stable opaque universe id."),
  name: universeNameSchema,
  unitType: z
    .string()
    .describe("Unit of randomisation. Snake-case in request (`unit_type`), camelCase in response."),
  holdoutRange: z
    .tuple([z.number(), z.number()])
    .nullable()
    .describe("Reserved holdout bucket range, or `null` if none."),
  createdAt: z.string().describe("ISO-8601 timestamp of creation."),
});

export const universeCreateResponseSchema = z.object({
  id: z.string().describe("Newly assigned universe id."),
  name: universeNameSchema,
});

export const universeUpdateResponseSchema = z.object({
  id: z.string().describe("Universe id that was updated."),
});

export const universeDeleteResponseSchema = z.object({ ok: z.literal(true) });

export type UniverseCreateInput = z.infer<typeof universeCreateSchema>;
export type UniverseUpdateInput = z.infer<typeof universeUpdateSchema>;
