import { z } from "zod";
import {
  COMMON_PARAMETERS,
  COMMON_RESPONSES,
  ERROR_RESPONSE_SCHEMA,
  SECURITY,
  SECURITY_SCHEMES,
  pageEnvelopeSchema,
} from "./components.js";
import type { Endpoint, ResourceDescriptor } from "./types.js";

// Structural types — see components.ts for why we don't import openapi-types.
type JsonObject = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

/** Loose OpenAPI 3.1 document shape. The output is validated at emit time. */
export interface OpenApiDocument extends JsonObject {
  openapi: string;
  info: JsonObject;
  servers: JsonObject[];
  paths: Record<string, JsonObject>;
  components: JsonObject;
  tags: JsonObject[];
  security: JsonObject[];
}

export interface BuildOpenApiOptions {
  /** Spec metadata. Title/description show on the docs landing page. */
  info: JsonObject;
  /** Server URLs. Document the canonical production URL first. */
  servers: JsonObject[];
  /** Each resource contributes a tag + a path per endpoint. */
  resources: readonly ResourceDescriptor[];
}

/**
 * Walks the resource registry and produces a self-contained OpenAPI 3.1
 * document. Inlines per-endpoint zod schemas as named components (one per
 * request/response shape) and references shared components for errors,
 * pagination, and security.
 */
export function buildOpenApi(opts: BuildOpenApiOptions): OpenApiDocument {
  const schemas: Record<string, JsonSchema> = {
    ErrorResponse: ERROR_RESPONSE_SCHEMA as JsonSchema,
  };
  const paths: Record<string, JsonObject> = {};
  const tags: JsonObject[] = [];

  for (const resource of opts.resources) {
    if (!resource.endpoints || resource.endpoints.length === 0) continue;

    const tag = resource.tag ?? {
      name: capitalise(resource.name),
      description: `Operations for ${resource.describeMany}.`,
    };
    tags.push(tag);

    for (const ep of resource.endpoints) {
      const fullPath = joinPath(resource.basePath, ep.path);
      const pathItem: JsonObject = (paths[fullPath] as JsonObject | undefined) ?? {};

      pathItem[ep.method.toLowerCase()] = buildOperation({
        endpoint: ep,
        tag: tag.name,
        registerSchema: (name, schema) => {
          schemas[name] = schema;
        },
      });

      paths[fullPath] = pathItem;
    }
  }

  return {
    openapi: "3.1.0",
    info: opts.info,
    servers: opts.servers,
    tags,
    paths,
    components: {
      schemas,
      parameters: COMMON_PARAMETERS,
      securitySchemes: SECURITY_SCHEMES,
      responses: COMMON_RESPONSES,
    },
    security: SECURITY,
  };
}

interface BuildOperationCtx {
  endpoint: Endpoint;
  tag: string;
  registerSchema: (name: string, schema: JsonSchema) => void;
}

