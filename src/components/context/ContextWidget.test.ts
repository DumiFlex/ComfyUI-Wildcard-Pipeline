import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ContextWidget from "./ContextWidget.vue";
import { _resetForTests as resetDriftStore } from "./drift-store";

beforeEach(() => {
  // Phase 5.5.4 — the picker now fetches the library on mount. Stub
  // global `fetch` so component tests don't hit a real server. Default
  // returns an empty list; per-test overrides as needed.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/wp/api/modules/list")) {
      return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});

afterEach(() => {
  // Modals teleport to body — strip leftover overlays between tests.
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  vi.unstubAllGlobals();
});

const moduleJson = (vars: Array<{ name: string; value: string }>): string =>
  JSON.stringify({
    version: 1,
    modules: [
      {
        id: "m1",
        type: "fixed_values",
        enabled: true,
        meta: { name: "test mod", description: "", tags: [] },
        entries: vars.map((v) => ({ variable_name: v.name, value: v.value })),
      },
    ],
  });

describe("ContextWidget.vue", () => {
  it("renders an empty state when no modules", () => {
    const wrapper = mount(ContextWidget, {
      props: { nodeId: 1, initialJson: '{"version":1,"modules":[]}', upstreamVars: [], onChange: () => {} },
    });
    // Empty hero shows the "No modules yet" title + the "Add module" CTA.
    expect(wrapper.find('[data-test="context-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("No modules yet");
    expect(wrapper.text()).toContain("Add module");
  });

  it("opens the library picker and surfaces it in the DOM", async () => {
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 2, initialJson: '{"version":1,"modules":[]}', upstreamVars: [], onChange: () => {} },
    });
    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    await wrapper.vm.$nextTick();
    // Phase 5.5.4 — picker is now a library browser, not a "kind chooser".
    // It teleports its modal to <body> and renders a search input + tab strip.
    const search = document.querySelector('[data-testid="picker-search"]');
    expect(search).not.toBeNull();
    const allTab = document.querySelector('[data-testid="picker-tab-all"]');
    expect(allTab).not.toBeNull();
  });

  it("renders a summary line per module — first 2 vars + '+N more' for the rest", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 3,
        initialJson: moduleJson([
          { name: "style", value: "noir" },
          { name: "subject", value: "fox" },
          { name: "mood", value: "calm" },
          { name: "light", value: "soft" },
        ]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toBe("$style, $subject, +2 more");
  });

  it("module name renders read-only as text (not an input)", () => {
    const wrapper = mount(ContextWidget, {
      props: { nodeId: 4, initialJson: moduleJson([]), upstreamVars: [], onChange: () => {} },
    });
    expect(wrapper.find("input.wp-module-name").exists()).toBe(false);
    expect(wrapper.find(".wp-module-name").text()).toBe("test mod");
  });

  it("summary line is read-only — not a button, no click handler", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 5,
        initialJson: moduleJson([{ name: "style", value: "noir" }]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    expect(summary.exists()).toBe(true);
    // Read-only div, not a button — edit access is via right-click → Edit
    // or Enter on the focused card.
    expect(summary.element.tagName).toBe("DIV");
  });

  // B1: meta line var-token highlighting (mockup v5 lines 682, 697, 712, 723, 734)
  it("renders variable names in summary as .var-tok spans with kind-color class", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 6,
        initialJson: moduleJson([
          { name: "style", value: "noir" },
          { name: "subject", value: "fox" },
        ]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    // Each $var token gets its own span, color-classed via varColorClass.
    const tokens = summary.findAll(".var-tok");
    expect(tokens.length).toBe(2);
    expect(tokens[0].text()).toBe("$style");
    expect(tokens[1].text()).toBe("$subject");
    // Color class hashes the binding name (without leading $).
    expect(tokens[0].classes().some((c) => /^var-\d+$/.test(c))).toBe(true);
    expect(tokens[1].classes().some((c) => /^var-\d+$/.test(c))).toBe(true);
    // Concatenated text still matches the legacy summary string so existing
    // tests + screen-reader output stay equivalent.
    expect(summary.text()).toBe("$style, $subject");
  });

  it("renders wildcard summary with binding token + opt count as separate spans", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 7,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            {
              id: "wc1",
              type: "wildcard",
              enabled: true,
              meta: { name: "hair_style" },
              entries: [],
              payload: { var_binding: "hair_style", options: [{}, {}, {}] },
            },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    const tokens = summary.findAll(".var-tok");
    expect(tokens.length).toBe(1);
    expect(tokens[0].text()).toBe("$hair_style");
    expect(summary.text()).toContain("3 options");
  });
});

