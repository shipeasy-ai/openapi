import { describe, it, expect, vi } from "vitest";
import type { AdminClient } from "../resources/index.js";
import { gateOperations } from "./gates.js";
import { operationsToMcpTools, operationsToDispatch } from "./mcp-adapter.js";
import { mountOperations } from "./cli-adapter.js";
import { renderOperationsMarkdown } from "./docs.js";
import type { CommandLike, CliContext } from "./types.js";

/**
 * Proof that ONE registry (`gateOperations`) drives the MCP tool catalog, the
 * commander command tree, and the docs — with the facade→wire mapping
 * (percent → basis points, JSON.parse(rules)) executed exactly once.
 */

// Minimal AdminClient stub — only the gate methods the ops touch.
function mockClient() {
  const gates = {
    listAll: vi.fn().mockResolvedValue([{ id: "g1", name: "checkout_v2" }]),
    resolve: vi.fn().mockResolvedValue({ id: "gat_123", name: "checkout_v2" }),
    create: vi.fn().mockResolvedValue({ id: "gat_new", name: "checkout_v2" }),
    update: vi.fn().mockResolvedValue({ id: "gat_123" }),
    enable: vi.fn().mockResolvedValue({ id: "gat_123", enabled: true }),
    disable: vi.fn().mockResolvedValue({ id: "gat_123", enabled: false }),
    setRollout: vi.fn().mockResolvedValue({ id: "gat_123" }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  };
  return { gates } as unknown as AdminClient & { gates: typeof gates };
}

describe("gate operations → MCP", () => {
  it("emits one tool per op with valid JSON-schema input", () => {
    const tools = operationsToMcpTools(gateOperations);
    expect(tools.map((t) => t.name)).toEqual([
      "exp_list_gates",
      "exp_create_gate",
      "exp_update_gate",
      "exp_enable_gate",
      "exp_disable_gate",
      "exp_set_gate_rollout",
      "exp_delete_gate",
    ]);

    const create = tools.find((t) => t.name === "exp_create_gate")!;
    expect(create.inputSchema.type).toBe("object");
    expect(create.inputSchema.required).toEqual(["name"]);
    // `json` params surface as strings (the LLM stringifies nested structures).
    expect(create.inputSchema.properties.rules.type).toBe("string");
    expect(create.inputSchema.properties.rollout.type).toBe("number");
  });

  it("dispatch coerces facade input and maps percent → basis points exactly once", async () => {
    const client = mockClient();
    const dispatch = operationsToDispatch(gateOperations);

    await dispatch.exp_create_gate(client, {
      name: "checkout_v2",
      rollout: 25,
      rules: '[{"attr":"plan","op":"eq","value":"pro"}]',
    });

    expect(client.gates.create).toHaveBeenCalledWith({
      name: "checkout_v2",
      rollout_pct: 2500, // 25% → 2500 bp, the mapping that used to live in 2 places
      rules: [{ attr: "plan", op: "eq", value: "pro" }], // JSON string parsed once
    });
  });

  it("update resolves by name then patches only supplied fields", async () => {
    const client = mockClient();
    const dispatch = operationsToDispatch(gateOperations);
    await dispatch.exp_update_gate(client, { name: "checkout_v2", rollout: 50, enabled: false });
    expect(client.gates.resolve).toHaveBeenCalledWith("checkout_v2");
    expect(client.gates.update).toHaveBeenCalledWith("gat_123", {
      rollout_pct: 5000,
      enabled: false,
    });
  });

  it("rejects malformed JSON and missing required params", async () => {
    const client = mockClient();
    const dispatch = operationsToDispatch(gateOperations);
    await expect(dispatch.exp_create_gate(client, { name: "x", rules: "not json" })).rejects.toThrow(
      /valid JSON/,
    );
    await expect(dispatch.exp_create_gate(client, {})).rejects.toThrow(/name is required/);
  });
});

describe("gate operations → CLI", () => {
  // Record what the adapter registers on a commander-like stub.
  function fakeProgram() {
    const registered: { signature: string; description?: string; options: string[]; action?: (...a: unknown[]) => unknown }[] = [];
    const make = (): CommandLike => {
      let current: (typeof registered)[number];
      const node: CommandLike = {
        command(sig: string) {
          current = { signature: sig, options: [] };
          registered.push(current);
          return node;
        },
        description(text: string) {
          current.description = text;
          return node;
        },
        option(flags: string) {
          current.options.push(flags);
          return node;
        },
        action(fn) {
          current.action = fn;
          return node;
        },
      };
      return node;
    };
    return { group: make(), registered };
  }

  it("mounts one commander subcommand per op with positional + flag params", () => {
    const { group, registered } = fakeProgram();
    const ctx: CliContext = {
      getClient: () => mockClient(),
      printJson: vi.fn(),
      printResult: vi.fn(),
      onError: vi.fn(),
    };
    mountOperations(group, gateOperations, ctx);

    const sigs = registered.map((r) => r.signature);
    expect(sigs).toContain("create <name>");
    expect(sigs).toContain("rollout <name> <pct>"); // two positionals
    expect(sigs).toContain("list");

    const create = registered.find((r) => r.signature === "create <name>")!;
    expect(create.options).toContain("--rollout <value>");
    expect(create.options).toContain("--rules <value>");
    expect(create.options).toContain("--json"); // injected by the adapter
  });

  it("a mounted action coerces args and runs the op against the resolved client", async () => {
    const { group, registered } = fakeProgram();
    const client = mockClient();
    const printResult = vi.fn();
    const ctx: CliContext = {
      getClient: () => client,
      printJson: vi.fn(),
      printResult,
      onError: (e) => {
        throw e;
      },
    };
    mountOperations(group, gateOperations, ctx);

    // commander would call: action(name, opts, command)
    const create = registered.find((r) => r.signature === "create <name>")!;
    await create.action!("checkout_v2", { rollout: "25" });

    expect(client.gates.create).toHaveBeenCalledWith({
      name: "checkout_v2",
      rollout_pct: 2500, // SAME mapping as the MCP path — defined once
      rules: [],
    });
    expect(printResult).toHaveBeenCalled();
  });
});

describe("gate operations → docs", () => {
  it("renders a section + param table + examples per op", () => {
    const md = renderOperationsMarkdown(gateOperations, { title: "Gates" });
    expect(md).toContain("# Gates");
    expect(md).toContain("## `gates.create`");
    expect(md).toContain("| Param | Type | Required | Description |");
    expect(md).toContain("exp_create_gate"); // MCP tool name cross-referenced
    expect(md).toContain("shipeasy gates create checkout-v2");
  });
});
