import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { ModuleRow } from "../../api/types";

/**
 * B3 — the per-row Publish button routes through the guided-publish GATE
 * (`requestPublish`), not straight to `publishToCommunity`, so a module with
 * unmet deps opens the dialog. We mock the gate store + router and assert the
 * button forwards the row's publishable + the unfiltered catalog.
 */
const requestPublish = vi.fn();
vi.mock("../../import-export/guided-publish-store", () => ({
  useGuidedPublishStore: () => ({ requestPublish }),
}));

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

// Stub the toast composable (no host mounted in this unit test).
vi.mock("../../composables/useToast", () => ({
  useToast: () => ({ push: vi.fn() }),
}));

import CommunityRowActions from "../CommunityRowActions.vue";
import { useModuleStore } from "../../stores/moduleStore";
import { buildModulePublishable } from "../../import-export/single-row-publish";

function moduleRow(parts: Partial<ModuleRow> & { id: string; name: string }): ModuleRow {
  return {
    type: "wildcard",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {},
    ...parts,
  } as unknown as ModuleRow;
}

describe("CommunityRowActions onPublish → guided-publish gate", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    requestPublish.mockReset();
    push.mockReset();
  });

  it("requestPublish is called with the row's publishable + the module catalog", async () => {
    const row = moduleRow({ id: "aaaa1111", name: "Hair" });
    const moduleStore = useModuleStore();
    moduleStore.catalog = [row];

    const wrap = mount(CommunityRowActions, {
      props: { row, kind: "module" },
      global: {
        stubs: {
          // Passthrough stub: forwards attrs (incl. aria-label) onto a native
          // <button> so the component's own @click binding is what fires.
          Button: {
            inheritAttrs: true,
            template: '<button v-bind="$attrs"><slot /></button>',
          },
        },
      },
    });

    // Trigger the Publish button by its aria-label (icon-only renders
    // Publish then Copy as siblings).
    await wrap.get("[aria-label='Publish Hair to community']").trigger("click");

    expect(requestPublish).toHaveBeenCalledTimes(1);
    const [pub, router, catalog] = requestPublish.mock.calls[0];
    expect(pub).toEqual(buildModulePublishable(row));
    expect(router).toEqual({ push });
    expect(catalog).toEqual([row]);
    wrap.unmount();
  });
});