function buildOperation(ctx: BuildOperationCtx): JsonObject {
  const { endpoint: ep, tag, registerSchema } = ctx;

  // Always require X-Project-Id; add pagination params on GETs that look like
  // list endpoints (heuristic: response schema is the page envelope itself,
  // i.e. the descriptor's response wraps `pageOf(...)`).
  const parameters: JsonObject[] = [{ $ref: "#/components/parameters/ProjectId" }];

  if (ep.pathParams) {
    for (const [name, description] of Object.entries(ep.pathParams)) {
      parameters.push({
        name,
        in: "path",
        required: true,
        description,
        schema: { type: "string" },
      });
    }
  }

  if (ep.queryParams) {
    for (const [name, def] of Object.entries(ep.queryParams)) {
      parameters.push({
        name,
        in: "query",
        required: false,
        description: def.description,
        schema: zodToJsonSchema(def.schema),
      });
    }
  }

  // Request body
  let requestBody: JsonObject | undefined;
  if (ep.request) {
    const reqName = `${pascalise(ep.operationId)}Request`;
    registerSchema(reqName, zodToJsonSchema(ep.request));
    const media: JsonObject = { schema: { $ref: `#/components/schemas/${reqName}` } };
    if (ep.examples?.requestExamples) {
      media.examples = ep.examples.requestExamples as unknown as JsonObject;
    } else if (ep.examples?.request !== undefined) {
      media.example = ep.examples.request;
    }
    requestBody = { required: true, content: { "application/json": media } };
  }

  // Response body — register the schema, also detect page envelope to add
  // pagination params automatically.
  const responseName = `${pascalise(ep.operationId)}Response`;
  const responseSchema = zodToJsonSchema(ep.response);
  registerSchema(responseName, responseSchema);
  const isPaginated = looksLikePageEnvelope(responseSchema);
  if (isPaginated && ep.method === "GET") {
    parameters.push(
      { $ref: "#/components/parameters/PaginationLimit" },
      { $ref: "#/components/parameters/PaginationCursor" },
    );
  }

  const status = String(ep.successStatus ?? (ep.method === "POST" ? 201 : 200));
  const responseMedia: JsonObject = { schema: { $ref: `#/components/schemas/${responseName}` } };
  if (ep.examples?.responseExamples) {
    responseMedia.examples = ep.examples.responseExamples as unknown as JsonObject;
  } else if (ep.examples?.response !== undefined) {
    responseMedia.example = ep.examples.response;
  }
  const responses: JsonObject = {
    [status]: {
      description: ep.summary,
      content: { "application/json": responseMedia },
    },
    "400": { $ref: "#/components/responses/BadRequest" },
    "401": { $ref: "#/components/responses/Unauthorized" },
    "403": { $ref: "#/components/responses/Forbidden" },
    "404": { $ref: "#/components/responses/NotFound" },
    "409": { $ref: "#/components/responses/Conflict" },
    "422": { $ref: "#/components/responses/UnprocessableEntity" },
  };

  // `useCase` may be a single sentence or a markdown list. Render the heading
  // on its own line so list bullets don't get glued to "**Use case:**".
  let useCaseBlock: string | null = null;
  if (ep.useCase) {
    const isList = /^\s*-\s/m.test(ep.useCase);
    useCaseBlock = isList ? `**Use cases**\n\n${ep.useCase}` : `**Use case:** ${ep.useCase}`;
  }
  const description = [ep.description, useCaseBlock].filter(Boolean).join("\n\n");

  return {
    operationId: ep.operationId,
    summary: ep.summary,
    ...(description ? { description } : {}),
    tags: [tag],
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses,
    ...(ep.deprecated ? { deprecated: true } : {}),
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  // Zod 4 emits draft 2020-12 by default; OpenAPI 3.1 is a strict superset of
  // 2020-12 so the output is directly compatible.
  const out = z.toJSONSchema(schema, {
    target: "openapi-3.1",
    unrepresentable: "any",
  }) as JsonSchema;
  return normalizeForOpenApi31(out);
}

/**
 * Post-process Zod's JSON-Schema output into generator-clean OpenAPI 3.1.
 * Zod 4 emits two constructs that `openapi-generator` (and the 3.1 validator)
 * reject — both verified against the real spec:
 *
 *   1. **Tuples → array-form `items`.** `z.tuple([z.number(), z.number()])`
 *      (the universe `holdout_range`) emits `{ type: "array", items: [ {...},
 *      {...} ] }`. Array-form `items` is the draft-4/OpenAPI-3.0 tuple form and
 *      is INVALID in 3.1 (which uses `prefixItems`); the validator rejects it
 *      and generators degrade the field to `Array<any>`. We collapse a
 *      homogeneous tuple to a single `items` schema + `min/maxItems` (so SDKs
 *      get a clean `number[]`), and convert a heterogeneous tuple to
 *      `prefixItems` (+ `items: false`).
 *
 *   2. **"any" leaf inside a union.** `z.unknown().nullable()` (the config
 *      activity `payload`) emits `anyOf: [ {}, { type: "null" } ]`. The empty
 *      schema `{}` already permits every value (null included), so the union is
 *      redundant — but `openapi-generator` chokes on it and emits a model with
 *      dangling `FromJSON`/`ToJSON` calls that don't compile. We drop the
 *      union, leaving the permissive any-schema (annotations preserved).
 *
 * Pure structural rewrite; `description`/`default`/`title` are preserved.
 */
function normalizeForOpenApi31<T>(node: T): T {
  if (Array.isArray(node)) return node.map((n) => normalizeForOpenApi31(n)) as unknown as T;
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;

  // Depth-first so nested tuples/unions are fixed before their parents.
  for (const key of Object.keys(obj)) obj[key] = normalizeForOpenApi31(obj[key]);

  // Rule 1 — array-form tuple `items` → valid 3.1.
  if (Array.isArray(obj.items)) {
    const elems = obj.items as JsonSchema[];
    const len = elems.length;
    const homogeneous = len > 0 && elems.every((e) => JSON.stringify(e) === JSON.stringify(elems[0]));
    if (homogeneous) {
      obj.items = elems[0];
    } else {
      obj.prefixItems = elems;
      obj.items = false;
    }
    if (obj.minItems === undefined) obj.minItems = len;
    if (obj.maxItems === undefined) obj.maxItems = len;
  }

  // Rule 2 — union containing an "any" leaf ({}) collapses to the any-schema.
  for (const comb of ["anyOf", "oneOf"] as const) {
    const branches = obj[comb];
    if (Array.isArray(branches) && branches.some(isEmptySchema)) delete obj[comb];
  }

  return node;
}

/** A schema with no constraint keys — Zod's representation of `any`/`unknown`. */
function isEmptySchema(s: unknown): boolean {
  return !!s && typeof s === "object" && !Array.isArray(s) && Object.keys(s as object).length === 0;
}

function looksLikePageEnvelope(schema: JsonSchema): boolean {
  if (schema.type !== "object" || typeof schema.properties !== "object") return false;
  const props = schema.properties as Record<string, JsonSchema>;
  return "data" in props && "next_cursor" in props && props.data?.type === "array";
}

function joinPath(basePath: string, suffix: string): string {
  if (!suffix) return basePath;
  if (suffix.startsWith("/")) return `${basePath}${suffix}`;
  return `${basePath}/${suffix}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pascalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { pageEnvelopeSchema };
