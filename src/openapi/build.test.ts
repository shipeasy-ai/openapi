import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildOpenApi } from "./build.js";
import type { ResourceDescriptor } from "./types.js";

/**
 * Generator-cleanliness invariants for the emitted spec. Zod 4's
 * `toJSONSchema` produces two constructs that break `openapi-generator` (and
 * the OpenAPI 3.1 validator); `build.ts` normalizes them. These tests lock the
 * normalization in so a Zod/Zod-options bump can't silently reintroduce
 * `Array<any>` fields or non-compiling SDK models. See `normalizeForOpenApi31`.
 */

/** Recursively visit every schema-shaped node in the document. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return;
  visit(node as Record<string, unknown>);
  for (const v of Object.values(node)) walk(v, visit);
}

const resource: ResourceDescriptor = {
  name: "widget",
  basePath: "/api/admin/widgets",
  describeOne: "widget",
  describeMany: "widgets",
  endpoints: [
    {
      operationId: "createWidget",
      method: "POST",
      path: "",
      summary: "Create a widget",
      // `range` is a tuple → Zod emits array-form `items`; `payload` is
      // unknown-or-null → Zod emits `anyOf: [{}, {type:null}]`. Both must be
      // normalized away.
      request: z.object({
        range: z.tuple([z.number(), z.number()]),
        payload: z.unknown().nullable(),
      }),
      response: z.object({ id: z.string() }),
    },
  ],
};

const doc = buildOpenApi({
  info: { title: "t", version: "1" },
  servers: [],
  resources: [resource],
});
const req = (doc.components.schemas as Record<string, { properties: Record<string, Record<string, unknown>> }>)
  .CreateWidgetRequest;

describe("buildOpenApi → OpenAPI 3.1 normalization", () => {
  it("never emits array-form `items` anywhere (invalid in 3.1)", () => {
    walk(doc, (n) => expect(Array.isArray(n.items)).toBe(false));
  });

  it("collapses a homogeneous tuple to `T[]` with min/maxItems", () => {
    const range = req.properties.range;
    expect(range.type).toBe("array");
    expect(range.items).toEqual({ type: "number" });
    expect(range.minItems).toBe(2);
    expect(range.maxItems).toBe(2);
  });

  it("drops a union that contains an empty `{}` (any) branch", () => {
    const payload = req.properties.payload;
    expect(payload.anyOf).toBeUndefined();
    expect(payload.oneOf).toBeUndefined();
  });

  it("never leaves an empty `{}` schema inside a union (breaks codegen)", () => {
    walk(doc, (n) => {
      for (const branches of [n.anyOf, n.oneOf]) {
        if (!Array.isArray(branches)) continue;
        for (const b of branches) {
          expect(b && typeof b === "object" && Object.keys(b).length === 0).toBe(false);
        }
      }
    });
  });
});
