import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import Banner from "./Banner.vue";
import CloseButton from "./CloseButton.vue";
import CopyButton from "./CopyButton.vue";
import Disclosure from "./Disclosure.vue";
import WpSegmented from "./WpSegmented.vue";
import WpTabs from "./WpTabs.vue";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TABS = [
  { id: "a", label: "Options", count: 3 },
  { id: "b", label: "Rules", disabled: true },
  { id: "c", label: "Preview" },
];

const CURRENT = "[role=tab][tabindex=\"0\"]";

describe("WpTabs", () => {
  it("marks the current tab and keeps only it in the Tab order", () => {
    const w = mount(WpTabs, { props: { modelValue: "a", tabs: TABS, ariaLabel: "Sections", testPrefix: "t" } });
    const tabs = w.findAll("[role=tab]");
    expect(w.find("[role=tablist]").attributes("aria-label")).toBe("Sections");
    expect(tabs.map((t) => t.attributes("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs[0].attributes("data-test")).toBe("t-a");
    expect(tabs[0].text()).toContain("3");
  });

  it("moves with the arrow keys past disabled tabs, wraps, and jumps with Home/End", async () => {
    const w = mount(WpTabs, { props: { modelValue: "a", tabs: TABS, "onUpdate:modelValue": (v: string) => w.setProps({ modelValue: v }) }, attachTo: document.body });
    await w.find(CURRENT).trigger("keydown", { key: "ArrowRight" });
    expect(w.props("modelValue")).toBe("c");
    await nextTick();
    expect(document.activeElement?.textContent).toContain("Preview");
    await w.find(CURRENT).trigger("keydown", { key: "ArrowRight" });
    expect(w.props("modelValue")).toBe("a");
    await w.find(CURRENT).trigger("keydown", { key: "End" });
    expect(w.props("modelValue")).toBe("c");
    await w.find(CURRENT).trigger("keydown", { key: "Home" });
    expect(w.props("modelValue")).toBe("a");
  });

  it("keeps the first enabled tab reachable when the value matches none", async () => {
    const w = mount(WpTabs, { props: { modelValue: "b", tabs: TABS } });
    expect(w.findAll("[role=tab]").map((t) => t.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
    await w.find(CURRENT).trigger("keydown", { key: "ArrowLeft" });
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["c"]);
  });

  it("wires the panel to its tab when a #panel slot is given", () => {
    const w = mount(WpTabs, { props: { modelValue: "c", tabs: TABS }, slots: { panel: "<p>body</p>" } });
    const panel = w.find("[role=tabpanel]");
    const tab = w.findAll("[role=tab]")[2];
    expect(panel.attributes("aria-labelledby")).toBe(tab.attributes("id"));
    expect(tab.attributes("aria-controls")).toBe(panel.attributes("id"));
  });
});

describe("WpSegmented", () => {
  const OPTS = [
    { value: "x", label: "X" },
    { value: "y", label: "Y", disabled: true },
    { value: "z", label: "Z", icon: "pi-sun" },
  ];

  it("is a radio group that picks on click", async () => {
    const w = mount(WpSegmented, { props: { modelValue: "x", options: OPTS, ariaLabel: "Mode" } });
    expect(w.find("[role=radiogroup]").attributes("aria-label")).toBe("Mode");
    await w.findAll("[role=radio]")[2].trigger("click");
    expect(w.emitted("update:modelValue")).toEqual([["z"]]);
  });

  it("moves with the arrows past disabled options", async () => {
    const w = mount(WpSegmented, { props: { modelValue: "x", options: OPTS } });
    await w.findAll("[role=radio]")[0].trigger("keydown", { key: "ArrowRight" });
    expect(w.emitted("update:modelValue")).toEqual([["z"]]);
  });

  it("fills its row with block", () => {
    const w = mount(WpSegmented, { props: { modelValue: "x", options: OPTS, block: true } });
    expect(w.attributes("data-block")).toBe("true");
  });

  it("names icon-only options by their label and ignores clicks when disabled", async () => {
    const w = mount(WpSegmented, { props: { modelValue: "x", options: OPTS, iconOnly: true, disabled: true } });
    const radios = w.findAll("[role=radio]");
    expect(radios[2].attributes("aria-label")).toBe("Z");
    expect(radios[2].text()).toBe("");
    await radios[2].trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });
});

describe("Disclosure", () => {
  it("folds on its own and wires aria-expanded to the body", async () => {
    const w = mount(Disclosure, { props: { label: "Advanced" }, slots: { default: "<p>inside</p>" } });
    const btn = w.find("button");
    const body = w.find(`#${btn.attributes("aria-controls")}`);
    expect(btn.attributes("aria-expanded")).toBe("false");
    expect(body.attributes("inert")).toBeDefined();
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
    expect(w.emitted("update:open")).toEqual([[true]]);
  });

  it("builds a lazy body only while open, and passes attributes to the heading", async () => {
    const w = mount(Disclosure, { props: { label: "A", lazy: true, triggerAttrs: { "data-test": "t" } }, slots: { default: "<p class='x'>in</p>" } });
    expect(w.find(".x").exists()).toBe(false);
    await w.find("[data-test=t]").trigger("click");
    expect(w.find(".x").exists()).toBe(true);
  });

  it("follows v-model:open", async () => {
    const w = mount(Disclosure, { props: { label: "A", open: true } });
    expect(w.find("button").attributes("aria-expanded")).toBe("true");
    await w.setProps({ open: false });
    expect(w.find("button").attributes("aria-expanded")).toBe("false");
  });
});

describe("Banner", () => {
  it("uses role=alert only for danger and dismisses from its close button", async () => {
    const w = mount(Banner, { props: { tone: "warn", title: "Out of date", dismissible: true }, slots: { default: "Update them." } });
    expect(w.attributes("role")).toBe("status");
    expect(w.find(".pi-exclamation-triangle").exists()).toBe(true);
    await w.find("button[aria-label=Dismiss]").trigger("click");
    expect(w.emitted("dismiss")).toHaveLength(1);
    await w.setProps({ tone: "danger" });
    expect(w.attributes("role")).toBe("alert");
  });
});

describe("CloseButton", () => {
  it("is named Close by default and emits click", async () => {
    const w = mount(CloseButton);
    expect(w.attributes("aria-label")).toBe("Close");
    await w.trigger("click");
    expect(w.emitted("click")).toHaveLength(1);
  });
});

describe("CopyButton", () => {
  it("copies, shows Copied, then goes back", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const w = mount(CopyButton, { props: { text: () => "hello", label: "Copy prompt" } });
    await w.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(w.emitted("copied")).toEqual([["hello"]]);
    expect(w.attributes("data-state")).toBe("copied");
    expect(w.find("[aria-live]").text()).toBe("Copied");
    vi.advanceTimersByTime(2000);
    await nextTick();
    expect(w.attributes("data-state")).toBe("idle");
  });

  it("says it failed when there is nothing to copy", async () => {
    const w = mount(CopyButton, { props: { text: "", showLabel: true } });
    await w.trigger("click");
    await flushPromises();
    expect(w.emitted("failed")).toHaveLength(1);
    expect(w.text()).toContain("Couldn't copy");
  });
});
