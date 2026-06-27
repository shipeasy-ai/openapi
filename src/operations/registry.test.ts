import { describe, it, expect, vi } from "vitest";
import type { AdminClient } from "../resources/index.js";
import { ALL_OPERATIONS } from "./index.js";
import { operationsToDispatch, operationsToMcpTools } from "./mcp-adapter.js";
import { opCli, opMcpName } from "./types.js";

/** Whole-registry invariants + the facade→wire mappings unique to each sibling resource. */

describe("release module registry", () => {
  it("MCP tool names are unique and mirror the CLI path", () => {
    const tools = operationsToMcpTools(ALL_OPERATIONS);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // no collisions
    // every MCP name is the CLI path with spaces → underscores
    for (const op of ALL_OPERATIONS) {
      expect(opMcpName(op)).toBe(opCli(op).replaceAll(" ", "_"));
      expect(opMcpName(op).startsWith("release_")).toBe(true);
    }
  });

  it("uses 'archive' for every destructive op — never 'delete'", () => {
    expect(ALL_OPERATIONS.some((o) => o.name === "delete")).toBe(false);
    const archives = ALL_OPERATIONS.filter((o) => o.name === "archive").map(opMcpName);
    expect(archives).toEqual([
      "release_flags_archive",
      "release_killswitch_archive",
      "release_configs_archive",
      "release_experiments_archive",
      "release_experiments_universes_archive",
    ]);
  });

  it("covers all five resources", () => {
    const groups = new Set(ALL_OPERATIONS.map((o) => o.group.join(" ")));
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
        resolve: vi.fn().mockResolvedValue({ id: "exp_1", name: "p" }),
        restore: vi.fn().mockResolvedValue({ id: "exp_1", status: "draft" }),
        get: vi
          .fn()
          .mockResolvedValue({ id: "exp_1", name: "p", status: "running", significance_threshold: 0.05 }),
        results: vi.fn().mockResolvedValue([{ group_name: "test", p_value: 0.01, srm_detected: 0 }]),
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

  it("experiment create: allocation% → basis points, defaults applied", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_create(c, { name: "p", allocation: 50 });
    expect(c.experiments.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "p", universe: "default", allocation_pct: 5000 }),
    );
  });

  it("experiment restore: resolves name then restores by id (archived → draft)", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_restore(c, { name: "p" });
    expect(c.experiments.resolve).toHaveBeenCalledWith("p");
    expect(c.experiments.restore).toHaveBeenCalledWith("exp_1");
  });

  it("experiment create: builds an inline goal metric from successEvent", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    await d.release_experiments_create(c, {
      name: "p",
      successEvent: "purchase",
      successAggregation: "sum",
      successValue: "amount",
    });
    expect(c.experiments.create).toHaveBeenCalledWith(
      expect.objectContaining({ goal_metric: { query: "sum(purchase, amount)" } }),
    );
  });

  it("experiment status: returns a ship verdict when p < threshold", async () => {
    const c = client();
    const d = operationsToDispatch(ALL_OPERATIONS);
    const out = (await d.release_experiments_status(c, { name: "p" })) as { verdict: string };
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
