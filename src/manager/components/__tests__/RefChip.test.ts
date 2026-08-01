import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, afterEach } from "vitest";
import { computed, nextTick } from "vue";
import RefChip from "../RefChip.vue";
import { _setForTests } from "@/extension/preview-resolver";
import {
  CONTEXT_POOLS_KEY,
  FOREIGN_POOL_LOOKUP_KEY,
  buildContextPools,
} from "@/extension/context-pools";

describe("RefChip hover card (issues #3 / #8)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("shows uuid + live 'N of M options match' on hover", async () => {
    // Seed the resolver so the hover reads the wildcard's LIVE options —
    // 4 options, 2 tagged `warm`; a `:warm` ref should read "2 of 4".
    _setForTests("beef0001", {
      name: "colour", kind: "wildcard",
      optionTagSets: [["warm"], ["warm"], ["cold"], []],
    });
    vi.useFakeTimers();
    const w = mount(RefChip, {
      props: { kind: "ref", name: "colour", uuid: "beef0001", resolved: true, expr: "warm" },
      attachTo: document.body,
    });
    await w.find(".wp-refchip").trigger("mouseenter");
    vi.advanceTimersByTime(300);
    await nextTick();
    const card = document.querySelector('[data-test="refchip-hover"]');
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("beef0001");
    expect(card?.textContent).toContain("2 of 4 options match");
    w.unmount();
  });

  it("shows a plain option count for an unfiltered ref", async () => {
    _setForTests("beef0002", { name: "pose", kind: "wildcard", optionTagSets: [[], [], []] });
    vi.useFakeTimers();
    const w = mount(RefChip, {
      props: { kind: "ref", name: "pose", uuid: "beef0002", resolved: true },
      attachTo: document.body,
    });
    await w.find(".wp-refchip").trigger("mouseenter");
    vi.advanceTimersByTime(300);
    await nextTick();
    expect(document.querySelector('[data-test="refchip-hover"]')?.textContent).toContain("3 options");
    w.unmount();
  });
});

/** Open a chip's hover card and return its text. The filter's "reads as" used
 *  to live in the native `title`; it moved into the card so the chip could
 *  carry an empty title and stop an ancestor's tooltip overlaying it. */
async function cardTextFor(props: Record<string, unknown>): Promise<string> {
  vi.useFakeTimers();
  const w = mount(RefChip, { props: props as never, attachTo: document.body });
  await w.find(".wp-refchip").trigger("mouseenter");
  vi.advanceTimersByTime(300);
  await nextTick();
  const text = document.querySelector('[data-test="refchip-hover"]')?.textContent ?? "";
  w.unmount();
  vi.useRealTimers();
  return text;
}

describe("RefChip filter indicator", () => {
  it("shows a funnel + the expression on the hover card, not inline", async () => {
    const props = { kind: "ref", name: "colors", uuid: "aabbccdd", resolved: true, expr: "warm or cold", excludeNull: true };
    const w = mount(RefChip, { props: props as never });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("warm or cold");  // not inline
    w.unmount();
    const card = await cardTextFor(props);
    expect(card).toContain("warm or cold");
    expect(card).toMatch(/null/);
  });

  it("normalizes the expression on the hover card (reads-as)", async () => {
    // `warm,cold` (comma shorthand) reads as `warm or cold`.
    const w = mount(RefChip, {
      props: { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true, expr: "warm,cold" },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.classes()).toContain("wp-refchip--filtered");
    w.unmount();
    expect(await cardTextFor({ kind: "ref", name: "c", uuid: "aabbccdd", resolved: true, expr: "warm,cold" }))
      .toContain("warm or cold");
  });

  it("renders a funnel for exclude-null only (no expression)", async () => {
    const props = { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true, excludeNull: true };
    const w = mount(RefChip, { props: props as never });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    w.unmount();
    expect(await cardTextFor(props)).toMatch(/null excluded/);
  });

  it("shows no filter indicator for an unfiltered ref", () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(false);
    // Empty, never absent — an absent title lets the container's tooltip through.
    expect(w.attributes("title")).toBe("");
    expect(w.classes()).not.toContain("wp-refchip--filtered");
  });

  it("derives the funnel + card text from the deprecated subCategories fallback", async () => {
    // Pre-SP1 callers pass a flat list (comma = OR); a trailing `null`
    // token maps to exclude-null. Kept compiling + non-regressed until
    // those callers migrate to `expr` / `excludeNull`.
    const props = {
      kind: "ref", name: "color", uuid: "aabbccdd", resolved: true,
      subCategories: ["warm", "cool", "null"],
    };
    const w = mount(RefChip, { props: props as never });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("warm");  // not inline
    w.unmount();
    const card = await cardTextFor(props);
    expect(card).toContain("warm or cool");   // reads-as
    expect(card).toMatch(/null excluded/);
  });

  it("peels a glued !null marker out of the subCategories fallback", async () => {
    // The widget lexer comma-splits a v2 ref body WITHOUT peeling, so a
    // single-element list like ["warm or intense!null"] reaches this legacy
    // prop glued. RefChip must peel it — never show `!null` as text, surface
    // the exclude-null ban, and normalize the expression on the card.
    const props = {
      kind: "ref", name: "mood", uuid: "aabbccdd", resolved: true,
      subCategories: ["warm or intense!null"],
    };
    const w = mount(RefChip, { props: props as never });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("!null");  // never inline
    w.unmount();
    const card = await cardTextFor(props);
    expect(card).toContain("warm or intense");  // reads-as
    expect(card).not.toContain("!null");        // peeled on the card too
    expect(card).toMatch(/null excluded/);      // ban semantics
  });
});

