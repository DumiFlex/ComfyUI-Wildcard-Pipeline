import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ImportTab from "../ImportTab.vue";
import type { RawPayload } from "../migrations";

/**
 * Helper: build a valid current-schema payload string. parsePayload
 * requires ALL SEVEN entity arrays (bundles, wildcards, fixed_values,
 * combines, derivations, constraints, categories). The plan's example
 * payload uses only four buckets and would silently fail the shape
 * check; we use the real seven-bucket shape here so the success path
 * actually exercises emit.
 */
function makeValidPayloadJson(): string {
  return JSON.stringify({
    schema_version: 2,
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
  });
}

/** Make a v0 payload — parser will migrate it to the current schema
 *  version and stamp every entity with `migrated_from: 0`. We use this
 *  to exercise the `migratedEntityCount > 0` branch in the
 *  migration-note UX. */
function makeV0PayloadJson(): string {
  return JSON.stringify({
    schema_version: 0,
    bundles: [],
    wildcards: [{ uuid: "w1", name: "$one" }, { uuid: "w2", name: "$two" }],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
  });
}

describe("ImportTab.vue", () => {
  it("renders both entry buttons", () => {
    const wrap = mount(ImportTab);
    expect(wrap.find("[data-test='import-file-btn']").exists()).toBe(true);
    expect(wrap.find("[data-test='import-paste-btn']").exists()).toBe(true);
    // Paste textarea is hidden until the user opens it.
    expect(wrap.find("[data-test='import-paste-textarea']").exists()).toBe(false);
  });

  it("emits payload-ready on valid clipboard paste", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();

    const textarea = wrap.find("textarea");
    expect(textarea.exists()).toBe(true);
    await textarea.setValue(makeValidPayloadJson());

    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();

    const emitted = wrap.emitted("payload-ready");
    expect(emitted).toBeTruthy();
    const firstCall = emitted?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    // Three args: payload (RawPayload), migratedCount, integrityWarnings.
    expect(firstCall).toHaveLength(3);
    const payload = firstCall[0] as RawPayload;
    expect(payload.schema_version).toBe(2);
    expect(payload.bundles).toEqual([]);
    expect(payload.wildcards).toEqual([]);
    expect(payload.fixed_values).toEqual([]);
    expect(payload.combines).toEqual([]);
    expect(payload.derivations).toEqual([]);
    expect(payload.constraints).toEqual([]);
    expect(payload.categories).toEqual([]);

    // After a successful parse the paste pane should collapse and the
    // textarea is no longer in the DOM.
    expect(wrap.find("[data-test='import-paste-pane']").exists()).toBe(false);
  });

  it("shows error on invalid paste — no emit, error visible", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue("not json at all");
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();

    expect(wrap.emitted("payload-ready")).toBeFalsy();
    const err = wrap.find("[data-test='import-tab-error']");
    expect(err.exists()).toBe(true);
    expect(err.text().toLowerCase()).toMatch(/invalid/);
    // Paste pane should still be open so the user can fix the input.
    expect(wrap.find("[data-test='import-paste-pane']").exists()).toBe(true);
  });

  it("error clears + emit fires after invalid then valid paste", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();

    // First attempt: garbage input → error appears, no emit.
    await wrap.find("textarea").setValue("definitely not json");
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    expect(wrap.emitted("payload-ready")).toBeFalsy();
    expect(wrap.find("[data-test='import-tab-error']").exists()).toBe(true);

    // Second attempt: valid payload → error clears, emit fires.
    await wrap.find("textarea").setValue(makeValidPayloadJson());
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    expect(wrap.emitted("payload-ready")).toBeTruthy();
    expect(wrap.find("[data-test='import-tab-error']").exists()).toBe(false);
  });

  it("file pick — parses File contents and emits payload-ready", async () => {
    const wrap = mount(ImportTab);
    const file = new File([makeValidPayloadJson()], "test.json", {
      type: "application/json",
    });
    const input = wrap.find("[data-test='import-file-input']");
    // jsdom's `<input type="file">` doesn't support direct .files
    // assignment; stamp via defineProperty so the change handler sees
    // our fixture file.
    Object.defineProperty(input.element, "files", {
      value: [file],
      configurable: true,
    });
    await input.trigger("change");
    await flushPromises();

    const emitted = wrap.emitted("payload-ready");
    expect(emitted).toBeTruthy();
    const firstCall = emitted?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as RawPayload;
    expect(payload.schema_version).toBe(2);
  });

  it("drag-and-drop — parses a dropped File and emits payload-ready (#5)", async () => {
    const wrap = mount(ImportTab);
    const file = new File([makeValidPayloadJson()], "test.json", {
      type: "application/json",
    });
    const zone = wrap.find("[data-test='import-dropzone']");
    await zone.trigger("drop", { dataTransfer: { files: [file] } });
    await flushPromises();

    const emitted = wrap.emitted("payload-ready");
    expect(emitted).toBeTruthy();
    expect((emitted?.[0]?.[0] as RawPayload).schema_version).toBe(2);
  });

  it("drag-over lights up the dropzone, drag-leave clears it (#5)", async () => {
    const wrap = mount(ImportTab);
    const zone = wrap.find("[data-test='import-dropzone']");
    const active = "wp-import-tab__dropzone--active";

    await zone.trigger("dragover", { dataTransfer: {} });
    expect(zone.classes()).toContain(active);

    // relatedTarget outside the zone → highlight clears.
    await zone.trigger("dragleave", { relatedTarget: document.body });
    expect(zone.classes()).not.toContain(active);
  });

  it("paste cancel closes the pane without emitting", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    expect(wrap.find("[data-test='import-paste-pane']").exists()).toBe(true);

    await wrap.find("[data-test='import-paste-cancel']").trigger("click");
    await flushPromises();

    expect(wrap.find("[data-test='import-paste-pane']").exists()).toBe(false);
    expect(wrap.emitted("payload-ready")).toBeFalsy();
  });

  it("shows a migration note when the payload required schema migration", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue(makeV0PayloadJson());
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();

    const emitted = wrap.emitted("payload-ready");
    expect(emitted).toBeTruthy();
    const firstCall = emitted?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    // CURRENT_SCHEMA_VERSION === 2: v0 migrates v0->v1->v2 (two steps).
    // Two wildcards counted once per step → 2 * 2 = 4.
    expect(firstCall[1]).toBe(4);

    const note = wrap.find("[data-test='import-tab-migration-note']");
    expect(note.exists()).toBe(true);
    expect(note.text()).toMatch(/migrated 4 entities/i);
  });

  // ---------- Phase 5: compact loaded-state bar ----------

  it("does NOT render the compact loaded bar before any parse", () => {
    // Even with payloadLoaded=true, the bar requires lastSource !== null
    // (i.e. a successful parse must have happened in this component
    // instance). Cold mount with the prop true should still show the
    // full UI.
    const wrap = mount(ImportTab, {
      props: { payloadLoaded: true },
    });
    expect(wrap.find("[data-test='import-tab-loaded']").exists()).toBe(false);
    expect(wrap.find("[data-test='import-file-btn']").exists()).toBe(true);
    expect(wrap.find("[data-test='import-paste-btn']").exists()).toBe(true);
  });

  it("renders the compact loaded bar after paste-parse when payloadLoaded=true", async () => {
    const wrap = mount(ImportTab, {
      props: { payloadLoaded: false },
    });
    // Drive a successful paste-parse to set lastSource = "paste".
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue(makeValidPayloadJson());
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    // Parent flips payloadLoaded → true in response to payload-ready.
    await wrap.setProps({ payloadLoaded: true });
    await flushPromises();

    const bar = wrap.find("[data-test='import-tab-loaded']");
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toMatch(/loaded/i);
    expect(bar.text()).toMatch(/from paste/i);
    expect(bar.text()).toMatch(/0\s+entities/i); // empty buckets → 0 entities
    // Full pick UI must be hidden now.
    expect(wrap.find("[data-test='import-file-btn']").exists()).toBe(false);
    expect(wrap.find("[data-test='import-paste-btn']").exists()).toBe(false);
    // Replace button is the only action surface in compact mode.
    expect(wrap.find("[data-test='import-tab-replace']").exists()).toBe(true);
  });

  it("compact bar labels source as 'From file' after a file-pick parse", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    const file = new File([makeValidPayloadJson()], "test.json", {
      type: "application/json",
    });
    const input = wrap.find("[data-test='import-file-input']");
    Object.defineProperty(input.element, "files", {
      value: [file], configurable: true,
    });
    await input.trigger("change");
    await flushPromises();
    await wrap.setProps({ payloadLoaded: true });
    await flushPromises();

    const bar = wrap.find("[data-test='import-tab-loaded']");
    expect(bar.exists()).toBe(true);
    expect(bar.text()).toMatch(/from file/i);
  });

  it("compact bar entity count reflects the parsed payload size", async () => {
    // Three wildcards in the payload → "3 entities".
    const payload = JSON.stringify({
      schema_version: 1,
      bundles: [],
      wildcards: [
        { id: "w1", name: "a" },
        { id: "w2", name: "b" },
        { id: "w3", name: "c" },
      ],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [],
      categories: [],
    });
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue(payload);
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    await wrap.setProps({ payloadLoaded: true });
    await flushPromises();
    const bar = wrap.find("[data-test='import-tab-loaded']");
    expect(bar.text()).toMatch(/3\s+entities/i);
  });

  it("emits replace-requested when Replace file button is clicked in compact mode", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue(makeValidPayloadJson());
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    await wrap.setProps({ payloadLoaded: true });
    await flushPromises();
    await wrap.find("[data-test='import-tab-replace']").trigger("click");
    await flushPromises();
    expect(wrap.emitted("replace-requested")).toBeTruthy();
  });

  it("returns to the full UI after Replace file → parent clears payloadLoaded", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-paste-btn']").trigger("click");
    await flushPromises();
    await wrap.find("textarea").setValue(makeValidPayloadJson());
    await wrap.find("[data-test='import-paste-confirm']").trigger("click");
    await flushPromises();
    await wrap.setProps({ payloadLoaded: true });
    await flushPromises();
    expect(wrap.find("[data-test='import-tab-loaded']").exists()).toBe(true);
    // Replace click → parent receives event → parent flips prop back.
    await wrap.find("[data-test='import-tab-replace']").trigger("click");
    await wrap.setProps({ payloadLoaded: false });
    await flushPromises();
    // Full UI restored, compact bar gone.
    expect(wrap.find("[data-test='import-tab-loaded']").exists()).toBe(false);
    expect(wrap.find("[data-test='import-file-btn']").exists()).toBe(true);
    expect(wrap.find("[data-test='import-paste-btn']").exists()).toBe(true);
  });
});
