import { z } from "zod";
import { folderSchema } from "./folder";

/**
 * Event catalog schemas — the registry of event names (and their typed
 * properties) that metric queries reference. `/collect` auto-discovers unknown
 * names as `pending` rows; `approve` promotes them to usable. These mirror the
 * authoritative server-side schemas in `@shipeasy/core/schemas/events`, adding
 * `.describe()` copy so they render in the OpenAPI doc. Property `name:type`
 * parsing is a CLI/MCP facade concern; the API takes the already-parsed
 * `properties` array.
 */

export const eventNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_\-.]{0,127}$/)
  .describe(
    "Event name. Starts with a letter, digit, or `_`; letters, digits, `_`, `-`, `.`; max 128 chars. Immutable after create — this is the handle metric queries reference.",
  );

// ── Request building blocks ────────────────────────────────────────────────
export const eventPropertySchema = z
  .object({
    name: z.string().min(1).max(64).describe("Property key, e.g. `amount` or `plan`."),
    type: z
      .enum(["string", "number", "boolean"])
      .describe("Value type of the property as recorded on the event."),
    required: z
      .boolean()
      .default(false)
      .describe("Whether the property must be present on every emitted event."),
    description: z
      .string()
      .default("")
      .describe("Human-readable description of the property."),
  })
  .describe("One typed property declared on a catalogued event.");

export const eventCreateSchema = z
  .object({
    name: eventNameSchema,
    folder: folderSchema,
    description: z
      .string()
      .optional()
      .describe("Optional human-readable description of the event."),
    properties: z
      .array(eventPropertySchema)
      .default([])
      .describe("Typed properties declared on the event. Defaults to an empty list."),
  })
  .describe("Body for `POST /api/admin/events`. Only `name` is required.");

export const eventUpdateSchema = z
  .object({
    folder: folderSchema,
    description: z
      .string()
      .optional()
      .describe("New description for the event."),
    properties: z
      .array(eventPropertySchema)
      .optional()
      .describe("Replaces the full property set (no merge). Omit to leave properties unchanged."),
  })
  .describe(
    "Body for `PATCH /api/admin/events/{id}` and `POST /api/admin/events/{id}/approve`. All fields optional; `name` is immutable after create.",
  );

// ── Response shapes ────────────────────────────────────────────────────────
export const eventResponseSchema = z
  .object({
    id: z.string().describe("Stable opaque event id."),
    name: z.string().describe("Event name — the handle metric queries reference."),
    folder: folderSchema
      .nullable()
      .describe("Folder the event is filed under, or `null` if at the root."),
    description: z
      .string()
      .nullable()
      .describe("Human-readable description, or `null` if none set."),
    properties: z
      .array(eventPropertySchema)
      .describe("Typed properties declared on the event."),
    pending: z
      .number()
      .int()
      .describe(
        "`1` if this is an auto-discovered name awaiting approval (metrics on it fail until approved), `0` if approved/usable.",
      ),
    createdAt: z.string().describe("ISO-8601 timestamp of creation."),
  })
  .describe("A catalogued event.");

export const eventCreateResponseSchema = z
  .object({
    id: z.string().describe("Newly assigned event id."),
    name: z.string().describe("The event name that was registered."),
  })
  .describe("Result of creating (or approving an existing pending) event.");

export const eventUpdateResponseSchema = z
  .object({ id: z.string().describe("Event id that was updated.") })
  .describe("Result of updating or approving an event.");

export const eventDeleteResponseSchema = z
  .object({ ok: z.literal(true) })
  .describe("Confirmation that the event was archived.");

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type EventResponse = z.infer<typeof eventResponseSchema>;
