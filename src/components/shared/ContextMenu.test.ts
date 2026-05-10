import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextMenu from "./ContextMenu.vue";

describe("ContextMenu — backward compat", () => {
  it("renders flat items unchanged", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [
          { label: "Edit",   icon: "pi-pencil", onSelect: () => undefined },
          { label: "Remove", icon: "pi-trash",  danger: true, onSelect: () => undefined },
        ],
      },
      attachTo: document.body,
    });
    const titles = document.body.querySelectorAll(".wp-ctxmenu__title");
    expect(titles).toHaveLength(2);
    expect(titles[0].textContent).toBe("Edit");
    expect(titles[1].textContent).toBe("Remove");
    expect(document.body.querySelector(".wp-ctxmenu__item--danger")).not.toBeNull();
    wrapper.unmount();
  });

  it("renders divider items", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [
          { label: "A", onSelect: () => undefined },
          { label: "B", divider: true, onSelect: () => undefined },
        ],
      },
      attachTo: document.body,
    });
    expect(document.body.querySelector(".wp-ctxmenu__sep")).not.toBeNull();
    wrapper.unmount();
  });

  it("dispatches onSelect on click + closes menu", async () => {
    let clicked = false;
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [{ label: "Edit", onSelect: () => { clicked = true; } }],
      },
      attachTo: document.body,
    });
    const item = document.body.querySelector(".wp-ctxmenu__item") as HTMLElement;
    item.click();
    expect(clicked).toBe(true);
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });
});

describe("ContextMenu — new affordances", () => {
  it("renders header when prop provided", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        header: { icon: "pi-box", label: "Bundle · foo", iconColor: "#FB7185" },
        items: [{ label: "Edit", onSelect: () => undefined }],
      },
      attachTo: document.body,
    });
    const header = document.body.querySelector(".wp-ctxmenu__header");
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("Bundle · foo");
    expect(header!.querySelector(".pi-box")).not.toBeNull();
    wrapper.unmount();
  });

  it("omits header when prop missing", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [{ label: "Edit", onSelect: () => undefined }],
      },
      attachTo: document.body,
    });
    expect(document.body.querySelector(".wp-ctxmenu__header")).toBeNull();
    wrapper.unmount();
  });

  it("applies header iconColor as inline style", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        header: { icon: "pi-box", label: "Bundle · foo", iconColor: "rgb(251, 113, 133)" },
        items: [{ label: "Edit", onSelect: () => undefined }],
      },
      attachTo: document.body,
    });
    const icon = document.body.querySelector(".wp-ctxmenu__header .pi-box") as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.style.color).toBe("rgb(251, 113, 133)");
    wrapper.unmount();
  });

  it("renders section label as separator with uppercase title", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [
          { label: "Edit", onSelect: () => undefined },
          { section: "Drift · library has newer version" },
          { label: "Refresh", onSelect: () => undefined },
        ],
      },
      attachTo: document.body,
    });
    const section = document.body.querySelector(".wp-ctxmenu__section");
    expect(section).not.toBeNull();
    expect(section!.textContent!.trim()).toBe("Drift · library has newer version");
    wrapper.unmount();
  });

  it("section entries are not clickable + do not advance keyboard nav", async () => {
    let clicks = 0;
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [
          { label: "A", onSelect: () => { clicks++; } },
          { section: "Group" },
          { label: "B", onSelect: () => { clicks++; } },
        ],
      },
      attachTo: document.body,
    });
    const section = document.body.querySelector(".wp-ctxmenu__section") as HTMLElement;
    // Section has no @click handler so clicking it does nothing.
    section.click();
    expect(clicks).toBe(0);
    wrapper.unmount();
  });

  it("renders subtitle under label when provided", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [
          { label: "Refresh from library", subtitle: "Pull current library version", onSelect: () => undefined },
        ],
      },
      attachTo: document.body,
    });
    expect(document.body.querySelector(".wp-ctxmenu__title")!.textContent).toBe("Refresh from library");
    expect(document.body.querySelector(".wp-ctxmenu__sub")!.textContent).toBe("Pull current library version");
    wrapper.unmount();
  });

  it("renders without subtitle when not provided (single-line)", () => {
    const wrapper = mount(ContextMenu, {
      props: {
        visible: true, x: 0, y: 0,
        items: [{ label: "Edit", onSelect: () => undefined }],
      },
      attachTo: document.body,
    });
    expect(document.body.querySelector(".wp-ctxmenu__title")!.textContent).toBe("Edit");
    expect(document.body.querySelector(".wp-ctxmenu__sub")).toBeNull();
    wrapper.unmount();
  });
});
