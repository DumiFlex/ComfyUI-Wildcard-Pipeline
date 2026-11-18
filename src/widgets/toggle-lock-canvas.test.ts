import { describe, expect, it } from "vitest";
import type { LiteGraphLike, LiteNodeLike } from "../extension/graph";
import { assignCodenames } from "../extension/node-codename";
import { nodeLastPicks, nodeLastUsedPerModule } from "../extension/_stashes";
import { applyLockActions, lockChoices, missingLocksOnCanvas } from "./toggle-lock-canvas";
import type { ContextWidgetValue } from "./_shared";

function contextNode(id: number, uids: string[]): LiteNodeLike {
  const value: ContextWidgetValue = {
    version: 1,
    modules: uids.map((u) => ({ id: `id${u}`, _uid: u, type: "wildcard", enabled: true, meta: { name: `Row ${u}` }, entries: [] })),
  };
  return { id, type: "WP_Context", title: "WP Context", widgets: [{ name: "wp_modules", value: JSON.stringify(value) }] };
}
const read = (n: LiteNodeLike): ContextWidgetValue => JSON.parse(String(n.widgets?.[0]?.value)) as ContextWidgetValue;

describe("toggle lock on the canvas", () => {
  const ctx = contextNode(3, ["a", "b"]);
  const toggles: LiteNodeLike = {
    id: 9,
    type: "WP_Toggles",
    widgets: [{ name: "wp_toggles", value: JSON.stringify({
      version: 1, mode: "any", group_var: "",
      rows: [{ id: "t1", kind: "toggle", name: "L", var: "l", on: true, lock: "seed", lock_targets: [{ node: "gone-node", uid: "x" }] }],
    }) }],
  };
  const root = { _nodes: [ctx, toggles] } as unknown as LiteGraphLike;
  const code = assignCodenames([3]).get("3") ?? "";

  it("offers every row by codename", () => {
    expect(lockChoices(root).map((c) => c.label)).toEqual([`${code} · WP Context · Row a`, `${code} · WP Context · Row b`]);
  });

  it("locks from the last run and lets go again", () => {
    nodeLastUsedPerModule.set(ctx, { a: 41 });
    nodeLastPicks.set(ctx, { all: { b: "opt" }, frames: new Map() });
    const target = [{ node: code, uid: "a" }, { node: code, uid: "b" }];
    const done = applyLockActions(root, 9, [{ toggleId: "t1", release: [], lock: target, mode: "value" }]);
    expect(done.locked).toBe(2);
    const [a, b] = read(ctx).modules;
    expect(a?.instance?.locked_seed).toBe(41);
    expect(b?.instance?.locked_option_id).toBe("opt");
    expect(b?.instance?._ui?.locked_by).toBe("toggles:9:t1");
    const back = applyLockActions(root, 9, [{ toggleId: "t1", release: target, lock: [], mode: "value" }]);
    expect(back.released).toBe(2);
    expect(read(ctx).modules.every((m) => m.instance?.locked_seed === undefined && m.instance?.locked_option_id === undefined)).toBe(true);
  });

  it("reports toggles nodes with missing targets", () => {
    expect(missingLocksOnCanvas(root).map((m) => [m.node.id, m.count])).toEqual([[9, 1]]);
  });
});
