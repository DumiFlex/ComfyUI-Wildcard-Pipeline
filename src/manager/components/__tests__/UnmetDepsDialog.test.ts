import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { ModuleRow } from "../../api/types";
import UnmetDepsDialog from "../UnmetDepsDialog.vue";

/**
 * B3 — the guided-publish gating dialog. Lists each unmet dependency (a
 * referenced wildcard in the library but not yet on the community) with a
 * per-dep Publish button, plus "Publish <module> anyway" and Cancel. Soft
 * nudge: anyway is always available. The dialog is presentational — it emits
 * intent (`publish-dep` / `publish-anyway` / `cancel`); the guided-publish
 * store does the actual publishing.
 */

/** Catalog row carrying the fields the dialog renders (name) + id (key). */
function depRow(parts: { id: string; name: string }): ModuleRow {
  return { type: "wildcard", ...parts } as unknown as ModuleRow;
}

function mountDialog(unmetRows: ModuleRow[], moduleName = "My Constraint") {
  return mount(UnmetDepsDialog, {
    props: { open: true, moduleName, unmetRows },
    attachTo: document.body,
  });
}

describe("UnmetDepsDialog", () => {
  it("renders one row per unmet dependency (by name)", async () => {
    const wrap = mountDialog([
      depRow({ id: "aaaa1111", name: "Hair Styles" }),
      depRow({ id: "bbbb2222", name: "Eye Colors" }),
    ]);
    await flushPromises();
    expect(document.body.textContent).toContain("Hair Styles");
    expect(document.body.textContent).toContain("Eye Colors");
    const rows = document.body.querySelectorAll("[data-test='unmet-dep-row']");
    expect(rows).toHaveLength(2);
    wrap.unmount();
  });

  it("shows the gating copy + the module name", async () => {
    const wrap = mountDialog([depRow({ id: "aaaa1111", name: "Hair Styles" })], "My Constraint");
    await flushPromises();
    // The lede warns that downloaders can't reattach the missing wildcards.
    expect(document.body.textContent).toMatch(/aren't on the community yet/i);
    expect(document.body.textContent).toMatch(/reattach/i);
    // The "publish anyway" affordance names the module.
    expect(document.body.textContent).toContain("My Constraint");
    wrap.unmount();
  });

  it("emits publish-dep with THAT dep's row when its Publish button is clicked", async () => {
    const hair = depRow({ id: "aaaa1111", name: "Hair Styles" });
    const eyes = depRow({ id: "bbbb2222", name: "Eye Colors" });
    const wrap = mountDialog([hair, eyes]);
    await flushPromises();

    const btn = document.body.querySelector(
      "[data-test='unmet-dep-publish'][data-test-id='bbbb2222']",
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await flushPromises();

    expect(wrap.emitted("publish-dep")).toBeTruthy();
    const ev = wrap.emitted("publish-dep")![0] as ModuleRow[];
    expect(ev[0].id).toBe("bbbb2222"); // the clicked dep, not the other
    wrap.unmount();
  });

  it("emits publish-anyway when the anyway button is clicked", async () => {
    const wrap = mountDialog([depRow({ id: "aaaa1111", name: "Hair Styles" })]);
    await flushPromises();
    const btn = document.body.querySelector(
      "[data-test='unmet-deps-publish-anyway']",
    ) as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(wrap.emitted("publish-anyway")).toBeTruthy();
    wrap.unmount();
  });

  it("emits cancel when the Cancel button is clicked", async () => {
    const wrap = mountDialog([depRow({ id: "aaaa1111", name: "Hair Styles" })]);
    await flushPromises();
    const btn = document.body.querySelector(
      "[data-test='unmet-deps-cancel']",
    ) as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(wrap.emitted("cancel")).toBeTruthy();
    wrap.unmount();
  });

  it("renders inside the shared Modal wrapper", async () => {
    const wrap = mountDialog([depRow({ id: "aaaa1111", name: "Hair Styles" })]);
    await flushPromises();
    expect(document.body.querySelector(".wp-modal")).toBeTruthy();
    expect(document.body.querySelector(".wp-modal__foot")).toBeTruthy();
    wrap.unmount();
  });
});
