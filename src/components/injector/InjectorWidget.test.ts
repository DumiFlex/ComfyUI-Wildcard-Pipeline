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