describe("RefChip base rendering", () => {
  it("renders var kind with $name + green palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    expect(wrap.text()).toContain("$person");
    expect(wrap.classes()).toContain("wp-refchip");
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.classes()).not.toContain("wp-refchip--unresolved");
  });

  it("renders a var chip's .K list accessor as a single chip (SP2a)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "colors", index: 0, resolved: true },
    });
    expect(wrap.text()).toContain("$colors.0");
  });

  it("a ref chip ignores the index prop (no .K on refs)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true, index: 2 },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.text()).not.toContain(".2");
  });

  it("renders ref kind with @name + purple palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.classes()).toContain("wp-refchip--ref");
  });

  it("renders unresolved ref as red ? chip with uuid visible", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false },
    });
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
  });

  it("emits click on ref-kind chip body", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeTruthy();
  });

  it("var-kind chip does not emit click on click (no edit affordance)", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeFalsy();
  });
});

// ── kind-aware (moduleKind prop) ───────────────────────────────────
// The `moduleKind` prop drives the chip's color via the `--wp-refchip-tone`
// CSS custom property AND swaps the leading ✦ glyph for the matching
// PrimeIcon from `KIND_ICON_MAP`. Unresolved chips stay red regardless.
// Var chips ignore the prop entirely.
describe("RefChip moduleKind", () => {
  it("default ref kind (no moduleKind) keeps legacy wildcard styling", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    const chip = wrap.find(".wp-refchip");
    expect(chip.attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("moduleKind=wildcard explicitly is treated as default (no kind-aware styling)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true, moduleKind: "wildcard" },
    });
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  const KIND_CASES: Array<{ kind: "fixed_values" | "combine" | "derivation" | "constraint" | "bundle"; toneVar: string; iconCls: string }> = [
    { kind: "fixed_values", toneVar: "var(--wp-kind-fixed)",      iconCls: "pi-tag" },
    { kind: "combine",      toneVar: "var(--wp-kind-combine)",    iconCls: "pi-link" },
    { kind: "derivation",   toneVar: "var(--wp-kind-derivation)", iconCls: "pi-arrow-right-arrow-left" },
    { kind: "constraint",   toneVar: "var(--wp-kind-constraint)", iconCls: "pi-filter" },
    { kind: "bundle",       toneVar: "var(--wp-text-muted)",      iconCls: "pi-box" },
  ];
  for (const { kind, toneVar, iconCls } of KIND_CASES) {
    it(`moduleKind=${kind} applies its tone variable + matching PrimeIcon`, () => {
      const wrap = mount(RefChip, {
        props: { kind: "ref", name: "n", uuid: "aabbccdd", resolved: true, moduleKind: kind },
      });
      const chip = wrap.find(".wp-refchip");
      const style = chip.attributes("style") ?? "";
      expect(style).toContain("--wp-refchip-tone");
      expect(style).toContain(toneVar);
      const iconEl = wrap.find(".wp-refchip__icon--pi");
      expect(iconEl.exists()).toBe(true);
      expect(iconEl.classes()).toContain(iconCls);
    });
  }

  it("unresolved ref with moduleKind still renders as red `?` chip (kind ignored)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("var chip ignores moduleKind entirely (always green)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });
});

