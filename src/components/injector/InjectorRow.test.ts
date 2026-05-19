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

  it("shows warn-color placeholder + wrap class when binding is empty", () => {
    // C.1a: empty state moved from the <input> class to the .wp-vbind-wrap
    // parent so the border + prefix + placeholder all react. Placeholder
    // text changed to $variable_name semantics (user types it, system
    // doesn't generate it).
    const w = mount(InjectorRow, { props: { row: makeRow({ binding: "" }) } });
    const input = w.find<HTMLInputElement>('[data-test="inj-row-binding"]');
    expect(input.attributes("placeholder")).toBe("variable_name");
    expect(w.find(".wp-vbind-wrap--empty").exists()).toBe(true);
  });

  it("shows the type chip from the valueType prop (lowercase)", () => {
    // C.1a: chip text lowercased to match the Context kind-chip family.
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "STRING" } });
    expect(w.find('[data-test="inj-row-type"]').text()).toBe("string");
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

  it("empty-binding rows surface as conflict cluster with 'no binding' badge", () => {
    // C.1b: injector_binding_missing replaces the retired
    // injector_input_disconnected for the only reachable case
    // (linked socket, no typed binding). Severed-socket rows are
    // auto-removed before they can render.
    const w = mount(InjectorRow, {
      props: {
        row: makeRow(),
        isConnected: true,
        conflictSeverity: "warning" as const,
        conflictLabel: "no binding",
      },
    });
    expect(w.find('[data-test="inj-row-conflict"]').text()).toBe("no binding");
  });
});

describe("InjectorRow — type icon (Phase C.1a)", () => {
  it("renders pi-pencil for string type", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "STRING" } });
    expect(w.find(".wp-row-type-icon .pi-pencil").exists()).toBe(true);
  });
  it("renders pi-hashtag for int type", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "INT" } });
    expect(w.find(".wp-row-type-icon .pi-hashtag").exists()).toBe(true);
  });
  it("renders pi-percentage for float type", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "FLOAT" } });
    expect(w.find(".wp-row-type-icon .pi-percentage").exists()).toBe(true);
  });
  it("renders pi-check-square for boolean type", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "BOOLEAN" } });
    expect(w.find(".wp-row-type-icon .pi-check-square").exists()).toBe(true);
  });
  it("falls back to pi-circle for unknown type", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "WEIRDTYPE" } });
    expect(w.find(".wp-row-type-icon .pi-circle").exists()).toBe(true);
  });
  it("maps ComfyUI tensor types: IMAGE → pi-image", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "IMAGE" } });
    expect(w.find(".wp-row-type-icon .pi-image").exists()).toBe(true);
  });
  it("maps ComfyUI tensor types: LATENT → pi-cloud", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "LATENT" } });
    expect(w.find(".wp-row-type-icon .pi-cloud").exists()).toBe(true);
  });
  it("maps ComfyUI model types: MODEL → pi-cube", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "MODEL" } });
    expect(w.find(".wp-row-type-icon .pi-cube").exists()).toBe(true);
  });
  it("maps ComfyUI model types: CLIP → pi-tag", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "CLIP" } });
    expect(w.find(".wp-row-type-icon .pi-tag").exists()).toBe(true);
  });
  it("maps audio types: AUDIO → pi-volume-up", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "AUDIO" } });
    expect(w.find(".wp-row-type-icon .pi-volume-up").exists()).toBe(true);
  });
});

describe("InjectorRow — data-type attribute (Phase C.1a)", () => {
  it("sets data-type to lowercased valueType on the row", () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), valueType: "STRING" } });
    expect(w.find(".wp-inj-row").attributes("data-type")).toBe("string");
  });
  it("data-type is empty string when valueType absent", () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    expect(w.find(".wp-inj-row").attributes("data-type")).toBe("");
  });
});

describe("InjectorRow — right-click context menu (Phase 4)", () => {
  it("emits row-contextmenu with idx + event on right click", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow(), index: 3 } });
    await w.find(".wp-inj-row").trigger("contextmenu", { clientX: 50, clientY: 60 });
    const ev = w.emitted("row-contextmenu");
    expect(ev).toBeTruthy();
    const payload = ev![0][0] as { ev: MouseEvent; idx: number };
    expect(payload.idx).toBe(3);
    expect(payload.ev).toBeInstanceOf(Event);
  });

  it("does not emit row-contextmenu when index prop is unset", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    await w.find(".wp-inj-row").trigger("contextmenu");
    expect(w.emitted("row-contextmenu")).toBeUndefined();
  });
});

