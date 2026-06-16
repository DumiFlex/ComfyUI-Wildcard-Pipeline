import { describe, it, expect } from "vitest";
import { computePairings, computePairingsFull, carrierOptionIdsFor, CARRIER_TYPES, branchKey, type ChainModule } from "./constraint-pairs";
import { varColorIndex } from "../components/shared/var-color";
import corpus from "../../tests/fixtures/constraint-corpus.json";

function module_(id: string, type: string, payload: Record<string, unknown> = {}, rowKey?: string): ChainModule {
  return { id, rowKey: rowKey ?? id, type, payload };
}

// Py≡TS branch-key parity: `branchKey` MUST produce the byte-identical string
// the engine stamps as the carrier option_id (derivation_handler
// `branch_carrier_key`). The shared corpus is the single source of truth so the
// two formats cannot drift independently.
describe("branchKey — Py≡TS branch-key parity (corpus)", () => {
  it.each(corpus.branch_key_cases)("$name -> $key", (c: { rule_id: string; branch: number | string; key: string }) => {
    expect(branchKey(c.rule_id, c.branch)).toBe(c.key);
  });
});

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
    // SP3: the SENDER's flat badge now carries its `reach` selector
    // (default `{mode:"all"}`). The target's flat badge is a back-compat
    // mirror of its first contributor → no `reach` (only senders carry it).
    expect(result.get("cn1")).toEqual({
      number: 1, targetUuid: "t1", colorIndex: color, isOrphan: false, reach: { mode: "all" },
    });
    expect(result.get("t1")).toEqual({ number: 1, targetUuid: "t1", colorIndex: color, isOrphan: false });
  });

  it("stable per-target numbering + distinct colors; keys by rowKey, not id", () => {
    // Two target instances share the same uuid `t1` — distinct rowKeys
    // keep them addressable on the returned badge map (real-world case:
    // library-deduped wildcards in a chain).
    //
    // SP3 mark-all: both constraints default to `all`, so BOTH cover BOTH
    // instances (no exclusive claim). The sender numbering is still a
    // stable per-target registration sequence (#1, #2) with distinct
    // colors; each instance's flat `direct` badge is a back-compat mirror
    // of its FIRST contributor (cn1, registered first).
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn1#uid"),
      module_("cn2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn2#uid"),
      module_("t1", "wildcard", {}, "t1#uid-a"),
      module_("t1", "wildcard", {}, "t1#uid-b"),
    ];
    const full = computePairingsFull(chain);
    const result = computePairings(chain);
    const c1 = colorForPair("cn1#uid", "t1");
    const c2 = colorForPair("cn2#uid", "t1");
    // Sender badges: stable #1/#2 with their own reach + colors.
    expect(result.get("cn1#uid")).toEqual({
      number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false, reach: { mode: "all" },
    });
    expect(result.get("cn2#uid")).toEqual({
      number: 2, targetUuid: "t1", colorIndex: c2, isOrphan: false, reach: { mode: "all" },
    });
    // Both instances are covered by BOTH constraints — contributors list
    // each in registration order.
    expect(full.get("t1#uid-a")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    expect(full.get("t1#uid-b")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    // Flat map mirrors the first contributor (cn1) on each instance row.
    expect(result.get("t1#uid-a")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    expect(result.get("t1#uid-b")).toEqual({ number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false });
    // Distinct senders land on distinct palette buckets even though both
    // pairs target the same wildcard uuid — that's the whole point of
    // hashing on the sender+target combo.
    expect(c1).not.toBe(c2);
  });

  it("two all-reach constraints, one instance: BOTH cover it (neither orphan)", () => {
    // SP3 drops the exclusive-claim model. Pre-SP3 a second constraint
    // with only one downstream instance was an "orphan" (the instance was
    // already claimed). Under mark-all, BOTH constraints cover the single
    // instance — neither is an orphan, and the instance lists both
    // contributors. Orphan now strictly means "selector covered ZERO
    // instances" (see the dedicated orphan tests below).
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }),
      module_("cn2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }),
      module_("t1", "wildcard"),
    ];
    const full = computePairingsFull(chain);
    const result = computePairings(chain);
    const c1 = colorForPair("cn1", "t1");
    const c2 = colorForPair("cn2", "t1");
    expect(result.get("cn1")).toEqual({
      number: 1, targetUuid: "t1", colorIndex: c1, isOrphan: false, reach: { mode: "all" },
    });
    expect(result.get("cn2")).toEqual({
      number: 2, targetUuid: "t1", colorIndex: c2, isOrphan: false, reach: { mode: "all" },
    });
    // The single instance accumulates BOTH constraints.
    expect(full.get("t1")?.contributors.map((b) => b.number)).toEqual([1, 2]);
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
    const full = computePairingsFull(chain);
    // Each target uuid keeps its OWN #1/#2 sender sequence + color.
    expect(result.get("cn-mood1")?.number).toBe(1);
    expect(result.get("cn-mood2")?.number).toBe(2);
    expect(result.get("cn-hair1")?.number).toBe(1);
    expect(result.get("cn-hair2")?.number).toBe(2);
    expect(result.get("cn-mood1")?.colorIndex).toBe(colorForPair("cn-mood1", "mood"));
    expect(result.get("cn-hair1")?.colorIndex).toBe(colorForPair("cn-hair1", "hair"));
    // SP3 mark-all: both mood constraints cover both mood instances (and
    // likewise for hair). Each instance lists both same-target
    // constraints; the flat map mirrors the first (#1).
    expect(full.get("mood#a")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    expect(full.get("mood#b")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    expect(full.get("hair#a")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    expect(full.get("hair#b")?.contributors.map((b) => b.number)).toEqual([1, 2]);
    expect(result.get("mood#a")?.number).toBe(1);
    expect(result.get("hair#a")?.number).toBe(1);
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

  it("sender's via reflects the FIRST covered encounter (carrier before later direct)", () => {
    // The engine encounters target occurrences in chain order — direct OR
    // nested. The sender badge's `via` is stamped from the FIRST covered
    // encounter. Here a carrier comes first, so the sender's via points at
    // it. Target uuid uses the real 8-hex-char shape so the via-ref regex
    // (`@\{([0-9a-f]{8})\}`) matches.
    //
    // SP3 mark-all: the default `all` reach covers EVERY downstream
    // occurrence, so the later direct `target#a` is ALSO a contributor
    // (pre-SP3 the carrier exclusively claimed the slot and target#a got
    // nothing).
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
      // direct match comes LATER — under mark-all it's still covered.
      module_(targetUuid, "wildcard", {}, "target#a"),
    ];
    const full = computePairingsFull(chain);
    const sender = full.get("cn1");
    expect(sender?.direct?.via?.carrierRowKey).toBe("carrier#a");
    expect(sender?.direct?.via?.optionIds).toEqual(["opt_a"]);
    // Carrier coverage lives in `viaInbound` (the `↪×N` chip), NOT
    // `contributors` — a nested relationship renders as exactly one badge.
    expect(full.get("carrier#a")?.viaInbound.length).toBe(1);
    expect(full.get("carrier#a")?.contributors.length ?? 0).toBe(0);
    // SP3: the later direct instance is ALSO covered under default `all`.
    expect(full.get("target#a")?.contributors.length).toBe(1);
    expect(full.get("target#a")?.direct?.number).toBe(1);
  });

  it("one-hop carrier reports routeChain = [targetUuid]", () => {
    // The existing direct-nested case should now also stamp a routeChain
    // ending (and starting) at the target uuid.
    const targetUuid = "a1b2c3d4";
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: targetUuid }),
      module_(
        "carrier",
        "wildcard",
        { options: [{ id: "opt_a", value: `@{${targetUuid}}` }] },
        "carrier#a",
      ),
    ];
    const full = computePairingsFull(chain);
    const sender = full.get("cn1");
    expect(sender?.direct?.via?.carrierRowKey).toBe("carrier#a");
    expect(sender?.direct?.via?.routeChain).toEqual([targetUuid]);
    // Carrier's inbound badge carries the same route chain.
    expect(full.get("carrier#a")?.viaInbound[0]?.via?.routeChain).toEqual([targetUuid]);
  });

  it("detects a target reached two hops deep and reports the route chain", () => {
    // Carrier A's option refs @{Buuid}; wildcard B's option refs
    // @{Tuuid}; the constraint targets T. A is a TRANSITIVE carrier of
    // T (A -> B -> T) — the old one-hop walk missed this entirely.
    const aUuid = "aaaaaaaa";
    const bUuid = "bbbbbbbb";
    const tUuid = "cccccccc";
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: tUuid }),
      // A is the first downstream wildcard — it reaches T only through B.
      module_(
        aUuid,
        "wildcard",
        { options: [{ id: "opt_a", value: `@{${bUuid}}` }] },
        "A#a",
      ),
      // B refs the actual target T.
      module_(
        bUuid,
        "wildcard",
        { options: [{ id: "opt_b", value: `@{${tUuid}}` }] },
        "B#a",
      ),
    ];
    const full = computePairingsFull(chain);
    const sender = full.get("cn1");
    // A's option is the carrier the engine reaches first.
    expect(sender?.direct?.via?.carrierRowKey).toBe("A#a");
    expect(sender?.direct?.via?.optionIds).toEqual(["opt_a"]);
    // Route chain is the hop path after A, target last: [B, T].
    expect(sender?.direct?.via?.routeChain).toEqual([bUuid, tUuid]);
    // Carrier A picks up the inbound badge with the same route chain.
    expect(full.get("A#a")?.viaInbound[0]?.via?.routeChain).toEqual([bUuid, tUuid]);
  });

  it("cycle A<->B does not infinite-loop", () => {
    // A refs @{B}, B refs @{A}; the constraint targets a T that neither
    // reaches. The cycle guard must terminate and the constraint falls
    // through to an orphan badge (no carrier, no direct).
    const aUuid = "aaaaaaaa";
    const bUuid = "bbbbbbbb";
    const tUuid = "dddddddd";
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: tUuid }),
      module_(aUuid, "wildcard", { options: [{ id: "opt_a", value: `@{${bUuid}}` }] }, "A#a"),
      module_(bUuid, "wildcard", { options: [{ id: "opt_b", value: `@{${aUuid}}` }] }, "B#a"),
    ];
    expect(() => computePairingsFull(chain)).not.toThrow();
    const sender = computePairingsFull(chain).get("cn1");
    // T is unreachable → orphan, no carrier.
    expect(sender?.direct?.isOrphan).toBe(true);
    expect(sender?.direct?.via).toBeUndefined();
  });
});

