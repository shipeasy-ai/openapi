import type { AdminClient } from "../resources/index.js";
import type { Operation, OpInput } from "./types.js";

/**
 * Project operations — `projects …`. `current` is the first command unlocked by
 * the fs consumer-context extraction (§A4.2): the server resolves the project
 * from the auth header, so the op needs nothing but the session and powers a
 * registry-driven `whoami` on both surfaces.
 *
 * Both ops are marked `mutates: false` on purpose: they operate at the account
 * level (resolved from the credential), NOT against the `.shipeasy`-bound
 * project, so the binding guard must not fire. `upsert` is idempotent
 * find-or-create — you typically run it precisely because no binding exists yet.
 * The `.shipeasy` write is a CONSUMER side-effect layered after the op (CLI
 * `bindProject`, MCP `.shipeasy` write), never part of the worker-safe op.
 */

const GROUP = ["projects"];

export const projectOperations: Operation[] = [
  {
    group: GROUP,
    name: "current",
    mutates: false,
    summary: "Show the current project",
    description:
      "Return the project the session resolves to (plan, status, enabled modules, billing). " +
      "The server reads the project from the auth header — no id needed. Powers `whoami`.",
    params: [],
    examples: [{ run: "shipeasy projects current" }],
    run: (client: AdminClient) => client.projects.current(),
  },
  {
    group: GROUP,
    name: "upsert",
    mutates: false,
    summary: "Find-or-create a project by domain",
    description:
      "Find-or-create a project by domain (idempotent), under the session's owner. Returns the " +
      "project. The `.shipeasy` bind that records the result locally is a consumer side-effect " +
      "layered on top of this op — it is not performed here.",
    params: [
      { name: "domain", type: "string", description: "Hostname-like project identifier (e.g. acme.com).", required: true },
      { name: "name", type: "string", description: "Human-readable name (defaults to the domain on first create)." },
    ],
    examples: [
      { note: "Find-or-create by domain", run: "shipeasy projects upsert --domain acme.com" },
      { note: "Name it explicitly", run: 'shipeasy projects upsert --domain shouks.app --name "Shouks"' },
    ],
    run: (client: AdminClient, i: OpInput) =>
      client.projects.upsert({
        domain: i.domain as string,
        ...(i.name ? { name: i.name as string } : {}),
      }),
  },
];
