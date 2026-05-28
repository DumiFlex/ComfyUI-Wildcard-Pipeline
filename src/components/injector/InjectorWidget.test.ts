import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import InjectorWidget from "./InjectorWidget.vue";

const EMPTY = JSON.stringify({ version: 1, rows: [] });

describe("InjectorWidget skeleton", () => {
  it("renders the toolbar with the section label and 0 / 0 count", () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    expect(w.find('[data-test="inj-toolbar-label"]').text()).toBe("injected variables");
    expect(w.find('[data-test="inj-toolbar-count"]').text()).toBe("0 / 0");
  });

  it("shows the ghost-add row when no rows present", () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    expect(w.find('[data-test="inj-ghost"]').exists()).toBe(true);
  });
});

describe("InjectorWidget — lifecycle", () => {
  it("addRow appends a new row with correct shape", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    const vm = w.vm as unknown as { addRow: (slotName: string) => void };
    vm.addRow("input_2");
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const lastJson = events[events.length - 1][0] as string;
    const parsed = JSON.parse(lastJson);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].slot_name).toBe("input_2");
    expect(parsed.rows[0].binding).toBe("");
    expect(parsed.rows[0].enabled).toBe(true);
    expect(parsed.rows[0].internal).toBe(false);
    expect(parsed.rows[0]._uid).toMatch(/^[0-9a-f]{12}$/);
  });

  it("does not double-append when addRow called twice with same slot name", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    const vm = w.vm as unknown as { addRow: (slotName: string) => void };
    vm.addRow("input_0");
    vm.addRow("input_0");
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const lastJson = events[events.length - 1][0] as string;
    expect(JSON.parse(lastJson).rows).toHaveLength(1);
  });
});

describe("InjectorWidget — template persistence (Phase 6)", () => {
  const ONE_ROW = JSON.stringify({
    version: 1,
    rows: [{ _uid: "uid_a", slot_name: "input_0", binding: "phrase", enabled: true, internal: false }],
  });

  it("template typed in the edit modal flows into the persisted JSON via change emit", async () => {
    const w = mount(InjectorWidget, {
      props: {
        nodeId: 7,
        initialJson: ONE_ROW,
        connectedSlots: ["input_0"],
        slotTypes: { input_0: "STRING" },
      },
      attachTo: document.body,
    });
    // Open the row's ctxmenu, pick Edit, type a template, Save.
    await w.find('[data-uid="uid_a"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const editItem = Array.from(document.querySelectorAll<HTMLElement>(".wp-ctxmenu__item")).find(
      (el) => el.querySelector(".wp-ctxmenu__title")?.textContent === "Edit",
    );
    expect(editItem).toBeTruthy();
    editItem!.click();
    await w.vm.$nextTick();

    const textarea = document.querySelector<HTMLTextAreaElement>('[data-test="ibm-template"]');
    expect(textarea).not.toBeNull();
    textarea!.value = "i love $input_0";
    textarea!.dispatchEvent(new Event("input"));
    await w.vm.$nextTick();

    const saveBtn = document.querySelector<HTMLButtonElement>('[data-test="ibm-save"]');
    expect(saveBtn).not.toBeNull();
    saveBtn!.click();
    await w.vm.$nextTick();

    const changes = w.emitted("change")!;
    const lastJson = changes[changes.length - 1][0] as string;
    const parsed = JSON.parse(lastJson);
    expect(parsed.rows[0].template).toBe("i love $input_0");
    w.unmount();
  });
});