describe("InjectorRow — collapse / summary (Phase 5)", () => {
  it("summary renders by default (row expanded)", () => {
    const w = mount(InjectorRow, { props: { row: makeRow() } });
    expect(w.find('[data-test="inj-row-summary"]').exists()).toBe(true);
  });

  it("summary stays mounted but is marked collapsed when row._collapsed is true", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ _collapsed: true }) } });
    // .wp-collapse-row keeps content mounted and animates a grid-track
    // 1fr -> 0fr collapse. Tests check the collapsed-state marker on
    // the wrapper rather than DOM presence so Vue Test Utils still
    // sees the summary node.
    expect(w.find('[data-test="inj-row-summary"]').exists()).toBe(true);
    const wrap = w.find('[data-test="inj-row-summary"]').element.parentElement;
    expect(wrap?.classList.contains("wp-collapse-row")).toBe(true);
    expect(wrap?.getAttribute("data-collapsed")).toBe("true");
  });

  it("caret toggles _collapsed via update emit", async () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ _collapsed: false }) } });
    await w.find('[data-test="inj-row-collapse"]').trigger("click");
    const last = w.emitted("update")![0][0] as Partial<RowType>;
    expect(last._collapsed).toBe(true);
  });

  it("caret shows pi-caret-down when expanded, pi-caret-right when collapsed", () => {
    const expanded = mount(InjectorRow, { props: { row: makeRow({ _collapsed: false }) } });
    expect(expanded.find('[data-test="inj-row-collapse"] .pi-caret-down').exists()).toBe(true);
    const collapsed = mount(InjectorRow, { props: { row: makeRow({ _collapsed: true }) } });
    expect(collapsed.find('[data-test="inj-row-collapse"] .pi-caret-right').exists()).toBe(true);
  });

  it("summary contains binding + slot when binding present", () => {
    const w = mount(InjectorRow, {
      props: { row: makeRow({ binding: "seed_phrase", slot_name: "input_0" }), valueType: "STRING" },
    });
    const text = w.find('[data-test="inj-row-summary"]').text();
    expect(text).toContain("seed_phrase");
    expect(text).toContain("input_0");
    expect(text).toContain("string");
  });

  it("summary shows empty-binding hint when binding is blank", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ binding: "" }) } });
    expect(w.find(".wp-inj-summary__empty").exists()).toBe(true);
  });

  it("renders the template + tpl badge when row.template is set", () => {
    const w = mount(InjectorRow, {
      props: { row: makeRow({ template: "hello $input_1" }) },
    });
    expect(w.find('[data-test="inj-row-summary-template"]').text()).toBe("hello $input_1");
    expect(w.find('[data-test="inj-row-tpl-badge"]').exists()).toBe(true);
  });

  it("no tpl badge when template is empty/null", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ template: "" }) } });
    expect(w.find('[data-test="inj-row-tpl-badge"]').exists()).toBe(false);
    const w2 = mount(InjectorRow, { props: { row: makeRow({ template: null }) } });
    expect(w2.find('[data-test="inj-row-tpl-badge"]').exists()).toBe(false);
  });
});

describe("InjectorRow — slot tag (Phase C.1a)", () => {
  it("renders .wp-inj-slot containing the row.slot_name when no displayLabel", () => {
    const w = mount(InjectorRow, { props: { row: makeRow({ slot_name: "input_2" }) } });
    expect(w.find(".wp-inj-slot").text()).toBe("input_2");
  });

  it("renders the displayLabel when provided (user-customized socket label)", () => {
    const w = mount(InjectorRow, {
      props: { row: makeRow({ slot_name: "input_2" }), displayLabel: "model_wire" },
    });
    expect(w.find(".wp-inj-slot").text()).toBe("model_wire");
  });

  it("title tooltip surfaces both slot_name and custom label when they differ", () => {
    const w = mount(InjectorRow, {
      props: { row: makeRow({ slot_name: "input_2" }), displayLabel: "model_wire" },
    });
    expect(w.find(".wp-inj-slot").attributes("title")).toBe(
      "Bound to socket input_2 (label: model_wire)",
    );
  });
});
