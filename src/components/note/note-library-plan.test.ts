import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../widgets/_shared";
import { parseCheckedPayload } from "../../manager/import-export/shape-check";
import { MAX_KNOWN_SCHEMA_VERSION } from "../../manager/import-export/migrations";
import {
  buildInstall, buildPlan, buttonHint, choicesFor, countLabel, rebindContext,
  type BundleVerdict, type ContextSource, type ModuleVerdict, type Verdicts,
} from "./note-library-plan";

function wc(id: string, name: string, extra: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id, _uid: `u${id}`, type: "wildcard", enabled: true, meta: { name }, entries: [],
    payload: { var_binding: name.toLowerCase(), options: [{ id: `o${id}`, value: name, weight: 1 }] },
    payload_hash: `h${id}`, ...extra,
  } as ModuleEntry;
}

function bundle(uid: string, libraryId: string, start: number, end: number, extra: Partial<BundleInstance> = {}): BundleInstance {
  return {
    _uid: uid, library_id: libraryId, start_idx: start, end_idx: end, enabled: true, collapsed: false,
    inserted_at_hash: "", name: `B${libraryId}`, color: null, parent_uid: null, ...extra,
  };
}

function verdicts(mods: Record<string, ModuleVerdict>, bundles: Record<string, BundleVerdict> = {}): Verdicts {
  return {
    module: (m) => mods[m.id] ?? (m.payload_hash ? "missing" : "local"),
    bundle: (b) => bundles[b.library_id] ?? "missing",
  };
}

function counter(): () => string {
  let n = 0;
  return () => `f${String(++n).padStart(7, "0")}`;
}

const ctx = (key: string, value: Partial<ContextWidgetValue>): ContextSource => ({
  key, value: { version: 1, modules: [], ...value },
});

describe("buildPlan", () => {
  it("sorts rows into new, different and taken, leaving out local and same rows", () => {
    const plan = buildPlan([ctx("1", {
      modules: [wc("aaaaaaaa", "Hero"), wc("bbbbbbbb", "Mood"), wc("cccccccc", "Odd"), wc("dddddddd", "Same"), wc("eeeeeeee", "Local", { payload_hash: "" })],
    })], verdicts({ bbbbbbbb: "different", cccccccc: "taken", dddddddd: "same" }), counter());
    expect(plan.items.map((i) => [i.name, i.state])).toEqual([["Hero", "new"], ["Mood", "different"], ["Odd", "taken"]]);
    expect(plan.already).toBe(1);
  });

  it("adds a bundle or module once when two Contexts hold it", () => {
    const value = { modules: [wc("aaaaaaaa", "Hero")], bundles: [bundle("b1", "11111111", 0, 0)] };
    const plan = buildPlan([ctx("1", value), ctx("2", value)], verdicts({}), counter());
    expect(plan.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["bundle:11111111", "module:aaaaaaaa"]);
  });

  it("lists examples first and bundles before modules", () => {
    const plan = buildPlan([ctx("1", {
      modules: [wc("aaaaaaaa", "Plain"), wc("bbbbbbbb", "Ex", { example: true })],
      bundles: [bundle("b1", "11111111", 0, 0)],
    })], verdicts({}), counter());
    expect(plan.items.map((i) => i.name)).toEqual(["Ex", "B11111111", "Plain"]);
  });

  it("gives an unlinked bundle an id, and its outer bundle refers to it by that id", () => {
    const modules = [wc("aaaaaaaa", "A", { bundle_origin: "outer" } as Partial<ModuleEntry>), wc("bbbbbbbb", "B", { bundle_origin: "inner" } as Partial<ModuleEntry>)];
    const plan = buildPlan([ctx("9", {
      modules,
      bundles: [bundle("outer", "11111111", 0, 1), bundle("inner", "", 1, 1, { parent_uid: "outer", name: "Inner" })],
    })], verdicts({}), counter());
    expect(plan.minted).toEqual([{ context: "9", uid: "inner", id: "f0000001" }]);
    const outer = plan.items.find((i) => i.id === "11111111");
    expect(outer?.entity.children).toEqual([
      expect.objectContaining({ id: "aaaaaaaa", type: "wildcard" }),
      { id: "f0000001", type: "bundle", name: "Inner", color: null },
    ]);
    expect(plan.items.find((i) => i.id === "f0000001")?.state).toBe("new");
  });

  it("names a module by its library name and keeps its description and tags", () => {
    const plan = buildPlan([ctx("1", {
      modules: [wc("aaaaaaaa", "Renamed", { meta: { name: "Renamed", library_name: "Hero", description: "who", tags: ["x"] } })],
    })], verdicts({}), counter());
    expect(plan.items[0]?.entity).toMatchObject({ id: "aaaaaaaa", type: "wildcard", name: "Hero", description: "who", tags: ["x"] });
  });
});