describe("ContextWidget drift dot", () => {
  it("renders wp-mod-dot--drift when embedded hash differs from live hash", async () => {
    // Reset the shared drift-store singleton so refCount + hashes don't leak
    // from earlier tests in this file (those mounts never call wrapper.unmount).
    resetDriftStore();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          // Live hash differs from embedded → drift.
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "h-LIVE" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "aaaaaaaa",
          type: "wildcard",
          enabled: true,
          meta: { name: "wc", description: "", tags: [] },
          entries: [],
          payload: { options: [] },
          payload_hash: "h-EMBEDDED",
        },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 99, initialJson, upstreamVars: [], onChange: () => {} },
    });

    // Wait for the store's first poll to land.
    await vi.waitFor(() => {
      expect(wrapper.find(".wp-mod-dot--drift").exists()).toBe(true);
    });

    // Sanity: missing dot must NOT also render — uuid is in library.
    expect(wrapper.find(".wp-mod-dot--missing").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("ContextWidget bulk refresh", () => {
  it("hides the bulk button when no module is drifted", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "h-A", bbbbbbbb: "h-B" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "h-A" },
        { id: "bbbbbbbb", type: "wildcard", enabled: true, meta: { name: "b" }, entries: [], payload: {}, payload_hash: "h-B" },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 100, initialJson, upstreamVars: [], onChange: () => {} },
    });

    // Wait for the store's first poll. With both synced, no drift dots
    // and the bulk button stays hidden.
    await vi.waitFor(() => {
      const dots = wrapper.findAll(".wp-mod-dot--drift");
      expect(dots.length).toBe(0);
    });
    expect(wrapper.find('[data-testid="bulk-refresh-drifted"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows the bulk button with the drifted count when at least one drifts", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          // Both embedded hashes differ from live → both drifted.
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "live-A", bbbbbbbb: "live-B" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "h-A" },
        { id: "bbbbbbbb", type: "wildcard", enabled: true, meta: { name: "b" }, entries: [], payload: {}, payload_hash: "h-B" },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 101, initialJson, upstreamVars: [], onChange: () => {} },
    });

    await vi.waitFor(() => {
      const btn = wrapper.find('[data-testid="bulk-refresh-drifted"]');
      expect(btn.exists()).toBe(true);
      // Tight match — guards against off-by-one + label-format regressions.
      expect(btn.text()).toContain("refresh 2 drifted");
    });
    wrapper.unmount();
  });

  it("clears the drift dot + propagates onChange after bulk refresh", async () => {
    resetDriftStore();

    // Stub flow:
    //   hashes poll  → returns { aaaaaaaa: "live-A" } so the embedded
    //                  hash "embedded-A" lights up the drift dot.
    //   embed-bundle → returns the live snapshot whose payload_hash
    //                  matches the live hash, so after merge + the
    //                  forceRefresh follow-up the dot clears.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "live-A" } }), { status: 200 });
        }
        if (typeof url === "string" && url.endsWith("/embed-bundle")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { uuids: string[] };
          expect(body.uuids).toEqual(["aaaaaaaa"]);
          return new Response(
            JSON.stringify({
              snapshots: {
                aaaaaaaa: {
                  snapshot_version: 1,
                  uuid: "aaaaaaaa",
                  type: "wildcard",
                  name: "a",
                  payload: { options: ["fresh"] },
                  payload_hash: "live-A",
                  source: { kind: "user" },
                },
              },
              pickOrder: ["aaaaaaaa"],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: { options: ["old"] }, payload_hash: "embedded-A" },
      ],
    });

    const onChange = vi.fn();
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 110, initialJson, upstreamVars: [], onChange },
    });

    // Drift dot lights up on the first poll.
    await vi.waitFor(() => {
      expect(wrapper.find(".wp-mod-dot--drift").exists()).toBe(true);
    });
    onChange.mockClear();           // ignore initial-mount onChange noise

    // Click the bulk-refresh button. It calls refreshAllDrifted, which
    // exercises the same merge code path refreshOne uses (single-uuid
    // batched fetch + map-replace mutation + forceRefresh).
    await wrapper.find('[data-testid="bulk-refresh-drifted"]').trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.find(".wp-mod-dot--drift").exists()).toBe(false);
    });
    // Deep watcher caught the array reassignment + propagated to onChange.
    expect(onChange).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("hides the Refresh menu item entirely for synced entries", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          // Synced — embedded hash matches live, no drift.
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "h-A" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "h-A" },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 120, initialJson, upstreamVars: [], onChange: () => {} },
    });

    // Wait for the store's first poll so isDrifted has a definitive answer.
    await vi.waitFor(() => {
      const dots = wrapper.findAll(".wp-mod-dot--drift");
      expect(dots.length).toBe(0);
    });

    // Right-click the card to open the context menu.
    await wrapper.find('[data-module-id="aaaaaaaa"]').trigger("contextmenu");
    await flushPromises();

    // ContextMenu teleports to <body>, so query the real DOM. Refresh
    // entry is conditionally pushed (matching Save's pattern) and must
    // be absent for synced modules.
    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    expect(items.length).toBeGreaterThan(0);
    const refresh = items.find((el) => el.textContent?.includes("Refresh from library"));
    expect(refresh, "Refresh from library should be hidden for synced entries").toBeUndefined();
    wrapper.unmount();
  });

  it("shows the Refresh menu item for drifted entries", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "live-A" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "embedded-A" },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 121, initialJson, upstreamVars: [], onChange: () => {} },
    });

    await vi.waitFor(() => {
      expect(wrapper.find(".wp-mod-dot--drift").exists()).toBe(true);
    });

    await wrapper.find('[data-module-id="aaaaaaaa"]').trigger("contextmenu");
    await flushPromises();

    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    const refresh = items.find((el) => el.textContent?.includes("Refresh from library"));
    expect(refresh, "Refresh from library should appear for drifted entries").toBeTruthy();
    expect(refresh!.classList.contains("wp-ctxmenu__item--disabled")).toBe(false);
    wrapper.unmount();
  });
});

