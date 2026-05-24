import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import CellRulePopover from "../../../../../src/components/context/editors/constraint/CellRulePopover.vue";

describe("CellRulePopover", () => {
  it("renders four labeled state buttons", () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "neutral", factor: 1, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const btns = wrap.findAll("button.pop-btn");
    expect(btns).toHaveLength(4);
    expect(btns.map((b) => b.text())).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/neutral/i),
        expect.stringMatching(/exclude/i),
        expect.stringMatching(/boost/i),
        expect.stringMatching(/reduce/i),
      ]),
    );
  });

  it("marks the current state button as active", () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const active = wrap.findAll("button.pop-btn.active");
    expect(active).toHaveLength(1);
    expect(active[0].text()).toMatch(/boost/i);
    expect(active[0].attributes("aria-pressed")).toBe("true");
  });

  it("emits update:state when a state button is clicked", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "neutral", factor: 1, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    await wrap.find("button.pop-btn.b-exclude").trigger("click");
    expect(wrap.emitted("update:state")?.[0]).toEqual(["exclude"]);
  });

  it("does NOT auto-close when a state button is clicked", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "neutral", factor: 1, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    await wrap.find("button.pop-btn.b-boost").trigger("click");
    expect(wrap.emitted("close")).toBeUndefined();
  });

  it("shows factor input only for boost and reduce", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "neutral", factor: 1, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    expect(wrap.find(".pop-factor").exists()).toBe(false);
    await wrap.setProps({ state: "boost", factor: 1.8 });
    expect(wrap.find(".pop-factor").exists()).toBe(true);
    await wrap.setProps({ state: "reduce", factor: 0.5 });
    expect(wrap.find(".pop-factor").exists()).toBe(true);
    await wrap.setProps({ state: "exclude", factor: 1 });
    expect(wrap.find(".pop-factor").exists()).toBe(false);
  });

  it("renders the stepper wrap + up/down buttons next to the factor input", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    expect(wrap.find(".pop-num").exists()).toBe(true);
    expect(wrap.find(".pop-num__field").exists()).toBe(true);
    expect(wrap.findAll(".pop-num__btn")).toHaveLength(2);
  });

  it("up button bumps the factor by +0.1", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const [up] = wrap.findAll(".pop-num__btn");
    await up.trigger("click");
    const events = wrap.emitted("update:factor") ?? [];
    // floating-point safe: rounded to 1 decimal
    expect(events[events.length - 1]).toEqual([1.9]);
  });

  it("down button bumps the factor by -0.1, clamped above 0", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "reduce", factor: 0.2, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const [, down] = wrap.findAll(".pop-num__btn");
    await down.trigger("click");
    let events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([0.1]);
    // Below 0.1 → clamped to 0.1
    await wrap.setProps({ factor: 0.1 });
    await down.trigger("click");
    events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([0.1]);
  });

  it("emits update:factor while typing", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const inp = wrap.find(".pop-num__field");
    await inp.setValue("2.4");
    const events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([2.4]);
  });

  it("ignores negative / NaN factor input (no emit)", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "warm", tgtLabel: "positive_qa" },
    });
    const inp = wrap.find(".pop-num__field");
    await inp.setValue("-1");
    await inp.setValue("abc");
    expect(wrap.emitted("update:factor")).toBeUndefined();
  });

  it("renders Reset button only when canReset is true", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "w", tgtLabel: "p", canReset: false },
    });
    expect(wrap.find(".pop-reset").exists()).toBe(false);
    await wrap.setProps({ canReset: true });
    expect(wrap.find(".pop-reset").exists()).toBe(true);
  });

  it("Reset button emits the reset event", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.8, srcLabel: "w", tgtLabel: "p", canReset: true },
    });
    await wrap.find(".pop-reset").trigger("click");
    expect(wrap.emitted("reset")?.length).toBe(1);
  });

  it("ArrowUp on the factor input bumps via rounded step (no float fuzz)", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.4, srcLabel: "w", tgtLabel: "p" },
    });
    const input = wrap.find(".pop-num__field");
    await input.trigger("keydown", { key: "ArrowUp" });
    const events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([1.5]);
  });

  it("ArrowDown rounds away the classic 1.4-0.1 = 1.2999... fuzz", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.4, srcLabel: "w", tgtLabel: "p" },
    });
    const input = wrap.find(".pop-num__field");
    await input.trigger("keydown", { key: "ArrowDown" });
    const events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([1.3]);
  });

  it("typing a fuzz value gets snapped to 3 decimals on emit", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.4, srcLabel: "w", tgtLabel: "p" },
    });
    const inp = wrap.find(".pop-num__field");
    await inp.setValue("1.2999999999999998");
    const events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([1.3]);
  });

  it("typing a legitimate 2-decimal value (1.25) is preserved on emit", async () => {
    const wrap = mount(CellRulePopover, {
      props: { state: "boost", factor: 1.4, srcLabel: "w", tgtLabel: "p" },
    });
    const inp = wrap.find(".pop-num__field");
    await inp.setValue("1.25");
    const events = wrap.emitted("update:factor") ?? [];
    expect(events[events.length - 1]).toEqual([1.25]);
  });
});
