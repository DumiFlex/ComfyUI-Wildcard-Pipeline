import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useCanvasSettings } from "../../composables/useCanvasSettings";
import {
  CANVAS_SETTINGS_CHANNEL,
  SETTING_ID_AC_MAX_SUGGESTIONS,
  SETTING_ID_AC_TAGS,
  SETTING_ID_DENSITY,
} from "../../../extension/settings-catalog";
import { announceCanvasSetting, listenForManagerSettings } from "../../../extension/settings";

/**
 * Canvas settings stay in step both ways over one BroadcastChannel: the
 * manager hands a change to the canvas, and the canvas announces a change
 * made in ComfyUI's panel or the playground. A tiny in-memory channel stands
 * in for the browser's, delivering to every other instance with the name.
 */
class FakeChannel {
  static open = new Set<FakeChannel>();
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { FakeChannel.open.add(this); }
  postMessage(data: unknown): void {
    for (const c of FakeChannel.open) {
      if (c !== this && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
    }
  }
  close(): void { FakeChannel.open.delete(this); }
}

let stored: Record<string, unknown>;

beforeEach(() => {
  FakeChannel.open.clear();
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  stored = { [SETTING_ID_DENSITY]: "compact", [SETTING_ID_AC_TAGS]: true };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      stored[decodeURIComponent(url.split("/").pop() ?? "")] = JSON.parse(String(init.body));
      return new Response("{}");
    }
    return new Response(JSON.stringify(stored));
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mountComposable() {
  let api!: ReturnType<typeof useCanvasSettings>;
  const w = mount(defineComponent({ setup() { api = useCanvasSettings(); return () => h("div"); } }));
  return { w, api: () => api };
}

describe("useCanvasSettings — live both ways", () => {
  it("reads the canvas autocomplete copies along with the Canvas settings", async () => {
    const { api } = mountComposable();
    await flushPromises();
    expect(api().values.value[SETTING_ID_DENSITY]).toBe("compact");
    expect(api().values.value[SETTING_ID_AC_TAGS]).toBe(true);
    expect(api().values.value[SETTING_ID_AC_MAX_SUGGESTIONS]).toBe("20");
  });

  it("shows a change announced by a canvas tab at once", async () => {
    const { api } = mountComposable();
    await flushPromises();
    announceCanvasSetting(SETTING_ID_DENSITY, "minimal");
    await nextTick();
    expect(api().values.value[SETTING_ID_DENSITY]).toBe("minimal");
  });

  it("ignores manager messages and ids it doesn't know", async () => {
    const { api } = mountComposable();
    await flushPromises();
    const other = new FakeChannel(CANVAS_SETTINGS_CHANNEL);
    other.postMessage({ id: SETTING_ID_DENSITY, value: "minimal", source: "manager" });
    other.postMessage({ id: "wildcardPipeline.other", value: true, source: "canvas" });
    await nextTick();
    expect(api().values.value[SETTING_ID_DENSITY]).toBe("compact");
    expect("wildcardPipeline.other" in api().values.value).toBe(false);
  });

  it("hands a manager change to the canvas, which ignores canvas echoes", async () => {
    const set = vi.fn();
    const stop = listenForManagerSettings({ extensionManager: { setting: { set } } });
    const { api } = mountComposable();
    await flushPromises();
    await api().set(SETTING_ID_AC_TAGS, false);
    expect(set).toHaveBeenCalledWith(SETTING_ID_AC_TAGS, false);
    expect(stored[SETTING_ID_AC_TAGS]).toBe(false);
    set.mockClear();
    announceCanvasSetting(SETTING_ID_DENSITY, "minimal");
    expect(set).not.toHaveBeenCalled();
    stop();
  });
});