describe("ContextWidget summaryFor — constraint", () => {
  it("renders $src → $tgt · NxM with sibling lookup", async () => {
    resetDriftStore();
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "aaaaaaaa", type: "wildcard", enabled: true,
          meta: { name: "Hair Color" }, entries: [],
          payload: { options: [], var_binding: "hair_color" },
        },
        {
          id: "bbbbbbbb", type: "wildcard", enabled: true,
          meta: { name: "Outfit" }, entries: [],
          payload: { options: [], var_binding: "outfit" },
        },
        {
          id: "cccccccc", type: "constraint", enabled: true,
          meta: { name: "Hair × Outfit" }, entries: [],
          payload: {
            source_wildcard_id: "aaaaaaaa",
            target_wildcard_id: "bbbbbbbb",
            matrix: {
              "blonde": { "casual": { mode: "allow", factor: 1 }, "formal": { mode: "allow", factor: 1 } },
              "raven":  { "casual": { mode: "allow", factor: 1 }, "formal": { mode: "allow", factor: 1 } },
            },
            exceptions: [],
          },
          payload_hash: "h",
        },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 200, initialJson, upstreamVars: [], onChange: () => {} },
    });

    const card = wrapper.find('[data-module-id="cccccccc"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("$hair_color → $outfit · 2×2");
    wrapper.unmount();
  });

  it("combine referencing $a does NOT flag missing when upstreamVars contains 'a'", async () => {
    // Regression: post-5.5.6 QA reported that a combine in Context B
    // referencing $a written by upstream Context A still showed the
    // missing-var dot. Pin the contract — when ContextWidget receives
    // upstreamVars=['a'] (the walker's job), no missing-var conflict
    // surfaces for the combine that references $a. If THIS test ever
    // fails, the bug is in ContextWidget / scanConflicts. If THIS
    // test passes but the canvas still shows the dot, the bug is
    // upstream of the prop — in `widgets/context.ts` /
    // `extension/graph.ts` walker / `extension/reactive.ts` polling.
    resetDriftStore();
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "c0000001", type: "combine", enabled: true,
          meta: { name: "join" }, entries: [],
          payload: { template: "$a and $b", output_var: "out", input_vars: [] },
        },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 250, initialJson, upstreamVars: ["a"], onChange: () => {} },
    });
    await flushPromises();
    const card = wrapper.find('[data-module-id="c0000001"]');
    expect(card.exists()).toBe(true);
    // $b is still missing — yellow warning dot expected.
    const dot = card.find(".wp-conflict-dot");
    expect(dot.exists()).toBe(true);
    // Tooltip mentions $b but NOT $a. $a is satisfied by upstreamVars.
    const title = card.find(".wp-conflict-dot").attributes("title") ?? "";
    expect(title).toContain("$b");
    expect(title).not.toContain("$a");
    wrapper.unmount();
  });

  it("falls back to ? when source/target uuid is missing from siblings", async () => {
    resetDriftStore();
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "cccccccc", type: "constraint", enabled: true,
          meta: { name: "Dangling" }, entries: [],
          payload: {
            source_wildcard_id: "deadbeef",
            target_wildcard_id: null,
            matrix: {},
            exceptions: [],
          },
          payload_hash: "h",
        },
      ],
    });

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 201, initialJson, upstreamVars: [], onChange: () => {} },
    });
    const card = wrapper.find('[data-module-id="cccccccc"]');
    expect(card.text()).toContain("$? → $? · 0×0");
    wrapper.unmount();
  });
});

