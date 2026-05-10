import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import InjectorRow from "./InjectorRow.vue";
import type { InjectorRow as RowType } from "../../widgets/_shared";

function makeRow(over: Partial<RowType> = {}): RowType {
  return {
    _uid: "uid_test",
    slot_name: "input_0",
    binding: "seed_phrase",
    enabled: true,
    internal: false,
    ...over,
  };
}

describe("InjectorRow — binding + type chip", () => {
  it("renders the binding input with the row's binding value", () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    const input = w.find<HTMLInputElement>('[data-test="inj-row-binding"]');
    expect(input.element.value).toBe("seed_phrase");
  });

  it("shows warn-color placeholder + class when binding is empty", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ binding: "" }) } });
    const input = w.find<HTMLInputElement>('[data-test="inj-row-binding"]');
    expect(input.attributes("placeholder")).toBe("binding…");
    expect(input.classes()).toContain("wp-inj-row-binding--empty");
  });

  it("shows the type chip from the valueType prop", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "STRING" } });
    expect(w.find('[data-test="inj-row-type"]').text()).toBe("STRING");
  });

  it("emits update with new binding when the input changes", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    const input = w.find<HTMLInputElement>('[data-test="inj-row-binding"]');
    await input.setValue("renamed");
    const updates = w.emitted("update")!;
    const last = updates[updates.length - 1][0] as Partial<RowType>;
    expect(last.binding).toBe("renamed");
  });
});

describe("InjectorRow — enabled checkbox", () => {
  it("renders checked when row.enabled is true", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ enabled: true }) } });
    expect(w.find<HTMLInputElement>('[data-test="inj-row-enabled"]').element.checked).toBe(true);
  });

  it("renders unchecked when row.enabled is false", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ enabled: false }) } });
    expect(w.find<HTMLInputElement>('[data-test="inj-row-enabled"]').element.checked).toBe(false);
  });

  it("emits update with toggled enabled flag on change", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ enabled: true }) } });
    await w.find<HTMLInputElement>('[data-test="inj-row-enabled"]').setValue(false);
    const last = w.emitted("update")![0][0] as Partial<RowType>;
    expect(last.enabled).toBe(false);
  });
});

describe("InjectorRow — internal flag", () => {
  it("internal-flag button inactive class when row.internal is false", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ internal: false }) } });
    expect(w.find('[data-test="inj-row-internal"]').classes()).not.toContain("is-active");
  });

  it("internal-flag button active class when row.internal is true", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ internal: true }) } });
    expect(w.find('[data-test="inj-row-internal"]').classes()).toContain("is-active");
  });

  it("clicking internal-flag emits update with toggled internal", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ internal: false }) } });
    await w.find('[data-test="inj-row-internal"]').trigger("click");
    const last = w.emitted("update")![0][0] as Partial<RowType>;
    expect(last.internal).toBe(true);
  });

  it("does not render a trash button — disconnect auto-removes rows", () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    expect(w.find('[data-test="inj-row-trash"]').exists()).toBe(false);
  });
});

describe("InjectorRow — conflict cluster", () => {
  it("renders conflict dot + badge with severity class", () => {
    const w = mount(InjectorRow, {
      props: {
        row: makeRow(),
        conflictSeverity: "info" as const,
        conflictLabel: "overrides upstream",
      },
    });
    const badge = w.find('[data-test="inj-row-conflict"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("overrides upstream");
    expect(badge.classes()).toContain("wp-conflict-badge--info");
    expect(w.find(".wp-conflict-dot.wp-conflict-dot--info").exists()).toBe(true);
  });

  it("warning severity uses amber tokens", () => {
    const w = mount(InjectorRow, {
      props: {
        row: makeRow(),
        conflictSeverity: "warning" as const,
        conflictLabel: "duplicate",
      },
    });
    expect(w.find(".wp-conflict-badge--warning").exists()).toBe(true);
  });

  it("no conflict cluster when severity unset", () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    expect(w.find('[data-test="inj-row-conflict"]').exists()).toBe(false);
    expect(w.find(".wp-conflict-dot").exists()).toBe(false);
  });
});

describe("InjectorRow — disconnected variant", () => {
  it("applies disconnected class when isConnected prop is false", () => {
    const w = mount(InjectorRow, {
      props: { row: makeRow(), isConnected: false },
    });
    expect(w.find('.wp-inj-row').classes()).toContain("wp-inj-row--disconnected");
  });

  it("disconnected rows surface as conflict cluster (no separate nolink badge)", () => {
    // The standalone `no link` badge moved into the unified conflict
    // cluster — `injector_input_disconnected` is now a warning-severity
    // conflict surfaced via the dot+badge cluster like the rest.
    const w = mount(InjectorRow, {
      props: {
        row: makeRow(),
        isConnected: false,
        conflictSeverity: "warning" as const,
        conflictLabel: "no link",
      },
    });
    expect(w.find('[data-test="inj-row-conflict"]').text()).toBe("no link");
  });
});
