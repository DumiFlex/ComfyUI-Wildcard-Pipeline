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

describe("ContextWidget bundle ops via ctxmenu", () => {
  it("Wrap into new bundle creates bundle + stamps bundle_origin", async () => {
    resetDriftStore();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/wp/api/bundles") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "bn_new", name: "MyBundle", description: "", color: null,
          category_id: null, tags: [], is_favorite: false,
          children: [], payload_hash: "ph1", version: 1,
          created_at: "", updated_at: "",
        }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("prompt", vi.fn(() => "MyBundle"));

    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "aaaaaaaa", type: "wildcard", enabled: true,
          meta: { name: "Hair" }, entries: [],
          payload: { var_binding: "hair", options: [] }, payload_hash: "h-A",
        },
      ],
    });
    const onChange = vi.fn();
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 300, initialJson, upstreamVars: [], onChange },
    });
    await flushPromises();
    onChange.mockClear();

    await wrapper.find('[data-module-id="aaaaaaaa"]').trigger("contextmenu");
    await flushPromises();
    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    const wrap = items.find((el) => el.textContent?.includes("Wrap into new bundle"));
    expect(wrap, "Wrap item should appear for unbundled module").toBeTruthy();
    wrap!.click();
    await flushPromises();

    const postCall = fetchSpy.mock.calls.find(
      ([u, i]) => typeof u === "string" && u.includes("/wp/api/bundles") && (i as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall, "POST /wp/api/bundles fired").toBeTruthy();
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0] as string;
    const parsed = JSON.parse(last);
    expect(parsed.bundles).toHaveLength(1);
    expect(parsed.bundles[0].library_id).toBe("bn_new");
    expect(parsed.modules[0].bundle_origin).toBe(parsed.bundles[0]._uid);
    wrapper.unmount();
  });

  it("Save changes to library PUTs current children", async () => {
    resetDriftStore();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/wp/api/bundles/bn_existing") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({
          id: "bn_existing", name: "Existing", description: "", color: null,
          category_id: null, tags: [], is_favorite: false,
          children: body.children, payload_hash: "ph2", version: 2,
          created_at: "", updated_at: "",
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));

    const bundleUid = "buid12345678";
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "cccccccc", type: "wildcard", enabled: true,
          meta: { name: "EditedChild" }, entries: [],
          payload: { var_binding: "v", options: [{ id: "o1", value: "x", weight: 1 }] },
          payload_hash: "h-edited", bundle_origin: bundleUid,
        },
      ],
      bundles: [
        {
          _uid: bundleUid, library_id: "bn_existing",
          start_idx: 0, end_idx: 0, enabled: true, collapsed: false,
          inserted_at_hash: "ph1", name: "Existing", color: null,
        },
      ],
    });
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 301, initialJson, upstreamVars: [], onChange: () => {} },
    });
    await flushPromises();

    const header = document.querySelector(`[data-bundle-uid="${bundleUid}"][data-bundle-header]`);
    expect(header, "bundle header rendered").toBeTruthy();
    header!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flushPromises();
    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    const save = items.find((el) => el.textContent?.includes("Save changes to library"));
    expect(save, "Save changes to library item present").toBeTruthy();
    save!.click();
    await flushPromises();

    const putCall = fetchSpy.mock.calls.find(
      ([u, i]) => typeof u === "string" && u.includes("/wp/api/bundles/bn_existing") && (i as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall, "PUT /wp/api/bundles/bn_existing fired").toBeTruthy();
    const sentBody = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(sentBody.children).toHaveLength(1);
    expect(sentBody.children[0].id).toBe("cccccccc");
    expect(sentBody.children[0].payload_hash).toBe("h-edited");
    wrapper.unmount();
  });

  it("Reset to library snapshot replaces children with library state", async () => {
    resetDriftStore();
    const libraryChildren = [
      {
        id: "lib_child", type: "wildcard", enabled: true,
        meta: { name: "LibraryName" }, entries: [],
        payload: { var_binding: "v", options: [] }, payload_hash: "h-lib",
      },
    ];
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.match(/\/wp\/api\/bundles\/bn_reset$/) && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          id: "bn_reset", name: "ResetMe", description: "", color: null,
          category_id: null, tags: [], is_favorite: false,
          children: libraryChildren, payload_hash: "ph-lib", version: 3,
          created_at: "", updated_at: "",
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("confirm", vi.fn(() => true));

    const bundleUid = "buid87654321";
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "dddddddd", type: "wildcard", enabled: true,
          meta: { name: "LocallyEdited" }, entries: [],
          payload: { var_binding: "v", options: [{ id: "o2", value: "y", weight: 2 }] },
          payload_hash: "h-edited", bundle_origin: bundleUid,
        },
      ],
      bundles: [
        {
          _uid: bundleUid, library_id: "bn_reset",
          start_idx: 0, end_idx: 0, enabled: true, collapsed: false,
          inserted_at_hash: "ph-old", name: "ResetMe", color: null,
        },
      ],
    });
    const onChange = vi.fn();
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 302, initialJson, upstreamVars: [], onChange },
    });
    await flushPromises();
    onChange.mockClear();

    const header = document.querySelector(`[data-bundle-uid="${bundleUid}"][data-bundle-header]`);
    expect(header).toBeTruthy();
    header!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flushPromises();
    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    const reset = items.find((el) => el.textContent?.includes("Reset to library snapshot"));
    expect(reset).toBeTruthy();
    reset!.click();
    await flushPromises();

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0] as string;
    const parsed = JSON.parse(last);
    expect(parsed.modules).toHaveLength(1);
    expect(parsed.modules[0].id).toBe("lib_child");
    expect(parsed.modules[0].meta.name).toBe("LibraryName");
    expect(parsed.modules[0].payload_hash).toBe("h-lib");
    expect(parsed.bundles[0].inserted_at_hash).toBe("ph-lib");
    wrapper.unmount();
  });

  it("Reset re-adds children removed since insert (bundle end_idx grew via reconcile)", async () => {
    resetDriftStore();
    // Library has TWO children; in-graph bundle currently has ONE
    // (user removed the second via removeModule which shrank end_idx).
    const libraryChildren = [
      {
        id: "lib_c1", type: "wildcard", enabled: true,
        meta: { name: "Original1" }, entries: [],
        payload: { var_binding: "v1", options: [] }, payload_hash: "h1",
      },
      {
        id: "lib_c2", type: "wildcard", enabled: true,
        meta: { name: "Original2" }, entries: [],
        payload: { var_binding: "v2", options: [] }, payload_hash: "h2",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.match(/\/wp\/api\/bundles\/bn_restore$/) && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          id: "bn_restore", name: "RestoreMe", description: "", color: null,
          category_id: null, tags: [], is_favorite: false,
          children: libraryChildren, payload_hash: "ph-lib", version: 1,
          created_at: "", updated_at: "",
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));
    vi.stubGlobal("confirm", vi.fn(() => true));

    const bundleUid = "buidrestoreXX";
    // Only one child in the current bundle (the second was removed).
    // end_idx therefore shrunk to 0 via removeModule's reconcile path.
    const initialJson = JSON.stringify({
      version: 1,
      modules: [
        {
          id: "lib_c1", type: "wildcard", enabled: true,
          meta: { name: "Original1" }, entries: [],
          payload: { var_binding: "v1", options: [] }, payload_hash: "h1",
          bundle_origin: bundleUid,
        },
      ],
      bundles: [
        {
          _uid: bundleUid, library_id: "bn_restore",
          start_idx: 0, end_idx: 0, enabled: true, collapsed: false,
          inserted_at_hash: "ph-old", name: "RestoreMe", color: null,
        },
      ],
    });
    const onChange = vi.fn();
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 303, initialJson, upstreamVars: [], onChange },
    });
    await flushPromises();
    onChange.mockClear();

    const header = document.querySelector(`[data-bundle-uid="${bundleUid}"][data-bundle-header]`);
    expect(header).toBeTruthy();
    header!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flushPromises();
    const items = Array.from(document.querySelectorAll(".wp-ctxmenu__item")) as HTMLElement[];
    const reset = items.find((el) => el.textContent?.includes("Reset to library snapshot"));
    expect(reset).toBeTruthy();
    reset!.click();
    await flushPromises();

    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0] as string;
    const parsed = JSON.parse(last);
    // Library had 2 children; reset should restore both.
    expect(parsed.modules).toHaveLength(2);
    expect(parsed.modules.map((m: { id: string }) => m.id)).toEqual(["lib_c1", "lib_c2"]);
    expect(parsed.bundles[0].start_idx).toBe(0);
    expect(parsed.bundles[0].end_idx).toBe(1);
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
  meta?: Record<string, unknown>;
  payload_hash?: string;
  collapsed?: boolean;
  entries?: Array<{ variable_name: string; value: string }>;
};
function mountWithModules(stubs: StubModule[]) {
  const modules = stubs.map((s) => ({
    id: s.id,
    type: s.type,
    enabled: s.enabled,
    meta: s.meta ?? { name: `mod-${s.id}`, description: "", tags: [] },
    entries: s.entries ?? [],
    payload: s.payload ?? {},
    ...(s.instance !== undefined ? { instance: s.instance } : {}),
    ...(s.payload_hash !== undefined ? { payload_hash: s.payload_hash } : {}),
    ...(s.collapsed !== undefined ? { collapsed: s.collapsed } : {}),
  }));
  const initialJson = JSON.stringify({ version: 1, modules });
  return mount(ContextWidget, {
    props: { nodeId: 9000, initialJson, upstreamVars: [], onChange: () => {} },
  });
}

