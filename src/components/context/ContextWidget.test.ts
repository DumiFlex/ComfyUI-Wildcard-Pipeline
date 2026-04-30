import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
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
    // Empty hero shows the brand title + the "Add your first module" CTA.
    expect(wrapper.text()).toContain("Wildcard Pipeline");
    expect(wrapper.text()).toContain("Add your first module");
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
      expect(btn.text()).toContain("2");
    });
    wrapper.unmount();
  });
});
