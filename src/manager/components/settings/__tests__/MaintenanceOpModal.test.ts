import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import MaintenanceOpModal from "../MaintenanceOpModal.vue";

const OP_PROPS = {
  open: true,
  op: "vacuum" as const,
  title: "Run VACUUM?",
  description: "Rebuilds the database file and reclaims unused space.",
  confirmLabel: "Run VACUUM",
};

describe("MaintenanceOpModal", () => {
  afterEach(() => {
    // Modal teleports to <body>; clean stale nodes between tests so
    // document.querySelector doesn't see content from a prior test.
    document.body.replaceChildren();
  });

  it("renders confirm phase initially", () => {
    const wrapper = mount(MaintenanceOpModal, { props: OP_PROPS, attachTo: document.body });
    expect(document.body.textContent).toContain("Run VACUUM?");
    expect(document.querySelector("[data-test='maintop-confirm']")).not.toBeNull();
    expect(document.querySelector("[data-test='maintop-spinner']")).toBeNull();
    wrapper.unmount();
  });

  it("switches to loading when phase prop is 'loading'", () => {
    const wrapper = mount(MaintenanceOpModal, {
      props: { ...OP_PROPS, phase: "loading" },
      attachTo: document.body,
    });
    expect(document.querySelector("[data-test='maintop-spinner']")).not.toBeNull();
    expect(document.querySelector("[data-test='maintop-confirm']")).toBeNull();
    wrapper.unmount();
  });

  it("renders ok result with bytes_reclaimed for vacuum", () => {
    const wrapper = mount(MaintenanceOpModal, {
      props: {
        ...OP_PROPS,
        phase: "result-ok",
        result: { ok: true, op: "vacuum", duration_ms: 2100, bytes_reclaimed: 3325952 },
      },
      attachTo: document.body,
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Reclaimed");
    expect(text).toContain("2.1");
    wrapper.unmount();
  });

  it("renders error in result-error phase", () => {
    const wrapper = mount(MaintenanceOpModal, {
      props: {
        ...OP_PROPS,
        phase: "result-error",
        result: { ok: false, op: "vacuum", duration_ms: 5, error: "database is locked" },
      },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain("database is locked");
    wrapper.unmount();
  });

  it("emits confirm when the confirm button is clicked", async () => {
    const wrapper = mount(MaintenanceOpModal, { props: OP_PROPS, attachTo: document.body });
    const btn = document.querySelector("[data-test='maintop-confirm']") as HTMLButtonElement;
    btn.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("confirm")).toBeTruthy();
    wrapper.unmount();
  });

  it("emits close when the close button is clicked in result-ok phase", async () => {
    const wrapper = mount(MaintenanceOpModal, {
      props: {
        ...OP_PROPS,
        phase: "result-ok",
        result: { ok: true, op: "analyze", duration_ms: 50 },
      },
      attachTo: document.body,
    });
    const btn = document.querySelector("[data-test='maintop-close']") as HTMLButtonElement;
    btn.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });
});
