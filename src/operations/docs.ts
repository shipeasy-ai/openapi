import type { Operation } from "./types.js";

/**
 * Render the registry to Markdown — the "documentation comes along for free"
 * half of the proposal. Both `cli/scripts/gen-cli-docs.ts` and
 * `mcp/scripts/gen-mcp-docs.ts` can call this instead of re-describing every
 * command/tool by hand, so help text, tool descriptions, and the docs site all
 * derive from the same `summary`/`description`/`params`/`examples`.
 */
export function renderOperationsMarkdown(ops: Operation[], opts: { title?: string } = {}): string {
  const lines: string[] = [];
  if (opts.title) lines.push(`# ${opts.title}`, "");

  for (const op of ops) {
    lines.push(`## \`${op.id}\``, "");
    lines.push(op.summary, "");
    if (op.description && op.description !== op.summary) lines.push(op.description, "");
    lines.push(
      `- **CLI:** \`shipeasy ${op.resource} ${op.cliName}\`  ·  **MCP tool:** \`${op.mcpName}\`  ·  ${op.mutates ? "write (needs project binding)" : "read"}`,
      "",
    );

    if (op.params.length) {
      lines.push("| Param | Type | Required | Description |", "| --- | --- | --- | --- |");
      for (const p of op.params) {
        const kind = p.positional ? `${p.type} (positional)` : p.type;
        lines.push(`| \`${p.name}\` | ${kind} | ${p.required ? "yes" : "no"} | ${p.description} |`);
      }
      lines.push("");
    }

    if (op.examples?.length) {
      lines.push("**Examples**", "");
      for (const ex of op.examples) {
        if (ex.note) lines.push(`- ${ex.note}:`);
        lines.push("```sh", ex.run, "```");
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
