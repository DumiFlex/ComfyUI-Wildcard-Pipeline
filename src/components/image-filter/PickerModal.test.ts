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
    expect(again.find('[data-test="image-filter-status"]').text()).toContain("1 of 3 picked");
    expect(again.find('[data-test="image-filter-keep-picked"]').text()).toBe("Keep 1 picked");
  });

  it("one batch shows a flat grid; keep picked sends the picks in order", async () => {
    const w = mk(request([4]));
    expect(w.findAll('[data-test^="image-filter-frame-"]')).toHaveLength(1);
    const keep = w.find('[data-test="image-filter-keep-picked"]');
    expect(keep.attributes("disabled")).toBeDefined();
    await w.find('[data-test="image-filter-tile-0-3"]').trigger("click");
    await w.find('[data-test="image-filter-tile-0-1"]').trigger("click");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 of 4 picked");
    await keep.trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[0, 1], [0, 3]] });
  });

  it("clicking a frame opens Detail on its first image; clicking an image only picks it", async () => {
    const w = mk(request([2, 2], { labels: [{ loop_index: 0 }, { loop_index: 1 }] }));
    await w.find('[data-test="image-filter-tile-1-1"]').trigger("click");
    expect(w.find('[data-test="image-filter-detail"]').exists()).toBe(false);
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("1 of 4 picked");
    await w.find('[data-test="image-filter-frame-1"] .wp-ifp__frame-label').trigger("click");
    expect(w.find('[data-test="image-filter-refine"]').text()).toContain("image 1");
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("3 / 4");
  });

  it("the mode switch moves between Grid, Detail and Zoom; Detail opens on the first picked image", async () => {
    const w = mk(request([3]));
    await w.find('[data-test="image-filter-tile-0-2"]').trigger("click");
    await w.find('[data-test="image-filter-mode-detail"]').trigger("click");
    expect(w.find('[data-test="image-filter-picker"]').attributes("data-mode")).toBe("detail");
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("3 / 3");
    expect(w.find('[data-test="image-filter-pick"]').text()).toBe("Picked");
    await w.find('[data-test="image-filter-mode-zoom"]').trigger("click");
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(true);
    expect(w.find('[data-test="imgzoom-fit"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-zoom-cap"]').text()).toContain("3 / 3");
    await w.find('[data-test="image-filter-mode-grid"]').trigger("click");
    expect(w.find('[data-test="image-filter-frames"]').exists()).toBe(true);
  });

  it("the footer stays the same in every mode", async () => {
    const w = mk(request([2]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    for (const key of ["g", "d", "z"]) {
      await root.trigger("keydown", { key });
      expect(w.find('[data-test="image-filter-keep-picked"]').exists()).toBe(true);
      expect(w.find('[data-test="image-filter-status"]').text()).toContain("0 of 2 picked");
    }
  });

  it("a loop's frames are grouped; the frame's all button picks the whole frame", async () => {
    const w = mk(request([2, 2, 2], { labels: [{ loop_index: 0 }, { loop_index: 1 }, { loop_index: 2 }] }));
    expect(w.findAll('[data-test^="image-filter-frame-"]')).toHaveLength(3);
    await w.find('[data-test="image-filter-frame-1"] .wp-ifp__frame-all').trigger("click");
    expect(w.find('[data-test="image-filter-detail"]').exists()).toBe(false);
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 of 6 picked from 1 frame");
    await w.find('[data-test="image-filter-keep-picked"]').trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[1, 0], [1, 1]] });
  });

  it("keep all and stop branch answer directly", async () => {
    const w = mk(request([3]));
    await w.find('[data-test="image-filter-keep-all"]').trigger("click");
    await w.find('[data-test="image-filter-stop"]').trigger("click");
    expect(w.emitted("answer")).toEqual([[{ action: "keep_all" }], [{ action: "stop" }]]);
  });

  it("Space picks the hovered image in Grid; D opens it; arrows move, P picks; Escape steps back a mode", async () => {
    const w = mk(request([3]));
    await w.vm.$nextTick();
    await w.find('[data-test="image-filter-tile-0-1"]').trigger("mouseenter");
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: " " });
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("1 of 3 picked");
    await root.trigger("keydown", { key: "d" });
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("2 / 3");
    await root.trigger("keydown", { key: "ArrowRight" });
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("3 / 3");
    await root.trigger("keydown", { key: "p" });
    expect(w.find('[data-test="image-filter-pick"]').text()).toBe("Picked");
    await root.trigger("keydown", { key: "z" });
    expect(w.find('[data-test="image-filter-zoom"]').exists()).toBe(true);
    await root.trigger("keydown", { key: "Escape" });
    expect(w.find('[data-test="image-filter-detail"]').exists()).toBe(true);
    await root.trigger("keydown", { key: "Escape" });
    expect(w.find('[data-test="image-filter-frames"]').exists()).toBe(true);
    expect(w.emitted("minimize")).toBeUndefined();
    await root.trigger("keydown", { key: "Escape" });
    expect(w.emitted("minimize")).toHaveLength(1);
    await root.trigger("keydown", { key: "Enter" });
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "picks", picks: [[0, 1], [0, 2]] });
  });

  it("the strip in Detail jumps to an image; double-clicking it opens Zoom", async () => {
    const w = mk(request([4]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "d" });
    await w.find('[data-test="image-filter-strip-0-3"]').trigger("click");
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("4 / 4");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("0 of 4 picked");
    await w.find('[data-test="image-filter-strip-0-1"]').trigger("dblclick");
    expect(w.find('[data-test="image-filter-zoom-cap"]').text()).toContain("2 / 4");
  });

  it("Ctrl+A picks everything, again clears", async () => {
    const w = mk(request([2, 1]));
    // The key shield binds after the first render (flush: "post").
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "a", ctrlKey: true });
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("3 of 3 picked");
    await root.trigger("keydown", { key: "a", ctrlKey: true });
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("0 of 3 picked");
  });

  it("shows the countdown when the node has a timeout", () => {
    const w = mk(request([1], { timeout: 125 }));
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2:05 left");
  });

  it("remembers the mode: the next picker opens in it", async () => {
    const w = mk(request([2]));
    await w.vm.$nextTick();
    await w.find('[data-test="image-filter-picker"]').trigger("keydown", { key: "z" });
    w.unmount();
    const again = mk(request([2], { token: "tok2" }));
    expect(again.find('[data-test="image-filter-zoom"]').exists()).toBe(true);
    await again.vm.$nextTick();
    await again.find('[data-test="image-filter-picker"]').trigger("keydown", { key: "g" });
    again.unmount();
    expect(mk(request([2])).find('[data-test="image-filter-frames"]').exists()).toBe(true);
  });

  it("an edited prompt goes out with the picks, for the whole frame with Same shape", async () => {
    const w = mk(request([2], { labels: [{ positive: "a cat", negative: "blurry" }] }));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "d" });
    const pos = w.find('[data-test="image-filter-positive"]');
    expect((pos.element as HTMLTextAreaElement).value).toBe("a cat");
    await pos.setValue("a dog");
    expect(w.find('[data-test="image-filter-refine"]').text()).toContain("edited");
    await w.find('[data-test="image-filter-pick"]').trigger("click");
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
    await root.trigger("keydown", { key: "d" });
    const pos = w.find('[data-test="image-filter-positive"]');
    await pos.setValue("x");
    await pos.setValue("a cat");
    await pos.setValue("y");
    await w.find('[data-test="image-filter-keep-all"]').trigger("click");
    expect(w.emitted("answer")?.[0]?.[0]).toEqual({ action: "keep_all", edits: { "0:0": { positive: "y" } } });
  });

  it("shows only the prompt fields that are wired, and warns without a CLIP", async () => {
    const w = mk(request([1], { labels: [{ positive: "p" }], has_clip: false }));
    await w.vm.$nextTick();
    await w.find('[data-test="image-filter-picker"]').trigger("keydown", { key: "d" });
    expect(w.find('[data-test="image-filter-no-clip"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-positive"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-negative"]').exists()).toBe(false);
  });

  it("with no prompt wired, Detail shows one line instead of empty fields", async () => {
    const w = mk(request([1], { has_clip: false }));
    await w.vm.$nextTick();
    await w.find('[data-test="image-filter-picker"]').trigger("keydown", { key: "d" });
    expect(w.find('[data-test="image-filter-no-prompt"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-positive"]').exists()).toBe(false);
    expect(w.find('[data-test="image-filter-no-clip"]').exists()).toBe(false);
  });

  it("C pins an image and compares it with the next one", async () => {
    const w = mk(request([3]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "d" });
    await root.trigger("keydown", { key: "c" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(false);
    await root.trigger("keydown", { key: "ArrowRight" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(true);
    await root.trigger("keydown", { key: "c" });
    expect(w.find('[data-test="image-filter-compare"]').exists()).toBe(false);
  });

  it("M opens the mask painter for the image in Detail", async () => {
    const w = mk(request([1]));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "d" });
    await root.trigger("keydown", { key: "m" });
    expect(w.find('[data-test="image-filter-mask"]').exists()).toBe(true);
    expect(w.find('[data-test="image-filter-mask-clear"]').exists()).toBe(true);
  });

  it("Detail lists the frame's values, marks them in the prompt and picks the whole frame", async () => {
    const labels = [{ positive: "1girl, red hair, calm", vars: { hair: "red hair", mood: "calm" }, seed: 9 }, {}];
    const w = mk(request([2, 1], { labels }));
    await w.vm.$nextTick();
    const root = w.find('[data-test="image-filter-picker"]');
    await root.trigger("keydown", { key: "d" });
    const details = w.find('[data-test="image-filter-details"]');
    expect(details.text()).toContain("$hair");
    expect(details.find('[data-test="image-filter-values"]').text()).toContain("seed9");
    expect(w.find('[data-test="image-filter-meta"]').text()).toContain("seed 9");
    const marked = w.find('[data-test="image-filter-positive-marked"]');
    expect(marked.findAll("mark").map((m) => m.text())).toEqual(["red hair", "calm"]);
    await marked.trigger("click");
    expect(w.find('[data-test="image-filter-positive"]').exists()).toBe(true);
    await details.find('[data-test="image-filter-details-frame"]').trigger("click");
    expect(w.find('[data-test="image-filter-status"]').text()).toContain("2 of 3 picked");
  });

  it("tile size S / M / L / Fit (or F) sizes the grid and is remembered", async () => {
    const w = mk(request([3]));
    await w.vm.$nextTick();
    expect(w.find('[data-test="image-filter-frame-0"]').attributes("style")).toContain("200px");
    await w.find('[data-test="image-filter-tile-size-l"]').trigger("click");
    expect(w.find('[data-test="image-filter-frame-0"]').attributes("style")).toContain("320px");
    await w.find('[data-test="image-filter-tile-size-fit"]').trigger("click");
    expect(w.find('[data-test="image-filter-picker"]').classes()).toContain("is-fit");
    w.unmount();
    const again = mk(request([3]));
    await again.vm.$nextTick();
    expect(again.find('[data-test="image-filter-picker"]').classes()).toContain("is-fit");
    await again.find('[data-test="image-filter-picker"]').trigger("keydown", { key: "f" });
    expect(again.find('[data-test="image-filter-picker"]').classes()).not.toContain("is-fit");
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
