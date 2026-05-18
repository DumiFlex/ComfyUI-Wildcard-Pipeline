import { describe, expect, it, beforeEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import ModuleListView from "../../components/ModuleListView.vue";

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Row ${i}`,
    is_favorite: false,
    tags: [],
    updated_at: "2026-01-01T00:00:00Z",
    category_id: null,
  }));
}

async function mountList(items: ReturnType<typeof rows>): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/:p+", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  return mount(ModuleListView, {
    global: { plugins: [router] },
    props: {
      title: "T",
      subtitle: "",
      newLabel: "+",
      newRoute: "/n",
      items,
      filter: {},
      emptyMessage: "Empty",
    },
    attachTo: document.body,
  }) as unknown as VueWrapper;
}

function focusedRowId(wrapper: VueWrapper): string | null {
  return (wrapper.vm as unknown as { focusedRowId: string | null }).focusedRowId;
}

beforeEach(() => setActivePinia(createPinia()));

describe("ModuleListView keyboard nav", () => {
  it("ArrowDown advances focus to next row", async () => {
    const wrapper = await mountList(rows(3));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    expect(focusedRowId(wrapper)).toBe("r0");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    expect(focusedRowId(wrapper)).toBe("r1");
  });

  it("ArrowUp at first row clamps", async () => {
    const wrapper = await mountList(rows(3));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    await tbody.trigger("keydown", { key: "ArrowUp" });
    await tbody.trigger("keydown", { key: "ArrowUp" });
    expect(focusedRowId(wrapper)).toBe("r0");
  });

  it("End jumps to last row on page", async () => {
    const wrapper = await mountList(rows(3));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "End" });
    expect(focusedRowId(wrapper)).toBe("r2");
  });

  it("Space toggles selection on focused row", async () => {
    const wrapper = await mountList(rows(2));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    await tbody.trigger("keydown", { key: " " });
    expect(wrapper.find('[data-test="bulk-bar"]').exists()).toBe(true);
  });

  it("Enter emits row-open with focused row", async () => {
    const wrapper = await mountList(rows(2));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    await tbody.trigger("keydown", { key: "Enter" });
    const ev = wrapper.emitted("row-open");
    expect(ev).toBeTruthy();
    expect((ev![0][0] as { id: string }).id).toBe("r0");
  });

  it("f emits row-favorite-toggle with focused row", async () => {
    const wrapper = await mountList(rows(2));
    const tbody = wrapper.find("tbody");
    await tbody.trigger("keydown", { key: "ArrowDown" });
    await tbody.trigger("keydown", { key: "f" });
    expect(wrapper.emitted("row-favorite-toggle")).toBeTruthy();
  });
});
