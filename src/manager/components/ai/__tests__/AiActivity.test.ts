import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import AiActivity from "../AiActivity.vue";
import type { AiChatStep } from "../../../api/types";
import { useUiStore } from "../../../stores/uiStore";

const Blank = defineComponent({ template: "<div />" });

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: Blank },
      { path: "/wildcards/:id", name: "wildcards-edit", component: Blank },
    ],
  });
}

const STEPS: AiChatStep[] = [
  { tool: "think", note: "Check the hair first.\nThen answer.", ok: true, think: true, at: 800 },
  { tool: "read", note: "Read Hair Color", ok: true, at: 1500,
    item: { id: "aaaa0001", type: "wildcard", name: "Hair Color" } },
  { tool: "search", note: "Searched \"red\"", ok: false, at: 2100 },
  { tool: "say", note: "Found it, now a test.", ok: true, say: true, at: 2200 },
  { tool: "retry", note: "The reply was cut off: asked for the rest", ok: true, notice: true, at: 2300 },
  { tool: "run_test", note: "Ran Hair Color on 100 seeds", ok: true, at: 6300 },
];

async function mountIt(props: Record<string, unknown> = {}) {
  const r = router();
  await r.push("/");
  const w = mount(AiActivity, { props: { steps: STEPS, elapsedMs: 7000, ...props }, global: { plugins: [r] } });
  return { w, r };
}

describe("AiActivity", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("folds a finished answer under one line, keeping what it said in view", async () => {
    const { w } = await mountIt();
    const turn = w.get('[data-test="ai-activity-turn"]');
    expect(turn.text()).toBe("Worked for 7 s · read 1 item, searched once and ran 1 test");
    expect(w.findAll('[data-test="ai-activity-group"]')).toHaveLength(0);
    expect(w.get('[data-test="ai-chat-said"]').text()).toBe("Found it, now a test.");
    await turn.trigger("click");
    const groups = w.findAll('[data-test="ai-activity-group"]');
    expect(groups.map((g) => g.text())).toEqual([
      "Read 1 item and searched once2.1 s1 failed", "Ran 1 test4 s",
    ]);
    expect(w.get('[data-test="ai-activity-notice"]').text()).toContain("cut off");
  });

  it("links the item a read read", async () => {
    const { w, r } = await mountIt({ elapsedMs: undefined });
    await w.get('[data-test="ai-activity-turn"]').trigger("click");
    await w.findAll('[data-test="ai-activity-group"]')[0].trigger("click");
    const chip = w.get('[data-test="ai-activity-item"]');
    expect(chip.text()).toBe("Hair Color");
    await chip.trigger("click");
    await flushPromises();
    expect(r.currentRoute.value.fullPath).toBe("/wildcards/aaaa0001");
  });

  it("keeps everything open in Verbose and never folds the answer", async () => {
    useUiStore().setChatDetail("verbose");
    const { w } = await mountIt();
    expect(w.find('[data-test="ai-activity-turn"]').exists()).toBe(false);
    expect(w.findAll('[data-test="ai-activity-group"]').every((g) => g.attributes("aria-expanded") === "true")).toBe(true);
    expect(w.text()).toContain("Ran Hair Color on 100 seeds");
  });

  it("shows the group being worked on, open in Detailed, hidden in Compact", async () => {
    const ui = useUiStore();
    ui.setChatDetail("detailed");
    const { w } = await mountIt({ steps: STEPS.slice(0, 3), running: true });
    expect(w.find('[data-test="ai-activity-turn"]').exists()).toBe(false);
    const live = w.get('[data-test="ai-activity-group"]');
    expect(live.text()).toContain("Searched \"red\"");
    expect(live.attributes("aria-expanded")).toBe("true");
    ui.setChatDetail("compact");
    await flushPromises();
    expect(w.find('[data-test="ai-activity-group"]').exists()).toBe(false);
  });

  it("starts the next group before its first step, titled by the thinking", async () => {
    const { w } = await mountIt({ steps: STEPS.slice(0, 4), running: true, thinking: true, thought: "Now the test\nwith" });
    const groups = w.findAll('[data-test="ai-activity-group"]');
    expect(groups.at(-1)?.text()).toBe("Thinking · Now the test");
  });

  it("keeps the reasoning to its title line unless replies are typed out", async () => {
    useUiStore().setChatDetail("detailed");
    const live = { steps: STEPS.slice(0, 4), running: true, thinking: true, thought: "Now the test\nwith" };
    const { w } = await mountIt({ ...live, typing: false });
    expect(w.findAll('[data-test="ai-activity-group"]').at(-1)?.text()).toBe("Thinking · Now the test");
    expect(w.find('[data-test="ai-chat-live-thought"]').exists()).toBe(false);
    const typed = (await mountIt(live)).w;
    expect(typed.get('[data-test="ai-chat-live-thought"]').text()).toContain("with");
  });
});