describe("choices and labels", () => {
  it("never offers Replace on an id another kind holds", () => {
    expect(choicesFor("new")).toEqual(["add"]);
    expect(choicesFor("different")).toEqual(["skip", "replace", "copy"]);
    expect(choicesFor("taken")).toEqual(["copy", "skip"]);
  });

  it("counts and hints", () => {
    expect(countLabel([{ kind: "bundle" }, { kind: "module" }, { kind: "module" }])).toBe("1 bundle and 2 modules");
    expect(countLabel([])).toBe("nothing");
    const plan = buildPlan([ctx("1", { modules: [wc("aaaaaaaa", "A"), wc("bbbbbbbb", "B")] })], verdicts({ bbbbbbbb: "different" }), counter());
    expect(buttonHint(plan, "workflow")).toBe("Add 1 module from this workflow to your library; 1 already there with other content");
    expect(buttonHint({ items: [], already: 3, minted: [] }, "context")).toBe("Already in your library");
    expect(buttonHint({ items: [], already: 0, minted: [] }, "context")).toBe("Nothing in this WP Context to add");
  });
});

describe("buildInstall", () => {
  const constraint: ModuleEntry = {
    id: "cccccccc", _uid: "uc", type: "constraint", enabled: true, meta: { name: "Rule" }, entries: [],
    payload: { source_wildcard_id: "aaaaaaaa", target_wildcard_id: "bbbbbbbb", rules: [] }, payload_hash: "hc",
  } as unknown as ModuleEntry;

  it("defaults to adding new rows and keeping the library's copy of a different one", () => {
    const plan = buildPlan([ctx("1", { modules: [wc("aaaaaaaa", "A"), wc("bbbbbbbb", "B")] })], verdicts({ bbbbbbbb: "different" }), counter());
    const build = buildInstall(plan, {}, counter(), 9);
    expect(build.count).toBe(1);
    expect((build.envelope.wildcards as Array<{ id: string }>).map((w) => w.id)).toEqual(["aaaaaaaa"]);
    expect(build.replace).toEqual([]);
  });

  it("Replace keeps the id; Keep both copies under a new id and references follow", () => {
    const modules = [wc("aaaaaaaa", "A", { bundle_origin: "b" } as Partial<ModuleEntry>), wc("bbbbbbbb", "B"), constraint];
    const plan = buildPlan([ctx("1", { modules, bundles: [bundle("b", "11111111", 0, 0)] })],
      verdicts({ aaaaaaaa: "different", bbbbbbbb: "different" }), counter());
    const build = buildInstall(plan, { "module:aaaaaaaa": "copy", "module:bbbbbbbb": "replace" }, counter(), 9);
    expect(build.rename).toEqual({ aaaaaaaa: "f0000001" });
    expect(build.replace).toEqual(["bbbbbbbb"]);
    const wildcards = build.envelope.wildcards as Array<{ id: string; name: string }>;
    expect(wildcards.map((w) => [w.id, w.name])).toEqual([["f0000001", "A (copy)"], ["bbbbbbbb", "B"]]);
    const rule = (build.envelope.constraints as Array<{ payload: Record<string, unknown> }>)[0];
    expect(rule?.payload.source_wildcard_id).toBe("f0000001");
    const b = (build.envelope.bundles as Array<{ children: Array<{ id: string }> }>)[0];
    expect(b?.children[0]?.id).toBe("f0000001");
  });

  it("gives an id that isn't 8 hex digits a new one, without calling it a copy", () => {
    const plan = buildPlan([ctx("1", { modules: [wc("hero", "Hero")] })], verdicts({}), counter());
    const build = buildInstall(plan, {}, counter(), 9);
    expect(build.rename).toEqual({ hero: "f0000001" });
    expect((build.envelope.wildcards as Array<{ id: string; name: string }>)[0]).toMatchObject({ id: "f0000001", name: "Hero" });
  });

  it("builds an envelope the Import tab's checks accept, from the shipped example workflow", () => {
    const wf = JSON.parse(readFileSync(resolve(__dirname, "../../../example_workflows/1 - One image.json"), "utf8")) as {
      nodes: Array<{ type: string; widgets_values: unknown[] }>;
      definitions?: { subgraphs?: Array<{ nodes: Array<{ type: string; widgets_values: unknown[] }> }> };
    };
    const nodes = [...wf.nodes, ...(wf.definitions?.subgraphs ?? []).flatMap((s) => s.nodes)];
    const sources = nodes
      .filter((n) => n.type === "WP_Context")
      .map((n, i) => ctx(String(i), JSON.parse(String(n.widgets_values.find((v) => typeof v === "string" && v.startsWith("{")))) as ContextWidgetValue));
    expect(sources.length).toBeGreaterThan(0);
    const plan = buildPlan(sources, verdicts({}), counter());
    expect(plan.items.some((i) => i.kind === "bundle")).toBe(true);
    const build = buildInstall(plan, {}, counter(), MAX_KNOWN_SCHEMA_VERSION);
    const parsed = parseCheckedPayload(JSON.stringify(build.envelope));
    expect(parsed.ok ? "ok" : parsed.reason).toBe("ok");
  });
});

