import { ApiError } from "../transport.js";
import type { Operation, OpInput, Param } from "./types.js";

/** Coerce one raw value (from a CLI flag string or an MCP JSON value) per its param type. */
function coerceValue(param: Param, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  switch (param.type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new ApiError(`--${param.name} must be a number`, 400);
      return n;
    }
    case "boolean":
      return raw === true || raw === "true" || raw === "1";
    case "json":
      // Both surfaces deliver nested structures as a JSON string for ergonomics
      // (commander has no array flag; LLMs emit a string). Parse once here so
      // `run` always sees a real object/array — the mapping the CLI and MCP
      // handlers each used to do by hand.
      if (typeof raw !== "string") return raw;
      try {
        return JSON.parse(raw);
      } catch {
        throw new ApiError(`--${param.name} must be valid JSON`, 400);
      }
    case "string":
    default: {
      const s = String(raw);
      if (param.enum && !param.enum.includes(s)) {
        throw new ApiError(`--${param.name} must be one of: ${param.enum.join(", ")}`, 400);
      }
      return s;
    }
  }
}

/**
 * Build the coerced facade input `run` expects from a raw key→value bag
 * (commander's merged args+opts, or MCP's `arguments`). Enforces `required`.
 */
export function coerceInput(op: Operation, raw: Record<string, unknown>): OpInput {
  const out: OpInput = {};
  for (const param of op.params) {
    const value = coerceValue(param, raw[param.name]);
    if (value === undefined) {
      if (param.required) throw new ApiError(`${param.name} is required`, 400);
      continue;
    }
    out[param.name] = value;
  }
  return out;
}
