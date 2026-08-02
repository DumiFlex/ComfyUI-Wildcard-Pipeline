import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import BulkAddPanel from "../components/BulkAddPanel.vue";

describe("BulkAddPanel — pending work", () => {
  it("reports pending as soon as the box has text", async () => {
    // The host greys its own Save and warns before navigation on the strength
    // of this: users reach for the PAGE's Save and Cancel instead of the
    // panel's, and the typed batch was thrown away silently.
    const w = mount(BulkAddPanel, { props: { mode: "options", existingValues: [] } });
    expect(w.emitted("update:pending")?.[0]).toEqual([false]);
    await w.get("textarea").setValue("alpha\nbeta");
    const ev = w.emitted("update:pending") ?? [];
    expect(ev[ev.length - 1]).toEqual([true]);
    w.unmount();
  });

  it("clears pending when the box is emptied again", async () => {
    const w = mount(BulkAddPanel, { props: { mode: "options", existingValues: [] } });
    const ta = w.get("textarea");
    await ta.setValue("alpha");
    await ta.setValue("   ");
    const ev = w.emitted("update:pending") ?? [];
    expect(ev[ev.length - 1]).toEqual([false]);
    w.unmount();
  });

  it("clears pending on unmount, so a closed panel never blocks the page", async () => {
    const w = mount(BulkAddPanel, { props: { mode: "options", existingValues: [] } });
    await w.get("textarea").setValue("alpha");
    w.unmount();
    const ev = w.emitted("update:pending") ?? [];
    expect(ev[ev.length - 1]).toEqual([false]);
  });
});