describe("rebindContext", () => {
  it("moves copies to their new ids, takes the library's hashes and drops EXAMPLE", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [wc("aaaaaaaa", "A", { example: true, bundle_origin: "b" } as Partial<ModuleEntry>), wc("bbbbbbbb", "B")],
      bundles: [bundle("b", "11111111", 0, 0, { example: true })],
    };
    const next = rebindContext("1", value, {
      rename: { bbbbbbbb: "f0000001" },
      minted: [],
      installedModules: new Map<string, unknown>([["aaaaaaaa", value.modules[0]?.payload], ["f0000001", value.modules[1]?.payload]]),
      installedBundles: new Set(["11111111"]),
      moduleHash: (id) => `live-${id}`,
      bundleHash: (id) => `blive-${id}`,
    });
    expect(next?.modules.map((m) => [m.id, m.payload_hash, m.example])).toEqual([
      ["aaaaaaaa", "live-aaaaaaaa", undefined],
      ["f0000001", "live-f0000001", undefined],
    ]);
    expect(next?.bundles?.[0]).toMatchObject({ library_id: "11111111", inserted_at_hash: "blive-11111111" });
    expect(next?.bundles?.[0]?.example).toBeUndefined();
    expect(next?.bundles?.[0]?.snapshot_fingerprint).toMatch(/^v2:/);
  });

  it("leaves a row whose content differs from what went in, and returns null when nothing moves", () => {
    const value: ContextWidgetValue = { version: 1, modules: [wc("aaaaaaaa", "A")] };
    const input = {
      rename: {}, minted: [], installedBundles: new Set<string>(),
      installedModules: new Map<string, unknown>([["aaaaaaaa", { other: true }]]),
      moduleHash: () => "x", bundleHash: () => "y",
    };
    expect(rebindContext("1", value, input)).toBeNull();
  });

  it("gives a minted bundle its id on its own Context only", () => {
    const value: ContextWidgetValue = { version: 1, modules: [wc("aaaaaaaa", "A")], bundles: [bundle("in", "", 0, 0)] };
    const input = {
      rename: {}, minted: [{ context: "2", uid: "in", id: "f0000009" }], installedBundles: new Set(["f0000009"]),
      installedModules: new Map<string, unknown>(), moduleHash: () => undefined, bundleHash: () => "bh",
    };
    expect(rebindContext("1", value, input)).toBeNull();
    expect(rebindContext("2", value, input)?.bundles?.[0]).toMatchObject({ library_id: "f0000009", inserted_at_hash: "bh" });
  });
});
