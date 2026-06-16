// DerivationInstanceModal — single-pane v2 shell. Mirrors
// WildcardInstanceModal + CombineInstanceModal + FixedValuesInstanceModal
// structure: brand-gradient header, sections, footer with SPA link +
// reset overrides + drift kebab + cancel/save. Header icon: pi-arrow-right-arrow-left
// (same icon picker.ts uses for derivation kind).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import DerivationInstanceModal from "./DerivationInstanceModal.vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "dv012345",
    type: "derivation",
    enabled: true,
    meta: { name: "mood-rules" },
    entries: [],
    payload: {
      rules: [{
        id: "r1",
        branches: [{
          condition: { var: "color", op: "equals", value: "red" },
          action: { target_var: "mood", mode: "replace", value: "warm" },
        }],
      }],
    },
    instance: {},
    payload_hash: "h",
    ...overrides,
  };
}

describe("DerivationInstanceModal", () => {
  it("renders pi-arrow-right-arrow-left icon in header", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.find(".wp-dvm__head-icon.pi.pi-arrow-right-arrow-left").exists()).toBe(true);
  });

  it("renders 'derivation' chip + module name", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.find('[data-test="dvm-name"]').text()).toBe("mood-rules");
    expect(w.find('[data-test="dvm-chip"]').text().toLowerCase()).toBe("derivation");
  });

  it("renders Identity + Rules + Runtime sections", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    expect(w.findComponent({ name: "IdentitySection" }).exists()).toBe(true);
    expect(w.findComponent({ name: "RulesSection" }).exists()).toBe(true);
    // Runtime added in 2026-05-10 tier-D expansion (Lock seed + Hide).
    expect(w.findComponent({ name: "RuntimeSection" }).exists()).toBe(true);
  });

  it("RuntimeSection updates bubble through to update event", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const runtime = w.findComponent({ name: "RuntimeSection" });
    runtime.vm.$emit("update", { instance: { locked_seed: 4242 } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.locked_seed).toBe(4242);
  });

  it("forwards section update events upward", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const rules = w.findComponent({ name: "RulesSection" });
    rules.vm.$emit("update", { instance: { disabled_rule_ids: ["r1"] } });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    expect((updates[0][0] as Partial<ModuleEntry>).instance?.disabled_rule_ids).toEqual(["r1"]);
  });

  it("SPA link points at /wp/derivations/<id>/edit", () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const link = w.find<HTMLAnchorElement>('[data-test="dvm-spa-link"]').element;
    expect(link.getAttribute("href")).toBe("/wp/derivations/dv012345/edit");
  });

  it("Save + Cancel emit correct events", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="dvm-save"]').trigger("click");
    expect(w.emitted("save")).toBeTruthy();
    await w.find('[data-test="dvm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  // PushToLibraryModal owns the explicit fork-vs-update choice now;
  // see WildcardInstanceModal.test.ts for the migration commentary.
  it("Save to library visible when payload exists, regardless of isModified", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: false },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library still visible when library-tracked + modified", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule(), isDrifted: false, isModified: true },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(true);
  });

  it("Save to library visible for inline-created (no payload_hash)", () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule({ payload_hash: undefined }), isModified: true },
    });
    expect(w.find('[data-test="dvm-save-lib"]').exists()).toBe(true);
  });

  it("Reset overrides emits clear-all-overrides", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await w.find('[data-test="dvm-clear-all"]').trigger("click");
    expect(w.emitted("clear-all-overrides")).toBeTruthy();
  });
});

// ── Library-catalog fetch + ref-data wiring (@{} parity) ──────────────
//
// On open the modal fetches /wp/api/modules ONCE, builds the wildcard
// `@{}` ref-data via buildWildcardRefData, and forwards it (+ the
// $var suggestion list from upstream/sibling vars) down to RulesSection
// so the canvas reaches full parity with the SPA derivation editor.
// Mirrors the fetch pattern in ModulePickerModal (`{ items: ModuleRow[] }`).

interface FakeRow {
  id: string;
  type: string;
  name: string;
  payload?: Record<string, unknown>;
}

