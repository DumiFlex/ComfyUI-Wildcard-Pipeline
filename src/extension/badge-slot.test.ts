import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computed, reactive } from "vue";
import { nodeBadge } from "./_stashes";
import {
  BADGE_REVISION_KEY,
  _resetBadgeSlotForTests,
  bumpBadgeRevision,
  ensureBadgeSlot,
  removeBadgeSlot,
  setBadgeHost,
} from "./badge-slot";

class FakeBadge {
  text: string;
  constructor(opts: { text?: string }) { this.text = opts.text ?? ""; }
}

type Node = { badges?: unknown[] };
const call = (b: unknown) => (typeof b === "function" ? (b as () => FakeBadge)() : (b as FakeBadge));

describe("badge-slot", () => {
  beforeEach(() => {
    (window as unknown as { LGraphBadge?: unknown }).LGraphBadge = FakeBadge;
    _resetBadgeSlotForTests();
  });
  afterEach(() => {
    delete (window as unknown as { LGraphBadge?: unknown }).LGraphBadge;
  });

  it("puts one getter in node.badges that returns an empty badge until one is set", () => {
    const node: Node = {};
    expect(ensureBadgeSlot(node)).toBe(true);
    expect(ensureBadgeSlot(node)).toBe(true);
    expect(node.badges).toHaveLength(1);
    expect(call(node.badges?.[0]).text).toBe("");
    nodeBadge.set(node, new FakeBadge({ text: "2 conflicts" }));
    expect(call(node.badges?.[0]).text).toBe("2 conflicts");
    nodeBadge.delete(node);
  });

  it("re-runs a host-side computed when the revision is bumped (Nodes 2.0)", () => {
    // Stand-in for ComfyUI's Pinia store and usePartitionedBadges' computed,
    // which reads node.badges (a plain array) and calls each getter.
    const host = reactive<Record<string, unknown>>({});
    setBadgeHost(() => host);
    const node: Node = {};
    ensureBadgeSlot(node);
    const texts = computed(() => (node.badges ?? []).map(call).map((b) => b.text).filter(Boolean));
    expect(texts.value).toEqual([]);
    nodeBadge.set(node, new FakeBadge({ text: "missing $time" }));
    expect(texts.value).toEqual([]); // nothing Vue can see changed yet
    bumpBadgeRevision();
    expect(host[BADGE_REVISION_KEY]).toBe(1);
    expect(texts.value).toEqual(["missing $time"]);
    nodeBadge.delete(node);
  });

  it("does nothing without LGraphBadge, and removes the getter again", () => {
    delete (window as unknown as { LGraphBadge?: unknown }).LGraphBadge;
    const bare: Node = {};
    expect(ensureBadgeSlot(bare)).toBe(false);
    expect(bare.badges).toBeUndefined();

    (window as unknown as { LGraphBadge?: unknown }).LGraphBadge = FakeBadge;
    const node: Node = { badges: ["other"] };
    ensureBadgeSlot(node);
    expect(node.badges).toHaveLength(2);
    removeBadgeSlot(node);
    expect(node.badges).toEqual(["other"]);
  });
});
