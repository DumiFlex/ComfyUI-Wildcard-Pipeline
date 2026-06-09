import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ValueRow from "./ValueRow.vue";
import type { LibraryRow, DraftRow } from "../defaults";

const lib: LibraryRow = { id: "v1", name: "lens", value: "85mm" };
const plainDraft: DraftRow = { id: "v1", name: "lens", value: "85mm", enabled: true, libraryId: "v1" };

describe("ValueRow", () => {
  it("renders $-prefixed name + value inputs", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    expect(w.find('[data-test="row-name-prefix"]').text()).toBe("$");
    expect(w.find<HTMLInputElement>('[data-test="row-name"]').element.value).toBe("lens");
    expect(w.find<HTMLInputElement>('[data-test="row-value"]').element.value).toBe("85mm");
  });

  it("checkbox is checked when enabled", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    expect(w.find('[data-test="row-check"]').classes()).toContain("row__check--on");
  });

  it("checkbox unchecked + line-through when disabled", () => {
    const draft = { ...plainDraft, enabled: false };
    const w = mount(ValueRow, { props: { row: draft, library: lib } });
    expect(w.find('[data-test="row-check"]').classes()).not.toContain("row__check--on");
    expect(w.classes()).toContain("row--off");
  });

  it("emits toggle event with row id when checkbox clicked", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    await w.find('[data-test="row-check"]').trigger("click");
    expect(w.emitted("toggle")?.[0]).toEqual(["v1"]);
  });

  it("emits update event with new name on name input", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    const input = w.find<HTMLInputElement>('[data-test="row-name"]');
    input.element.value = "camera_lens";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { name: "camera_lens" }]);
  });

  it("emits update event with new value on value input", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    const input = w.find<HTMLInputElement>('[data-test="row-value"]');
    input.element.value = "50mm";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { value: "50mm" }]);
  });

  it("strips comma + punctuation from the name on input (value names must be identifiers)", async () => {
    // The name becomes a `$var`; only identifier chars allowed. The VALUE
    // field (below) is free-form and must NOT be sanitized.
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    const input = w.find<HTMLInputElement>('[data-test="row-name"]');
    input.element.value = "cam,era;lens!";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { name: "cameralens" }]);
    expect(input.element.value).toBe("cameralens");
  });

  it("does NOT strip punctuation from the value field (values are free-form)", async () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    const input = w.find<HTMLInputElement>('[data-test="row-value"]');
    input.element.value = "85mm, f/1.8!";
    await input.trigger("input");
    expect(w.emitted("update")?.[0]).toEqual(["v1", { value: "85mm, f/1.8!" }]);
  });

  it("library row with no override is plain (no --mod, no reset button)", () => {
    const w = mount(ValueRow, { props: { row: plainDraft, library: lib } });
    expect(w.find('[data-test="row-name-wrap"]').classes()).not.toContain("row__name-wrap--mod");
    expect(w.find('[data-test="row-value-wrap"]').classes()).not.toContain("row__value-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(false);
  });

  it("library row with value override gets --mod class on value wrap + reset visible", () => {
    const draft: DraftRow = { ...plainDraft, value: "50mm" };
    const w = mount(ValueRow, { props: { row: draft, library: lib } });
    expect(w.find('[data-test="row-value-wrap"]').classes()).toContain("row__value-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(true);
  });

  it("library row with name override gets --mod class on name wrap", () => {
    const draft: DraftRow = { ...plainDraft, name: "camera_lens" };
    const w = mount(ValueRow, { props: { row: draft, library: lib } });
    expect(w.find('[data-test="row-name-wrap"]').classes()).toContain("row__name-wrap--mod");
    expect(w.find('[data-test="row-reset"]').exists()).toBe(true);
  });

  it("instance-added row (no library) shows --added + delete button (no reset)", () => {
    const draft: DraftRow = { id: "fresh01", name: "mood", value: "cozy", enabled: true, libraryId: null };
    const w = mount(ValueRow, { props: { row: draft, library: undefined } });
    expect(w.classes()).toContain("row--added");
    expect(w.find('[data-test="row-delete"]').exists()).toBe(true);
    expect(w.find('[data-test="row-reset"]').exists()).toBe(false);
  });

  it("reset button click emits reset with row id", async () => {
    const draft: DraftRow = { ...plainDraft, value: "50mm" };
    const w = mount(ValueRow, { props: { row: draft, library: lib } });
    await w.find('[data-test="row-reset"]').trigger("click");
    expect(w.emitted("reset")?.[0]).toEqual(["v1"]);
  });

  it("delete button click emits delete with row id", async () => {
    const draft: DraftRow = { id: "fresh01", name: "mood", value: "cozy", enabled: true, libraryId: null };
    const w = mount(ValueRow, { props: { row: draft, library: undefined } });
    await w.find('[data-test="row-delete"]').trigger("click");
    expect(w.emitted("delete")?.[0]).toEqual(["fresh01"]);
  });
});
