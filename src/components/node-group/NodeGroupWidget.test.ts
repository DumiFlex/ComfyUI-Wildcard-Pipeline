import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NodeGroupWidget from "./NodeGroupWidget.vue";

const members = [{ id: 2, title: "Upscale", mode: "on" as const }];

describe("NodeGroupWidget", () => {
  it("names the canvas group it stands for", () => {
    const w = mount(NodeGroupWidget, { props: { members, groupMode: "on", wholeGroup: "Hires fix" } });
    expect(w.find('[data-test="ng-whole-group"]').text()).toBe("Hires fix");
    expect(w.text()).toContain("1 node");
  });

  it("shows no group name while nodes are wired in", () => {
    const w = mount(NodeGroupWidget, { props: { members, groupMode: "on", wholeGroup: null } });
    expect(w.find('[data-test="ng-whole-group"]').exists()).toBe(false);
  });

  it("explains both ways to gather nodes when empty", () => {
    const w = mount(NodeGroupWidget, { props: { members: [], groupMode: "on" } });
    expect(w.text()).toContain("inside a canvas group");
  });
});