describe("InjectorWidget — right-click context menu (Phase 4)", () => {
  const TWO_ROWS = JSON.stringify({
    version: 1,
    rows: [
      { _uid: "uid_a", slot_name: "input_0", binding: "a", enabled: true, internal: false },
      { _uid: "uid_b", slot_name: "input_1", binding: "b", enabled: false, internal: false },
    ],
  });

  it("opens the shared ContextMenu on right-click with the expected entries", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: TWO_ROWS, connectedSlots: ["input_0", "input_1"] },
      attachTo: document.body,
    });
    await w.find('[data-uid="uid_a"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const menu = document.querySelector(".wp-ctxmenu");
    expect(menu).not.toBeNull();
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map(
      (n) => n.textContent,
    );
    expect(labels).toContain("Edit");
    expect(labels).toContain("Disable");          // row a is enabled
    expect(labels).toContain("Collapse");         // default: _collapsed unset → falsy → expanded
    expect(labels).toContain("Move to top");
    expect(labels).toContain("Move to bottom");
    expect(labels).toContain("Disconnect");
    w.unmount();
  });

  it("Move to top is disabled on the first row", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: TWO_ROWS, connectedSlots: ["input_0", "input_1"] },
      attachTo: document.body,
    });
    await w.find('[data-uid="uid_a"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const items = Array.from(document.querySelectorAll<HTMLElement>(".wp-ctxmenu__item"));
    const moveTop = items.find((el) => el.querySelector(".wp-ctxmenu__title")?.textContent === "Move to top");
    expect(moveTop?.classList.contains("wp-ctxmenu__item--disabled")).toBe(true);
    w.unmount();
  });

  it("renders the scope header with type icon + 'Type · $binding' label", async () => {
    const w = mount(InjectorWidget, {
      props: {
        nodeId: 7,
        initialJson: TWO_ROWS,
        connectedSlots: ["input_0", "input_1"],
        slotTypes: { input_0: "STRING", input_1: "INT" },
      },
      attachTo: document.body,
    });
    await w.find('[data-uid="uid_a"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const header = document.querySelector(".wp-ctxmenu__header");
    expect(header).not.toBeNull();
    expect(header!.querySelector(".pi-pencil")).not.toBeNull();
    expect(header!.querySelector(".wp-ctxmenu__header-label")!.textContent).toBe("String · $a");
    w.unmount();
  });

  it("header label falls back to slot_name when binding is empty", async () => {
    const EMPTY_BINDING = JSON.stringify({
      version: 1,
      rows: [{ _uid: "uid_x", slot_name: "input_0", binding: "", enabled: true, internal: false }],
    });
    const w = mount(InjectorWidget, {
      props: {
        nodeId: 7,
        initialJson: EMPTY_BINDING,
        connectedSlots: ["input_0"],
        slotTypes: { input_0: "INT" },
      },
      attachTo: document.body,
    });
    await w.find('[data-uid="uid_x"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const label = document.querySelector(".wp-ctxmenu__header-label")!.textContent;
    expect(label).toBe("Int · input_0");
    w.unmount();
  });

  it("right-click on a disabled row swaps the Disable entry to Enable", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: TWO_ROWS, connectedSlots: ["input_0", "input_1"] },
      attachTo: document.body,
    });
    await w.find('[data-uid="uid_b"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map(
      (n) => n.textContent,
    );
    expect(labels).toContain("Enable");
    expect(labels).not.toContain("Disable");
    w.unmount();
  });
});

