import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Tier3ChainViz from "../conflict-rows/Tier3ChainViz.vue";
import type { ChainStep } from "../conflict-rows/chain-types";

/**
 * Tests for `Tier3ChainViz.vue` — Task 19.
 *
 * The component is a pure visualization for tier-3 (over-nested
 * bundle) issues surfaced inside `ConflictModal.vue`. It renders the
 * outer bundle name + a "Tier-3 rejected" badge, and a collapsed
 * chain body the user can expand via the "Why?" toggle.
 *
 * Test surface is deliberately narrow:
 *   - Render shape (name, chain step names).
 *   - Collapsed-by-default + toggle behavior.
 *   - Indent ramp (idx * 16px).
 *   - Prefix string (`└ contains: `) on every step after the outer.
 *   - Remediation hint text.
 *
 * `ChainStep.id` (NOT `uuid`) — aligned with the Task 17 entity-key
 * fix.
 */
function makeChain(...names: string[]): ChainStep[] {
  return names.map((name, idx) => ({ name, id: `b${idx}` }));
}

describe("Tier3ChainViz", () => {
  it("renders the bundle name and every chain step name when expanded", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Sketch Pack",
        chain: makeChain("Sketch Pack", "Pose Pack", "Pen Set"),
      },
    });
    // Head row visible immediately.
    expect(wrap.text()).toContain("Sketch Pack");
    // Expand to see the chain rows.
    await wrap.find('[data-test="chain-toggle"]').trigger("click");
    const body = wrap.find('[data-test="chain-body"]');
    expect(body.exists()).toBe(true);
    expect(body.text()).toContain("Sketch Pack");
    expect(body.text()).toContain("Pose Pack");
    expect(body.text()).toContain("Pen Set");
  });

  it("hides the chain body by default", () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Inner"),
      },
    });
    expect(wrap.find('[data-test="chain-body"]').exists()).toBe(false);
  });

  it("shows the chain body after clicking the toggle", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Inner"),
      },
    });
    await wrap.find('[data-test="chain-toggle"]').trigger("click");
    expect(wrap.find('[data-test="chain-body"]').exists()).toBe(true);
  });

  it("renders each chain step with idx * 16px of left padding", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Middle", "Inner"),
      },
    });
    await wrap.find('[data-test="chain-toggle"]').trigger("click");
    const steps = wrap.findAll('[data-test="chain-body"] .wp-tier3-row__step');
    expect(steps).toHaveLength(3);
    // Inline-style `padding-left` is set via :style binding — verify
    // the ramp directly. `style` attribute string varies between
    // engines on whitespace, so check via `.attributes("style")`
    // substring match.
    expect(steps[0].attributes("style")).toContain("padding-left: 0px");
    expect(steps[1].attributes("style")).toContain("padding-left: 16px");
    expect(steps[2].attributes("style")).toContain("padding-left: 32px");
  });

  it("prefixes every step after the outer with '└ contains: '", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Middle", "Inner"),
      },
    });
    await wrap.find('[data-test="chain-toggle"]').trigger("click");
    const steps = wrap.findAll('[data-test="chain-body"] .wp-tier3-row__step');
    // Step 0 = outer bundle, no prefix.
    expect(steps[0].text()).not.toContain("└ contains:");
    expect(steps[0].text()).toContain("Outer");
    // Steps 1+ get the prefix.
    expect(steps[1].text()).toContain("└ contains:");
    expect(steps[1].text()).toContain("Middle");
    expect(steps[2].text()).toContain("└ contains:");
    expect(steps[2].text()).toContain("Inner");
  });

  it("renders the remediation hint inside the expanded chain body", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Inner"),
      },
    });
    await wrap.find('[data-test="chain-toggle"]').trigger("click");
    const body = wrap.find('[data-test="chain-body"]');
    expect(body.text()).toContain(
      "Exceeds tier-2 nesting cap. Flatten the chain to import.",
    );
  });

  it("collapses the chain body when the toggle is clicked a second time", async () => {
    const wrap = mount(Tier3ChainViz, {
      props: {
        bundleName: "Outer",
        chain: makeChain("Outer", "Inner"),
      },
    });
    const toggle = wrap.find('[data-test="chain-toggle"]');
    await toggle.trigger("click");
    expect(wrap.find('[data-test="chain-body"]').exists()).toBe(true);
    await toggle.trigger("click");
    expect(wrap.find('[data-test="chain-body"]').exists()).toBe(false);
  });
});
