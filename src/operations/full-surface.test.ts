import { describe, it, expect, vi } from "vitest";
import type { AdminClient } from "../resources/index.js";
import { ALL_OPERATIONS } from "./index.js";
import { operationsToDispatch } from "./mcp-adapter.js";

/** Facade→wire mappings for the full-surface modules (metrics, events, ops, projects, i18n, docs). */

function stubClient() {
  const stub = {
    metrics: {
      list: vi.fn().mockResolvedValue([]),
      resolve: vi.fn().mockResolvedValue({ id: "met_1", name: "checkouts" }),
      create: vi.fn().mockResolvedValue({ id: "met_1", name: "checkouts" }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
    },
    events: {
      list: vi.fn().mockResolvedValue([
        { id: "evt_1", name: "a", pending: 1 },
        { id: "evt_2", name: "b", pending: 0 },
      ]),
      create: vi.fn().mockResolvedValue({ id: "evt_1", name: "purchase" }),
    },
    ops: {
      list: vi.fn().mockResolvedValue([{ id: "fb_1", priority: "high" }]),
      create: vi.fn().mockResolvedValue({ id: "fb_1", number: 7 }),
      update: vi.fn().mockResolvedValue({ id: "fb_1" }),
      notify: vi.fn().mockResolvedValue({ dedupeKey: "feedback:7", dispatched: true }),
      channels: vi
        .fn()
        .mockResolvedValue({ connected: true, channels: [{ id: "C1", name: "incidents" }] }),
    },
    alertRules: {
      create: vi.fn().mockResolvedValue({ id: "ar_1" }),
      resolve: vi.fn().mockResolvedValue({ id: "ar_1", name: "high", notify: null }),
    },
    projects: {
      current: vi.fn().mockResolvedValue({ id: "proj_1", name: "acme" }),
      upsert: vi.fn().mockResolvedValue({ id: "proj_1", created: true }),
    },
    i18n: {
      resolveProfile: vi.fn().mockResolvedValue({ id: "prof_1", name: "en:prod" }),
      pushKeys: vi.fn().mockResolvedValue({ added: ["home.cta"], skipped: [] }),
      updateKeyByName: vi.fn().mockResolvedValue({ id: "key_1" }),
      publish: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  return stub as unknown as AdminClient & typeof stub;
}

const d = operationsToDispatch(ALL_OPERATIONS);

describe("metrics module", () => {
  it("grammar is pure — returns the DSL grammar without touching the client", async () => {
    const c = stubClient();
    const out = (await d.metrics_grammar(c, {})) as { grammar: string };
    expect(out.grammar).toContain("metric query DSL");
    expect(c.metrics.list).not.toHaveBeenCalled();
  });

  it("create threads event + DSL query through with winsorize default 99", async () => {
    const c = stubClient();
    await d.metrics_create(c, { name: "checkouts", event: "checkout_completed", query: "count_users(checkout_completed)" });
    expect(c.metrics.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "checkouts",
        event_name: "checkout_completed",
        query: "count_users(checkout_completed)",
        winsorize_pct: 99,
      }),
    );
  });

  it("archive resolves name then soft-deletes by id", async () => {
    const c = stubClient();
    await d.metrics_archive(c, { metric: "checkouts" });
    expect(c.metrics.resolve).toHaveBeenCalledWith("checkouts");
    expect(c.metrics.delete).toHaveBeenCalledWith("met_1");
  });
});

describe("events module", () => {
  it("list --pending filters to the unapproved queue", async () => {
    const c = stubClient();
    const out = (await d.events_list(c, { pending: "true" })) as { pending: number }[];
    expect(out).toHaveLength(1);
    expect(out[0].pending).toBe(1);
  });

  it("create parses props JSON into the properties array", async () => {
    const c = stubClient();
    await d.events_create(c, { name: "purchase", props: '[{"name":"amount","type":"number","required":true}]' });
    expect(c.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "purchase",
        properties: [{ name: "amount", type: "number", required: true }],
      }),
    );
  });
});

describe("ops module", () => {
  it("create routes a bug to the bug endpoint via the resource", async () => {
    const c = stubClient();
    await d.ops_create(c, { type: "bug", title: "Checkout 500s" });
    expect(c.ops.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bug", title: "Checkout 500s" }),
    );
  });

  it("notify derives a feedback:<n> dedupe key from --item", async () => {
    const c = stubClient();
    await d.ops_notify(c, { title: "Blocked", summary: "needs migration", item: "#7" });
    expect(c.ops.notify).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "feedback:7" }),
    );
  });

  it("alerts create resolves metric + Slack channel into the rule", async () => {
    const c = stubClient();
    await d.ops_alerts_create(c, {
      name: "high",
      metric: "api-errors",
      comparator: "gt",
      threshold: 50,
      slackChannel: "#incidents",
    });
    expect(c.metrics.resolve).toHaveBeenCalledWith("api-errors");
    expect(c.alertRules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metricId: "met_1",
        comparator: "gt",
        threshold: 50,
        windowHours: 24,
        notify: { slackChannel: { id: "C1", name: "incidents" }, email: null },
      }),
    );
  });
});

describe("projects module", () => {
  it("current is read-only and hits projects.current()", async () => {
    const c = stubClient();
    await d.projects_current(c, {});
    expect(c.projects.current).toHaveBeenCalled();
  });
});

describe("i18n module", () => {
  it("push resolves the profile by name then inserts keys", async () => {
    const c = stubClient();
    await d.i18n_push(c, { profile: "en:prod", keys: '[{"key":"home.cta","value":"Go"}]' });
    expect(c.i18n.resolveProfile).toHaveBeenCalledWith("en:prod");
    expect(c.i18n.pushKeys).toHaveBeenCalledWith({
      profile_id: "prof_1",
      chunk: "default",
      keys: [{ key: "home.cta", value: "Go" }],
    });
  });

  it("update resolves profile + key by name", async () => {
    const c = stubClient();
    await d.i18n_update(c, { key: "home.cta", value: "Go", profile: "en:prod" });
    expect(c.i18n.updateKeyByName).toHaveBeenCalledWith("prof_1", "home.cta", { value: "Go" });
  });
});

describe("docs module", () => {
  it("get falls back to the built-in default set when the manifest 404s", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const c = stubClient();
    const out = (await d.docs_get(c, { sdk: "python", path: "overview" })) as {
      fallback: boolean;
      content: string;
    };
    expect(out.fallback).toBe(true);
    expect(out.content).toContain("Shipeasy SDK");
    vi.unstubAllGlobals();
  });

  it("get substitutes {{RESOURCE_NAME}} from --name in the fallback snippet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const c = stubClient();
    const out = (await d.docs_get(c, { sdk: "typescript", path: "release/flags", name: "checkout_v2" })) as {
      content: string;
    };
    expect(out.content).toContain("checkout_v2");
    vi.unstubAllGlobals();
  });
});
