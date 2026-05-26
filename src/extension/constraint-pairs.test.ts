import { describe, it, expect } from "vitest";
import { computePairings, computePairingsFull, type ChainModule } from "./constraint-pairs";
import { varColorIndex } from "../components/shared/var-color";

function module_(id: string, type: string, payload: Record<string, unknown> = {}, rowKey?: string): ChainModule {
  return { id, rowKey: rowKey ?? id, type, payload };
}

/** Pair color hashed from `senderRowKey + ':' + targetUuid`, mirroring
 *  the production formula in `computePairingsFull`. Each (sender, target)
 *  pair maps to its own palette bucket. */
function colorForPair(senderRowKey: string, targetUuid: string): number {
  return varColorIndex(`${senderRowKey}:${targetUuid}`);
}

describe("computePairings", () => {
  it("returns empty map when no constraints", () => {
    const result = computePairings([
      module_("w1", "wildcard", { options: [], sub_categories: [] }),
    ]);
    expect(result.size).toBe(0);
  });

  it("solo case (1 constraint + 1 target) shows #1 / #1 pair", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }),
      module_("t1", "wildcard"),
    ];
    const result = computePairings(chain);
    const color = colorForPair("cn1", "t1");
    expect(result.get("cn1")).toEqual({ number: 1, targetUuid: "t1", colorIndex: color, isOrphan: false });
    expect(result.get("t1")).toEqual({ number: 1, targetUuid: "t1", colorIndex: color, isOrphan: false });
  });

  it("pairs N constraints with N target instances by chain order — keys by rowKey, not id", () => {
    // Two target instances share the same uuid `t1` — distinct rowKeys
    // keep them addressable on the returned badge map (real-world case:
    // library-deduped wildcards in a chain).
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn1#uid"),
      module_("cn2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn2#uid"),
      module_("t1", "wildcard", {}, "t1#uid-a"),
      module_("t1", "wildcard", {}, "t1#uid-b"),
    ];
    const result = computePairings(chain);
    const c1 = colorForPair("cn1#uid", "t1");
    const c2 = colorForPair("cn2#uid", "t1");
    expect(result.get("cn1#uid")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    expect(result.get("t1#uid-a")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    expect(result.get("cn2#uid")).toEqual({ number: 2, targetUuid: "t1", colorIndex: c2, isOrphan: false });
    expect(result.get("t1#uid-b")).toEqual({ number: 2, targetUuid: "t1", colorIndex: c2, isOrphan: false });
    // Distinct senders land on distinct palette buckets even though both
    // pairs target the same wildcard uuid — that's the whole point of
    // hashing on the sender+target combo.
    expect(c1).not.toBe(c2);
  });

  it("orphan constraint gets isOrphan: true + still numbers in the sequence", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }),
      module_("cn2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }),
      module_("t1", "wildcard"),
      // Only one downstream target — cn2 is orphan.
    ];
    const result = computePairings(chain);
    const c1 = colorForPair("cn1", "t1");
    const c2 = colorForPair("cn2", "t1");
    expect(result.get("cn1")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    expect(result.get("t1")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    expect(result.get("cn2")).toEqual({ number: 2, targetUuid: "t1", colorIndex: c2, isOrphan: true });
  });

  it("constraint with no target_wildcard_id is silently ignored (scanner flags it separately)", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1" }),  // no target
      module_("t1", "wildcard"),
    ];
    const result = computePairings(chain);
    expect(result.has("cn1")).toBe(false);
  });

  it("each target wildcard gets its own [1], [2]... sequence + own color", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn-mood1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "mood" }),
      module_("cn-hair1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "hair" }),
      module_("cn-mood2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "mood" }),
      module_("cn-hair2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "hair" }),
      module_("mood", "wildcard", {}, "mood#a"),
      module_("hair", "wildcard", {}, "hair#a"),
      module_("mood", "wildcard", {}, "mood#b"),
      module_("hair", "wildcard", {}, "hair#b"),
    ];
    const result = computePairings(chain);
    expect(result.get("cn-mood1")?.number).toBe(1);
    expect(result.get("cn-mood2")?.number).toBe(2);
    expect(result.get("cn-hair1")?.number).toBe(1);
    expect(result.get("cn-hair2")?.number).toBe(2);
    expect(result.get("cn-mood1")?.colorIndex).toBe(colorForPair("cn-mood1", "mood"));
    expect(result.get("cn-hair1")?.colorIndex).toBe(colorForPair("cn-hair1", "hair"));
    // Distinct target uuids resolve to (usually) distinct buckets.
    expect(result.get("mood#a")?.number).toBe(1);
    expect(result.get("mood#b")?.number).toBe(2);
    expect(result.get("hair#a")?.number).toBe(1);
    expect(result.get("hair#b")?.number).toBe(2);
  });

  it("color index hashes sender+target — constraint + claimed instance share the color", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "mood" }),
      module_("mood", "wildcard"),
    ];
    const result = computePairings(chain);
    expect(result.get("cn1")?.colorIndex).toBe(colorForPair("cn1", "mood"));
    expect(result.get("mood")?.colorIndex).toBe(colorForPair("cn1", "mood"));
    expect(result.get("cn1")?.colorIndex).toBe(result.get("mood")?.colorIndex);
  });

  it("first downstream match wins regardless of direct-vs-nested route", () => {
    // The engine fires constraints against the first downstream instance
    // it encounters at runtime — direct OR nested. Earlier code preferred
    // direct over nested even when the nested ref came FIRST in the chain.
    // Regression: a carrier wildcard immediately downstream of the
    // constraint should claim the slot before any later direct instance.
    // Target uuid uses the real 8-hex-char shape so the via-ref regex
    // (`@\{([0-9a-f]{8})\}`) matches.
    const targetUuid = "a1b2c3d4";
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: targetUuid }),
      // carrier comes FIRST in chain order
      module_(
        "carrier",
        "wildcard",
        { options: [{ id: "opt_a", value: `@{${targetUuid}}` }] },
        "carrier#a",
      ),
      // direct match comes LATER — engine never reaches it because
      // carrier claimed the slot first.
      module_(targetUuid, "wildcard", {}, "target#a"),
    ];
    const full = computePairingsFull(chain);
    const sender = full.get("cn1");
    expect(sender?.direct?.via?.carrierRowKey).toBe("carrier#a");
    expect(sender?.direct?.via?.optionIds).toEqual(["opt_a"]);
    // Direct `target#a` should NOT be paired (carrier won the race).
    expect(full.get("target#a")?.direct).toBeUndefined();
  });
});
