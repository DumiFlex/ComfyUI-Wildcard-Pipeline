import { describe, it, expect } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import VarPicker from "./VarPicker.vue";

describe("VarPicker", () => {
  // The picker is the kit Combobox: its list floats in a Popover teleported to
  // <body>, so these tests mount attached and read the options from document.
  const opts = () => [...document.querySelectorAll<HTMLElement>(".wp-combo__opt")];
  const field = (w: ReturnType<typeof mount>) => w.get<HTMLInputElement>('[data-test="var-picker-trigger"] input, input.wp-combo__field');
  async function typeIn(w: ReturnType<typeof mount>, text: string) {
    const f = field(w);
    await f.trigger("focus");
    await f.setValue(text);
    await flushPromises();
  }

  it("shows the placeholder when modelValue is empty", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "", upstreamVars: [], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    expect(field(w).attributes("placeholder")).toBe("(no var selected)");
    w.unmount();
  });

  it("lists the upstream vars when opened", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "$seed", upstreamVars: ["$seed", "$mood"], previewSource: "1920", previewParsed: "1920", previewDefault: "0" },
    });
    await typeIn(w, "");
    expect(opts().map((o) => o.textContent?.trim())).toEqual(["$seed", "$mood"]);
    w.unmount();
  });

  it("emits update:modelValue with the picked var", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "", upstreamVars: ["$seed", "$mood"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await typeIn(w, "");
    opts()[1]?.click();
    await flushPromises();
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["$mood"]);
    w.unmount();
  });

  it("filters the list as you type, with or without the leading $", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "", upstreamVars: ["$seed", "$mood", "$outfit_color"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await typeIn(w, "moo");
    expect(opts().map((o) => o.textContent?.trim())).toEqual(["$mood"]);
    await typeIn(w, "$see");
    expect(opts().map((o) => o.textContent?.trim())).toEqual(["$seed"]);
    w.unmount();
  });

  it("says so when nothing matches", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "", upstreamVars: ["$seed"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await typeIn(w, "zzz");
    expect(document.querySelector(".wp-combo__empty")?.textContent).toContain("No variable matches");
    w.unmount();
  });

  it("Enter picks the first match", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "", upstreamVars: ["$seed", "$mood"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await typeIn(w, "moo");
    await field(w).trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["$mood"]);
    w.unmount();
  });

  it("shows the parsed preview in teal", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "1920x1080", previewParsed: "1920", previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).not.toContain("wp-var-picker__preview--default");
    expect(preview.classes()).not.toContain("wp-var-picker__preview--idle");
    expect(preview.text()).toContain("→ 1920");
  });

  it("shows the default fallback in amber when previewParsed is null + source present", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "hello", previewParsed: null, previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).toContain("wp-var-picker__preview--default");
    expect(preview.text()).toContain("→ default (0)");
  });

  it("shows the idle state when previewSource is empty (no execute yet)", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).toContain("wp-var-picker__preview--idle");
    expect(preview.text()).toContain("run workflow to see result");
  });

  it("shows the default in amber after a run whose variable was missing", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "", previewParsed: null, previewDefault: "0", executed: true },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).toContain("wp-var-picker__preview--default");
    expect(preview.text()).toContain("→ default (0)");
    expect(w.find('[data-test="var-picker-unset"]').text()).toBe("$seed was not set");
  });

  it("shows the empty-state message when no upstream vars exist", async () => {
    const w = mount(VarPicker, {
      attachTo: document.body,
      props: { modelValue: "", upstreamVars: [], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await typeIn(w, "");
    expect(document.querySelector(".wp-combo__empty")?.textContent).toContain("No upstream variables");
    w.unmount();
  });
  it("shows what a Var → Choice output feeds and how the run matched", () => {
    const w = mount(VarPicker, {
      props: {
        modelValue: "$checkpoint", upstreamVars: ["$checkpoint"],
        previewSource: "wai nsfw v14", previewParsed: "waiNSFW_v140.safetensors", previewDefault: "waiNSFW_v140.safetensors",
        wiredTo: "Load Checkpoint › ckpt_name · 24 options", choiceNote: "Matched “wai nsfw v14” loosely.",
      },
    });
    expect(w.find('[data-test="var-picker-wired"]').text()).toContain("Load Checkpoint › ckpt_name · 24 options");
    expect(w.find('[data-test="var-picker-choice-note"]').text()).toBe("Matched “wai nsfw v14” loosely.");
    expect(w.find('[data-test="var-picker-source"]').exists()).toBe(false);
    expect(w.find('[data-test="var-picker-preview"]').text()).toContain("waiNSFW_v140.safetensors");
  });

  it("labels a Var → Choice miss as the fallback", () => {
    const w = mount(VarPicker, {
      props: {
        modelValue: "$checkpoint", upstreamVars: [], previewSource: "juggernaut", previewParsed: null,
        previewDefault: "pony.safetensors", choiceNote: "No match for “juggernaut”. Used pony.safetensors.",
      },
    });
    expect(w.find('[data-test="var-picker-preview"]').text()).toContain("fallback (pony.safetensors)");
    expect(w.find('[data-test="var-picker-wired"]').exists()).toBe(false);
  });
});
