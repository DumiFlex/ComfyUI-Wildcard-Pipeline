/**
 * PushBundleToLibraryModal — bundle re-link (D3a bundle side).
 *
 * A workflow BundleInstance is "detached" when its `library_id` is no longer
 * in the polled `bundleHashes` map (a re-import minted a fresh uuid). Its
 * `inserted_at_hash` IS the library bundle's payload_hash at insert time, so
 * a content-identical library bundle under a DIFFERENT uuid matches on it —
 * the same signal the module re-link uses.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("#comfyui/app", () => ({
  app: { graph: { _nodes: [], _nodes_by_id: {} } },
}));

import PushBundleToLibraryModal from "./PushBundleToLibraryModal.vue";
import { bundleHashes } from "./drift-store";
import type { BundleInstance } from "../../widgets/_shared";

function makeBundle(over: Partial<BundleInstance> = {}): BundleInstance {
  return {
    _uid: "buid0001",
    library_id: "dead0001",
    name: "Environments",
    color: null,
    enabled: true,
    collapsed: false,
    parent_uid: null,
    start_idx: 0,
    end_idx: 0,
    inserted_at_hash: "HASH_A",
    ...over,
  } as BundleInstance;
}

function resetBody(): void {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
}

beforeEach(() => {
  resetBody();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetBody();
  bundleHashes.value = null;
});

async function openModal(bundle: BundleInstance | null) {
  const wrap = mount(PushBundleToLibraryModal, {
    attachTo: document.body,
    props: { open: false, bundle: null, childrenForLibrary: [], childrenPreview: [] },
  });
  await wrap.setProps({ open: true, bundle, childrenForLibrary: [], childrenPreview: [] });
  await flushPromises();
  return wrap;
}

describe("PushBundleToLibraryModal re-link", () => {
  it("offers re-link to a content-identical library bundle when detached", async () => {
    // A DIFFERENT uuid carries this instance's inserted_at_hash.
    bundleHashes.value = { live0001: "HASH_A" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/wp/api/bundles")) {
        return new Response(
          JSON.stringify({ items: [{ id: "live0001", name: "Environments" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }));

    const wrap = await openModal(makeBundle());
    await flushPromises();

    expect(document.querySelector('[data-test="pbtl-relink"]')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-test="pbtl-relink-confirm"]')!.click();
    await flushPromises();

    const saved = wrap.emitted("saved");
    expect(saved).toBeTruthy();
    const result = saved![0][0] as { mode: string; id: string; origId: string };
    expect(result.mode).toBe("relink");
    expect(result.id).toBe("live0001");
    expect(result.origId).toBe("dead0001");
    wrap.unmount();
  });

  it("does NOT offer re-link when the bundle is still linked", async () => {
    // library_id present in the live map → not detached.
    bundleHashes.value = { dead0001: "HASH_A" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const wrap = await openModal(makeBundle());
    await flushPromises();
    expect(document.querySelector('[data-test="pbtl-relink"]')).toBeNull();
    wrap.unmount();
  });

  it("does NOT offer re-link when no library bundle matches the content", async () => {
    bundleHashes.value = { live0009: "OTHER_HASH" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/wp/api/bundles")) {
        return new Response(
          JSON.stringify({ items: [{ id: "live0009", name: "Unrelated" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }));
    const wrap = await openModal(makeBundle({ name: "Environments" }));
    await flushPromises();
    expect(document.querySelector('[data-test="pbtl-relink"]')).toBeNull();
    wrap.unmount();
  });
});
