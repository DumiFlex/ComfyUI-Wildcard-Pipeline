import { beforeEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PickerModal from "./PickerModal.vue";
import { _resetImageFilterForTests, type WaitingRequest } from "../../extension/image-filter";
import { dropDraftEdits } from "./picker-state";

const ref = (n: string) => ({ filename: `${n}.png`, subfolder: "", type: "temp" });

function request(frames: number[], over: Partial<WaitingRequest> = {}): WaitingRequest {
  return {
    token: "tok",
    node_id: "3",
    frames: frames.map((count, f) => Array.from({ length: count }, (_, i) => ref(`${f}-${i}`))),
    labels: [],
    send_as: "same_shape",
    has_clip: true,
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
  beforeEach(() => {
    _resetImageFilterForTests();
    dropDraftEdits("tok");
    localStorage.clear();
  });

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

  it("clicking a frame zooms its first image; clicking an image only picks it", async () => {
    const w = mk(request([2, 2], { labels: [{ loop_index: 0 }, { loop_index: 1 }] }));
    await w.find('[data-test="image-filter-tile-1-1"]').trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(false);
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("1 picked");
    await w.find('[data-test="image-filter-frame-1"] .wp-ifp__frame-label').trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("image 1");
  });

  it("the header Zoom button opens the zoom on the first picked image and closes it again", async () => {
    const w = mk(request([3]));
    await w.find('[data-test="image-filter-tile-0-2"]').trigger("click");
    const btn = w.find('[data-test="image-filter-zoom-toggle"]');
    await btn.trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("3 / 3");
    expect(btn.text()).toBe("Back to all");
    await btn.trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(false);
  });

  it("a loop's frames are grouped; the frame's all button picks the whole frame", async () => {
    const w = mk(request([2, 2, 2], { labels: [{ loop_index: 0 }, { loop_index: 1 }, { loop_index: 2 }] }));
    expect(w.findAll('[data-test^="image-filter-frame-"]')).toHaveLength(3);
    await w.find('[data-test="image-filter-frame-1"] .wp-ifp__frame-all').trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(false);
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

  it("remembers being zoomed: the next picker opens zoomed in", async () => {
    const w = mk(request([2]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(true);
    w.unmount();
    const again = mk(request([2], { token: "tok2" }));
    expect(again.find('[data-test="image-filter-zoom"]').exists()).toBe(true);
    await again.vm.$nextTick();
    await again.find('[data-test="image-filter-picker"]').trigger("keydown", { key: " " });
    again.unmount();
    expect(mk(request([2])).find('[data-test="image-filter-zoom"]').exists()).toBe(false);
  });

  it("an edited prompt goes out with the picks, for the whole frame with Same shape", async () => {
    const w = mk(request([2], { labels: [{ positive: "a cat", negative: "blurry" }] }));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    const pos = w.find('[data-test="image-filter-positive"]');
    expect((pos.element as HTMLTextAreaElement).value).toBe("a cat");
    await pos.setValue("a dog");
    expect(w.find('[data-test="image-filter-refine"]').text()).toContain("edited");
    await w.find('[data-test="image-filter-zoom-pick"]').trigger("click");
    await root.trigger("keydown", { key: "Enter" });
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({
      action: "picks",
      picks: [[0, 0]],
      edits: { "0:0": { positive: "a dog" } },
    });
  });

  it("typing the original text back clears the edit; One per image edits one image", async () => {
    const w = mk(request([2], { labels: [{ positive: "a cat" }], send_as: "per_image" }));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    const pos = w.find('[data-test="image-filter-positive"]');
    await pos.setValue("x");
    await pos.setValue("a cat");
    await pos.setValue("y");
    await w.find('[data-test="image-filter-keep-all"]').trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "keep_all", edits: { "0:0": { positive: "y" } } });
  });

  it("warns that edits only change text without a CLIP", async () => {
    const w = mk(request([1], { labels: [{ positive: "p" }], has_clip: false }));
    await w.vm.$nextTick();
    await w.find('[data-test="image-filter-picker"]').trigger("keydown", { key: " " });
    expect(w.find('[data-test="image-filter-no-clip"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-negative"]').exists()).toBe(false);
  });

  it("C pins an image and compares it with the next one", async () => {
    const w = mk(request([3]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    await root.trigger("keydown", { key: "c" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(false);
    await root.trigger("keydown", { key: "ArrowRight" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(true);
    await root.trigger("keydown", { key: "c" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(false);
  });

  it("M opens the mask painter for the zoomed image", async () => {
    const w = mk(request([1]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    await root.trigger("keydown", { key: "m" });
    expect(w.find('[data-test="image-filter-mask"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-mask-clear"]').exists()).toBe(true);
  });

  it("I adds Details to the zoom: values, marked prompt, the frame's images; it is remembered", async () => {
    const labels = [{ positive: "1girl, red hair, calm", vars: { hair: "red hair", mood: "calm" }, seed: 9 }];
    const w = mk(request([2], { labels }));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    expect(w.find('[data-test="image-filter-details"]').exists()).toBe(false);
    await root.trigger("keydown", { key: "i" });
    const details = w.find('[data-test="image-filter-details"]');
    expect(details.text()).toContain("$hair");
    expect(details.text()).toContain("seed9");
    const marked = w.find('[data-test="image-filter-positive-marked"]');
    expect(marked.findAll("mark").map((m) => m.text())).toEqual(["red hair", "calm"]);
    await marked.trigger("click");
    expect(w.find('[data-test="image-filter-positive"]').exists()).toBe(true);
    await details.find('[data-test="image-filter-details-frame"]').trigger("click");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 picked");
    await details.findAll(".wp-ifp-tile")[1]?.trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').text()).toContain("2 / 2");
    w.unmount();
    const again = mk(request([2], { labels }));
    expect(again.find('[data-test="image-filter-details"]').exists()).toBe(true);
  });

  it("frame captions show the loop number and hover shows seed and prompt", () => {
    const w = mk(request([1, 1], { labels: [{ loop_index: 4, seed: 77, positive: "red hat" }, { loop_index: 5 }] }));
    const label = w.find('[data-test="image-filter-frame-0"] .wp-ifp__frame-label');
    expect(label.text()).toBe("#5");
    const frame = w.find('[data-test="image-filter-frame-0"]');
    expect(frame.attributes("title")).toContain("Seed 77");
    expect(frame.attributes("title")).toContain("red hat");
  });
});