describe("ContextWidget — fixed_values picked from library", () => {
  /**
   * Regression: post-5.5.6 the picker can embed any kind. For
   * fixed_values the engine reads `payload.values` but the widget
   * UI reads `m.entries` for the collapsed-card summary + the inline
   * editor. Without hoisting on pick, the card rendered with an
   * empty body. Pin the hoist so the summary surfaces the bindings.
   */
  it("hoists payload.values into entries on library pick (mocked)", async () => {
    resetDriftStore();
    // Stub embed-bundle so the pick flow returns a fixed_values
    // snapshot whose payload.values carries 3 named bindings.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/embed-bundle")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { uuids: string[] };
          expect(body.uuids).toEqual(["12345abc"]);
          return new Response(
            JSON.stringify({
              modules: [],
              snapshots: {
                "12345abc": {
                  uuid: "12345abc",
                  type: "fixed_values",
                  name: "presets",
                  payload: {
                    values: [
                      { id: "val_0001", name: "style",   value: "noir" },
                      { id: "val_0002", name: "subject", value: "fox" },
                      { id: "val_0003", name: "mood",    value: "calm" },
                    ],
                  },
                  payload_hash: "h-fv",
                },
              },
              pickOrder: ["12345abc"],
              walkOverflow: [],
            }),
            { status: 200 },
          );
        }
        // Default for /list, /hashes, /categories etc.
        return new Response("{}", { status: 200 });
      }),
    );

    const onChange = vi.fn();
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 300, initialJson: '{"version":1,"modules":[]}', upstreamVars: [], onChange },
    });

    // Drive a library add by directly invoking the picker emit
    // — the picker UI is exercised by its own tests; here we want
    // the widget's onPickerAdd branch to run with our stub.
    const picker = wrapper.findComponent({ name: "ModulePickerModal" });
    expect(picker.exists()).toBe(true);
    picker.vm.$emit("add", ["12345abc"]);

    await flushPromises();

    const card = wrapper.find('[data-module-id="12345abc"]');
    expect(card.exists()).toBe(true);
    // summaryFor for fixed_values renders "$style, $subject, +1 more".
    expect(card.text()).toContain("$style");
    expect(card.text()).toContain("$subject");
    expect(card.text()).toContain("+1 more");
    wrapper.unmount();
  });
});

