import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import {
  _resetAiActionsForTests, anchors, pointer, registerAiAction, runCall, type AiActionHost,
} from "../useAiActions";
import type { AiPendingCall } from "../../api/types";

function host(over: Partial<AiActionHost> = {}): AiActionHost {
  return {
    navigate: vi.fn(async () => true),
    hasRoute: () => true,
    page: () => ({ route: "all" }),
    ...over,
  };
}

describe("useAiActions", () => {
  beforeEach(() => {
    _resetAiActionsForTests();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("lists anchors, settings rows and sidebar links, but not the chat", () => {
    document.body.innerHTML = `
      <div data-ai-anchor="rows" data-ai-label="The list">x</div>
      <div data-setting="ai-model"><span class="wp-set-row__label">Model</span><input></div>
      <a data-nav-id="test"><span class="wp-nav__label">Test Runner</span></a>
      <aside class="wp-ai-chat"><div data-ai-anchor="inside">no</div></aside>`;
    expect(anchors().map((a) => `${a.key}=${a.label}`)).toEqual([
      "rows=The list", "ai-model=Model", "nav-test=Test Runner",
    ]);
  });

  it("says when there is nothing to point at, and when a part is missing", async () => {
    const call: AiPendingCall = { id: "h", tool: "highlight", label: "", args: { anchor: "nope", caption: "" } };
    expect(await runCall(call, host())).toContain('no part "nope"');
    expect(pointer.value).toBeNull();
  });

  it("reports when the user stays on a page with unsaved changes", async () => {
    const call: AiPendingCall = { id: "o", tool: "open", label: "", args: { id: "w1", type: "wildcard" } };
    const h = host({ navigate: vi.fn(async () => false) });
    expect(await runCall(call, h)).toContain("stayed on the page");
    expect(h.navigate).toHaveBeenCalledWith({ name: "wildcards-edit", params: { id: "w1" } });
    const bad: AiPendingCall = { id: "o", tool: "open", label: "", args: { page: "nowhere" } };
    expect(await runCall(bad, host({ hasRoute: () => false }))).toContain("no page nowhere");
  });

  it("uses the delegate on screen when it holds the rows, else opens the right page", async () => {
    const run = vi.fn(async () => "selected 1 row: Weapon");
    const List = defineComponent({
      setup() {
        registerAiAction("select_rows", run, (args) => (args.ids as string[]).every((id) => id === "w1"));
        return {};
      },
      template: "<div />",
    });
    const w = mount(List);
    const h = host();
    const call: AiPendingCall = { id: "s", tool: "select_rows", label: "", args: { ids: ["w1"] } };
    expect(await runCall(call, h)).toBe("selected 1 row: Weapon");
    expect(h.navigate).not.toHaveBeenCalled();
    // Not this list's rows: it goes to All items, which never mounts here.
    vi.useFakeTimers();
    const other = runCall({ ...call, args: { ids: ["zz"] } }, h);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await other).toContain("didn't open");
    expect(h.navigate).toHaveBeenCalledWith({ name: "all" });
    vi.useRealTimers();
    w.unmount();
  });
});
