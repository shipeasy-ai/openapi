import type { Transport } from "../transport.js";
import { attributeListResponseSchema, type Attribute } from "../schemas/attributes.js";

/**
 * Targeting attributes — the auto-inferred user-attribute schema the dashboard
 * surfaces for gate/experiment targeting. Read-only; this exists so the typed
 * `attributes list` op can replace the `attributes` kind of the old MCP-only
 * "generic read" (`list_resources`), which is being deleted (see doc 21 §A4.3).
 */
export type { Attribute };

export interface AttributesClient {
  list(): Promise<Attribute[]>;
}

const BASE = "/api/admin/attributes";

export function attributesClient(t: Transport): AttributesClient {
  return {
    list: () => t.request<Attribute[]>("GET", BASE),
  };
}

export const attributesResource = {
  name: "attributes" as const,
  basePath: BASE,
  describeOne: "attribute",
  describeMany: "attributes",
  tag: {
    name: "Attributes",
    description: [
      "Targeting attributes: the auto-inferred schema of user-context keys the",
      "platform has observed in evaluation calls. Read-only — populated by the",
      "SDK hot path, surfaced here so you can see which keys (and value types)",
      "are available when writing gate/experiment targeting rules.",
    ].join("\n"),
  },
  schemas: {},
  actions: [] as const,
  endpoints: [
    {
      operationId: "listAttributes",
      method: "GET",
      path: "",
      summary: "List targeting attributes",
      description:
        "Returns every auto-inferred targeting attribute in the project — the `name` and (when known) the value `type` — for building gate/experiment targeting rules.",
      response: attributeListResponseSchema,
      examples: {
        response: [
          { name: "plan", type: "string" },
          { name: "country", type: "string" },
          { name: "seats", type: "number" },
        ],
      },
      useCase:
        "Discover which user-context keys are available before authoring a targeting rule, instead of guessing attribute names.",
    },
  ] as const,
} as const;
