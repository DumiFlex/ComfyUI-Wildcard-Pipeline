import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import DebugViewer from "./DebugViewer.vue";

describe("DebugViewer.vue", () => {
  it("renders a placeholder when no snapshot has been received", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: "" } });
    expect(wrapper.text()).toContain("Run the graph");
  });

  it("renders the snapshot JSON pretty-printed", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: '{"context":{"a":1},"debug":{}}' } });
    expect(wrapper.text()).toContain('"a": 1');
  });
});
