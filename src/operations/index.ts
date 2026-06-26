/**
 * Operation registry + surface adapters.
 *
 * One declarative `Operation[]` per resource drives three surfaces:
 *   - CLI    — `mountOperations(group, ops, ctx)` builds commander subcommands.
 *   - MCP    — `operationsToMcpTools(ops)` + `operationsToDispatch(ops)`.
 *   - Docs   — `renderOperationsMarkdown(ops)`.
 *
 * Pilot: `gateOperations`. Add `experimentOperations`, `configOperations`, …
 * the same way, then aggregate into `ALL_OPERATIONS`.
 */
export type {
  Operation,
  OpInput,
  OpExample,
  Param,
  ParamType,
  CommandLike,
  CliContext,
  McpTool,
} from "./types.js";
export { opId, opCli, opMcpName } from "./types.js";

export { coerceInput } from "./coerce.js";
export { mountOperations } from "./cli-adapter.js";
export { operationsToMcpTools, operationsToDispatch } from "./mcp-adapter.js";
export { renderOperationsMarkdown } from "./docs.js";

export { gateOperations } from "./gates.js";
export { killswitchOperations } from "./killswitches.js";
export { configOperations } from "./configs.js";
export { experimentOperations } from "./experiments.js";
export { universeOperations } from "./universes.js";

import { gateOperations } from "./gates.js";
import { killswitchOperations } from "./killswitches.js";
import { configOperations } from "./configs.js";
import { experimentOperations } from "./experiments.js";
import { universeOperations } from "./universes.js";
import type { Operation } from "./types.js";

/** Every operation across every resource in the `release` module. Adapters iterate this. */
export const ALL_OPERATIONS: Operation[] = [
  ...gateOperations,
  ...killswitchOperations,
  ...configOperations,
  ...experimentOperations,
  ...universeOperations,
];