// ── Task 9 helpers ──────────────────────────────────────────────────────────

/** Minimal mount helper for Task 9 tests. Accepts a compact module descriptor
 *  array and serialises it into the initialJson format ContextWidget expects.
 *  `id`, `type`, and `enabled` are required; remaining fields default to safe
 *  empty values so callers only specify what the test cares about. */
type StubModule = {
  id: string;
  type: string;
  enabled: boolean;
  payload?: Record<string, unknown>;
  instance?: Record<string, unknown>;
};
function mountWithModules(stubs: StubModule[]) {
  const modules = stubs.map((s) => ({
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    meta: { name: `mod-${s.id}`, description: "", tags: [] },
    entries: [],
    payload: s.payload ?? {},
    ...(s.instance !== undefined ? { instance: s.instance } : {}),
  }));
  const initialJson = JSON.stringify({ version: 1, modules });
  return mount(ContextWidget, {
    props: { nodeId: 9000, initialJson, upstreamVars: [], onChange: () => {} },
  });
}

// ── Sibling badge ───────────────────────────────────────────────────────────

describe("ContextWidget sibling badge", () => {
  it("renders #N of M badge when uuid duplicated in same Context", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true },
      { id: "abc12345", type: "wildcard", enabled: true },
    ]);
    const badges = wrapper.findAll(".wp-mod-badge--sibling");
    expect(badges).toHaveLength(2);
    expect(badges[0].text()).toMatch(/#1\s*of\s*2/);
    expect(badges[1].text()).toMatch(/#2\s*of\s*2/);
    expect(badges[0].attributes("title")).toBe("used 2 times in this Context");
  });

  it("does NOT render sibling badge when uuid appears once", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true },
    ]);
    expect(wrapper.find(".wp-mod-badge--sibling").exists()).toBe(false);
  });
});

// ── Inline actions ──────────────────────────────────────────────────────────

describe("ContextWidget inline actions", () => {
  it("renders lock + internal + remove icons for wildcard rows", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').find("i.pi.pi-lock").exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-internal"]').find("i.pi.pi-globe").exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-remove"]').find("i.pi.pi-trash").exists()).toBe(true);
  });

  it("hides lock + internal for non-wildcard rows", () => {
    const wrapper = mountWithModules([
      { id: "def67890", type: "fixed_values", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-action-internal"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-action-remove"]').exists()).toBe(true);
  });
});


// ── B2: status badges (mockup v5 lines 714, 736, 861) ──────────────────────
// Text-style labels next to the existing 7px dots so users discover the
// indicator meaning without hovering for the tooltip.

describe("ContextWidget status badges", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/list")) {
          return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  it("renders 'drift' text badge alongside the drift dot", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          return new Response(JSON.stringify({ hashes: { aaaaaaaa: "live" } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: {
        nodeId: 800,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "embedded" },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });

    await vi.waitFor(() => {
      const badge = wrapper.find(".wp-mod-badge--drift");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("drift");
    });
    wrapper.unmount();
  });

  it("renders 'missing' text badge when uuid is not in library", async () => {
    resetDriftStore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
          // Empty hashes map → uuid not in lib → missing.
          return new Response(JSON.stringify({ hashes: {} }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: {
        nodeId: 801,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            { id: "aaaaaaaa", type: "wildcard", enabled: true, meta: { name: "a" }, entries: [], payload: {}, payload_hash: "embedded" },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });

    await vi.waitFor(() => {
      const badge = wrapper.find(".wp-mod-badge--missing");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("missing");
    });
    wrapper.unmount();
  });
});
