import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import PairBadge from "./PairBadge.vue";
import type { PairingBadge } from "../../extension/constraint-pairs";

afterEach(() => {
  // Popover teleports to <body> — strip leftover overlays between tests.
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

/** Minimal sender badge with a given reach selector. */
function senderPair(reach: PairingBadge["reach"], over: Partial<PairingBadge> = {}): PairingBadge {
  return {
    number: 1,
    targetUuid: "aaaaaaaa",
    colorIndex: 3,
    isOrphan: false,
    reach,
    ...over,
  };
}

describe("PairBadge.vue — sender reach suffix", () => {
  it("renders ·all for the default all reach", () => {
    const wrapper = mount(PairBadge, {
      props: { pair: senderPair({ mode: "all" }), variant: "sender" },
    });
    expect(wrapper.text()).toContain("#1");
    expect(wrapper.text()).toContain("·all");
  });

  it("renders ·first for first reach", () => {
    const wrapper = mount(PairBadge, {
      props: { pair: senderPair({ mode: "first" }), variant: "sender" },
    });
    expect(wrapper.text()).toContain("·first");
  });

  it("renders ·n{count} for next reach", () => {
    const wrapper = mount(PairBadge, {
      props: { pair: senderPair({ mode: "next", count: 2 }), variant: "sender" },
    });
    expect(wrapper.text()).toContain("·n2");
  });

  it("renders ·pick for pick reach", () => {
    const wrapper = mount(PairBadge, {
      props: { pair: senderPair({ mode: "pick", picks: [] }), variant: "sender" },
    });
    expect(wrapper.text()).toContain("·pick");
  });

  it("keeps the via ↪ glyph alongside the reach suffix", () => {
    const wrapper = mount(PairBadge, {
      props: {
        pair: senderPair(
          { mode: "all" },
          { via: { carrierRowKey: "c1", carrierName: "backdrop", optionIds: ["o1"], routeChain: ["aaaaaaaa"] } },
        ),
        variant: "sender",
      },
    });
    expect(wrapper.text()).toContain("↪");
    expect(wrapper.text()).toContain("·all");
  });

  it("does not append a reach suffix to a direct (target) chip", () => {
    const wrapper = mount(PairBadge, {
      props: { pair: { number: 1, targetUuid: "aaaaaaaa", colorIndex: 3, isOrphan: false }, variant: "direct" },
    });
    expect(wrapper.text()).toContain("#1");
    expect(wrapper.text()).not.toContain("·");
  });
});

describe("PairBadge.vue — collapse variant", () => {
  const pairs: PairingBadge[] = [
    { number: 1, targetUuid: "aaaaaaaa", colorIndex: 1, isOrphan: false },
    { number: 2, targetUuid: "aaaaaaaa", colorIndex: 2, isOrphan: false },
    { number: 3, targetUuid: "aaaaaaaa", colorIndex: 3, isOrphan: false },
  ];

  it("renders ↥×N from the pairs length", () => {
    const wrapper = mount(PairBadge, {
      props: { pairs, variant: "collapse" },
    });
    expect(wrapper.text()).toContain("↥×3");
  });

  it("renders ↥×N from an explicit count prop", () => {
    const wrapper = mount(PairBadge, {
      props: { count: 4, pairs, variant: "collapse" },
    });
    expect(wrapper.text()).toContain("↥×4");
  });

  it("carries the .wp-pair-badge--collapse class and not the carrier multi-color class", () => {
    const wrapper = mount(PairBadge, {
      props: { pairs, variant: "collapse" },
    });
    const chip = wrapper.find(".wp-pair-badge");
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).toContain("wp-pair-badge--collapse");
    // Solid collapse chip is NOT the dim multi-color carrier surface.
    expect(chip.classes()).not.toContain("wp-pair-badge--via-multi");
  });

  it("opens a popover listing every collapsed pair", async () => {
    const wrapper = mount(PairBadge, {
      attachTo: document.body,
      props: { pairs, variant: "collapse" },
    });
    await wrapper.find(".wp-pair-badge").trigger("click");
    await wrapper.vm.$nextTick();
    const pop = document.querySelector(".wp-pair-pop");
    expect(pop).not.toBeNull();
    // Each numbered entry should be present.
    expect(pop?.textContent).toContain("#1");
    expect(pop?.textContent).toContain("#2");
    expect(pop?.textContent).toContain("#3");
  });
});

describe("PairBadge.vue — popover REACH + PATH rows", () => {
  it("renders a REACH row from the primary pair's reach", async () => {
    const wrapper = mount(PairBadge, {
      attachTo: document.body,
      props: { pair: senderPair({ mode: "next", count: 2 }), variant: "sender" },
    });
    await wrapper.find(".wp-pair-badge").trigger("click");
    await wrapper.vm.$nextTick();
    const pop = document.querySelector(".wp-pair-pop");
    expect(pop).not.toBeNull();
    expect(pop?.textContent?.toLowerCase()).toContain("reach");
    // "next 2" is the human label for a next/count reach.
    expect(pop?.textContent).toContain("next 2");
  });

  it("renders a PATH row when via.routeChain is present", async () => {
    const wrapper = mount(PairBadge, {
      attachTo: document.body,
      props: {
        pair: senderPair(
          { mode: "all" },
          {
            via: {
              carrierRowKey: "c1",
              carrierName: "backdrop",
              optionIds: ["o1"],
              routeChain: ["bbbbbbbb", "aaaaaaaa"],
            },
          },
        ),
        variant: "sender",
      },
    });
    await wrapper.find(".wp-pair-badge").trigger("click");
    await wrapper.vm.$nextTick();
    const pop = document.querySelector(".wp-pair-pop");
    expect(pop).not.toBeNull();
    expect(pop?.textContent?.toLowerCase()).toContain("path");
    // Hops rendered (uuids resolve to themselves when no name cached).
    expect(pop?.textContent).toContain("bbbbbbbb");
    expect(pop?.textContent).toContain("aaaaaaaa");
  });
});
