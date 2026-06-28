import { describe, it, expect, vi } from "vitest";
import type { AdminClient } from "../resources/index.js";
import { ALL_OPERATIONS, RELEASE_OPERATIONS } from "./index.js";
import { operationsToDispatch, operationsToMcpTools } from "./mcp-adapter.js";
import { opCli, opMcpName } from "./types.js";

/** Whole-registry invariants + the facade→wire mappings unique to each sibling resource. */

describe("full registry", () => {
  it("MCP tool names are unique and mirror the CLI path (spaces → underscores)", () => {
    const tools = operationsToMcpTools(ALL_OPERATIONS);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // no collisions across all modules
    for (const op of ALL_OPERATIONS) {
      expect(opMcpName(op)).toBe(opCli(op).replaceAll(" ", "_"));
    }
  });

  it("uses 'archive' for every destructive op — never 'delete'", () => {
    expect(ALL_OPERATIONS.some((o) => o.name === "delete")).toBe(false);
  });

  it("spans every migrated module", () => {
    const topLevel = new Set(ALL_OPERATIONS.map((o) => o.group[0]));
    expect([...topLevel].sort()).toEqual([
      "attributes",
      "docs",
      "events",
      "i18n",
      "metrics",
      "ops",
      "projects",
      "release",
    ]);
  });
});

describe("release module registry", () => {
  it("every release op's MCP name starts with release_", () => {
    for (const op of RELEASE_OPERATIONS) {
      expect(opMcpName(op).startsWith("release_")).toBe(true);
    }
  });

  it("release archives are the five soft-deletes", () => {
    const archives = RELEASE_OPERATIONS.filter((o) => o.name === "archive").map(opMcpName);
    expect(archives).toEqual([
      "release_flags_archive",
      "release_killswitch_archive",
      "release_configs_archive",
      "release_experiments_archive",
      "release_experiments_universes_archive",
    ]);
  });

  it("covers all five resources", () => {
    const groups = new Set(RELEASE_OPERATIONS.map((o) => o.group.join(" ")));
    expect([...groups].sort()).toEqual([
      "release configs",
      "release experiments",
      "release experiments universes",
      "release flags",
      "release killswitch",
    ]);
  });
});

describe("sibling facade→wire mappings", () => {
  function client() {
    const stub = {
      killswitches: {
        resolve: vi.fn().mockResolvedValue({ id: "ks_1" }),
        setSwitch: vi.fn().mockResolvedValue({ ok: true }),
        create: vi.fn().mockResolvedValue({ id: "ks_1", name: "x" }),
      },
      configs: {
        resolve: vi.fn().mockResolvedValue({ id: "cfg_1" }),
        saveDraft: vi.fn().mockResolvedValue({ ok: true }),
      },
      experiments: {
        create: vi.fn().mockResolvedValue({ id: "exp_1" }),
        update: vi.fn().mockResolvedValue({ id: "exp_1" }),
        restore: vi.fn().mockResolvedValue({ id: "exp_1", status: "draft" }),
        // `/results` now carries the server-computed verdict; the status op is a
        // pure pass-through of this bundle.
        results: vi.fn().mockResolvedValue({
          experiment: { id: "exp_1", name: "p", status: "running" },
          results: [],
          verdict: "ship",
        }),
      },
      universes: {
        create: vi.fn().mockResolvedValue({ id: "uni_1" }),
      },
    };
    return stub as unknown as AdminClient & typeof stub;
  }

  it("killswitch set: resolves name, defaults env=prod, coerces value bool", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_killswitch_set(c, { name: "payments.x", switchKey: "refunds", value: "true" });
    expect(c.killswitches.setSwitch).toHaveBeenCalledWith("ks_1", {
      env: "prod",
      switchKey: "refunds",
      value: true,
    });
  });

  it("killswitch create: switches JSON parsed, value defaults false", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_killswitch_create(c, { name: "a.b", switches: '{"refunds":true}' });
    expect(c.killswitches.create).toHaveBeenCalledWith({
      name: "a.b",
      description: undefined,
      value: false,
      switches: { refunds: true },
    });
  });

  it("config draft: env + JSON value threaded through", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_configs_draft(c, { name: "pricing", env: "prod", value: '{"days":30}' });
    expect(c.configs.saveDraft).toHaveBeenCalledWith("cfg_1", { env: "prod", value: { days: 30 } });
  });

  it("experiment create: forwards allocation as percent (server converts to bp)", async () => {
    // Pass-through: the registry forwards `allocation_percent` (0–100); the
    // server does the %→basis-points conversion (was Math.round(pct*100) here).
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_create(c, { name: "p", allocation: 50 });
    expect(c.experiments.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "p", universe: "default", allocation_percent: 50 }),
    );
  });

  it("experiment restore: passes the name through (server resolves name-or-id)", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_restore(c, { name: "p" });
    // No client-side resolve() — the {id} route accepts the name directly.
    expect(c.experiments.restore).toHaveBeenCalledWith("p");
  });

  it("experiment create: forwards the goal metric in event form (server compiles DSL)", async () => {
    // Pass-through: the successEvent/Aggregation/Value trio is forwarded as the
    // server's inline event form; the server builds the DSL (was buildGoalMetric).
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_create(c, {
      name: "p",
      successEvent: "purchase",
      successAggregation: "sum",
      successValue: "amount",
    });
    expect(c.experiments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        goal_metric: { event: "purchase", aggregation: "sum", value: "amount" },
      }),
    );
  });

  it("experiment status: passes through the server verdict from /results", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    const out = (await d.release_experiments_status(c, { name: "p" })) as { verdict: string };
    // The verdict is the server's, read off the results bundle (was computeVerdict).
    expect(c.experiments.results).toHaveBeenCalledWith("p");
    expect(out.verdict).toBe("ship");
  });

  it("universe create: 'lo,hi' holdout string → tuple", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_universes_create(c, { name: "web", holdout: "0,999" });
    expect(c.universes.create).toHaveBeenCalledWith({
      name: "web",
      unit_type: "user_id",
      holdout_range: [0, 999],
    });
  });
});
