import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PrimeVue from "primevue/config";
import ConstraintMatrix from "../components/ConstraintMatrix.vue";
import type { ConstraintMatrix as Matrix } from "../api/types";

function lastEmitted(
  wrap: ReturnType<typeof mount>,
  event = "update:modelValue",
): Matrix | undefined {
  const evs = wrap.emitted(event) ?? [];
  return evs[evs.length - 1]?.[0] as Matrix | undefined;
}

function mountGrid(modelValue: Matrix = {}, rows = ["red", "blue"], cols = ["warm", "cool"]) {
  return mount(ConstraintMatrix, {
    props: { rows, cols, modelValue },
    global: { plugins: [PrimeVue] },
  });
}

describe("ConstraintMatrix.vue", () => {
  it("renders rows × cols cells", () => {
    const wrap = mountGrid({}, ["red", "blue", "green"], ["warm", "cool"]);
    const cells = wrap.findAll('button[data-test^="cell-"]');
    expect(cells).toHaveLength(3 * 2);
    // Sanity: aria-labels mention row × col
    expect(cells[0].attributes("aria-label")).toContain("red");
    expect(cells[0].attributes("aria-label")).toContain("warm");
  });

  it("cycles cell mode allow → exclude → boost → reduce → allow", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    const cell = wrap.find('button[data-test="cell-red-warm"]');
    expect(cell.attributes("data-mode")).toBe("allow");

    // allow → exclude
    await cell.trigger("click");
    let last = lastEmitted(wrap);
    expect(last?.red.warm).toEqual({ mode: "exclude", factor: 0 });
    await wrap.setProps({ modelValue: last });
    expect(wrap.find('button[data-test="cell-red-warm"]').attributes("data-mode"))
      .toBe("exclude");

    // exclude → boost
    await wrap.find('button[data-test="cell-red-warm"]').trigger("click");
    last = lastEmitted(wrap);
    expect(last?.red.warm).toEqual({ mode: "boost", factor: 2 });
    await wrap.setProps({ modelValue: last });

    // boost → reduce
    await wrap.find('button[data-test="cell-red-warm"]').trigger("click");
    last = lastEmitted(wrap);
    expect(last?.red.warm).toEqual({ mode: "reduce", factor: 0.5 });
    await wrap.setProps({ modelValue: last });

    // reduce → allow (sparse: row entry should be absent)
    await wrap.find('button[data-test="cell-red-warm"]').trigger("click");
    last = lastEmitted(wrap);
    expect(last?.red).toBeUndefined();
  });

  it("renders empty notice when no rows", () => {
    const wrap = mountGrid({}, [], ["warm"]);
    expect(wrap.text()).toContain("No source values yet");
  });
});
