import { afterEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import InjectorBindingModal from "./InjectorBindingModal.vue";
import type { InjectorRow } from "../../widgets/_shared";

// The insert menu is `<Teleport to="body">` — it escapes the modal's scroll
// container so it can't be clipped, which means it is NOT inside the test
// wrapper's subtree. Query the document for it instead.
function menuItem(name: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-test="ibm-slot-item-${name}"]`);
}

async function clickMenuItem(name: string): Promise<void> {
  const el = menuItem(name);
  if (!el) throw new Error(`no insert-menu item for "${name}"`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
}

// Teleported nodes outlive an un-unmounted wrapper, so a menu left open by
// one test would still answer `menuItem()` in the next. Unmount rather than
// clearing document.body — ripping the body out from under a live component
// detaches Vue's teleport anchor and the next patch throws on a null parent.
const mounted: { unmount: () => void }[] = [];
type MountArgs = Parameters<typeof mount<typeof InjectorBindingModal>>;
function mountModal(...args: MountArgs): ReturnType<typeof mount<typeof InjectorBindingModal>> {
  const w = mount(...args);
  mounted.push(w);
  return w;
}
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

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
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_2", binding: "seed" }) },
    });
    expect(w.find('[data-test="ibm-name"]').text()).toBe("input_2");
    const input = w.find<HTMLInputElement>('[data-test="ibm-binding"]');
    expect(input.element.value).toBe("seed");
  });

  it("does NOT emit update while typing — draft buffer holds edits until Save", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    const input = w.find<HTMLInputElement>('[data-test="ibm-binding"]');
    await input.setValue("renamed");
    expect(w.emitted("update")).toBeUndefined();
  });

  it("Save emits update with the draft binding + closes", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
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
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ template: "i love $input_1" }) },
    });
    const ta = w.find<HTMLTextAreaElement>('[data-test="ibm-template"]');
    expect(ta.element.value).toBe("i love $input_1");
  });

  it("Save emits a non-empty template string verbatim (no null collapse)", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLTextAreaElement>('[data-test="ibm-template"]').setValue("i love $input_2");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("i love $input_2");
    expect(last.binding).toBe("phrase");
  });

  it("Save collapses whitespace-only template to null", async () => {
    const w = mountModal(InjectorBindingModal, {
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
    const w = mountModal(InjectorBindingModal, {
      props: { row: siblings[0], siblingRows: siblings },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    expect(menuItem("input_0")).not.toBeNull();
    expect(menuItem("input_1")).toBeNull();
    expect(menuItem("input_2")).toBeNull();
  });

  it("clicking the row's own slot appends $slot_name to the draft, Save persists it", async () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_0", template: "prefix " }) },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    await clickMenuItem("input_0");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("prefix $input_0");
  });

  it("preview pane highlights known $slot refs (own slot) + flags unknown", () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ slot_name: "input_0", template: "love $input_0 and $missing" }) },
    });
    expect(w.findAll(".ibm-tok--ref")).toHaveLength(1);
    expect(w.findAll(".ibm-tok--ref-unknown")).toHaveLength(1);
  });

  it("reset button clears the draft template", async () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ template: "hi" }) },
    });
    await w.find('[data-test="ibm-template-reset"]').trigger("click");
    const ta = w.find<HTMLTextAreaElement>('[data-test="ibm-template"]');
    expect(ta.element.value).toBe("");
  });

  it("typing a bare $ does NOT crash the tokenizer (regression)", () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: makeRow({ template: "hello $" }) },
    });
    expect(w.find('[data-test="ibm-preview"]').exists()).toBe(true);
  });
});

describe("InjectorBindingModal — Save / Cancel / keybinds", () => {
  it("Cancel closes without emitting update", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-cancel"]').trigger("click");
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("clicking overlay cancels (no update emit)", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-overlay"]').trigger("click");
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Esc cancels", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("dropped");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Escape" });
    expect(w.emitted("update")).toBeUndefined();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Cmd+Enter saves", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("kept");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Enter", metaKey: true });
    const updates = w.emitted("update")!;
    expect(updates).toHaveLength(1);
    const last = updates[0][0] as Partial<InjectorRow>;
    expect(last.binding).toBe("kept");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("Ctrl+Enter also saves (non-mac users)", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("kept2");
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(w.emitted("update")).toHaveLength(1);
  });

  it("Save button is disabled when no changes were made", () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    const btn = w.find<HTMLButtonElement>('[data-test="ibm-save"]');
    expect(btn.element.disabled).toBe(true);
  });

  it("Save button becomes enabled after editing the binding", async () => {
    const w = mountModal(InjectorBindingModal, { props: { row: makeRow() } });
    await w.find<HTMLInputElement>('[data-test="ibm-binding"]').setValue("changed");
    const btn = w.find<HTMLButtonElement>('[data-test="ibm-save"]');
    expect(btn.element.disabled).toBe(false);
  });
});

describe("InjectorBindingModal — general (template) row", () => {
  function generalRow(over: Partial<InjectorRow> = {}): InjectorRow {
    return makeRow({ kind: "general", slot_name: "", binding: "combo", template: "$input_0 by $test", ...over });
  }

  it("header reads as a Template row, not a socket", () => {
    const w = mountModal(InjectorBindingModal, { props: { row: generalRow() } });
    expect(w.find('[data-test="ibm-name"]').text()).toBe("template row");
    expect(w.find('[data-test="ibm-chip"]').text()).toBe("Template");
  });

  it("insert menu lists every reference (sockets + socket-row bindings)", async () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow(), references: ["input_0", "input_1", "test"] },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    expect(menuItem("input_0")).not.toBeNull();
    expect(menuItem("input_1")).not.toBeNull();
    expect(menuItem("test")).not.toBeNull();
  });

  it("preview treats references as known refs (no unknown flags)", () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow({ template: "$input_0 by $test" }), references: ["input_0", "test"] },
    });
    expect(w.findAll(".ibm-tok--ref")).toHaveLength(2);
    expect(w.findAll(".ibm-tok--ref-unknown")).toHaveLength(0);
  });

  it("flags a ref that isn't in the references list as unknown", () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow({ template: "$input_0 and $missing" }), references: ["input_0"] },
    });
    expect(w.findAll(".ibm-tok--ref")).toHaveLength(1);
    expect(w.findAll(".ibm-tok--ref-unknown")).toHaveLength(1);
  });

  it("Save emits binding + template for a general row", async () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow({ binding: "combo", template: "$input_0" }), references: ["input_0", "test"] },
    });
    await w.find<HTMLTextAreaElement>('[data-test="ibm-template"]').setValue("$input_0 by $test");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("$input_0 by $test");
    expect(last.binding).toBe("combo");
  });

  it("inserting a socket-row binding ref appends $name to the draft", async () => {
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow({ template: "prefix " }), references: ["input_0", "test"] },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    await clickMenuItem("test");
    await w.find('[data-test="ibm-save"]').trigger("click");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<InjectorRow>;
    expect(last.template).toBe("prefix $test");
  });

  it("a click outside the insert menu closes it", async () => {
    // The menu had no outside-click dismissal at all — once open, the only
    // way out was picking an item or closing the whole modal.
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow(), references: ["input_0"] },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    await nextTick();
    expect(menuItem("input_0")).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(menuItem("input_0")).toBeNull();
  });

  it("Escape closes the insert menu without discarding the draft", async () => {
    // Escape cancels the modal (dropping the draft). With a dropdown open it
    // must dismiss the dropdown first, not throw away the user's edits.
    const w = mountModal(InjectorBindingModal, {
      props: { row: generalRow({ template: "prefix " }), references: ["input_0"] },
    });
    await w.find('[data-test="ibm-insert-slot"]').trigger("click");
    await nextTick();
    expect(menuItem("input_0")).not.toBeNull();
    await w.find('[data-test="ibm-overlay"]').trigger("keydown", { key: "Escape" });
    expect(menuItem("input_0")).toBeNull();
    expect(w.emitted("cancel")).toBeUndefined();
  });
});
