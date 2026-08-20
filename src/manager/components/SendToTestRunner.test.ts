import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import SendToTestRunner from "./SendToTestRunner.vue";

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/test", name: "test", component: { template: "<div/>" } },
    ],
  });
}

describe("SendToTestRunner", () => {
  it("pushes /test with kind + module query on click", async () => {
    const router = makeRouter();
    const spy = vi.spyOn(router, "push");
    const wrap = mount(SendToTestRunner, {
      props: { kind: "wildcard", id: "abc12345" },
      global: { plugins: [router] },
    });
    await wrap.get("button").trigger("click");
    expect(spy).toHaveBeenCalledWith({
      name: "test",
      query: { kind: "wildcard", module: "abc12345" },
    });
  });

  it("compact renders an icon-only button with a screen-reader label", () => {
    const wrap = mount(SendToTestRunner, {
      props: { kind: "combine", id: "deadbeef", compact: true },
      global: { plugins: [makeRouter()] },
    });
    const btn = wrap.get("button");
    expect(btn.attributes("aria-label")).toBe("Send to Test Runner");
    // icon-only → no visible label text
    expect(btn.text()).toBe("");
  });

  it("non-compact carries a visible label", () => {
    const wrap = mount(SendToTestRunner, {
      props: { kind: "bundle", id: "b0000001" },
      global: { plugins: [makeRouter()] },
    });
    expect(wrap.get("button").text()).toContain("Test Runner");
  });
});