describe("computePairingsFull — SP3 reach + contributors", () => {
  it("all-reach (default) covers EVERY downstream target instance", () => {
    // Default `all` selector — the constraint re-weights every downstream
    // instance of its target, so BOTH instances accumulate the constraint
    // in their `contributors` (length 1 each — only one constraint here).
    const chain = [
      module_("s1", "wildcard"),
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: { mode: "all" } },
        "cn1#uid",
      ),
      module_("t1", "wildcard", {}, "t1#a"),
      module_("t1", "wildcard", {}, "t1#b"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("t1#a")?.contributors.length).toBe(1);
    expect(full.get("t1#b")?.contributors.length).toBe(1);
    expect(full.get("t1#a")?.contributors[0]?.targetUuid).toBe("t1");
    expect(full.get("t1#b")?.contributors[0]?.targetUuid).toBe("t1");
  });

  it("two all-reach constraints stack on a shared instance (contributors.length === 2)", () => {
    // Both constraints default to `all`, so each downstream instance is
    // covered by BOTH — a shared instance carries two contributors.
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn1#uid"),
      module_("cn2", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn2#uid"),
      module_("t1", "wildcard", {}, "t1#a"),
    ];
    const full = computePairingsFull(chain);
    const contribs = full.get("t1#a")?.contributors ?? [];
    expect(contribs.length).toBe(2);
    // Stable per-target numbering — registration order #1, #2.
    expect(contribs.map((c) => c.number).sort()).toEqual([1, 2]);
  });

  it("`first` reach covers ONLY the first downstream instance", () => {
    const chain = [
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: { mode: "first" } },
        "cn1#uid",
      ),
      module_("s1", "wildcard"),
      module_("t1", "wildcard", {}, "t1#a"),
      module_("t1", "wildcard", {}, "t1#b"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("t1#a")?.contributors.length).toBe(1);
    expect(full.get("t1#b")?.contributors.length ?? 0).toBe(0);
  });

  it("`next` count=2 covers the first two instances, not the third", () => {
    const chain = [
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: { mode: "next", count: 2 } },
        "cn1#uid",
      ),
      module_("s1", "wildcard"),
      module_("t1", "wildcard", {}, "t1#a"),
      module_("t1", "wildcard", {}, "t1#b"),
      module_("t1", "wildcard", {}, "t1#c"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("t1#a")?.contributors.length).toBe(1);
    expect(full.get("t1#b")?.contributors.length).toBe(1);
    expect(full.get("t1#c")?.contributors.length ?? 0).toBe(0);
  });

  it("`pick` direct covers only the listed instance uid (bare _uid, not rowKey)", () => {
    // `pick` lists the SECOND instance's BARE _uid (`b`, stripped of the
    // `t1#` node prefix) → only it is covered. The badge derives the bare
    // suffix of each row's rowKey so it agrees with both the UI-persisted
    // pick format AND the engine's `_occurrence_matches`. A rowKey-format
    // pick (`t1#b`) would NOT match — see the explicit guard below.
    const chain = [
      module_(
        "cn1",
        "constraint",
        {
          source_wildcard_id: "s1",
          target_wildcard_id: "t1",
          target_select: { mode: "pick", picks: [{ kind: "direct", uid: "b" }] },
        },
        "cn1#uid",
      ),
      module_("s1", "wildcard"),
      module_("t1", "wildcard", {}, "t1#a"),
      module_("t1", "wildcard", {}, "t1#b"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("t1#a")?.contributors.length ?? 0).toBe(0);
    expect(full.get("t1#b")?.contributors.length).toBe(1);
  });

  it("`pick` direct with a rowKey-format uid covers NOTHING (bare-uid contract)", () => {
    // Round-trip guard mirroring the engine test: the OLD buggy format
    // stored the full rowKey (`t1#b`) as the pick uid. Post-fix the badge
    // matches the BARE suffix, so a rowKey-format pick never covers — the
    // badge agrees with the engine that this pick is dead.
    const chain = [
      module_(
        "cn1",
        "constraint",
        {
          source_wildcard_id: "s1",
          target_wildcard_id: "t1",
          target_select: { mode: "pick", picks: [{ kind: "direct", uid: "t1#b" }] },
        },
        "cn1#uid",
      ),
      module_("s1", "wildcard"),
      module_("t1", "wildcard", {}, "t1#a"),
      module_("t1", "wildcard", {}, "t1#b"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("t1#a")?.contributors.length ?? 0).toBe(0);
    expect(full.get("t1#b")?.contributors.length ?? 0).toBe(0);
    // The constraint covered zero downstream instances → orphan badge.
    expect(full.get("cn1#uid")?.direct?.isOrphan).toBe(true);
  });

  it("sender row's direct.reach equals the constraint's target_select", () => {
    const sel = { mode: "next", count: 3 } as const;
    const chain = [
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: sel },
        "cn1#uid",
      ),
      module_("s1", "wildcard"),
      module_("t1", "wildcard", {}, "t1#a"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("cn1#uid")?.direct?.reach).toEqual(sel);
  });

  it("sender row defaults direct.reach to {mode:'all'} when target_select absent", () => {
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: "t1" }, "cn1#uid"),
      module_("t1", "wildcard", {}, "t1#a"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("cn1#uid")?.direct?.reach).toEqual({ mode: "all" });
  });

  it("orphan: selector covering zero downstream instances marks sender isOrphan", () => {
    // `first` selector but NO downstream instance exists at all → the
    // selector covers zero instances → sender is orphan.
    const chain = [
      module_("s1", "wildcard"),
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: { mode: "first" } },
        "cn1#uid",
      ),
      // no t1 instance downstream
    ];
    const full = computePairingsFull(chain);
    expect(full.get("cn1#uid")?.direct?.isOrphan).toBe(true);
  });

  it("orphan: `next` past the available count is NOT orphan (it covered some)", () => {
    // `next` count=3 but only 1 instance — it still covered that one, so
    // the sender is NOT an orphan. Orphan means ZERO coverage.
    const chain = [
      module_("s1", "wildcard"),
      module_(
        "cn1",
        "constraint",
        { source_wildcard_id: "s1", target_wildcard_id: "t1", target_select: { mode: "next", count: 3 } },
        "cn1#uid",
      ),
      module_("t1", "wildcard", {}, "t1#a"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("cn1#uid")?.direct?.isOrphan).toBe(false);
    expect(full.get("t1#a")?.contributors.length).toBe(1);
  });

  it("nested coverage flows through a transitive carrier's viaInbound with via metadata", () => {
    // Default `all` reach over a carrier whose option transitively refs the
    // target — the carrier row collects the constraint in `viaInbound` (the
    // `↪×N` chip), NOT `contributors`, and the badge carries `via` (carrier
    // + route). One relationship → one badge.
    const tUuid = "cccccccc";
    const chain = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: tUuid }, "cn1#uid"),
      module_("carrier", "wildcard", { options: [{ id: "opt_a", value: `@{${tUuid}}` }] }, "carrier#a"),
    ];
    const full = computePairingsFull(chain);
    expect(full.get("carrier#a")?.contributors.length ?? 0).toBe(0);
    const inbound = full.get("carrier#a")?.viaInbound ?? [];
    expect(inbound.length).toBe(1);
    expect(inbound[0]?.via?.carrierRowKey).toBe("carrier#a");
    expect(inbound[0]?.via?.routeChain).toEqual([tUuid]);
  });
});

