import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DragHandle from "../DragHandle.vue";

describe("DragHandle", () => {
  it("draws the six-dot grip, hidden from screen readers, with a tooltip", () => {
    const w = mount(DragHandle);
    expect(w.attributes("aria-hidden")).toBe("true");
    expect(w.attributes("title")).toBe("Drag to reorder");
    expect(w.findAll("circle")).toHaveLength(6);
    expect(w.attributes("data-size")).toBe("sm");
  });

  it("takes a size and its own tooltip", () => {
    const w = mount(DragHandle, { props: { size: "md", title: "Drag to move" } });
    expect(w.attributes("data-size")).toBe("md");
    expect(w.attributes("title")).toBe("Drag to move");
  });
});
