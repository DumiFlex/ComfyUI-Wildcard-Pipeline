import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { createDomWidgetHost, parseWidgetJson, serializeWidgetJson } from "./_shared";

describe("createDomWidgetHost", () => {
  it("mounts a Vue component into a fresh div and returns the host element", () => {
    const Hello = defineComponent({
      props: { msg: { type: String, required: true } },
      setup: (p) => () => h("span", { class: "hi" }, p.msg),
    });
    const fakeNode = { addDOMWidget: (_n: string, _t: string, el: HTMLElement) => ({ element: el }) };
    const { element, unmount } = createDomWidgetHost(fakeNode, "modules", Hello, {
      componentProps: { msg: "ok" },
    });
    expect(element.querySelector(".hi")?.textContent).toBe("ok");
    unmount();
    expect(element.querySelector(".hi")).toBeNull();
  });

  it("exposes getValue/setValue backed by the closure state", () => {
    const Empty = defineComponent({ setup: () => () => h("span") });
    let captured: { getValue?: () => string; setValue?: (v: string) => void } = {};
    const fakeNode = {
      addDOMWidget: (_n: string, _t: string, el: HTMLElement, opts: Record<string, unknown> | undefined) => {
        captured = opts as never;
        return { element: el };
      },
    };
    const restored: string[] = [];
    const host = createDomWidgetHost(fakeNode, "modules", Empty, {
      initialValue: "seed",
      onValueRestored: (v) => restored.push(v),
    });
    expect(host.getValue()).toBe("seed");
    expect(captured.getValue?.()).toBe("seed");

    captured.setValue?.("from-workflow");
    expect(host.getValue()).toBe("from-workflow");
    expect(restored).toEqual(["from-workflow"]);

    host.setValue("from-host");
    expect(captured.getValue?.()).toBe("from-host");
    host.unmount();
  });
});

describe("parseWidgetJson / serializeWidgetJson", () => {
  it("round-trips, returns parsed value, and falls back on invalid input", () => {
    const fallback = { version: 1, modules: [] };
    const real = { version: 1, modules: [{ id: "abc12345" }] };
    expect(parseWidgetJson(JSON.stringify(real), fallback)).toEqual(real);
    expect(parseWidgetJson("not-json", fallback)).toEqual(fallback);
    expect(parseWidgetJson("null", fallback)).toEqual(fallback);
    expect(serializeWidgetJson({ version: 1, modules: [] })).toBe('{"version":1,"modules":[]}');
  });
});