const LIBRARY_ROWS: FakeRow[] = [
  // This derivation module itself — must be EXCLUDED from refSuggestions.
  { id: "dv012345", type: "derivation", name: "mood-rules", payload: { rules: [] } },
  {
    id: "aabbccdd",
    type: "wildcard",
    name: "color",
    payload: {
      var_binding: "color",
      sub_categories: ["warm", "cool"],
      options: [
        { id: "o1", value: "red", sub_categories: ["warm"] },
        { id: "o2", value: "blue", sub_categories: ["cool"] },
      ],
      tag_groups: { temp: ["warm", "cool"] },
    },
  },
  {
    id: "eeff0011",
    type: "wildcard",
    name: "outfit",
    payload: { var_binding: "outfit", options: [{ id: "o1", value: "tee" }] },
  },
  // A non-wildcard row — must NOT contribute to refSuggestions.
  { id: "cc001122", type: "combine", name: "combo", payload: { output_var: "x" } },
];

function stubModulesFetch(rows: FakeRow[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("/wp/api/modules") ? { items: rows, total: rows.length } : {},
    })) as unknown as typeof fetch,
  );
}

/** Flush the fetch → json() microtask chain + a nextTick so the
 *  ref-data computed re-evaluates after the catalog populates. */
async function flushFetch(w: ReturnType<typeof mount>): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await w.vm.$nextTick();
}

describe("DerivationInstanceModal — @{} ref-data fetch + forwarding", () => {
  beforeEach(() => stubModulesFetch(LIBRARY_ROWS));
  afterEach(() => vi.unstubAllGlobals());

  it("fetches /wp/api/modules once when the modal mounts", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await flushFetch(w);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const modulesCalls = calls.filter((c) => String(c[0]).includes("/wp/api/modules"));
    expect(modulesCalls.length).toBe(1);
  });

  it("forwards wildcard refSuggestions (excluding self + non-wildcards) to RulesSection", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await flushFetch(w);
    const rules = w.findComponent({ name: "RulesSection" });
    const refs = rules.props("refSuggestions") as string[];
    // Only the two wildcard rows; sorted by display name (color < outfit).
    expect(refs).toEqual(["aabbccdd", "eeff0011"]);
    // Self id + the combine row are excluded.
    expect(refs).not.toContain("dv012345");
    expect(refs).not.toContain("cc001122");
  });

  it("forwards the six buildWildcardRefData maps to RulesSection", async () => {
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await flushFetch(w);
    const rules = w.findComponent({ name: "RulesSection" });
    const uuidToName = rules.props("uuidToName") as Map<string, string>;
    expect(uuidToName.get("aabbccdd")).toBe("color");
    expect((rules.props("uuidToSubCategories") as Map<string, string[]>).get("aabbccdd")).toEqual(["warm", "cool"]);
    expect((rules.props("uuidToOptionsCount") as Map<string, number>).get("aabbccdd")).toBe(2);
    expect((rules.props("uuidToHasNull") as Map<string, boolean>).get("aabbccdd")).toBe(false);
    expect(rules.props("uuidToOptionTagSets")).toBeInstanceOf(Map);
    expect((rules.props("uuidToTagGroups") as Map<string, Record<string, string[]>>).get("aabbccdd")).toEqual({ temp: ["warm", "cool"] });
  });

  it("forwards upstream + sibling vars as the $var suggestion list", async () => {
    const w = mount(DerivationInstanceModal, {
      props: { module: makeModule(), upstreamVars: ["age"], siblingVars: ["mood"] },
    });
    await flushFetch(w);
    const rules = w.findComponent({ name: "RulesSection" });
    const vars = rules.props("varSuggestions") as string[];
    expect(vars).toContain("age");
    expect(vars).toContain("mood");
  });

  it("does not crash + passes empty ref-data before the fetch resolves", () => {
    // No flush — assert the synchronous mount path is safe (maps empty).
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    const rules = w.findComponent({ name: "RulesSection" });
    expect((rules.props("refSuggestions") as string[]) ?? []).toEqual([]);
    expect((rules.props("uuidToName") as Map<string, string>).size).toBe(0);
  });

  it("survives a failed /wp/api/modules fetch (empty ref-data, no throw)", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);
    const w = mount(DerivationInstanceModal, { props: { module: makeModule() } });
    await flushFetch(w);
    const rules = w.findComponent({ name: "RulesSection" });
    expect((rules.props("refSuggestions") as string[]) ?? []).toEqual([]);
  });
});