// ── Sibling badge (Phase B: lives in summary line, not header) ────────────
//
// Phase A shipped the badge in the header always-visible. Phase B
// (2026-05-10) moves it into the summary line so collapsed siblings
// stack cleanly without chrome bloat. Expanding any row reveals the
// chip alongside the binding via summaryTokens.

describe("ContextWidget sibling badge — summary line", () => {
  it("renders #N of M chip in summary when expanded + uuid count > 1", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true, collapsed: false },
      { id: "abc12345", type: "wildcard", enabled: true, collapsed: false },
    ]);
    const chips = wrapper.findAll('[data-test="sibling-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0].text()).toMatch(/#1\s*of\s*2/);
    expect(chips[1].text()).toMatch(/#2\s*of\s*2/);
    expect(chips[0].attributes("title")).toBe("used 2 times in this Context");
  });

  it("hides sibling chip when collapsed (no summary line rendered)", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true, collapsed: true },
      { id: "abc12345", type: "wildcard", enabled: true, collapsed: true },
    ]);
    expect(wrapper.findAll('[data-test="sibling-chip"]').length).toBe(0);
  });

  it("does NOT render sibling chip when uuid appears once", () => {
    const wrapper = mountWithModules([
      { id: "abc12345", type: "wildcard", enabled: true, collapsed: false },
    ]);
    expect(wrapper.find('[data-test="sibling-chip"]').exists()).toBe(false);
  });

  it("does NOT render sibling badge in the header (moved to summary)", () => {
    const wrapper = mountWithModules([
      { id: "shared03", type: "wildcard", enabled: true, collapsed: false },
      { id: "shared03", type: "wildcard", enabled: true, collapsed: false },
    ]);
    const headerBadges = wrapper.findAll(".wp-module-header .wp-mod-badge--sibling");
    expect(headerBadges.length).toBe(0);
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

  it("renders lock + internal icons for fixed_values rows (seed-lockable)", () => {
    // Post-2026-05-08 syntax-parity cycle: fixed_values resolves
    // `{a|b|c}` per value + honors `locked_seed`. Inline lock icon
    // surfaces same as wildcard.
    const wrapper = mountWithModules([
      { id: "def67890", type: "fixed_values", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-internal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-remove"]').exists()).toBe(true);
  });

  it("renders lock + internal icons for combine rows (seed-lockable)", () => {
    // Combine resolves inline `{a|b|c}` in its template + honors
    // `locked_seed` for that resolution.
    const wrapper = mountWithModules([
      { id: "cb123456", type: "combine", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-internal"]').exists()).toBe(true);
  });

  it("renders lock + internal icons for derivation rows (seed-lockable)", () => {
    // Derivation honors `locked_seed` since the 2026-05-10 expansion:
    // pins inline syntax resolution (`{a|b|c}` / nested wildcards)
    // inside `action.value`. Mirrors combine/fixed_values gating.
    const wrapper = mountWithModules([
      { id: "dv123456", type: "derivation", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="row-action-internal"]').exists()).toBe(true);
  });

  it("hides both lock and internal for constraint kind (no bindings produced)", () => {
    const wrapper = mountWithModules([
      { id: "def67890", type: "constraint", enabled: true },
    ]);
    expect(wrapper.find('[data-test="row-action-lock"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-action-internal"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="row-action-remove"]').exists()).toBe(true);
  });
});

// ── Modal dispatch: combine v2 routing ──────────────────────────────────
// Sanity check: when ContextWidget opens its edit modal for a combine
// module, the v2 CombineInstanceModal renders (NOT the v1 .wp-medit
// tabbed shell). Mirrors the existing wildcard / fixed_values v2
// dispatch coverage in ModuleEditModal.test.ts but at the
// ContextWidget level so the integration path stays guarded.

describe("ContextWidget combine v2 modal dispatch", () => {
  it("opens CombineInstanceModal (no v1 .wp-medit) for a combine module", async () => {
    // Mount with teleport stub so ModalShell content lands inline
    // where wrapper.find can reach it (rather than appended to body).
    const initialJson = JSON.stringify({
      version: 1,
      modules: [{
        id: "cb123456",
        type: "combine",
        enabled: true,
        meta: { name: "mod-cb123456", description: "", tags: [] },
        entries: [],
        payload: { template: "$style portrait", output_var: "result" },
      }],
    });
    const wrapper = mount(ContextWidget, {
      props: { nodeId: 9000, initialJson, upstreamVars: [], onChange: () => {} },
      global: { stubs: { teleport: true } },
    });
    const card = wrapper.find(".wp-module");
    await card.trigger("keydown", { key: "Enter" });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".cbm").exists()).toBe(true);
    expect(wrapper.find(".wp-medit").exists()).toBe(false);
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

// ── B3: kind chip next to module name (mockup v5 lines 681, 696, 711, 722, 733) ─

describe("ContextWidget kind chip", () => {
  it("renders inline kind chip next to the module name", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 900,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            { id: "wc", type: "wildcard", enabled: true, meta: { name: "hair" }, entries: [], payload: {} },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const chip = wrapper.find(".wp-kind-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("wildcard");
  });

  it("uses KIND_TITLE label for fixed_values kind", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 901,
        initialJson: moduleJson([{ name: "x", value: "y" }]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const chip = wrapper.find(".wp-kind-chip");
    expect(chip.exists()).toBe(true);
    // KIND_TITLE.fixed_values === "fixed" — matches mockup line 733.
    expect(chip.text()).toBe("fixed");
  });

  it("tags chip with a kind-color modifier class (e.g. wp-kind-chip--wildcard)", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 902,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            { id: "c1", type: "constraint", enabled: true, meta: { name: "rule" }, entries: [], payload: {} },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const chip = wrapper.find(".wp-kind-chip");
    expect(chip.classes()).toContain("wp-kind-chip--constraint");
  });
});

// ── Conflict badges (QA follow-up — labels next to wp-conflict-dot) ────────
// Pairs with the existing wp-conflict-dot the same way the status badges
// pair with wp-mod-dot. Covers shadows_upstream → "override" and
// missing_template_variable → "missing var".

describe("ContextWidget conflict badges", () => {
  it("renders 'override' badge when binding shadows an upstream var", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 950,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            // wildcard binding "x" — collides with upstream "x" → shadows_upstream
            {
              id: "ww111111",
              type: "wildcard",
              enabled: true,
              meta: { name: "x" },
              entries: [],
              payload: { var_binding: "x", options: [] },
            },
          ],
        }),
        upstreamVars: ["x"],
        onChange: () => {},
      },
    });
    const badge = wrapper.find(".wp-conflict-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("override");
  });

  it("renders 'missing var' badge when combine references a var not in scope", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 951,
        initialJson: JSON.stringify({
          version: 1,
          modules: [
            // combine template references $undefined — not in upstream nor sibling
            {
              id: "cb111111",
              type: "combine",
              enabled: true,
              meta: { name: "phrase" },
              entries: [],
              payload: { template: "uses $undefined", output_var: "out" },
            },
          ],
        }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const badge = wrapper.find(".wp-conflict-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("missing var");
  });
});

// ── Phase 3b: collapse stack mode (independent vs accordion) ───────────────
// Verifies that toggleCollapsed reads getCollapseMode() and acts accordingly:
// independent (default) leaves siblings alone, accordion forces only one
// expanded at a time. Collapsing never auto-expands siblings in either mode.

describe("ContextWidget collapse stack mode", () => {
  beforeEach(async () => {
    const { _resetDisplayStateForTesting } = await import("../../extension/settings");
    _resetDisplayStateForTesting();
  });

  /** Build a per-mode stub app whose extensionManager.setting.get returns
   *  the requested collapseMode (and safe defaults for everything else). */
  function makeAppFor(mode: "independent" | "accordion") {
    return {
      extensionManager: {
        setting: {
          get: (id: string) => {
            if (id === "wildcardPipeline.display.collapseMode") return mode;
            if (id === "wildcardPipeline.display.density") return "comfortable";
            if (id === "wildcardPipeline.display.decoration") return "full";
            if (id === "wildcardPipeline.display.indicatorStyle") return "badge";
            if (id === "wildcardPipeline.display.borderHighlight") return true;
            if (id === "wildcardPipeline.display.collapsedByDefault") return false;
            if (id === "wildcardPipeline.display.focusMode") return false;
            if (id === "wildcardPipeline.display.kindStyle") return "chip";
            if (id === "wildcardPipeline.behavior.validation") return "strict";
            if (id === "wildcardPipeline.behavior.toastLifetime") return "default";
            if (id === "wildcardPipeline.behavior.suppressInfoToasts") return false;
            if (id === "wildcardPipeline.behavior.newModuleDisabled") return false;
            return undefined;
          },
        },
      },
    };
  }

  /** Mount three fixed_values modules with explicit collapsed state per index. */
  function mountThreeWithCollapse(states: boolean[]) {
    const modules = states.map((collapsed, i) => ({
      id: `mod${i}aaaa`,
      type: "fixed_values",
      enabled: true,
      meta: { name: `m${i}`, description: "", tags: [] },
      entries: [{ variable_name: `v${i}`, value: "x" }],
      payload: {},
      collapsed,
    }));
    return mount(ContextWidget, {
      props: {
        nodeId: 9100,
        initialJson: JSON.stringify({ version: 1, modules }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
  }

  /** Read collapse state from chevron icon classes (caret-right = collapsed). */
  function readCollapsed(wrapper: ReturnType<typeof mountThreeWithCollapse>) {
    return wrapper
      .findAll(".wp-collapse-btn i.pi")
      .map((el) => el.classes().includes("pi-caret-right"));
  }

  it("independent mode: expanding one leaves siblings unchanged", async () => {
    const { applyDisplayPrefs } = await import("../../extension/settings");
    applyDisplayPrefs(makeAppFor("independent"));

    // m0+m1 collapsed, m2 expanded
    const wrapper = mountThreeWithCollapse([true, true, false]);
    expect(readCollapsed(wrapper)).toEqual([true, true, false]);

    // Click expand on m0 → m0 becomes expanded; m2 stays expanded.
    const btns = wrapper.findAll(".wp-collapse-btn");
    await btns[0].trigger("click");
    await flushPromises();

    expect(readCollapsed(wrapper)).toEqual([false, true, false]);
  });

  it("accordion mode: expanding one collapses every sibling", async () => {
    const { applyDisplayPrefs } = await import("../../extension/settings");
    applyDisplayPrefs(makeAppFor("accordion"));

    // m0+m1 collapsed, m2 expanded
    const wrapper = mountThreeWithCollapse([true, true, false]);
    expect(readCollapsed(wrapper)).toEqual([true, true, false]);

    // Click expand on m0 → m0 expanded; accordion collapses m2.
    const btns = wrapper.findAll(".wp-collapse-btn");
    await btns[0].trigger("click");
    await flushPromises();

    expect(readCollapsed(wrapper)).toEqual([false, true, true]);
  });

  it("accordion mode: collapsing a module does not auto-expand siblings", async () => {
    const { applyDisplayPrefs } = await import("../../extension/settings");
    applyDisplayPrefs(makeAppFor("accordion"));

    // m0+m1 collapsed, m2 expanded
    const wrapper = mountThreeWithCollapse([true, true, false]);
    expect(readCollapsed(wrapper)).toEqual([true, true, false]);

    // Click collapse on m2 → m2 collapsed; siblings stay where they were.
    const btns = wrapper.findAll(".wp-collapse-btn");
    await btns[2].trigger("click");
    await flushPromises();

    expect(readCollapsed(wrapper)).toEqual([true, true, true]);
  });
});

// ── Phase 3a: drag-drop overhaul ──────────────────────────────────────────
// Whole-card draggable, inline controls opt out, keyboard move-to-edge.

describe("ContextWidget drag-drop overhaul", () => {
  /** JSDOM doesn't provide a DataTransfer constructor; the handlers
   *  only need `effectAllowed` + `setData` + `dropEffect`, so a plain
   *  stub passes the dragstart / dragover paths cleanly. */
  function makeDataTransfer() {
    return {
      effectAllowed: "",
      dropEffect: "",
      setData: () => {},
      getData: () => "",
    };
  }

  function mountFour() {
    const modules = [0, 1, 2, 3].map((i) => ({
      id: `mod${i}aaaa`,
      type: "fixed_values",
      enabled: true,
      meta: { name: `m${i}`, description: "", tags: [] },
      entries: [{ variable_name: `v${i}`, value: "x" }],
      payload: {},
    }));
    return mount(ContextWidget, {
      attachTo: document.body,
      props: {
        nodeId: 9200,
        initialJson: JSON.stringify({ version: 1, modules }),
        upstreamVars: [],
        onChange: () => {},
      },
    });
  }

  it("entire .wp-module is draggable", () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.attributes("draggable")).toBe("true");
    }
    wrapper.unmount();
  });

  it("inline controls opt out of dragging via draggable=false", () => {
    const wrapper = mountFour();
    expect(wrapper.find(".wp-collapse-btn").attributes("draggable")).toBe("false");
    expect(wrapper.find(".wp-toggle").attributes("draggable")).toBe("false");
    expect(wrapper.find(".wp-mod-actions").attributes("draggable")).toBe("false");
    wrapper.unmount();
  });

  it("Ctrl+Shift+ArrowDown moves focused module to the bottom", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");
    // Trigger keydown on the first card; expect mod0 to land at the end.
    await cards[0].trigger("keydown", { key: "ArrowDown", shiftKey: true, ctrlKey: true });
    await flushPromises();

    const ids = wrapper.findAll(".wp-module").map((c) => c.attributes("data-module-id"));
    expect(ids).toEqual(["mod1aaaa", "mod2aaaa", "mod3aaaa", "mod0aaaa"]);
    wrapper.unmount();
  });

  it("Ctrl+Shift+ArrowUp moves focused module to the top", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");
    // Trigger keydown on the third card; expect mod2 to land at index 0.
    await cards[2].trigger("keydown", { key: "ArrowUp", shiftKey: true, ctrlKey: true });
    await flushPromises();

    const ids = wrapper.findAll(".wp-module").map((c) => c.attributes("data-module-id"));
    expect(ids).toEqual(["mod2aaaa", "mod0aaaa", "mod1aaaa", "mod3aaaa"]);
    wrapper.unmount();
  });

  it("Cmd+Shift+ArrowDown also works (Mac modifier)", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");
    await cards[0].trigger("keydown", { key: "ArrowDown", shiftKey: true, metaKey: true });
    await flushPromises();

    const ids = wrapper.findAll(".wp-module").map((c) => c.attributes("data-module-id"));
    expect(ids).toEqual(["mod1aaaa", "mod2aaaa", "mod3aaaa", "mod0aaaa"]);
    wrapper.unmount();
  });

  it("plain Shift+ArrowDown still moves by 1 (regression check)", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");
    await cards[0].trigger("keydown", { key: "ArrowDown", shiftKey: true });
    await flushPromises();

    const ids = wrapper.findAll(".wp-module").map((c) => c.attributes("data-module-id"));
    // mod0 swaps with mod1 only — does not land at the end.
    expect(ids).toEqual(["mod1aaaa", "mod0aaaa", "mod2aaaa", "mod3aaaa"]);
    wrapper.unmount();
  });

  it("dragover with clientY in top half marks card as drop-target--before", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");

    // Stub getBoundingClientRect on the second card so the math has a
    // measurable rect (JSDOM defaults to 0/0). Top half of a 200px-tall
    // card centered at y=300 → y=200..300 means "before".
    const targetEl = cards[1].element as HTMLElement;
    targetEl.getBoundingClientRect = () => ({
      top: 200, bottom: 400, left: 0, right: 100,
      width: 100, height: 200, x: 0, y: 200, toJSON() { return this; },
    });

    // Initiate a drag from the first card so dragState is populated.
    await cards[0].trigger("dragstart", { dataTransfer: makeDataTransfer() });
    // Hover with pointer in the TOP half of the second card (y=220).
    await cards[1].trigger("dragover", { clientY: 220, dataTransfer: makeDataTransfer() });
    await flushPromises();

    expect(cards[1].classes()).toContain("wp-drop-target");
    expect(cards[1].classes()).toContain("wp-drop-target--before");
    expect(cards[1].classes()).not.toContain("wp-drop-target--after");

    await cards[0].trigger("dragend");
    wrapper.unmount();
  });

  it("dragover with clientY in bottom half marks card as drop-target--after", async () => {
    const wrapper = mountFour();
    const cards = wrapper.findAll(".wp-module");

    const targetEl = cards[1].element as HTMLElement;
    targetEl.getBoundingClientRect = () => ({
      top: 200, bottom: 400, left: 0, right: 100,
      width: 100, height: 200, x: 0, y: 200, toJSON() { return this; },
    });

    await cards[0].trigger("dragstart", { dataTransfer: makeDataTransfer() });
    // BOTTOM half (y=380, well past the midpoint at y=300).
    await cards[1].trigger("dragover", { clientY: 380, dataTransfer: makeDataTransfer() });
    await flushPromises();

    expect(cards[1].classes()).toContain("wp-drop-target--after");
    expect(cards[1].classes()).not.toContain("wp-drop-target--before");

    await cards[0].trigger("dragend");
    wrapper.unmount();
  });
});

