import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SelectionToolbar from "../../components/SelectionToolbar.vue";

function mountBar() {
  return mount(SelectionToolbar, {
    props: { count: 3, tags: ["warm", "cool"] },
  });
}

/** Click a top-level toolbar Button by its label text. */
async function clickBar(wrap: VueWrapper, label: string) {
  const btn = wrap.findAll("button.wp-btn").find((b) => b.text().includes(label));
  if (!btn) throw new Error(`toolbar button "${label}" not found`);
  await btn.trigger("click");
}

describe("SelectionToolbar.vue", () => {
  it("shows the selected count", () => {
    expect(mountBar().text()).toContain("3 selected");
  });

  it("apply-tag fires with an existing tag picked from the menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Apply sub-category");
    const item = wrap.findAll(".wpc-seltoolbar__menuitem").find((b) => b.text() === "cool");
    await item!.trigger("click");
    expect(wrap.emitted("apply-tag")![0]).toEqual(["cool"]);
  });

  it("apply-tag fires with a brand-new tag typed into the menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Apply sub-category");
    await wrap.get(".wpc-seltoolbar__menu input.wp-input").setValue("fresh");
    await wrap.get(".wpc-seltoolbar__menuitem--new").trigger("click");
    expect(wrap.emitted("apply-tag")![0]).toEqual(["fresh"]);
  });

  it("remove-tag fires from the remove menu", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Remove sub-category");
    const item = wrap.findAll(".wpc-seltoolbar__menuitem").find((b) => b.text() === "warm");
    await item!.trigger("click");
    expect(wrap.emitted("remove-tag")![0]).toEqual(["warm"]);
  });

  it("set-weight fires with the entered weight", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Set weight");
    await wrap.get(".wpc-seltoolbar__menu--weight input").setValue("2.5");
    await wrap.get(".wpc-seltoolbar__menu--weight button.wp-btn--primary").trigger("click");
    expect(wrap.emitted("set-weight")![0]).toEqual([2.5]);
  });

  it("delete + clear fire their intents", async () => {
    const wrap = mountBar();
    await clickBar(wrap, "Delete");
    await clickBar(wrap, "Clear");
    expect(wrap.emitted("delete-selected")).toBeTruthy();
    expect(wrap.emitted("clear")).toBeTruthy();
  });

  it("Apply menu hides tags already on every selected row (commonTags)", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 2, tags: ["warm", "cool"], commonTags: ["warm"] },
    });
    await clickBar(wrap, "Apply sub-category");
    const labels = wrap.findAll(".wpc-seltoolbar__menuitem").map((b) => b.text());
    expect(labels).toContain("cool");
    expect(labels).not.toContain("warm");
  });

  it("Remove menu lists only tags present on the selection", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 2, tags: ["warm", "cool", "neon"], presentTags: ["neon"] },
    });
    await clickBar(wrap, "Remove sub-category");
    const labels = wrap.findAll(".wpc-seltoolbar__menuitem").map((b) => b.text());
    expect(labels).toEqual(["neon"]);
  });

  it("Remove menu is empty when the selection carries no tags", async () => {
    const wrap = mount(SelectionToolbar, {
      props: { count: 1, tags: ["warm", "cool"], presentTags: [] },
    });
    await clickBar(wrap, "Remove sub-category");
    expect(wrap.findAll(".wpc-seltoolbar__menuitem")).toHaveLength(0);
    expect(wrap.find(".wpc-seltoolbar__menuempty").exists()).toBe(true);
  });

  it("menu chips carry their tag's axis hue as --chip-hue", async () => {
    const wrap = mount(SelectionToolbar, {
      props: {
        count: 1,
        tags: ["warm"],
        tagHues: { warm: "hsl(1 2% 3%)" },
      },
    });
    await clickBar(wrap, "Apply sub-category");
    const item = wrap
      .findAll(".wpc-seltoolbar__menuitem")
      .find((b) => b.text() === "warm");
    expect(item!.attributes("style")).toContain("--chip-hue: hsl(1 2% 3%)");
  });
});
