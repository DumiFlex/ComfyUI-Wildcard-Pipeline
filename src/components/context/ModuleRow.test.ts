import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import ModuleRow from "./ModuleRow.vue";
import { ModuleRowCtxKey, type ModuleRowCtx } from "./module-row-ctx";
import type { ModuleEntry } from "../../widgets/_shared";
import type { PairingBadge } from "../../extension/constraint-pairs";

/** Build a ModuleRowCtx whose pairing accessors return canned data and
 *  whose ~30 helpers are inert stubs — ModuleRow only renders, so the
 *  helpers just need to exist + be callable without throwing. */
function makeCtx(over: Partial<ModuleRowCtx> = {}): ModuleRowCtx {
  const noop = (): void => {};
  return {
    KIND_TITLE: { wildcard: "Wildcard", constraint: "Constraint" },
    kindIcon: () => "pi pi-box",
    kindChipModifier: (t: string) => t,
    varColorClass: () => "var-1",
    isCollapsed: () => true,
    isLocked: () => false,
    isInternal: () => false,
    isSeedLockable: () => false,
    isModified: () => false,
    isDrifted: () => false,
    isMissingFromLibrary: () => false,
    isTypeConflict: () => false,
    severityFor: () => null,
    conflictTooltip: () => "",
    conflictBadgeText: () => null,
    modifiedTooltip: () => "",
    summaryFor: () => "",
    summaryTokens: () => [],
    siblingInfo: () => null,
    rowGap: () => null,
    draggingModuleUid: ref<string | null>(null),
    recentDropUids: ref(new Set<string>()),
    pulseDelayFor: () => "0ms",
    toggleCollapsed: noop,
    toggleEnabled: noop,
    removeModule: noop,
    toggleLockOnCard: noop,
    toggleInternalOnCard: noop,
    onDragStart: noop,
    onDragEnd: noop,
    openContextMenu: noop,
    onCardKeydown: noop,
    pairingFor: () => null,
    viaInboundFor: () => [],
    contributorsFor: () => [],
    currentFrame: ref<number | null>(null),
    isHeld: () => false,
    isOverriddenOnFrame: () => false,
    effectiveLockedSeed: () => undefined,
    effectiveEnabled: (m) => m.enabled !== false,
    frameEnableOverride: () => null,
    ...over,
  };
}

function module(over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "m1",
    _uid: "uid1",
    type: "wildcard",
    enabled: true,
    meta: { name: "subject" },
    entries: [],
    ...over,
  };
}

function mountRow(ctx: ModuleRowCtx, mod: ModuleEntry) {
  return mount(ModuleRow, {
    props: { module: mod, idx: 0 },
    global: { provide: { [ModuleRowCtxKey as symbol]: ctx } },
  });
}

const contrib = (n: number, colorIndex = n): PairingBadge => ({
  number: n,
  targetUuid: "aaaaaaaa",
  colorIndex,
  isOrphan: false,
});

describe("ModuleRow.vue — badge before name", () => {
  it("renders the pair badge BEFORE the module name in DOM order", () => {
    const ctx = makeCtx({ contributorsFor: () => [contrib(1)] });
    const wrapper = mountRow(ctx, module());
    const html = wrapper.html();
    const badgeIdx = html.indexOf("wp-pair-badge");
    const nameIdx = html.indexOf("wp-module-name");
    expect(badgeIdx).toBeGreaterThanOrEqual(0);
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(badgeIdx).toBeLessThan(nameIdx);
  });

  it("renders the sender badge before the name for a constraint row", () => {
    const senderBadge: PairingBadge = {
      number: 1,
      targetUuid: "aaaaaaaa",
      colorIndex: 2,
      isOrphan: false,
      reach: { mode: "all" },
    };
    const ctx = makeCtx({ pairingFor: () => senderBadge });
    const wrapper = mountRow(ctx, module({ type: "constraint", meta: { name: "no red" } }));
    const html = wrapper.html();
    expect(html.indexOf("wp-pair-badge")).toBeLessThan(html.indexOf("wp-module-name"));
    // Sender carries its reach suffix.
    expect(wrapper.text()).toContain("·all");
  });
});

