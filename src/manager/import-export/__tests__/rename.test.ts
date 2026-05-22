import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ImportAsNewRename from "../ImportAsNewRename.vue";

/**
 * Tests for `ImportAsNewRename.vue` — Task 20.
 *
 * The component is the inline rename input shown when the user picks
 * "Import as new" on a UUID-collision row (batch or per-item). It
 * mints a fresh 8-hex-char id client-side (matching the engine's
 * `secrets.token_hex(4)` shape) and emits `{ new_id, new_name }` on
 * confirm.
 *
 * Payload key naming: `new_id` + `new_name`, matching the locked
 * server contract (Tasks 13/14/15) and the existing `commit.ts`
 * rename branch. Earlier plan drafts used a different key; the
 * component and these tests follow the locked contract.
 */

/** Typed payload shape — keep tests strict-TS clean. */
interface AppliedPayload {
  new_id: string;
  new_name: string;
}

function getAppliedPayload(
  wrap: ReturnType<typeof mount>,
  callIdx = 0,
): AppliedPayload {
  const events = wrap.emitted("applied");
  expect(events).toBeTruthy();
  if (!events) throw new Error("applied not emitted");
  const call = events[callIdx];
  expect(call).toBeDefined();
  if (!call) throw new Error(`applied call ${callIdx} missing`);
  return call[0] as AppliedPayload;
}

describe("ImportAsNewRename.vue", () => {
  it("defaults the input value to '<originalName> (imported)'", () => {
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "$person" },
    });
    const input = wrap.find('[data-test="rename-input"]')
      .element as HTMLInputElement;
    expect(input.value).toBe("$person (imported)");
  });

  it("edits the name via v-model and emits the edited value on confirm", async () => {
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "Sketch Pack" },
    });
    const input = wrap.find('[data-test="rename-input"]');
    await input.setValue("My Renamed Pack");

    await wrap.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();

    const payload = getAppliedPayload(wrap);
    expect(payload.new_name).toBe("My Renamed Pack");
  });

  it("emits applied with new_id matching the 8-hex regex", async () => {
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();

    const payload = getAppliedPayload(wrap);
    expect(payload.new_id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("emits applied with the new_name matching the input value", async () => {
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();

    const payload = getAppliedPayload(wrap);
    // Default seed — user did not edit.
    expect(payload.new_name).toBe("$colors (imported)");
  });

  it("emits 'cancel' when the cancel button is clicked", async () => {
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap.find('[data-test="rename-cancel"]').trigger("click");
    await flushPromises();

    expect(wrap.emitted("cancel")).toBeTruthy();
    expect(wrap.emitted("applied")).toBeFalsy();
  });

  it("mints a fresh new_id on each confirm (statistical non-collision)", async () => {
    // Two independent mounts → two independent confirm clicks should
    // produce distinct ids with near-certainty (4 bytes = 2^32 distinct
    // ids; probability of a collision between two random draws ≈ 1/4B).
    const wrap1 = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap1.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();
    const id1 = getAppliedPayload(wrap1).new_id;

    const wrap2 = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap2.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();
    const id2 = getAppliedPayload(wrap2).new_id;

    expect(id1).not.toBe(id2);
    // Both should still match the shape contract.
    expect(id1).toMatch(/^[0-9a-f]{8}$/);
    expect(id2).toMatch(/^[0-9a-f]{8}$/);
  });

  it("emits exactly { new_id, new_name } — no extra fields", async () => {
    // Belt-and-braces: the locked server contract is `new_id` + `new_name`.
    // Lock the shape so no future field accidentally leaks into the
    // payload (e.g. a renamed field reverting via a bad merge).
    const wrap = mount(ImportAsNewRename, {
      props: { originalName: "$colors" },
    });
    await wrap.find('[data-test="rename-confirm"]').trigger("click");
    await flushPromises();

    const payload = getAppliedPayload(wrap);
    expect(payload.new_id).toBeDefined();
    expect(payload.new_name).toBeDefined();
    expect(Object.keys(payload).sort()).toEqual(["new_id", "new_name"]);
  });
});
