import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ValuesSection from "./ValuesSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets" },
    entries: [],
    payload: {
      values: [
        { id: "v1", name: "lens", value: "85mm" },
        { id: "v2", name: "angle", value: "wide" },
      ],
    },
    instance: {},
    payload_hash: "h",
    ...overrides,
  };
}

describe("ValuesSection", () => {
  it("renders one ValueRow per library row by default", () => {
    const w = mount(ValuesSection, { props: { module: makeModule() } });
    expect(w.findAllComponents({ name: "ValueRow" })).toHaveLength(2);
  });

  it("renders override rows from instance.values_overrides instead of library", () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "50mm" },
              { id: "v2", name: "angle", value: "wide" },
            ],
          },
        }),
      },
    });
    const rows = w.findAllComponents({ name: "ValueRow" });
    expect(rows[0].props("row").value).toBe("50mm");
  });

  it("renders instance-added rows after library rows", () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "85mm" },
              { id: "v2", name: "angle", value: "wide" },
              { id: "fresh01", name: "mood", value: "cozy" },
            ],
          },
        }),
      },
    });
    const rows = w.findAllComponents({ name: "ValueRow" });
    expect(rows).toHaveLength(3);
    expect(rows[2].props("row").libraryId).toBeNull();
  });

  it("toggle on a library row updates enabled_options", async () => {
    const w = mount(ValuesSection, { props: { module: makeModule() } });
    w.findComponent({ name: "ValueRow" }).vm.$emit("toggle", "v1");
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.enabled_options).toEqual(["v2"]);
  });

  it("toggling all rows back on collapses enabled_options to null", async () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({ instance: { enabled_options: ["v1"] } }),
      },
    });
    const rows = w.findAllComponents({ name: "ValueRow" });
    rows[1].vm.$emit("toggle", "v2");
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.enabled_options).toBeNull();
  });

  it("name update on a row emits values_overrides patch with full effective list", async () => {
    const w = mount(ValuesSection, { props: { module: makeModule() } });
    w.findComponent({ name: "ValueRow" }).vm.$emit("update", "v1", { name: "camera_lens" });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.values_overrides).toEqual([
      { id: "v1", name: "camera_lens", value: "85mm" },
      { id: "v2", name: "angle", value: "wide" },
    ]);
  });

  it("typing value back to library default collapses values_overrides to null", async () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "50mm" },
              { id: "v2", name: "angle", value: "wide" },
            ],
          },
        }),
      },
    });
    w.findComponent({ name: "ValueRow" }).vm.$emit("update", "v1", { value: "85mm" });
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.values_overrides).toBeNull();
  });

  it("reset on a row drops its override (collapses to null when last)", async () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "50mm" },
              { id: "v2", name: "angle", value: "wide" },
            ],
          },
        }),
      },
    });
    w.findComponent({ name: "ValueRow" }).vm.$emit("reset", "v1");
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.values_overrides).toBeNull();
  });

  it("add-row button appends new entry with fresh id", async () => {
    const w = mount(ValuesSection, { props: { module: makeModule() } });
    await w.find('[data-test="vals-add"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.values_overrides).toHaveLength(3);
    expect(patch.instance?.values_overrides![2].name).toBe("");
  });

  it("delete on instance-added row removes it", async () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "85mm" },
              { id: "v2", name: "angle", value: "wide" },
              { id: "fresh01", name: "mood", value: "cozy" },
            ],
          },
        }),
      },
    });
    const rows = w.findAllComponents({ name: "ValueRow" });
    rows[2].vm.$emit("delete", "fresh01");
    await w.vm.$nextTick();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.values_overrides).toBeNull(); // collapses since only override was the added row
  });

  it("summary shows enabled count + override count + added count", () => {
    const w = mount(ValuesSection, {
      props: {
        module: makeModule({
          instance: {
            values_overrides: [
              { id: "v1", name: "lens", value: "50mm" }, // override
              { id: "v2", name: "angle", value: "wide" },
              { id: "fresh01", name: "mood", value: "cozy" }, // added
            ],
            enabled_options: ["v1", "fresh01"], // 2 of 3 enabled
          },
        }),
      },
    });
    const summary = w.find('[data-test="vals-summary"]').text();
    expect(summary).toContain("2 of 3");
    expect(summary).toContain("1 override");
    expect(summary).toContain("1 added");
  });
});
