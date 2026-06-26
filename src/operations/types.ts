import type { AdminClient } from "../resources/index.js";

/**
 * Operation registry — the single source of truth that drives BOTH
 * `@shipeasy/cli` (commander subcommands) and `@shipeasy/mcp` (MCP tools),
 * plus their generated docs.
 *
 * Today each surface is hand-maintained: the CLI hand-builds commander
 * commands in `packages/cli/src/commands/*`, the MCP server hand-writes tool
 * JSON Schemas in `packages/mcp/src/tools/schema.ts` and a 60-branch dispatch
 * in `server.ts`, and the percent→basis-points + `JSON.parse(rules)` mapping
 * is written *identically* in both. An Operation collapses that into one
 * definition: the params describe the ergonomic facade once, `run` performs
 * the facade→wire mapping once, and the adapters in this folder project it
 * onto each surface.
 */

/** Param value kinds. `json` arrives as a JSON string on both surfaces and is parsed by the framework. */
export type ParamType = "string" | "number" | "boolean" | "json";

export interface Param {
  /** Field name — also the CLI flag (`--<name>`) or positional, and the MCP property key. */
  name: string;
  type: ParamType;
  /** Shown in CLI `--help`, the MCP tool input schema, and generated docs. */
  description: string;
  required?: boolean;
  /** CLI only: render as a positional `<name>` argument instead of a `--flag`. Ignored by MCP. */
  positional?: boolean;
  /** Restrict to a fixed set (MCP `enum`, CLI validated in coercion). */
  enum?: string[];
}

export interface OpExample {
  /** Why you'd run this. */
  note?: string;
  /** A copy-pasteable command line. */
  run: string;
}

/** Coerced facade input handed to `run` — keys are param names, values coerced by `ParamType`. */
export type OpInput = Record<string, unknown>;

export interface Operation<O = unknown> {
  /**
   * Command-path segments BEFORE the verb, e.g. `["release", "flags"]`.
   * This is the exact CLI nesting; nested resources just add segments
   * (`["release", "experiments", "universes"]`). Drives grouping + naming.
   */
  group: string[];
  /**
   * The verb, e.g. `create`. Authored ONCE — every surface name derives from
   * `group` + `name` so they can never drift:
   *   id  = `release.flags.create`   (opId   — `.`-joined)
   *   CLI = `release flags create`   (opCli  — space-joined, the real invocation)
   *   MCP = `release_flags_create`   (opMcpName — `_`-joined; MCP names can't have spaces)
   */
  name: string;
  /** True for writes — the CLI/MCP adapter enforces `.shipeasy` binding before running. */
  mutates: boolean;
  /** One-liner — CLI `.description()` and the docs heading. */
  summary: string;
  /** Long-form — the MCP tool `description` and the docs body. */
  description: string;
  params: Param[];
  examples?: OpExample[];
  /**
   * The single source of behaviour: coerced facade input → typed AdminClient
   * call → raw data. Returns data (never prints) so every surface can format
   * it its own way (CLI table, MCP JSON envelope, …).
   */
  run: (client: AdminClient, input: OpInput) => Promise<O>;
}

/**
 * Structural subset of commander's `Command`. The CLI adapter targets this so
 * `@shipeasy/openapi` never has to depend on `commander` — commander's real
 * `Command` satisfies it.
 */
export interface CommandLike {
  command(nameAndArgs: string): CommandLike;
  description(text: string): CommandLike;
  option(flags: string, description?: string, defaultValue?: unknown): CommandLike;
  action(fn: (...args: unknown[]) => void | Promise<void>): CommandLike;
}

/** Everything the CLI surface injects so the adapter stays free of process/chalk/IO. */
export interface CliContext {
  /** Resolve the typed admin client; `mutates` triggers the `requireBinding` guard. */
  getClient: (o: { mutates: boolean; projectOverride?: string }) => AdminClient;
  /** Print machine output (`--json`). */
  printJson: (data: unknown) => void;
  /** Print human output for a successful op (table / one-liner). */
  printResult: (op: Operation, data: unknown, input: OpInput) => void;
  /** Terminal error handler (prints + exits). */
  onError: (e: unknown) => void;
}

type Named = Pick<Operation, "group" | "name">;

/** Stable id, e.g. `release.flags.create`. */
export const opId = (op: Named): string => [...op.group, op.name].join(".");

/** MCP tool name, e.g. `release_flags_create` — the CLI path with `_` for each space. */
export const opMcpName = (op: Named): string => [...op.group, op.name].join("_");

/** CLI invocation, e.g. `release flags create` (full command path). */
export const opCli = (op: Named): string => [...op.group, op.name].join(" ");

/** Plain MCP `Tool` shape — structurally compatible with `@modelcontextprotocol/sdk`'s `Tool`. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    required?: string[];
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  };
}
