/**
 * PushToLibraryModal — Phase C unified save-to-library surface.
 *
 * Stubs the global fetch + the ComfyUI `app.graph` so the modal can be
 * mounted in jsdom without a live ComfyUI session. Each test asserts a
 * specific contract:
 *
 *   - Update existing greyed when no payload_hash
 *   - PUT body carries meta (name / description / tags)
 *   - Update path forwards bundles_updated to the saved event
 *   - Fork path POSTs to /wp/api/modules with the renamed payload
 *   - propagate_to_bundles flag round-trips
 *
 * The instance-modal save-button visibility tests live next to each
 * kind's modal file; those just check the gate. This file covers the
 * shared surface they all route into.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("#comfyui/app", () => ({
  app: { graph: { _nodes: [], _nodes_by_id: {} } },
}));

import PushToLibraryModal from "./PushToLibraryModal.vue";
import { hashes } from "./drift-store";
import type { ModuleEntry } from "../../widgets/_shared";

const VALID_PAYLOAD = {
  options: [{ id: "o1", value: "red", weight: 1 }],
  var_binding: "color",
  sub_categories: [],
};

function makeDraft(over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "src00001",
    type: "wildcard",
    enabled: true,
    meta: { name: "test_w", description: "", tags: [] },
    entries: [],
    payload: VALID_PAYLOAD,
    payload_hash: "abc123",
    ...over,
  } as ModuleEntry;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}
let calls: FetchCall[] = [];
let nextResponses: Array<{ status: number; body: unknown }> = [];

function pushResponse(body: unknown, status = 200): void {
  nextResponses.push({ status, body });
}

function makeMockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resetBody(): void {
  // Teleported overlays from a previous test linger in document.body
  // because Vue's Transition holds the wrapper for animation cleanup.
  // Hard-reset by replacing the body element's children with an empty
  // fragment — semantically equivalent to clearing innerHTML but
  // without the XSS-shaped foot-gun.
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
}

beforeEach(() => {
  calls = [];
  nextResponses = [];
  resetBody();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const resp = nextResponses.shift() ?? { status: 200, body: { items: [] } };
    return makeMockResponse(resp.status, resp.body);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetBody();
  // The re-link branch reads the drift-store live hashes; null it out so a
  // set value can't leak into other tests and falsely trip isLibraryMissing.
  hashes.value = null;
});

async function openModal(draft: ModuleEntry | null) {
  const wrap = mount(PushToLibraryModal, {
    attachTo: document.body,
    props: { open: false, draft: null },
  });
  await wrap.setProps({ open: true, draft });
  await flushPromises();
  return wrap;
}

describe("PushToLibraryModal", () => {
  it("renders nothing when closed", () => {
    const wrap = mount(PushToLibraryModal, {
      props: { open: false, draft: null },
    });
    expect(document.querySelector('[data-test="ptl"]')).toBeNull();
    wrap.unmount();
  });

  it("seeds the form fields from draft.meta on open", async () => {
    pushResponse({ items: [] });  // contains_module probe
    const wrap = await openModal(makeDraft({
      meta: { name: "test_w", description: "lore", tags: ["a", "b"] },
    }));
    const nameInput = document.querySelector<HTMLInputElement>('[data-test="ptl-name"]')!;
    const descInput = document.querySelector<HTMLTextAreaElement>('[data-test="ptl-description"]')!;
    const tagsInput = document.querySelector<HTMLInputElement>('[data-test="ptl-tags"]')!;
    expect(nameInput.value).toBe("test_w");
    expect(descInput.value).toBe("lore");
    expect(tagsInput.value).toBe("a, b");
    wrap.unmount();
  });

  it("disables Update existing when draft has no payload_hash", async () => {
    pushResponse({ items: [] });
    const wrap = await openModal(makeDraft({ payload_hash: undefined }));
    const btn = document.querySelector<HTMLButtonElement>('[data-test="ptl-update"]')!;
    expect(btn.disabled).toBe(true);
    wrap.unmount();
  });

  it("Update existing PUTs payload + flattened meta + propagate flag", async () => {
    pushResponse({ items: [] });                                              // contains_module
    pushResponse({ description: "", tags: [], name: "test_w" });              // seedFromLibrary
    pushResponse({ payload_hash: "new123", bundles_updated: [], name: "x" }); // canonical PUT
    const wrap = await openModal(makeDraft());

    const nameInput = document.querySelector<HTMLInputElement>('[data-test="ptl-name"]')!;
    nameInput.value = "renamed_in_modal";
    nameInput.dispatchEvent(new Event("input"));
    await flushPromises();

    const btn = document.querySelector<HTMLButtonElement>('[data-test="ptl-update"]')!;
    btn.click();
    await flushPromises();

    const putCall = calls.find((c) => c.init?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(putCall!.url).toBe("/wp/api/modules/src00001");
    const body = JSON.parse(putCall!.init!.body as string);
    expect(body.payload).toEqual(VALID_PAYLOAD);
    // Canonical contract — meta fields are flattened on the body, not
    // nested under a `meta` key.
    expect(body.name).toBe("renamed_in_modal");
    expect(body.description).toBeUndefined();
    expect(body.tags).toBeUndefined();
    expect(body.propagate_to_bundles).toBe(true);
    wrap.unmount();
  });

  it("emits saved with bundles_updated forwarded from the server", async () => {
    pushResponse({ items: [] });
    pushResponse({ description: "", tags: [] });  // seedFromLibrary
    pushResponse({ payload_hash: "h2", bundles_updated: ["b1", "b2"], name: "test_w" });
    const wrap = await openModal(makeDraft());

    document.querySelector<HTMLButtonElement>('[data-test="ptl-update"]')!.click();
    await flushPromises();

    const saved = wrap.emitted("saved");
    expect(saved).toBeTruthy();
    const result = saved![0][0] as { bundles_updated: string[] };
    expect(result.bundles_updated).toEqual(["b1", "b2"]);
    wrap.unmount();
  });

  it("Save as new entry POSTs to /wp/api/modules with the renamed payload", async () => {
    pushResponse({ items: [] });                  // contains_module
    pushResponse({ description: "", tags: [] });  // seedFromLibrary
    pushResponse([]);                              // forkModule's fetch of /modules (existing names)
    pushResponse({ id: "newid01", payload_hash: "fh1" }, 201);  // POST /modules

    const wrap = await openModal(makeDraft());
    document.querySelector<HTMLButtonElement>('[data-test="ptl-save-new"]')!.click();
    await flushPromises();

    const postCall = calls.find((c) => c.init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall!.url).toBe("/wp/api/modules");
    const body = JSON.parse(postCall!.init!.body as string);
    expect(body.type).toBe("wildcard");
    // The modal threads the editable Name field through forkModule's
    // collision check, so the suffix prefix matches whatever the user
    // typed (or the original meta.name when untouched).
    expect(body.name).toMatch(/\(copy/);
    expect(body.payload).toEqual(VALID_PAYLOAD);

    const saved = wrap.emitted("saved");
    expect(saved).toBeTruthy();
    const result = saved![0][0] as { mode: string; id: string };
    expect(result.mode).toBe("fork");
    expect(result.id).toBe("newid01");
    wrap.unmount();
  });

  it("renders the bundle list when contains_module returns matches", async () => {
    pushResponse({ items: [{ id: "b1", name: "framing" }, { id: "b2", name: "mood" }] });
    const wrap = await openModal(makeDraft());
    const bundles = document.querySelector('[data-test="ptl-bundles"]');
    expect(bundles?.textContent).toContain("Affects 2 saved bundles");
    expect(bundles?.textContent).toContain("framing");
    expect(bundles?.textContent).toContain("mood");
    wrap.unmount();
  });

  it("seeds description + tags from the library entry when the draft is silent", async () => {
    // Workflow rows only carry meta.name + library_name at insert
    // time; the modal fetches the live library row to fill the rest.
    pushResponse({ items: [] });
    pushResponse({ description: "library description", tags: ["fromlib", "two"] });
    const wrap = await openModal(makeDraft({
      meta: { name: "test_w" } as { name: string },  // intentionally no description/tags
    }));
    // seedFromLibrary fires async after openModal resolves — give it a
    // beat to land.
    await flushPromises();
    const descInput = document.querySelector<HTMLTextAreaElement>('[data-test="ptl-description"]')!;
    const tagsInput = document.querySelector<HTMLInputElement>('[data-test="ptl-tags"]')!;
    expect(descInput.value).toBe("library description");
    expect(tagsInput.value).toBe("fromlib, two");
    wrap.unmount();
  });

  it("does not clobber in-modal edits when seedFromLibrary lands late", async () => {
    pushResponse({ items: [] });
    // First arg ignored — we'll set the form before this resolves by
    // delaying via Promise indirection. Simulate by stubbing fetch
    // returning library data with a different description; the modal
    // should respect the typed value because the field is non-empty.
    pushResponse({ description: "FROM_LIB_SHOULD_LOSE", tags: ["lib"] });
    const wrap = await openModal(makeDraft({
      meta: { name: "test_w", description: "USER_TYPED" } as { name: string; description: string },
    }));
    await flushPromises();
    const descInput = document.querySelector<HTMLTextAreaElement>('[data-test="ptl-description"]')!;
    expect(descInput.value).toBe("USER_TYPED");
    wrap.unmount();
  });

  it("offers re-link to a content-identical library row when the draft is detached", async () => {
    // A DIFFERENT uuid carries the draft's payload_hash — the re-imported twin.
    hashes.value = { live0001: { type: "wildcard", payload_hash: "HASH_A" } };
    pushResponse({ items: [] });                                                    // fetchBundlesContaining
    pushResponse({ description: "", tags: [] });                                    // seedFromLibrary
    pushResponse({ items: [{ id: "live0001", name: "test_w", type: "wildcard" }] }); // fetchLibraryNames
    const wrap = await openModal(makeDraft({ id: "dead0001", payload_hash: "HASH_A" }));

    const relink = document.querySelector('[data-test="ptl-relink"]');
    expect(relink).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-test="ptl-relink-confirm"]')!.click();
    await flushPromises();

    const saved = wrap.emitted("saved");
    expect(saved).toBeTruthy();
    const result = saved![0][0] as { mode: string; id: string; origId: string };
    expect(result.mode).toBe("relink");
    expect(result.id).toBe("live0001");
    expect(result.origId).toBe("dead0001");
    wrap.unmount();
  });

  it("does not offer re-link when no content match exists (detached, novel content)", async () => {
    // Library has a different-content row only → no identical + no name match
    // for a differently-named draft → no re-link block (Save as new is the path).
    hashes.value = { live0009: { type: "wildcard", payload_hash: "OTHER" } };
    pushResponse({ items: [] });                                                    // bundles
    pushResponse({ description: "", tags: [] });                                    // seedFromLibrary
    pushResponse({ items: [{ id: "live0009", name: "unrelated", type: "wildcard" }] }); // names
    const wrap = await openModal(makeDraft({ id: "dead0002", payload_hash: "HASH_Z" }));
    expect(document.querySelector('[data-test="ptl-relink"]')).toBeNull();
    wrap.unmount();
  });

  it("opt-out checkbox round-trips into the PUT body", async () => {
    pushResponse({ items: [{ id: "b1", name: "framing" }] });
    pushResponse({ description: "", tags: [] });  // seedFromLibrary
    pushResponse({ payload_hash: "h", bundles_updated: [], name: "test_w" });
    const wrap = await openModal(makeDraft());

    // propagate defaults on; one click toggles it off (wp-check span).
    const cb = document.querySelector<HTMLElement>('[data-test="ptl-propagate"]')!;
    cb.click();
    await flushPromises();

    document.querySelector<HTMLButtonElement>('[data-test="ptl-update"]')!.click();
    await flushPromises();

    const putCall = calls.find((c) => c.init?.method === "PUT")!;
    const body = JSON.parse(putCall.init!.body as string);
    expect(body.propagate_to_bundles).toBe(false);
    wrap.unmount();
  });
});
