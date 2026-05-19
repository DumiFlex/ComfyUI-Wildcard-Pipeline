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

  it("Update existing PUTs payload + meta + propagate flag", async () => {
    pushResponse({ items: [] });  // contains_module
    pushResponse({ ok: true, new_hash: "new123", bundles_updated: [] });  // PUT
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
    expect(putCall!.url).toBe("/wp/api/modules/src00001/payload");
    const body = JSON.parse(putCall!.init!.body as string);
    expect(body.payload).toEqual(VALID_PAYLOAD);
    // metaBody() only emits keys with non-empty values — the modal
    // doesn't waste bytes sending blank description/tags overrides.
    expect(body.meta).toEqual({ name: "renamed_in_modal" });
    expect(body.propagate_to_bundles).toBe(true);
    wrap.unmount();
  });

  it("emits saved with bundles_updated forwarded from the server", async () => {
    pushResponse({ items: [] });
    pushResponse({ ok: true, new_hash: "h2", bundles_updated: ["b1", "b2"] });
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
    pushResponse({ items: [] });  // contains_module
    pushResponse([]);              // forkModule's fetch of /modules (existing names)
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

  it("opt-out checkbox round-trips into the PUT body", async () => {
    pushResponse({ items: [{ id: "b1", name: "framing" }] });
    pushResponse({ ok: true, new_hash: "h", bundles_updated: [] });
    const wrap = await openModal(makeDraft());

    const cb = document.querySelector<HTMLInputElement>('[data-test="ptl-propagate"]')!;
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    await flushPromises();

    document.querySelector<HTMLButtonElement>('[data-test="ptl-update"]')!.click();
    await flushPromises();

    const putCall = calls.find((c) => c.init?.method === "PUT")!;
    const body = JSON.parse(putCall.init!.body as string);
    expect(body.propagate_to_bundles).toBe(false);
    wrap.unmount();
  });
});
