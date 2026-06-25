import type { AdminClient } from "../resources/index.js";
import { coerceInput } from "./coerce.js";
import type { McpTool, Operation } from "./types.js";

/** JSON-Schema `type` keyword for each param type. `json` is surfaced as a string the model stringifies. */
function jsonType(t: Operation["params"][number]["type"]): string {
  switch (t) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
    case "string":
    default:
      return "string";
  }
}

/** Project the registry onto the MCP `tools/list` catalog — one tool per operation. */
export function operationsToMcpTools(ops: Operation[]): McpTool[] {
  return ops.map((op) => {
    const properties: McpTool["inputSchema"]["properties"] = {};
    const required: string[] = [];
    for (const p of op.params) {
      properties[p.name] = { type: jsonType(p.type), description: p.description };
      if (p.enum) properties[p.name].enum = p.enum;
      if (p.required) required.push(p.name);
    }
    return {
      name: op.mcpName,
      description: op.description,
      inputSchema: { type: "object", ...(required.length ? { required } : {}), properties },
    };
  });
}

/**
 * Build the `tools/call` dispatch map keyed by MCP tool name. Each entry
 * coerces the raw `arguments` and runs the op against the admin client —
 * replacing the hand-written 60-branch if/else in `mcp/src/server.ts`.
 */
export function operationsToDispatch(
  ops: Operation[],
): Record<string, (client: AdminClient, args: Record<string, unknown>) => Promise<unknown>> {
  const map: Record<
    string,
    (client: AdminClient, args: Record<string, unknown>) => Promise<unknown>
  > = {};
  for (const op of ops) {
    // `async` so a synchronous coercion error (bad JSON, missing required) is
    // surfaced as a rejected promise the caller can await/catch uniformly.
    map[op.mcpName] = async (client, args) => op.run(client, coerceInput(op, args ?? {}));
  }
  return map;
}