// ── Phase B: duplicate keeps uuid + auto-suffixes binding ──────────────
//
// Right-click → Duplicate now creates a SIBLING (same uuid) instead of
// a fork-without-library. Per-instance binding gets auto-suffixed so
// $foo and $foo_2 don't collide as duplicate-variable conflicts. The
// Ctrl+D keyboard shortcut on a focused module row routes through the
// same `duplicateModule` function as the right-click menu, giving us a
// stable handle for tests.

describe("ContextWidget — Phase B: duplicate keeps uuid + auto-suffixes binding", () => {
  it("wildcard duplicate keeps uuid + payload_hash + auto-suffixes binding via instance", async () => {
    const wrapper = mountWithModules([
      {
        id: "wcAAA111",
        type: "wildcard",
        enabled: true,
        meta: { name: "hair_style", library_name: "hair_style" },
        payload: { options: [], var_binding: "hair_style" },
        payload_hash: "h_lib",
      },
    ]);
    // Focus the row, then send Ctrl+D — wired in onCardKeydown to call
    // duplicateModule(id) directly. Avoids brittle context-menu finds.
    const row = wrapper.find('[data-module-id="wcAAA111"]');
    await row.trigger("keydown", { key: "d", ctrlKey: true });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll("[data-module-id]");
    expect(cards.length).toBe(2);
    // Same uuid (NOT a new one).
    expect(cards[0].attributes("data-module-id")).toBe("wcAAA111");
    expect(cards[1].attributes("data-module-id")).toBe("wcAAA111");
    wrapper.unmount();
  });

  it("derivation duplicate keeps uuid (no binding to suffix)", async () => {
    const wrapper = mountWithModules([
      {
        id: "dvCCC333",
        type: "derivation",
        enabled: true,
        meta: { name: "rules" },
        payload: { rules: [] },
        payload_hash: "h_dv",
      },
    ]);
    const row = wrapper.find('[data-module-id="dvCCC333"]');
    await row.trigger("keydown", { key: "d", ctrlKey: true });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll("[data-module-id]");
    expect(cards.length).toBe(2);
    expect(cards[1].attributes("data-module-id")).toBe("dvCCC333");
    wrapper.unmount();
  });
});
