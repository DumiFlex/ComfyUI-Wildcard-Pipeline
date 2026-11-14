import { describe, expect, it, vi } from "vitest";
import {
  NEGATIVE_COLLAPSED_PROP,
  create,
  createPromoted,
  editorVariant,
  initialNegativeCollapsed,
} from "./templateEditor";

describe("editorVariant", () => {
  it("negative_template gets the negative editor with the reserved slot", () => {
    const v = editorVariant("negative_template");
    expect(v.negative).toBe(true);
    expect(v.ariaLabel).toBe("Negative template");
    expect(v.placeholder).toBe("$negatives");
    expect(v.reservedVars).toEqual(["negatives"]);
  });

  it("any other input is the prompt template", () => {
    const v = editorVariant("template");
    expect(v.negative).toBe(false);
    expect(v.ariaLabel).toBe("Prompt template");
    expect(v.reservedVars).toEqual([]);
  });
});

describe("initialNegativeCollapsed", () => {
  it("collapsed by default exactly when empty", () => {
    expect(initialNegativeCollapsed(undefined, "")).toBe(true);
    expect(initialNegativeCollapsed({}, "  ")).toBe(true);
    expect(initialNegativeCollapsed({}, "lowres, $negatives")).toBe(false);
  });

  it("a saved choice wins", () => {
    expect(initialNegativeCollapsed({ [NEGATIVE_COLLAPSED_PROP]: false }, "")).toBe(false);
    expect(initialNegativeCollapsed({ [NEGATIVE_COLLAPSED_PROP]: true }, "lowres")).toBe(true);
  });
});

describe("the template editor on a subgraph node", () => {
  interface FakeWidget {
    element: HTMLElement;
    options?: Record<string, unknown>;
    onRemove?: (...a: unknown[]) => unknown;
  }
  function fakeNode(id: number) {
    const widgets: FakeWidget[] = [];
    const removes: ReturnType<typeof vi.fn>[] = [];
    return {
      removes,
      id,
      mode: 0,
      inputs: [{ name: "template", link: null as number | null }],
      properties: {} as Record<string, unknown>,
      widgets,
      addDOMWidget(_n: string, _t: string, el: HTMLElement, opts?: Record<string, unknown>): FakeWidget {
        const remove = vi.fn();
        removes.push(remove);
        const w: FakeWidget = { element: el, options: opts, onRemove: remove };
        widgets.push(w);
        return w;
      },
    };
  }

  it("offers itself for promotion and builds an editor bound to the stored value", () => {
    const inner = fakeNode(1);
    const host = create(inner as never, "template");
    const outer = fakeNode(2);
    let stored = "a $style cat";
    const value = { get: () => stored, set: (v: string) => { stored = v; } };
    const made = createPromoted(inner as never, "template", { subgraphNode: outer as never, inputName: "template", value });
    expect(outer.widgets).toHaveLength(1);
    expect(made).toBe(outer.widgets[0]);
    // ComfyUI setting the widget (load, undo) reaches the store.
    const setValue = outer.widgets[0]?.options?.setValue as (v: string) => void;
    const getValue = outer.widgets[0]?.options?.getValue as () => string;
    expect(getValue()).toBe("a $style cat");
    setValue("a dog");
    expect(stored).toBe("a dog");
    // Demoting the input runs ComfyUI's onRemove, then tears our editor down.
    const w = made as FakeWidget;
    const mounted = () => (w.element.firstElementChild as unknown as { __vue_app__?: unknown } | null)?.__vue_app__;
    expect(mounted()).toBeTruthy();
    w.onRemove?.();
    expect(outer.removes[0]).toHaveBeenCalledTimes(1);
    expect(mounted()).toBeFalsy();
    host.unmount();
  });
});
