import { z } from "zod";

/**
 * Projects — admin-API request/response shapes for the two account-level
 * endpoints: `upsert` (find-or-create by domain) and `current` (the project the
 * caller's auth header resolves to). Both are read-from-credential / idempotent,
 * so neither targets the `.shipeasy`-bound project. Zod-only — no transport.
 */

// ── Request ────────────────────────────────────────────────────────────────
export const projectUpsertSchema = z
  .object({
    domain: z
      .string()
      .min(1)
      .max(2048)
      .describe(
        "Hostname-like project identifier (e.g. `acme.com`). Use `*` to allow any origin. The project is keyed by `(owner_email, domain)`, so a second call with the same domain returns the existing project.",
      ),
    name: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe("Human-readable project name. Defaults to the domain on first create."),
  })
  .describe(
    "Body for `POST /api/admin/projects/upsert`. Only `domain` is required; the owner is resolved from the caller's session.",
  );

// ── Response shapes ──────────────────────────────────────────────────────────
export const projectUpsertResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque project id."),
    name: z.string().describe("Project name (the supplied `name`, or the domain on first create)."),
    domain: z.string().nullable().describe("Project domain, or `null` if unset."),
    owner_email: z.string().describe("Email of the account that owns the project."),
    created: z
      .boolean()
      .describe("`true` if this call created the project, `false` if it returned an existing one."),
  })
  .describe("Result of `POST /api/admin/projects/upsert`.");

export const currentProjectResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque project id."),
    name: z.string().describe("Project name."),
    domain: z.string().nullable().describe("Project domain, or `null` if unset."),
    ownerEmail: z.string().describe("Email of the account that owns the project."),
    plan: z.enum(["free", "paid"]).describe("Billing plan tier."),
    status: z.enum(["active", "inactive"]).describe("Project lifecycle status."),
    subscriptionStatus: z
      .string()
      .describe("Stripe subscription status (`none`, `active`, `trialing`, `past_due`, …)."),
    billingInterval: z.enum(["monthly", "annual"]).describe("Billing cadence."),
    currentPeriodEnd: z
      .string()
      .nullable()
      .describe("ISO-8601 end of the current billing period, or `null`."),
    trialEndsAt: z.string().nullable().describe("ISO-8601 trial end, or `null` if not trialing."),
    cancelAtPeriodEnd: z
      .number()
      .describe("`1` if the subscription is set to cancel at period end, else `0`."),
    moduleTranslations: z
      .union([z.boolean(), z.number()])
      .describe("Whether the i18n/translations module is enabled."),
    moduleConfigs: z
      .union([z.boolean(), z.number()])
      .describe("Whether the dynamic-configs module is enabled."),
    moduleGates: z
      .union([z.boolean(), z.number()])
      .describe("Whether the feature-gates module is enabled."),
    moduleExperiments: z
      .union([z.boolean(), z.number()])
      .describe("Whether the experiments module is enabled."),
    moduleFeedback: z
      .union([z.boolean(), z.number()])
      .describe("Whether the feedback/ops module is enabled."),
    createdAt: z.string().describe("ISO-8601 timestamp of project creation."),
    updatedAt: z.string().describe("ISO-8601 timestamp of last update."),
  })
  .catchall(z.unknown())
  .describe(
    "The project the caller's auth header resolves to. The shape is open — additional project fields may be present.",
  );

export type ProjectUpsertInput = z.infer<typeof projectUpsertSchema>;
export type UpsertResult = z.infer<typeof projectUpsertResponseSchema>;
export type CurrentProject = z.infer<typeof currentProjectResponseSchema>;
