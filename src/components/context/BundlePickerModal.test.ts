import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BundlePickerModal from "./BundlePickerModal.vue";

vi.mock("../../manager/api/client", () => ({
  api: {
    bundles: {
      list: vi.fn(),
    },
  },
}));

import { api } from "../../manager/api/client";

const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;

function sampleBundle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "abcd1234",
    name: "subject_phrase",
    description: "",
    color: "#FB7185",
    category_id: null,
    tags: [],
    is_favorite: false,
    children: [
      { id: "aabbcc11", type: "wildcard" },
      { id: "ddeeff22", type: "wildcard" },
      { id: "11223344", type: "combine" },
    ],
    payload_hash: "h",
    version: 1,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function cleanBody() {
  // Wipe any DOM teleported by ModalShell from previous mounts so each
  // test sees a fresh stage. innerHTML clear flagged by the project's
  // security hook; iterating + removing children is the safe form.
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

beforeEach(() => {
  apiBundles.list.mockReset();
  cleanBody();
});

afterEach(() => {
  vi.clearAllMocks();
  cleanBody();
});

describe("BundlePickerModal", () => {
  it("fetches bundles on open", async () => {
    apiBundles.list.mockResolvedValue({ items: [sampleBundle()], total: 1 });
    mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    expect(apiBundles.list).toHaveBeenCalled();
  });

  it("renders one row per bundle", async () => {
    apiBundles.list.mockResolvedValue({
      items: [sampleBundle({ id: "a", name: "alpha" }), sampleBundle({ id: "b", name: "beta" })],
      total: 2,
    });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const rows = document.body.querySelectorAll(".wp-bp__row");
    expect(rows).toHaveLength(2);
    w.unmount();
  });

  it("filters by search term", async () => {
    apiBundles.list.mockResolvedValue({
      items: [
        sampleBundle({ id: "a", name: "alpha" }),
        sampleBundle({ id: "b", name: "beta" }),
      ],
      total: 2,
    });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const input = document.body.querySelector('[data-testid="bundle-picker-search"]') as HTMLInputElement;
    input.value = "alph";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    const rows = document.body.querySelectorAll(".wp-bp__row");
    expect(rows).toHaveLength(1);
    w.unmount();
  });

  it("emits pick + close when row clicked", async () => {
    apiBundles.list.mockResolvedValue({ items: [sampleBundle()], total: 1 });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const row = document.body.querySelector(".wp-bp__row") as HTMLElement;
    row.click();
    expect(w.emitted("pick")).toBeTruthy();
    expect(w.emitted("pick")?.[0]).toEqual(["abcd1234"]);
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("emits create when Create Bundle clicked", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const btn = document.body.querySelector('[data-testid="bundle-picker-create"]') as HTMLElement;
    btn.click();
    expect(w.emitted("create")).toBeTruthy();
    w.unmount();
  });

  it("shows empty state when library has no bundles", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const state = document.body.querySelector(".wp-bp__state");
    expect(state).not.toBeNull();
    expect(state!.textContent).toContain("Create Bundle");
    w.unmount();
  });

  it("renders kind composition pills per bundle", async () => {
    apiBundles.list.mockResolvedValue({
      items: [sampleBundle()],   // 2 wildcards + 1 combine
      total: 1,
    });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const pills = document.body.querySelectorAll(".wp-bp__row-comp .comp-pill");
    const labels = Array.from(pills).map((el) => el.textContent);
    expect(labels).toContain("2W");
    expect(labels).toContain("1Cb");
    w.unmount();
  });

  it("renders keyboard hint strip in footer", async () => {
    apiBundles.list.mockResolvedValue({ items: [], total: 0 });
    const w = mount(BundlePickerModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    await flushPromises();
    const hints = document.body.querySelector(".wp-bp__hints");
    expect(hints).not.toBeNull();
    expect(hints!.textContent).toContain("nav");
    expect(hints!.textContent).toContain("insert");
    expect(hints!.textContent).toContain("cancel");
    w.unmount();
  });
});
