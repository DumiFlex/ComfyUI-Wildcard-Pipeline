import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ValueRow from "./ValueRow.vue";
import type { LibraryRow, DraftRow } from "../defaults";

// The value field is a RichTextInput now, so booru tag autocomplete works in
// it. Stubbed here: it is contenteditable with atom spans, which jsdom does
// not implement, and these tests are about ValueRow's wiring.
const RichTextInputStub = {
  name: "RichTextInput",
  props: {
    modelValue: String,
    surface: String,
    multiline: Boolean,
    rows: [Number, String],
    disabled: Boolean,
    ariaLabel: String,
  },
  emits: ["update:modelValue"],
  template: `<div class="wp-rt-stub" data-test="row-value" :data-model-value="modelValue"></div>`,
};
const globalStubs = { RichTextInput: RichTextInputStub };

/** What the value field is showing. */
const valueOf = (w: any) => w.findComponent(RichTextInputStub).props("modelValue");
/** Type into the value field. */
async function typeValue(w: any, v: string): Promise<void> {
  w.findComponent(RichTextInputStub).vm.$emit("update:modelValue", v);
  await w.vm.$nextTick();
}


const lib: LibraryRow = { id: "v1", name: "lens", value: "85mm" };
const plainDraft: DraftRow = { id: "v1", name: "lens", value: "85mm", enabled: true, libraryId: "v1" };

describe("ValueRow", () => {
  it("renders $-prefixed name + value inputs", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-name-prefix"]').text()).toBe("$");
    expect(w.find<HTMLInputElement>('[data-test="row-name"]').element.value).toBe("lens");
    expect(valueOf(w)).toBe("85mm");
  });

  it("value field grows rather than being a single line", async () => {
    // Users routinely paste a whole sentence into a fixed value; a one-line
    // field showed a sliver with no way to see the rest. The requirement is
    // "multiline and grows", not "is a <textarea>" — it is a RichTextInput
    // now, which carries the same `useGrowableField` auto-grow, overflow fade
    // and drag grip, plus the tag autocomplete a textarea could not host.
    const w = mount(ValueRow, {
      props: { row: plainDraft, library: lib },
      global: { stubs: globalStubs },
    });
    const rt = w.findComponent(RichTextInputStub);
    expect(rt.exists()).toBe(true);
    expect(rt.props("multiline")).toBe(true);
  });

  it("offers tag autocomplete but not $ or @", () => {
    // The engine treats fixed_values as a binding PRODUCER: it DEFINES what
    // `$name` resolves to, so `$var` reads and `@{}` refs are gated off and
    // render as literal text with a warning. The surface prop is what carries
    // that rule into the editor.
    const w = mount(ValueRow, {
      props: { row: plainDraft, library: lib },
      global: { stubs: globalStubs },
    });
    expect(w.findComponent(RichTextInputStub).props("surface")).toBe("fixed_values");
  });

  it("keeps a multi-line value intact on input", async () => {
    // Multi-line values round-trip: the engine stores the value verbatim, and
    // the modal saves on Cmd/Ctrl+Enter so plain Enter stays free for a
    // newline. Previously two tests — one drove a keydown to prove Enter was
    // not swallowed, which only made sense against a real <textarea>.
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    await typeValue(w, "line one\nline two");
    const updates = w.emitted("update") ?? [];
    expect(updates[updates.length - 1]).toEqual(["v1", { value: "line one\nline two" }]);
  });

  it("checkbox is checked when enabled", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-check"]').classes()).toContain("row__check--on");
  });

  it("checkbox unchecked + line-through when disabled", () => {
    const draft = { ...plainDraft, enabled: false };
    const w = mount(ValueRow, { props: { row: draft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-check"]').classes()).not.toContain("row__check--on");
    expect(w.classes()).toContain("row--off");
  });

  it("emits toggle event with row id when checkbox clicked", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    await w.find('[data-test="row-check"]').trigger("click");
    expect(w.emitted("toggle")?.[0]).toEqual(["v1"]);
  });

  it("emits update event with new name on name input", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    const input = w.find<HTMLInputElement>('[data-test="row-name"]');
    input.element.value = "camera_lens";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { name: "camera_lens" }]);
  });

  it("emits update event with new value on value input", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    await typeValue(w, "50mm");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { value: "50mm" }]);
  });

  it("strips comma + punctuation from the name on input (value names must be identifiers)", async () => {
    // The name becomes a `$var`; only identifier chars allowed. The VALUE
    // field (below) is free-form and must NOT be sanitized.
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    const input = w.find<HTMLInputElement>('[data-test="row-name"]');
    input.element.value = "cam,era;lens!";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { name: "cameralens" }]);
    expect(input.element.value).toBe("cameralens");
  });

  it("does NOT strip punctuation from the value field (values are free-form)", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    await typeValue(w, "85mm, f/1.8!");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { value: "85mm, f/1.8!" }]);
  });

  it("library row with no override is plain (no --mod, no reset button)", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-name-wrap"]').classes()).not.toContain("row__name-wrap--mod");
    expect(w.find('[data-test="row-value-wrap"]').classes()).not.toContain("row__value-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(false);
  });

  it("library row with value override gets --mod class on value wrap + reset visible", () => {
    const draft: DraftRow = { ...plainDraft, value: "50mm" };
    const w = mount(ValueRow, { props: { row: draft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-value-wrap"]').classes()).toContain("row__value-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(true);
  });

  it("library row with name override gets --mod class on name wrap", () => {
    const draft: DraftRow = { ...plainDraft, name: "camera_lens" };
    const w = mount(ValueRow, { props: { row: draft, library: lib }, global: { stubs: globalStubs } });
    expect(w.find('[data-test="row-name-wrap"]').classes()).toContain("row__name-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(true);
  });

  it("instance-added row (no library) shows --added + delete button (no reset)", () => {
    const draft: DraftRow = { id: "fresh01", name: "mood", value: "cozy", enabled: true, libraryId: null };
    const w = mount(ValueRow, { props: { row: draft, library: undefined }, global: { stubs: globalStubs } });
    expect(w.classes()).toContain("row--added");
    expect(w.find('[data-test="row-delete"]').exists()).toBe(true);
    expect(w.find('[data-test="row-reset"]').exists()).toBe(false);
  });

  it("reset button click emits reset with row id", async () => {
    const draft: DraftRow = { ...plainDraft, value: "50mm" };
    const w = mount(ValueRow, { props: { row: draft, library: lib }, global: { stubs: globalStubs } });
    await w.find('[data-test="row-reset"]').trigger("click");
    expect(w.emitted("reset")?.[0]).toEqual(["v1"]);
  });

  it("delete button click emits delete with row id", async () => {
    const draft: DraftRow = { id: "fresh01", name: "mood", value: "cozy", enabled: true, libraryId: null };
    const w = mount(ValueRow, { props: { row: draft, library: undefined }, global: { stubs: globalStubs } });
    await w.find('[data-test="row-delete"]').trigger("click");
    expect(w.emitted("delete")?.[0]).toEqual(["fresh01"]);
  });
});
