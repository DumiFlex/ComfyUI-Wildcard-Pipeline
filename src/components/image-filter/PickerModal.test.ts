import { beforeEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PickerModal from "./PickerModal.vue";
import { _resetImageFilterForTests, type WaitingRequest } from "../../extension/image-filter";

const ref = (n: string) => ({ filename: `${n}.png`, subfolder: "", type: "temp" });

function request(frames: number[], over: Partial<WaitingRequest> = {}): WaitingRequest {
  return {
    token: "tok",
    node_id: "3",
    frames: frames.map((count, f) => Array.from({ length: count }, (_, i) => ref(`${f}-${i}`))),
    labels: [],
    timeout: 0,
    started_at: 0,
    receivedAt: Date.now(),
    ...over,
  };
}

function mk(req: WaitingRequest) {
  return mount(PickerModal, { props: { request: req }, global: { stubs: { teleport: true } } });
}

describe("PickerModal", () => {
  beforeEach(() => _resetImageFilterForTests());

  it("picks survive the picker being tucked away and reopened", async () => {
    const req = request([3]);
    const first = mk(req);
    await first.find('[data-test="image-filter-tile-0-2"]').trigger("click");
    first.unmount();
    const again = mk(req);
    expect(again.find('[data-test="image-filter-status"]').text()).toContain("1 picked");
    expect(again.find('[data-test="image-filter-keep-picked"]').text()).toBe("Keep 1 picked");
  });

  it("one batch shows a flat grid; keep picked sends the picks in order", async () => {
    const w = mk(request([4]));
    expect(w.findAll('[data-test^="image-filter-frame-"]')).toHaveLength(1);
    const keep = w.find('[data-test="image-filter-keep-picked"]');
    expect(keep.attributes("disabled")).toBeDefined();
    await w.find('[data-test="image-filter-tile-0-3"]').trigger("click");
    await w.find('[data-test="image-filter-tile-0-1"]').trigger("click");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 picked");
    await keep.trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[0, 1], [0, 3]] });
  });

  it("a loop's frames are grouped; clicking a frame label picks the whole frame", async () => {
    const w = mk(request([2, 2, 2], { labels: [{ loop_index: 0 }, { loop_index: 1 }, { loop_index: 2 }] }));
    expect(w.findAll('[data-test^="image-filter-frame-"]')).toHaveLength(3);
    await w.find('[data-test="image-filter-frame-1"] .wp-ifp__frame-label').trigger("click");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 picked from 1 frame");
    await w.find('[data-test="image-filter-keep-picked"]').trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[1, 0], [1, 1]] });
  });

  it("keep all and stop branch answer directly", async () => {
    const w = mk(request([3]));
    await w.find('[data-test="image-filter-keep-all"]').trigger("click");
    await w.find('[data-test="image-filter-stop"]').trigger("click");
    expect(w.emitted("answer")).toEqual([[{ action: "keep_all" }], [{ action: "stop" }]]);
  });

  it("Space zooms the hovered image; arrows move, ↑ picks, Escape leaves the zoom first", async () => {
    const w = mk(request([3]));
    await w.find('[data-test="image-filter-tile-0-1"]').trigger("mouseenter");
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("2 / 3");
    await root.trigger("keydown", { key: "ArrowRight" });
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("3 / 3");
    await root.trigger("keydown", { key: "ArrowUp" });
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("Picked");
    await root.trigger("keydown", { key: "Escape" });
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(false);
    expect(w.emitted("minimize")).toBeUndefined();
    await root.trigger("keydown", { key: "Escape" });
    expect(w.emitted("minimize")).toHaveLength(1);
    await root.trigger("keydown", { key: "Enter" });
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[0, 2]] });
  });

  it("Ctrl+A picks everything, again clears", async () => {
    const w = mk(request([2, 1]));
    // The key shield binds after the first render (flush: "post").
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "a", ctrlKey: true });
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("3 picked");
    await root.trigger("keydown", { key: "a", ctrlKey: true });
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("0 picked");
  });

  it("shows the countdown when the node has a timeout", () => {
    const w = mk(request([1], { timeout: 125 }));
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2:05 left");
  });
});
