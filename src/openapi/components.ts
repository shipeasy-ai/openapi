/**
 * Reusable OpenAPI components: security schemes, error envelope, pagination
 * params. The builder merges these once into `components.{schemas,parameters,
 * securitySchemes}`; per-operation references are added by name.
 *
 * Types are structural (`Record<string, unknown>`) because `openapi-types`
 * v12 has internal V3/V3.1 incompatibilities — the runtime output is valid
 * OpenAPI 3.1; a separate validate step (e.g. `swagger-parser`) catches any
 * spec violation at emit time.
 */
type JsonObject = Record<string, unknown>;

export const ERROR_RESPONSE_SCHEMA: JsonObject = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string", description: "Human-readable error message." },
    code: { type: "string", description: "Stable machine code, when applicable." },
    detail: { type: "string", description: "Extra context (stack frames, validation details)." },
  },
  additionalProperties: false,
};

export const SECURITY_SCHEMES: Record<string, JsonObject> = {
  bearerSdkKey: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "sdk_admin_*",
    description:
      'Pass an admin SDK key as `Authorization: Bearer sdk_admin_…`. Mint via `POST /api/admin/keys` with `type: "admin"`.',
  },
};

/** Single global security requirement applied to every operation. */
export const SECURITY: JsonObject[] = [{ bearerSdkKey: [] }];

/** Reusable parameters surfaced under `components.parameters`. */
export const COMMON_PARAMETERS: Record<string, JsonObject> = {
  ProjectId: {
    name: "X-Project-Id",
    in: "header",
    required: true,
    description: "Project the request operates on. Must match the project the SDK key belongs to.",
    schema: { type: "string" },
  },
  PaginationLimit: {
    name: "limit",
    in: "query",
    required: false,
    description: "Page size (1–500). Defaults to 100.",
    schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  },
  PaginationCursor: {
    name: "cursor",
    in: "query",
    required: false,
    description:
      "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.",
    schema: { type: "string" },
  },
};

/** Standard 4xx/5xx response set referenced from every operation. */
export const COMMON_RESPONSES: Record<string, JsonObject> = {
  BadRequest: {
    description: "The request was malformed or failed validation.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
  Unauthorized: {
    description: "Missing or invalid SDK key.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
  Forbidden: {
    description: "SDK key is valid but not allowed to act on this project.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
  NotFound: {
    description: "The resource does not exist or is not visible to the caller.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
  Conflict: {
    description:
      "The mutation conflicts with current state (e.g. duplicate name, or a referenced row is still in use).",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
  UnprocessableEntity: {
    description: "Zod schema validation rejected the request body.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
};

/** Wraps a single-item schema as the paginated `{ data, next_cursor }` envelope. */
export function pageEnvelopeSchema(itemRef: string): JsonObject {
  // (kept for callers that want to reference an existing schema component)
  return {
    type: "object",
    required: ["data", "next_cursor"],
    properties: {
      data: { type: "array", items: { $ref: itemRef } },
      next_cursor: {
        type: ["string", "null"],
        description: "Opaque cursor for the next page. `null` when this is the last page.",
      },
    },
    additionalProperties: false,
  };
}
