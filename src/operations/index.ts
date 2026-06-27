/**
 * Operation registry + surface adapters.
 *
 * One declarative `Operation[]` per resource drives three surfaces:
 *   - CLI    — `mountOperations(group, ops, ctx)` builds commander subcommands.
 *   - MCP    — `operationsToMcpTools(ops)` + `operationsToDispatch(ops)`.
 *   - Docs   — `renderOperationsMarkdown(ops)`.
 *
 * The `release` module was the pilot; the registry now spans the whole
 * migratable surface (doc 21 §A2/§A3): metrics, events, ops (queue + alert
 * rules), projects, i18n (API parts), attributes, and SDK-docs. What stays
 * permanently hand-written in the fs-having consumers: i18n fs/AST ops, SDK key
 * minting, `detect_project`, and auth login/logout/bind.
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

// ── release module (the pilot) ──────────────────────────────────────────────
export { gateOperations } from "./gates.js";
export { killswitchOperations } from "./killswitches.js";
export { configOperations } from "./configs.js";
export { experimentOperations } from "./experiments.js";
export { universeOperations } from "./universes.js";

// ── full-surface modules ────────────────────────────────────────────────────
export { metricOperations, METRIC_GRAMMAR } from "./metrics.js";
export { eventOperations } from "./events.js";
export { opsOperations } from "./ops.js";
export { projectOperations } from "./projects.js";
export { i18nOperations } from "./i18n.js";
export { attributeOperations } from "./attributes.js";
export { docsOperations } from "./sdk-docs.js";

import { gateOperations } from "./gates.js";
import { killswitchOperations } from "./killswitches.js";
import { configOperations } from "./configs.js";
import { experimentOperations } from "./experiments.js";
import { universeOperations } from "./universes.js";
import { metricOperations } from "./metrics.js";
import { eventOperations } from "./events.js";
import { opsOperations } from "./ops.js";
import { projectOperations } from "./projects.js";
import { i18nOperations } from "./i18n.js";
import { attributeOperations } from "./attributes.js";
import { docsOperations } from "./sdk-docs.js";
import type { Operation } from "./types.js";

/** The `release` module — feature flags, kill switches, configs, experiments, universes. */
export const RELEASE_OPERATIONS: Operation[] = [
  ...gateOperations,
  ...killswitchOperations,
  ...configOperations,
  ...experimentOperations,
  ...universeOperations,
];

/** Every operation across every registry-driven module. Adapters iterate this. */
export const ALL_OPERATIONS: Operation[] = [
  ...RELEASE_OPERATIONS,
  ...metricOperations,
  ...eventOperations,
  ...opsOperations,
  ...projectOperations,
  ...i18nOperations,
  ...attributeOperations,
  ...docsOperations,
];
