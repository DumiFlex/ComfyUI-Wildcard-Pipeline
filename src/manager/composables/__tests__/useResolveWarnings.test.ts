import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import { useResolveWarnings } from "../useResolveWarnings";
import type { ResolveWarning } from "../../utils/resolveTokens";

function mkWarn(over: Partial<ResolveWarning> = {}): ResolveWarning {
  return {
    type: "broken_ref_on_import",
    severity: "warn",
    module_id: "mod_a",
    source_field: "options[0].value",
    position: 0,
    token_index: null,
    detail: {},
    message: "broken ref",
    ...over,
  };
}

describe("useResolveWarnings", () => {
  beforeEach(() => {
    // Module-level singleton — wipe before each test so previous-test
    // state can't leak across cases.
    useResolveWarnings().clearAll();
  });

  it("starts empty", () => {
    const store = useResolveWarnings();
    expect(store.warnings.value.length).toBe(0);
  });

  it("push appends without replacing", () => {
    const store = useResolveWarnings();
    store.push([mkWarn({ module_id: "a" })]);
    store.push([mkWarn({ module_id: "b" })]);
    expect(store.warnings.value.length).toBe(2);
    expect(store.warnings.value[0]?.module_id).toBe("a");
    expect(store.warnings.value[1]?.module_id).toBe("b");
  });

  it("push of empty array is a no-op", () => {
    const store = useResolveWarnings();
    store.push([mkWarn({ module_id: "a" })]);
    store.push([]);
    expect(store.warnings.value.length).toBe(1);
  });

  it("forModule filters reactively when push happens", () => {
    const store = useResolveWarnings();
    const forA = store.forModule("a");
    expect(forA.value.length).toBe(0);

    store.push([mkWarn({ module_id: "a" }), mkWarn({ module_id: "b" })]);
    expect(forA.value.length).toBe(1);
    expect(forA.value[0]?.module_id).toBe("a");

    store.push([mkWarn({ module_id: "a", message: "second" })]);
    expect(forA.value.length).toBe(2);
  });

  it("clearForModule removes only matching warnings", () => {
    const store = useResolveWarnings();
    store.push([
      mkWarn({ module_id: "a" }),
      mkWarn({ module_id: "b" }),
      mkWarn({ module_id: "a", message: "second a" }),
    ]);
    store.clearForModule("a");
    expect(store.warnings.value.length).toBe(1);
    expect(store.warnings.value[0]?.module_id).toBe("b");
  });

  it("clearByType removes only matching type", () => {
    const store = useResolveWarnings();
    store.push([
      mkWarn({ type: "broken_ref_on_import" }),
      mkWarn({ type: "unknown_ref" }),
      mkWarn({ type: "broken_ref_on_import", module_id: "b" }),
    ]);
    store.clearByType("broken_ref_on_import");
    expect(store.warnings.value.length).toBe(1);
    expect(store.warnings.value[0]?.type).toBe("unknown_ref");
  });

  it("clearAll empties the store", () => {
    const store = useResolveWarnings();
    store.push([mkWarn(), mkWarn({ module_id: "b" })]);
    store.clearAll();
    expect(store.warnings.value.length).toBe(0);
  });

  it("multiple consumers share the same data (singleton confirmation)", async () => {
    // Mount two independent host components — each calls
    // useResolveWarnings() in its own setup(). Pushing into one's handle
    // must be observable from the other's handle because the underlying
    // ref is module-scoped.
    const seenInA: number[] = [];
    const seenInB: number[] = [];

    const HostA = defineComponent({
      setup() {
        const { warnings, push } = useResolveWarnings();
        return { warnings, push };
      },
      template: `<div data-test="a">{{ warnings.length }}</div>`,
    });
    const HostB = defineComponent({
      setup() {
        const { warnings } = useResolveWarnings();
        return { warnings };
      },
      template: `<div data-test="b">{{ warnings.length }}</div>`,
    });

    const a = mount(HostA);
    const b = mount(HostB);

    seenInA.push(Number(a.find('[data-test="a"]').text()));
    seenInB.push(Number(b.find('[data-test="b"]').text()));

    (a.vm as unknown as { push: (n: ResolveWarning[]) => void }).push([
      mkWarn({ module_id: "shared" }),
    ]);
    await a.vm.$nextTick();
    await b.vm.$nextTick();

    seenInA.push(Number(a.find('[data-test="a"]').text()));
    seenInB.push(Number(b.find('[data-test="b"]').text()));

    expect(seenInA).toEqual([0, 1]);
    expect(seenInB).toEqual([0, 1]);

    a.unmount();
    b.unmount();
  });
});
