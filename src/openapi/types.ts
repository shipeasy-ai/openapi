import type { ZodTypeAny } from "zod";

/**
 * Rich descriptor for one HTTP operation. We extend the existing resource
 * surface (`schemas`, `actions`) with this so a single source — the resource
 * file — drives the typed client, the MCP tool catalog, and the OpenAPI doc.
 *
 * Path is relative to the resource's `basePath`; concatenation happens in the
 * builder. Use `{id}` or `{name}` style placeholders for path parameters.
 */
export interface Endpoint {
  /** camelCase, used as the OpenAPI operationId and SDK method name. */
  operationId: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Path *relative* to the resource basePath. "" for collection endpoints,
   *  "/{id}" for item, "/{id}/enable" for actions. */
  path: string;
  summary: string;
  /** Markdown. Shown in the docs operation page. Optional — falls back to summary. */
  description?: string;
  /** Path-parameter descriptions (looked up by name). */
  pathParams?: Record<string, string>;
  /** Query-parameter zod schemas + descriptions. */
  queryParams?: Record<string, { schema: ZodTypeAny; description: string }>;
  /** Request body zod schema; absent for GET/DELETE. */
  request?: ZodTypeAny;
  /** Response body zod schema for the 2xx happy path. */
  response: ZodTypeAny;
  /** Status code for the success response. Defaults to 200; use 201 for creates,
   *  204 for empty deletes. */
  successStatus?: number;
  /**
   * Inline examples surfaced in the docs page and JSON spec.
   *
   * Two forms supported:
   * - Singular `request` / `response` — emitted as OpenAPI `example`. One sample, no label.
   * - Plural `requestExamples` / `responseExamples` — emitted as OpenAPI `examples`
   *   (an object keyed by example name). Each entry can carry a `summary`
   *   (tab/label) and `description` (markdown caption). Use this when one
   *   sample isn't enough to teach the shape (e.g. minimal vs. full vs.
   *   gatekeeper-stack variants of `createGate`).
   *
   * If both forms are supplied, the plural wins.
   */
  examples?: {
    request?: unknown;
    response?: unknown;
    requestExamples?: Record<string, { summary?: string; description?: string; value: unknown }>;
    responseExamples?: Record<string, { summary?: string; description?: string; value: unknown }>;
  };
  /** 1–3 sentence narrative — what to use this endpoint for. Goes into the
   *  description and the use-case sidebar in docs. */
  useCase?: string;
  /** Marks an endpoint that's not part of v1; emitted as deprecated. */
  deprecated?: boolean;
}

/**
 * Resource descriptor extended with the OpenAPI tag + endpoint list. Existing
 * `schemas`/`actions` fields stay for backward compatibility; OpenAPI consumers
 * use `endpoints` and `tag`.
 */
export interface ResourceDescriptor {
  name: string;
  basePath: string;
  describeOne: string;
  describeMany: string;
  /** Tag groups operations in the docs sidebar. Optional — falls back to a
   *  capitalised resource name. */
  tag?: { name: string; description: string };
  /** Full operation list. Builders walk this; MCP/CLI can iterate it too. */
  endpoints?: readonly Endpoint[];
}
