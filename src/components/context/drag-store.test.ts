// drag-store — shared dragState ref + pendingHandoffs queue.
//
// Pins the queue semantics that the source-side "backup cleanup"
// watcher relies on. Once a target widget queues a handoff for some
// `sourceNodeId`, the matching source widget takes it exactly once
// — re-reading is a no-op. Mixed sourceNodeIds stay isolated so two
// widgets handing off rows to two other widgets don't corrupt each
// other's pending lists.

import { describe, it, expect, beforeEach } from "vitest";
import {
  pendingHandoffs,
  queueHandoff,
  takeHandoffsFor,
  type PendingHandoff,
} from "./drag-store";

describe("drag-store — pendingHandoffs queue", () => {
  beforeEach(() => { pendingHandoffs.value = []; });

  it("queueHandoff appends to the shared list", () => {
    queueHandoff({ kind: "module", sourceNodeId: 1, uid: "u1" });
    queueHandoff({ kind: "module", sourceNodeId: 2, uid: "u2" });
    expect(pendingHandoffs.value).toHaveLength(2);
  });

  it("takeHandoffsFor returns only entries matching sourceNodeId", () => {
    queueHandoff({ kind: "module", sourceNodeId: 1, uid: "u1" });
    queueHandoff({ kind: "module", sourceNodeId: 2, uid: "u2" });
    queueHandoff({ kind: "module", sourceNodeId: 1, uid: "u3" });

    const taken = takeHandoffsFor(1);
    expect(taken.map((h) => h.uid)).toEqual(["u1", "u3"]);
    // Untouched entries remain.
    expect(pendingHandoffs.value).toHaveLength(1);
    expect(pendingHandoffs.value[0].uid).toBe("u2");
  });

  it("takeHandoffsFor a second time returns an empty list (idempotent)", () => {
    queueHandoff({ kind: "module", sourceNodeId: 1, uid: "u1" });
    takeHandoffsFor(1);
    expect(takeHandoffsFor(1)).toEqual([]);
  });

  it("queueHandoff replaces the list reference so Vue watchers fire", () => {
    const before = pendingHandoffs.value;
    queueHandoff({ kind: "module", sourceNodeId: 1, uid: "u1" });
    // Same-array mutation wouldn't fire Vue reactivity reliably; the
    // `queueHandoff` helper rebuilds the array so refs get a new value.
    expect(pendingHandoffs.value).not.toBe(before);
  });

  it("bundle handoff round-trips bundleUid + range", () => {
    const entry: PendingHandoff = {
      kind: "bundle",
      sourceNodeId: 7,
      bundleUid: "b-uid",
      sourceStartIdx: 3,
      sourceEndIdx: 6,
    };
    queueHandoff(entry);
    const [taken] = takeHandoffsFor(7);
    expect(taken).toEqual(entry);
  });
});
