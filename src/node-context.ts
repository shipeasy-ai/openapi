/**
 * Shared node-only consumer context resolver (doc 21 §A4.2).
 *
 * The CLI and the stdio MCP both need the same two local files to build the
 * registry transport's auth: the `.shipeasy` project pointer (walked up like
 * `.git`) and `~/.config/shipeasy/config.json` (the session token + default
 * project), plus the `SHIPEASY_CLI_TOKEN` / `SHIPEASY_PROJECT_ID` env
 * overrides. They used to each keep a private copy (`loadCredentials` +
 * `getBoundProjectId` in the CLI, `readConfig` + `getBoundProjectIdSync` in the
 * MCP). This is the one shared resolver they both import.
 *
 * HARD CONSTRAINT: this entry is node-only (`node:fs`/`node:os`/`node:path`)
 * and must NEVER be imported by `src/index.ts`, `src/resources/*`, or
 * `src/operations/*` — i.e. anything in the worker-bundled graph. Only the two
 * fs-having consumers import it via the `@shipeasy/openapi/node-context`
 * subpath. The slack-worker / MCP-worker keep getting context from the request,
 * not the filesystem.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ConsumerContext {
  /** SDK token used as `X-SDK-Key`. */
  token: string;
  /** Resolved project id used as `X-Project-Id`. */
  projectId: string;
  /** Directory that held the `.shipeasy` binding, if any. */
  boundDir: string | null;
  /** Path to the XDG config file that supplied the session, if read. */
  configPath: string;
  /** Owner email from the session config, if present. */
  userEmail: string | null;
  /** True when a `.shipeasy` binding (or `--project`/env override) supplied the project id. */
  bound: boolean;
}

interface SessionConfig {
  project_id?: string;
  cli_token?: string;
  app_base_url?: string;
  api_base_url?: string;
  user_email?: string;
}

interface ProjectPointer {
  project_id?: string;
  project_name?: string;
}

/** XDG config path for the CLI/MCP session (`~/.config/shipeasy/config.json`). */
export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "shipeasy", "config.json");
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Walk up from `dir` (like `.git`) to find the nearest `.shipeasy` file. */
export function findBoundDir(dir: string): string | null {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".shipeasy"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** The bound project id from the nearest `.shipeasy`, or undefined. */
export function getBoundProjectId(dir: string = process.cwd()): string | undefined {
  const boundDir = findBoundDir(dir);
  if (!boundDir) return undefined;
  return readJson<ProjectPointer>(join(boundDir, ".shipeasy"))?.project_id;
}

export interface ResolveOptions {
  /** Explicit `--project` override (highest precedence). */
  projectOverride?: string;
  /** Directory to resolve the binding from (defaults to cwd). */
  cwd?: string;
}

/**
 * Resolve the consumer context once: env overrides → `.shipeasy` binding →
 * session config. Returns null if there is no usable session token.
 *
 * Precedence for the project id: `projectOverride` → `SHIPEASY_PROJECT_ID` →
 * `.shipeasy` → session default. The token comes from `SHIPEASY_CLI_TOKEN` or
 * the session config.
 */
export function resolveConsumerContext(opts: ResolveOptions = {}): ConsumerContext | null {
  const cwd = opts.cwd ?? process.cwd();
  const cfgPath = configPath();
  const cfg = readJson<SessionConfig>(cfgPath) ?? {};

  const token = process.env.SHIPEASY_CLI_TOKEN || cfg.cli_token;
  if (!token) return null;

  const boundDir = findBoundDir(cwd);
  const boundId = boundDir
    ? readJson<ProjectPointer>(join(boundDir, ".shipeasy"))?.project_id
    : undefined;
  const envProject = process.env.SHIPEASY_PROJECT_ID;
  const projectId = opts.projectOverride || envProject || boundId || cfg.project_id;
  if (!projectId) return null;

  return {
    token,
    projectId,
    boundDir: boundId ? boundDir : null,
    configPath: cfgPath,
    userEmail: cfg.user_email ?? null,
    bound: Boolean(opts.projectOverride || envProject || boundId),
  };
}
