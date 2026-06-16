import { describe, it, expect } from "vitest";
import { pairingBadgeEqual, pairingMapEqual } from "./context";
import type {
  PairingBadge,
  RowPairings,
  TargetSelect,
} from "../extension/constraint-pairs";

/** Minimal sender badge carrying a `reach` selector — the only badge
 *  kind that does. Contributor / carrier badges leave `reach` undefined. */
function senderBadge(reach: TargetSelect): PairingBadge {
  return { number: 1, targetUuid: "t1", colorIndex: 3, isOrphan: false, reach };
}

/** Plain contributor badge (no `reach`). */
function badge(number: number): PairingBadge {
  return { number, targetUuid: "t1", colorIndex: 3, isOrphan: false };
}

function row(partial: Partial<RowPairings>): RowPairings {
  return { direct: null, viaInbound: [], contributors: [], ...partial };
}

describe("pairingBadgeEqual — reach selector (SP3 QA)", () => {
  it("differs when reach mode changes (all → first)", () => {
    // The defect: a `target_select` edit flips the sender chip's reach
    // suffix (·all → ·first) but the gate said 'equal', freezing the badge.
    expect(
      pairingBadgeEqual(senderBadge({ mode: "all" }), senderBadge({ mode: "first" })),
    ).toBe(false);
  });

  it("differs when next-N count changes", () => {
    expect(
      pairingBadgeEqual(
        senderBadge({ mode: "next", count: 1 }),
        senderBadge({ mode: "next", count: 2 }),
      ),
    ).toBe(false);
  });

  it("differs when a pick's identity changes", () => {
    expect(
      pairingBadgeEqual(
        senderBadge({ mode: "pick", picks: [{ kind: "direct", uid: "a" }] }),
        senderBadge({ mode: "pick", picks: [{ kind: "direct", uid: "b" }] }),
      ),
    ).toBe(false);
  });

  it("differs when a pick is added", () => {
    expect(
      pairingBadgeEqual(
        senderBadge({ mode: "pick", picks: [{ kind: "direct", uid: "a" }] }),
        senderBadge({
          mode: "pick",
          picks: [
            { kind: "direct", uid: "a" },
            { kind: "nested", carrier_uid: "c", option_id: "o" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("equal when reach is identical", () => {
    expect(
      pairingBadgeEqual(
        senderBadge({ mode: "next", count: 2 }),
        senderBadge({ mode: "next", count: 2 }),
      ),
    ).toBe(true);
  });

  it("equal when both badges carry no reach (contributor/carrier rows)", () => {
    // Must NOT churn: most badges have reach === undefined, and a false
    // negative here would re-render every ContextWidget every poll.
    expect(pairingBadgeEqual(badge(1), badge(1))).toBe(true);
  });
});

describe("pairingMapEqual — contributors list (SP3 QA)", () => {
  it("differs when a NON-first contributor drops (direct mirror unchanged)", () => {
    // Row covered by two constraints [#1, #2]. Constraint #2's reach stops
    // covering it → contributors becomes [#1]. `direct` mirrors only
    // contributors[0] (#1) so it's unchanged — the cluster still goes from
    // two chips to one, which the gate must detect.
    const a = new Map<string, RowPairings>([
      ["t1#u", row({ direct: badge(1), contributors: [badge(1), badge(2)] })],
    ]);
    const b = new Map<string, RowPairings>([
      ["t1#u", row({ direct: badge(1), contributors: [badge(1)] })],
    ]);
    expect(pairingMapEqual(a, b)).toBe(false);
  });

  it("equal when contributors are identical", () => {
    const mk = () =>
      new Map<string, RowPairings>([
        ["t1#u", row({ direct: badge(1), contributors: [badge(1), badge(2)] })],
      ]);
    expect(pairingMapEqual(mk(), mk())).toBe(true);
  });
});
