import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { _resetAiActionsForTests, runCall, type AiActionHost } from "../useAiActions";
import type { AiConfig, AiPendingCall } from "../../api/types";

const config = ref<Partial<AiConfig> | null>({ enabled: true });
vi.mock("../useAiConfig", () => ({ useAiConfig: () => ({ config }) }));

const { usePanelAction } = await import("../usePanelAction");

function host(): AiActionHost {
  return {
    navigate: vi.fn(async () => true),
    hasRoute: () => true,
    page: () => ({ route: "wildcards-edit" }),
  };
}

function call(args: { id: string; type: string; panel: string; request: string }): AiPendingCall {
  return { id: "c", tool: "use_panel", label: "", args };
}

describe("usePanelAction", () => {
  const describeFn = vi.fn(async (text: string) => `described: ${text}`);
  const draft = vi.fn(async (text: string) => `drafted: ${text}`);

  function mountEditor(id = "w1") {
    const Editor = defineComponent({
      setup() {
        usePanelAction({
          id: () => id,
          identity: ref({ describe: describeFn }),
          panels: { draft },
        });
        return {};
      },
      template: "<div />",
    });
    return mount(Editor);
  }

  beforeEach(() => {
    _resetAiActionsForTests();
    config.value = { enabled: true };
    describeFn.mockClear();
    draft.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("sends describe to the identity card", async () => {
    const w = mountEditor();
    const out = await runCall(call({ id: "w1", type: "wildcard", panel: "describe", request: "shorter" }), host());
    expect(out).toBe("described: shorter");
    expect(describeFn).toHaveBeenCalledWith("shorter");
    w.unmount();
  });

  it("runs a named panel with the request", async () => {
    const w = mountEditor();
    const out = await runCall(call({ id: "w1", type: "fixed_values", panel: "draft", request: "ten colors" }), host());
    expect(out).toBe("drafted: ten colors");
    expect(draft).toHaveBeenCalledWith("ten colors");
    w.unmount();
  });

  it("says when the editor has no such panel", async () => {
    const w = mountEditor();
    const out = await runCall(call({ id: "w1", type: "fixed_values", panel: "retag", request: "x" }), host());
    expect(out).toBe("couldn't: this editor has no retag panel");
    w.unmount();
  });

  it("only owns calls for its own item", async () => {
    const w = mountEditor("w1");
    vi.useFakeTimers();
    const h = host();
    const other = runCall(call({ id: "zz", type: "wildcard", panel: "draft", request: "x" }), h);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await other).toContain("didn't open");
    expect(h.navigate).toHaveBeenCalledWith({ name: "wildcards-edit", params: { id: "zz" } });
    expect(draft).not.toHaveBeenCalled();
    w.unmount();
  });

  it("refuses while the assistant is off", async () => {
    config.value = { enabled: false };
    const w = mountEditor();
    const out = await runCall(call({ id: "w1", type: "wildcard", panel: "draft", request: "x" }), host());
    expect(out).toBe("couldn't: the assistant is off");
    expect(draft).not.toHaveBeenCalled();
    w.unmount();
  });
});
