import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.hoisted(() => ({
  modules: { get: vi.fn(), create: vi.fn(), list: vi.fn() },
  bundles: { create: vi.fn(), list: vi.fn() },
  templates: { get: vi.fn(), create: vi.fn() },
}));

const pushMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../../composables/useToast", () => ({
  useToast: () => ({ toasts: { value: [] }, push: pushMock, dismiss: vi.fn() }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { ApiError } from "../../api/client";
import { useStarterSet } from "../useStarterSet";
import { useStarterStore } from "../../stores/starterStore";
import { STARTER_MODULE_NAMES } from "../starter-recipe";
import type { ModuleRow, ModuleType } from "../../api/types";

let idSeq = 0;
/** Build a minimal ModuleRow with a deterministic id. */
function moduleRow(type: ModuleType, overrides: Partial<ModuleRow> = {}): ModuleRow {
  idSeq += 1;
  const id = overrides.id ?? `row${idSeq}`;
  return {
    id, type, name: "m", description: "", category_id: null, tags: [],
    is_favorite: false, payload: { k: id }, payload_hash: `hash-${id}`,
    version: 1, created_at: "", updated_at: "", ...overrides,
  };
}

/** Make `api.modules.create` mint a fresh row whose type matches the body. */
function createReturnsFreshRows(): void {
  apiMock.modules.create.mockImplementation(
    (body: { type: ModuleType; name: string; payload: Record<string, unknown> }) =>
      Promise.resolve(moduleRow(body.type, { name: body.name, payload: body.payload })),
  );
}

describe("useStarterSet", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    idSeq = 0;
    apiMock.modules.get.mockReset();
    apiMock.modules.create.mockReset();
    apiMock.modules.list.mockReset().mockResolvedValue({ items: [], total: 0 });
    apiMock.bundles.create.mockReset();
    apiMock.bundles.list.mockReset().mockResolvedValue({ items: [], total: 0 });
    apiMock.templates.get.mockReset();
    apiMock.templates.create.mockReset();
    pushMock.mockReset();
    routerPushMock.mockReset();
  });

  describe("ensureSlot", () => {
    it("creates a module when the store has no recorded id", async () => {
      createReturnsFreshRows();
      const { ensureSlot } = useStarterSet();
      const id = await ensureSlot("subject");
      expect(apiMock.modules.create).toHaveBeenCalledTimes(1);
      expect(apiMock.modules.create).toHaveBeenCalledWith(expect.objectContaining({
        type: "wildcard", name: STARTER_MODULE_NAMES.subject,
      }));
      // Recorded in the store.
      expect(useStarterStore().idFor("subject")).toBe(id);
    });

    it("is idempotent — recorded + live id reuses, no second create", async () => {
      createReturnsFreshRows();
      const { ensureSlot } = useStarterSet();
      const first = await ensureSlot("style");
      // Second call: store has the id, and get() resolves ⇒ reuse.
      apiMock.modules.get.mockResolvedValueOnce(moduleRow("fixed_values", { id: first }));
      const second = await ensureSlot("style");
      expect(second).toBe(first);
      expect(apiMock.modules.create).toHaveBeenCalledTimes(1);
      expect(apiMock.modules.get).toHaveBeenCalledWith(first);
    });

    it("recreates when the recorded id is dangling (get → 404 ApiError)", async () => {
      createReturnsFreshRows();
      const store = useStarterStore();
      store.record("scene", "deadbeef");
      apiMock.modules.get.mockRejectedValueOnce(new ApiError(404, "not found"));
      const { ensureSlot } = useStarterSet();
      const id = await ensureSlot("scene");
      expect(id).not.toBe("deadbeef");
      expect(apiMock.modules.create).toHaveBeenCalledTimes(1);
      expect(store.idFor("scene")).toBe(id);
    });

    it("throws if pairing is ensured without both wildcard ids", async () => {
      const { ensureSlot } = useStarterSet();
      await expect(ensureSlot("pairing")).rejects.toThrow(/requires subject \+ mood/);
      expect(apiMock.modules.create).not.toHaveBeenCalled();
    });
  });

  describe("createStarterModule", () => {
    it("creates a single module + toasts with an Open action", async () => {
      createReturnsFreshRows();
      const { createStarterModule } = useStarterSet();
      const id = await createStarterModule("style");
      expect(apiMock.modules.create).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
        severity: "success",
        action: expect.objectContaining({ label: "Open" }),
      }));
      // The Open action routes to the slot's editor.
      const entry = pushMock.mock.calls[0][0];
      entry.action.run();
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "fixed-values-edit", params: { id },
      });
    });

    it("pairing self-ensures subject + mood, then creates the constraint", async () => {
      createReturnsFreshRows();
      const { createStarterModule } = useStarterSet();
      await createStarterModule("pairing");
      // Three creates: subject, mood, pairing.
      expect(apiMock.modules.create).toHaveBeenCalledTimes(3);
      const types = apiMock.modules.create.mock.calls.map((c) => c[0].type);
      expect(types).toEqual(["wildcard", "wildcard", "constraint"]);
      // Constraint body wires both freshly-created wildcard ids.
      const store = useStarterStore();
      const constraintBody = apiMock.modules.create.mock.calls[2][0];
      expect(constraintBody.payload.source_wildcard_id).toBe(store.idFor("subject"));
      expect(constraintBody.payload.target_wildcard_id).toBe(store.idFor("mood"));
    });
  });

  describe("ensureStarterTemplate", () => {
    it("creates the template when none recorded", async () => {
      apiMock.templates.create.mockResolvedValue({
        id: "tpl1", name: "Starter prompt", description: "", category_id: null,
        tags: [], is_favorite: false, template_string: "x", created_at: "", updated_at: "",
      });
      const { ensureStarterTemplate } = useStarterSet();
      const id = await ensureStarterTemplate();
      expect(id).toBe("tpl1");
      expect(apiMock.templates.create).toHaveBeenCalledTimes(1);
      expect(useStarterStore().idFor("template")).toBe("tpl1");
    });

    it("is idempotent when the recorded template still resolves", async () => {
      const store = useStarterStore();
      store.record("template", "tplX");
      apiMock.templates.get.mockResolvedValueOnce({
        id: "tplX", name: "Starter prompt", description: "", category_id: null,
        tags: [], is_favorite: false, template_string: "x", created_at: "", updated_at: "",
      });
      const { ensureStarterTemplate } = useStarterSet();
      const id = await ensureStarterTemplate();
      expect(id).toBe("tplX");
      expect(apiMock.templates.create).not.toHaveBeenCalled();
    });
  });

  describe("buildStarterBundle (failsafe)", () => {
    beforeEach(() => {
      createReturnsFreshRows();
      // get() echoes back a fresh row for whatever id it's asked about, so
      // the child-snapshot fetch step works for the just-created modules.
      apiMock.modules.get.mockImplementation((id: string) =>
        Promise.resolve(moduleRow("wildcard", { id })),
      );
      apiMock.bundles.create.mockImplementation((body: { name: string }) =>
        Promise.resolve({
          id: "bundle1", name: body.name, description: "", color: null,
          category_id: null, tags: [], is_favorite: false, children: [],
          payload_hash: "bh", version: 1, created_at: "", updated_at: "",
        }),
      );
      apiMock.templates.create.mockResolvedValue({
        id: "tpl1", name: "Starter prompt", description: "", category_id: null,
        tags: [], is_favorite: false, template_string: "x", created_at: "", updated_at: "",
      });
    });

    it("from an empty store, creates all six modules in dependency order then bundles", async () => {
      const { buildStarterBundle } = useStarterSet();
      const bundleId = await buildStarterBundle();
      expect(bundleId).toBe("bundle1");
      // Six module creates, in dependency order.
      const types = apiMock.modules.create.mock.calls.map((c) => c[0].type);
      expect(types).toEqual([
        "wildcard", "wildcard", "fixed_values", "combine", "derivation", "constraint",
      ]);
      // Bundle created once, template ensured once.
      expect(apiMock.bundles.create).toHaveBeenCalledTimes(1);
      expect(apiMock.templates.create).toHaveBeenCalledTimes(1);
      // Bundle + template recorded.
      const store = useStarterStore();
      expect(store.idFor("bundle")).toBe("bundle1");
      expect(store.idFor("template")).toBe("tpl1");
    });

    it("constraint child references the created subject + mood ids", async () => {
      const store = useStarterStore();
      const { buildStarterBundle } = useStarterSet();
      await buildStarterBundle();
      const constraintCreate = apiMock.modules.create.mock.calls.find(
        (c) => c[0].type === "constraint",
      );
      expect(constraintCreate?.[0].payload.source_wildcard_id).toBe(store.idFor("subject"));
      expect(constraintCreate?.[0].payload.target_wildcard_id).toBe(store.idFor("mood"));
    });

    it("emits library-linked children in the canonical ChildSnapshot shape", async () => {
      const { buildStarterBundle } = useStarterSet();
      await buildStarterBundle();
      const body = apiMock.bundles.create.mock.calls[0][0];
      expect(body.name).toBe("Starter set");
      expect(body.children).toHaveLength(6);
      for (const child of body.children) {
        expect(child).toMatchObject({
          enabled: true, collapsed: false, instance: {}, entries: [],
        });
        expect(typeof child.id).toBe("string");
        expect(typeof child.payload_hash).toBe("string");
        expect(child).toHaveProperty("payload");
        expect(child.meta).toMatchObject({ name: expect.any(String), library_name: expect.any(String) });
      }
    });

    it("reuses already-created modules (no duplicate creates) when store is populated", async () => {
      // Pre-populate store with live ids; get() resolves them all.
      const store = useStarterStore();
      for (const slot of ["subject", "mood", "style", "scene", "accent", "pairing"] as const) {
        store.record(slot, `pre-${slot}`);
      }
      apiMock.modules.get.mockImplementation((id: string) =>
        Promise.resolve(moduleRow("wildcard", { id })),
      );
      const { buildStarterBundle } = useStarterSet();
      await buildStarterBundle();
      // Nothing re-created — all six reused.
      expect(apiMock.modules.create).not.toHaveBeenCalled();
      expect(apiMock.bundles.create).toHaveBeenCalledTimes(1);
    });

    it("toasts a View-bundle navigate action", async () => {
      const { buildStarterBundle } = useStarterSet();
      await buildStarterBundle();
      expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
        severity: "success",
        action: expect.objectContaining({ label: "View bundle" }),
      }));
      const entry = pushMock.mock.calls.find((c) => c[0].action?.label === "View bundle")?.[0];
      entry.action.run();
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "bundles-edit", params: { id: "bundle1" },
      });
    });
  });
});