describe("InjectorWidget — general (template) rows", () => {
  it("addGeneralRow appends a durable kind:general row with no slot", async () => {
    const w = mount(InjectorWidget, { props: { nodeId: 7, initialJson: EMPTY } });
    const vm = w.vm as unknown as { addGeneralRow: () => void };
    vm.addGeneralRow();
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const parsed = JSON.parse(events[events.length - 1][0] as string);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].kind).toBe("general");
    expect(parsed.rows[0].slot_name).toBe("");
    expect(parsed.rows[0].binding).toBe("");
    expect(parsed.rows[0].template).toBe("");
    expect(parsed.rows[0].enabled).toBe(true);
    expect(parsed.rows[0]._uid).toMatch(/^[0-9a-f]{12}$/);
  });

  it("renders the 'Add template row' affordance", () => {
    const w = mount(InjectorWidget, { props: { nodeId: 7, initialJson: EMPTY } });
    expect(w.find('[data-test="inj-add-general"]').exists()).toBe(true);
  });

  it("reconcile KEEPS general rows when sockets churn", async () => {
    const WITH_GENERAL = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "sock_a", kind: "socket", slot_name: "input_0", binding: "a", enabled: true, internal: false },
        { _uid: "gen_a", kind: "general", slot_name: "", binding: "combo", template: "$a!", enabled: true, internal: false },
      ],
    });
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: WITH_GENERAL, connectedSlots: ["input_0"] },
    });
    // Sever input_0 — the socket row should drop, the general row must survive.
    await w.setProps({ connectedSlots: [] });
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const parsed = JSON.parse(events[events.length - 1][0] as string);
    const kinds = parsed.rows.map((r: { kind?: string }) => r.kind);
    expect(kinds).toContain("general");
    expect(parsed.rows.find((r: { _uid: string }) => r._uid === "gen_a")).toBeTruthy();
    expect(parsed.rows.find((r: { _uid: string }) => r._uid === "sock_a")).toBeUndefined();
  });

  it("general rows render AFTER socket rows even when sockets are added later", async () => {
    const WITH_GENERAL_FIRST = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "gen_a", kind: "general", slot_name: "", binding: "combo", template: "$x", enabled: true, internal: false },
      ],
    });
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: WITH_GENERAL_FIRST, connectedSlots: [] },
    });
    await w.setProps({ connectedSlots: ["input_0", "input_1"] });
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const parsed = JSON.parse(events[events.length - 1][0] as string);
    const kinds = parsed.rows.map((r: { kind?: string }) => r.kind);
    // Two socket rows first, general row trailing.
    expect(kinds).toEqual(["socket", "socket", "general"]);
  });

  it("round-trips a general row through serialize/parse unchanged", async () => {
    const ROUND = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "gen_rt", kind: "general", slot_name: "", binding: "combo", template: "$input_0 by $test", enabled: true, internal: true, _collapsed: false },
      ],
    });
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: ROUND, connectedSlots: [] },
      attachTo: document.body,
    });
    // Toggle the internal flag off then on to force a couple of persist cycles.
    await w.find('[data-uid="gen_rt"] [data-test="inj-row-internal"]').trigger("click");
    await w.vm.$nextTick();
    const events = w.emitted("change")!;
    const parsed = JSON.parse(events[events.length - 1][0] as string);
    const row = parsed.rows[0];
    expect(row.kind).toBe("general");
    expect(row.binding).toBe("combo");
    expect(row.template).toBe("$input_0 by $test");
    expect(row.internal).toBe(false); // toggled off
    w.unmount();
  });

  it("general-row context menu offers Delete instead of Disconnect", async () => {
    const WITH_GENERAL = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "gen_a", kind: "general", slot_name: "", binding: "combo", template: "$x", enabled: true, internal: false },
      ],
    });
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: WITH_GENERAL, connectedSlots: [] },
      attachTo: document.body,
    });
    await w.find('[data-uid="gen_a"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map((n) => n.textContent);
    expect(labels).toContain("Delete");
    expect(labels).not.toContain("Disconnect");
    expect(labels).not.toContain("Edit"); // general rows edit inline
    w.unmount();
  });
});

describe("InjectorWidget — collapse-connections button", () => {
  it("renders the toolbar button with merge-wires label + icon when expanded (default)", () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    const btn = w.find('[data-test="inj-toolbar-collapse-conns"]');
    expect(btn.exists()).toBe(true);
    expect(btn.find(".pi-arrows-v").exists()).toBe(true);
    expect(btn.text()).toBe("merge wires");
    expect(btn.classes()).not.toContain("is-active");
  });

  it("flips icon + label + active class when connectionsCollapsed is true", () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY, connectionsCollapsed: true },
    });
    const btn = w.find('[data-test="inj-toolbar-collapse-conns"]');
    expect(btn.find(".pi-arrows-alt").exists()).toBe(true);
    expect(btn.text()).toBe("expand wires");
    expect(btn.classes()).toContain("is-active");
  });

  it("emits toggle-connections-collapse on click", async () => {
    const w = mount(InjectorWidget, {
      props: { nodeId: 7, initialJson: EMPTY },
    });
    await w.find('[data-test="inj-toolbar-collapse-conns"]').trigger("click");
    expect(w.emitted("toggle-connections-collapse")).toHaveLength(1);
  });
});
