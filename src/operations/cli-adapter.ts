import { coerceInput } from "./coerce.js";
import type { CliContext, CommandLike, Operation } from "./types.js";

/** `unitType` → `unit-type` for the CLI flag (commander camelCases it back on read). */
const toKebab = (s: string): string => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** verb `create` + positional params → commander signature `create <name>`. */
function commandSignature(op: Operation): string {
  const positionals = op.params
    .filter((p) => p.positional)
    .map((p) => (p.required === false ? `[${p.name}]` : `<${p.name}>`));
  return [op.name, ...positionals].join(" ");
}

/**
 * Mount every operation as a commander subcommand under `group`. The CLI passes
 * its own commander `Command` (which satisfies `CommandLike`) and a `CliContext`
 * carrying the bits `@shipeasy/openapi` must not own (client resolution, table
 * formatting, process.exit). Replaces the per-command hand-wiring in
 * `packages/cli/src/commands/*`.
 */
export function mountOperations(group: CommandLike, ops: Operation[], ctx: CliContext): void {
  for (const op of ops) {
    const positionals = op.params.filter((p) => p.positional);
    const flags = op.params.filter((p) => !p.positional);

    const cmd = group.command(commandSignature(op)).description(op.summary);

    for (const p of flags) {
      // All param flags take a value — booleans included, so the CLI can pass
      // `--enabled false` / `--value true` explicitly (a bare flag couldn't set
      // false). camelCase param name → kebab flag; commander camelCases it back
      // to exactly `p.name`, so `coerceInput` reads it off `opts` unchanged.
      cmd.option(`--${toKebab(p.name)} <value>`, p.description);
    }
    cmd.option("--json", "Output as JSON");
    cmd.option("--project <id>", "Project ID override");

    cmd.action(async (...argv: unknown[]) => {
      try {
        // commander calls action(pos1, pos2, …, opts, command). Pull opts off the tail.
        const opts = (argv.find((a) => a && typeof a === "object" && !Array.isArray(a)) ??
          {}) as Record<string, unknown>;
        const raw: Record<string, unknown> = { ...opts };
        positionals.forEach((p, i) => {
          raw[p.name] = argv[i];
        });

        const input = coerceInput(op, raw);
        const client = ctx.getClient({
          mutates: op.mutates,
          projectOverride: opts.project as string | undefined,
        });
        const data = await op.run(client, input);

        if (opts.json) ctx.printJson(data);
        else ctx.printResult(op, data, input);
      } catch (e) {
        ctx.onError(e);
      }
    });
  }
}
