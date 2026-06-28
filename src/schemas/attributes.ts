import { z } from "zod";

/**
 * Targeting attribute — one row of the auto-inferred user-attribute schema the
 * dashboard surfaces for gate/experiment targeting. Read-only. The shape is
 * open (`name` + optional `type` plus inferred extras like sample values), so
 * the schema carries the known fields and allows additional ones.
 */
export const attributeResponseSchema = z
  .object({
    name: z.string().describe("Attribute key as seen in evaluation context (e.g. `plan`, `country`)."),
    type: z
      .string()
      .optional()
      .describe("Inferred value type (`string`, `number`, `boolean`, …) when known."),
  })
  .catchall(z.unknown())
  .describe("One auto-inferred targeting attribute.");

export const attributeListResponseSchema = z
  .array(attributeResponseSchema)
  .describe("Every auto-inferred targeting attribute in the project.");

export type Attribute = z.infer<typeof attributeResponseSchema>;
