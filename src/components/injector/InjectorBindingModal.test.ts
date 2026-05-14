import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import InjectorBindingModal from "./InjectorBindingModal.vue";
import type { InjectorRow } from "../../widgets/_shared";

function makeRow(over: Partial<InjectorRow> = {}): InjectorRow {
  return {
    _uid: "uid_self",
    slot_name: "input_0",
    binding: "phrase",
    enabled: true,
    internal: false,
    ...over,
  };
}

describe("InjectorBindingModal — identity section", () => {
  it("renders the row's slot_name in the header + current binding in the input", () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_2", binding: "seed" }) },
    });
    expect(w.find('[data-test="ibm-name"]').text()).toBe("input_2");
    const input = w.find<HTMLInputElement>('[data-test="ibm-binding"]');
    expect(input.element.value).toBe("seed");
  });

  it("does NOT emit update while typing — draft buffer holds edits until Save", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    const input = w.find<HTMLInputElement>('[data-test="ibm-binding"]');
    await input.setValue("renamed");
    expect(w.emitted("update")).toBeUndefined();
  });

  it("Save emits update with the draft binding + closes", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("renamed");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.binding).toBe("renamed");
    expect(w.emitted("close")).toHaveLength(1);
  });
});

describe("InjectorBindingModal — template section", () => {
  it("template textarea bound to row.template at open", () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ template: "i love $input_1" }) },
    });
    const ta = w.find<HTMLTextAreaElement>('[data-test="ibm-template"]');
    expect(ta.element.value).toBe("i love $input_1");
  });

  it("Save emits a non-empty template string verbatim (no null collapse)", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLTextAreaElement>('[data-test="ibm-template"]').setValue("i love $input_2");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("i love $input_2");
    expect(last.binding).toBe("phrase");
  });

  it("Save collapses whitespace-only template to null", async () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ template: "hello" }) },
    });
    await w.find<HTMLTextAreaElement>('[data-test="ibm-template"]').setValue("   ");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBeNull();
  });

  it("insert-slot dropdown lists ONLY this row's own slot (no sibling refs)", async () => {
    const siblings: InjectorRow[] = [
      makeRow({ _uid: "uid_self", slot_name: "input_0" }),
      makeRow({ _uid: "uid_b", slot_name: "input_1", binding: "b" }),
      makeRow({ _uid: "uid_c", slot_name: "input_2", binding: "c" }),
    ];
    const w = mount(InjectorBindingModal, {
      props: { row: siblings[0], siblingRows: siblings },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    expect(w.find('[data-test="ibm-slot-item-input_0"]').exists()).toBe(true);
    expect(w.find('[data-test="ibm-slot-item-input_1"]').exists()).toBe(false);
    expect(w.find('[data-test="ibm-slot-item-input_2"]').exists()).toBe(false);
  });

  it("clicking the row's own slot appends $slot_name to the draft, Save persists it", async () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_0", template: "prefix " }) },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    await w.find('[data-test="ibm-slot-item-input_0"]').trigger("click");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("prefix $input_0");
  });

  it("preview pane highlights known $slot refs (own slot) + flags unknown", () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_0", template: "love $input_0 and $missing" }) },
    });
    expect(w.findAll(".ibm-tok--ref")).toHaveLength(1);
    expect(w.findAll(".ibm-tok--ref-unknown")).toHaveLength(1);
  });

  it("reset button clears the draft template", async () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ template: "hi" }) },
    });
    await w.find('[data-test="ibm-template-reset"]').trigger("click");
    const ta = w.find<HTMLTextAreaElement>('[data-test="ibm-template"]');
    expect(ta.element.value).toBe("");
  });

  it("typing a bare $ does NOT crash the tokenizer (regression)", () => {
    const w = mount(InjectorBindingModal, {
      props: { row: makeRow({ template: "hello $" }) },
    });
    expect(w.find('[data-test="ibm-preview"]').exists()).toBe(true);
  });
});

describe("InjectorBindingModal — Save / Cancel / keybinds", () => {
  it("Cancel closes without emitting update", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-cancel"]').trigger("click");
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("clicking overlay cancels (no update emit)", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-overlay"]').trigger("click");
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Esc cancels", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Escape" });
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Cmd+Enter saves", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("kept");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Enter", metaKey: true });
    const updates = w.emitted("update")!;
    expect(updates).toHaveLength(1);
    const last = updates[0][0] as Partial<InjectorRow>;
    expect(last.binding).toBe("kept");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Ctrl+Enter also saves (non-mac users)", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("kept2");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(w.emitted("update")).toHaveLength(1);
  });

  it("Save button is disabled when no changes were made", () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    const btn = w.find<HTMLButtonElement>('[data-test="ibm-save"]');
    expect(btn.element.disabled).toBe(true);
  });

  it("Save button becomes enabled after editing the binding", async () => {
    const w = mount(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("changed");
    const btn = w.find<HTMLButtonElement>('[data-test="ibm-save"]');
    expect(btn.element.disabled).toBe(false);
  });
});