describe("RefChip hover card — which pool the count came from", () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Mount with an optional Context-node pool map provided, mirroring what
   *  ContextWidget does for every chip beneath it. */
  async function hoverCard(opts: {
    uuid: string;
    expr?: string;
    modules?: unknown[];
  }) {
    vi.useFakeTimers();
    const w = mount(RefChip, {
      props: {
        kind: "ref", name: "pose", uuid: opts.uuid, resolved: true,
        ...(opts.expr ? { expr: opts.expr } : {}),
      },
      attachTo: document.body,
      global: opts.modules
        ? { provide: { [CONTEXT_POOLS_KEY as symbol]: computed(() => buildContextPools(opts.modules)) } }
        : {},
    });
    await w.find(".wp-refchip").trigger("mouseenter");
    vi.advanceTimersByTime(300);
    await nextTick();
    const card = document.querySelector('[data-test="refchip-hover"]');
    const text = card?.textContent ?? "";
    w.unmount();
    return text;
  }

  const nodeModule = (uuid: string, tagSets: string[][], name: string) => ({
    id: uuid, type: "wildcard", meta: { name },
    payload: { options: tagSets.map((sub_categories, i) => ({ id: `o${i}`, sub_categories })) },
  });

  it("says 'library' when the ref's target is not in the node", async () => {
    _setForTests("beef0010", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    expect(await hoverCard({ uuid: "beef0010" })).toContain("pool: library");
  });

  it("names the node and its module when the node holds the pool", async () => {
    _setForTests("beef0011", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    const text = await hoverCard({
      uuid: "beef0011",
      modules: [nodeModule("beef0011", [[], []], "Pose pool")],
    });
    expect(text).toContain("pool: this node");
    expect(text).toContain("Pose pool");
  });

  it("counts against the NODE's pool, not the library's — that split is the bug", async () => {
    // Library has the `test`-tagged option; the node's snapshot predates it.
    _setForTests("beef0012", {
      name: "pose", kind: "wildcard",
      optionTagSets: [["test"], [], []],
    });
    const text = await hoverCard({
      uuid: "beef0012",
      expr: "test",
      modules: [nodeModule("beef0012", [[], []], "Pose pool")],
    });
    // 0 of 2 (the node), NOT 1 of 3 (the library).
    expect(text).toContain("0 of 2 options match");
    expect(text).not.toContain("1 of 3");
  });

  it("flags the drift so the differing library number is explained, not hidden", async () => {
    _setForTests("beef0013", {
      name: "pose", kind: "wildcard",
      optionTagSets: [["test"], [], []],
    });
    const text = await hoverCard({
      uuid: "beef0013",
      modules: [nodeModule("beef0013", [[], []], "Pose pool")],
    });
    expect(text).toContain("library has 3");
  });

  it("says nothing about the library when the two pools agree", async () => {
    _setForTests("beef0014", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    const text = await hoverCard({
      uuid: "beef0014",
      modules: [nodeModule("beef0014", [[], []], "Pose pool")],
    });
    expect(text).not.toContain("library has");
  });
});

describe("RefChip native tooltip", () => {
  it("carries an EMPTY title so an ancestor's tooltip can't overlay the card", () => {
    // Chips live inside the derivation rule/branch summaries, which put the
    // full row text on their own `title`. An omitted title lets that ancestor
    // tooltip through, so hovering a chip raised the native tooltip on top of
    // the chip's hover card. An empty title means "no advisory information"
    // and stops the lookup — omitting the attribute does not.
    const w = mount(RefChip, {
      props: { kind: "ref", name: "pose", uuid: "beef0020", resolved: true },
    });
    expect(w.find(".wp-refchip").attributes("title")).toBe("");
    w.unmount();
  });

  it("keeps the empty title on a FILTERED chip too — the reads-as lives in the card", () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "pose", uuid: "beef0021", resolved: true, expr: "warm" },
    });
    expect(w.find(".wp-refchip").attributes("title")).toBe("");
    w.unmount();
  });
});

describe("RefChip hover card — pool held by ANOTHER node", () => {
  afterEach(() => { vi.useRealTimers(); });

  async function cardWithLookup(homes: string[], modules?: unknown[]) {
    vi.useFakeTimers();
    const w = mount(RefChip, {
      props: { kind: "ref", name: "pose", uuid: "beef0030", resolved: true },
      attachTo: document.body,
      global: {
        provide: {
          [FOREIGN_POOL_LOOKUP_KEY as symbol]: () => homes,
          ...(modules
            ? { [CONTEXT_POOLS_KEY as symbol]: computed(() => buildContextPools(modules)) }
            : {}),
        },
      },
    });
    await w.find(".wp-refchip").trigger("mouseenter");
    vi.advanceTimersByTime(300);
    await nextTick();
    const text = document.querySelector('[data-test="refchip-hover"]')?.textContent ?? "";
    w.unmount();
    return text;
  }

  it("names the other node holding the pool, and says pools are not shared", async () => {
    _setForTests("beef0030", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    const text = await cardWithLookup(["dusk-marten"]);
    expect(text).toContain("also in dusk-marten");
    expect(text).toContain("other nodes don't share pools");
  });

  it("counts them when several nodes hold it, rather than listing every one", async () => {
    _setForTests("beef0030", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    expect(await cardWithLookup(["dusk-marten", "dawn-marten"])).toContain("2 other nodes");
  });

  it("stays silent when no other node holds it", async () => {
    _setForTests("beef0030", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    expect(await cardWithLookup([])).not.toContain("also in");
  });

  it("stays silent when THIS node supplies the pool — nothing to explain", async () => {
    _setForTests("beef0030", { name: "pose", kind: "wildcard", optionTagSets: [[], []] });
    const mine = [{
      id: "beef0030", type: "wildcard", meta: { name: "Pose pool" },
      payload: { options: [{ id: "o0", sub_categories: [] }] },
    }];
    expect(await cardWithLookup(["dusk-marten"], mine)).not.toContain("also in");
  });
});