describe("ModuleRow.vue — contributor cluster", () => {
  it("renders one chip per contributor when there are 2 or fewer", () => {
    const ctx = makeCtx({ contributorsFor: () => [contrib(1), contrib(2)] });
    const wrapper = mountRow(ctx, module());
    expect(wrapper.findAll(".wp-pair-badge")).toHaveLength(2);
    expect(wrapper.find(".wp-pair-badge--collapse").exists()).toBe(false);
  });

  it("renders exactly ONE collapse chip ↥×N when there are 3 or more contributors", () => {
    const ctx = makeCtx({ contributorsFor: () => [contrib(1), contrib(2), contrib(3)] });
    const wrapper = mountRow(ctx, module());
    const collapse = wrapper.findAll(".wp-pair-badge--collapse");
    expect(collapse).toHaveLength(1);
    expect(collapse[0].text()).toContain("↥×3");
    // The collapse chip REPLACES the individual chips — no per-contributor
    // direct chips alongside it.
    expect(wrapper.findAll(".wp-pair-badge")).toHaveLength(1);
  });

  it("renders no contributor chip on a row no constraint covers", () => {
    const ctx = makeCtx({ contributorsFor: () => [] });
    const wrapper = mountRow(ctx, module());
    expect(wrapper.find(".wp-pair-badge").exists()).toBe(false);
  });
});

describe("ModuleRow.vue — iteration-aware badges", () => {
  it("shows a held badge when seed_scope is hold", () => {
    const mod = module({ instance: { seed_scope: "hold" } as ModuleEntry["instance"] });
    const ctx = makeCtx({ isHeld: (m) => m.instance?.seed_scope === "hold" });
    const wrapper = mountRow(ctx, mod);
    expect(wrapper.find('[data-test="mod-held"]').exists()).toBe(true);
  });

  it("shows an override badge labelled with the current frame", () => {
    const frame = ref<number | null>(1);
    const mod = module({ iteration_overrides: { "1": { weight: 2 } } as ModuleEntry["iteration_overrides"] });
    const ctx = makeCtx({
      currentFrame: frame,
      isOverriddenOnFrame: (m) => {
        const k = frame.value;
        return k != null && !!m.iteration_overrides?.[String(k)];
      },
    });
    const wrapper = mountRow(ctx, mod);
    const badge = wrapper.find('[data-test="mod-override"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("#2");
  });
});

describe("ModuleRow.vue — per-frame enable/disable", () => {
  it("checkbox is unchecked when effectiveEnabled is false on the active frame", () => {
    const frame = ref<number | null>(2);
    const ctx = makeCtx({ currentFrame: frame, effectiveEnabled: () => false });
    const wrapper = mountRow(ctx, module({ enabled: true }));
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.exists()).toBe(true);
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
  });

  it("checkbox is checked when effectiveEnabled is true (base-off but on for this frame)", () => {
    const frame = ref<number | null>(2);
    const ctx = makeCtx({ currentFrame: frame, effectiveEnabled: () => true });
    const wrapper = mountRow(ctx, module({ enabled: false }));
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
  });

  it("shows an off-#k badge when frameEnableOverride is 'off'", () => {
    const frame = ref<number | null>(2);
    const ctx = makeCtx({ currentFrame: frame, frameEnableOverride: () => "off" });
    const wrapper = mountRow(ctx, module({ enabled: true }));
    const badge = wrapper.find('[data-test="mod-frame-disabled"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("#3"); // frame index 2 (0-based) → "#3"
  });

  it("shows an on-#k badge when frameEnableOverride is 'on'", () => {
    const frame = ref<number | null>(2);
    const ctx = makeCtx({ currentFrame: frame, frameEnableOverride: () => "on" });
    const wrapper = mountRow(ctx, module({ enabled: false }));
    const badge = wrapper.find('[data-test="mod-frame-enabled"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("#3");
  });

  it("checkbox change calls ctx.toggleEnabled with the row index", async () => {
    const frame = ref<number | null>(2);
    const calls: number[] = [];
    const ctx = makeCtx({
      currentFrame: frame,
      toggleEnabled: (idx) => { calls.push(idx); },
    });
    const wrapper = mountRow(ctx, module({ enabled: true }));
    await wrapper.find('input[type="checkbox"]').trigger("change");
    expect(calls).toEqual([0]);
  });
});