describe("B2+B3 — derivation as @{} carrier", () => {
  it("carrierOptionIdsFor reads derivation action values keyed by branch key", () => {
    const tgt = "aabbccdd";
    const deriv: ChainModule = {
      id: "d1", rowKey: "1#d1", type: "derivation",
      payload: { rules: [{
        id: "r1",
        branches: [{ action: { target_var: "out", value: `x @{${tgt}} y` } }],
        else: { action: { target_var: "out", value: `@{${tgt}}` } },
      }] },
    };
    expect(CARRIER_TYPES.has("derivation")).toBe(true);
    const match = carrierOptionIdsFor(deriv, tgt, () => []);
    expect(match.optionIds).toEqual(["r1:0", "r1:else"]);
    expect(match.routeChain).toEqual([tgt]);
  });

  it("a constraint targeting a wildcard reached only via a derivation marks the derivation carrier", () => {
    const tgt = "aabbccdd";
    const chain: ChainModule[] = [
      module_("s1", "wildcard"),
      module_("cn1", "constraint", { source_wildcard_id: "s1", target_wildcard_id: tgt }, "cn1#uid"),
      { id: "d1", rowKey: "1#d1", type: "derivation",
        payload: { rules: [{ id: "r1", branches: [{ action: { value: `@{${tgt}}` } }] }] } },
    ];
    const full = computePairingsFull(chain);
    // Nested coverage lives in viaInbound (single-bucket rule); contributors stays empty.
    expect(full.get("1#d1")?.viaInbound.length).toBe(1);
    expect(full.get("1#d1")?.contributors.length ?? 0).toBe(0);
    expect(full.get("cn1#uid")?.direct?.isOrphan).toBe(false);
    expect(full.get("cn1#uid")?.direct?.via?.carrierRowKey).toBe("1#d1");
  });
});
