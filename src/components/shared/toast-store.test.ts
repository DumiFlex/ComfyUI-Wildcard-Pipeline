// Tests for toast-store — focuses on the singletonKey contract that lets
// repeating notifications (e.g. a11y toggle confirmations) replace
// themselves instead of stacking.

import { describe, it, expect, beforeEach } from "vitest";
import {
  toasts,
  pushToast,
  dismissToast,
  setLifetimeProvider,
  setSuppressInfoFilter,
  _resetToastProvidersForTesting,
} from "./toast-store";

describe("toast-store", () => {
  beforeEach(() => {
    toasts.value = [];
    _resetToastProvidersForTesting();
  });

  it("pushToast without options appends a default-severity toast", () => {
    pushToast("hello");
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("hello");
    expect(toasts.value[0].severity).toBe("info");
    expect(toasts.value[0].singletonKey).toBeUndefined();
  });

  it("pushToast with singletonKey records the key on the toast", () => {
    pushToast("first", { singletonKey: "a11y-motion" });
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].singletonKey).toBe("a11y-motion");
  });

  it("second push with same singletonKey replaces the first", () => {
    pushToast("first", { singletonKey: "a11y-motion" });
    pushToast("second", { singletonKey: "a11y-motion" });

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("second");
    expect(toasts.value[0].singletonKey).toBe("a11y-motion");
  });

  it("different singletonKeys coexist", () => {
    pushToast("motion on", { singletonKey: "a11y-motion" });
    pushToast("contrast on", { singletonKey: "a11y-contrast" });

    expect(toasts.value).toHaveLength(2);
    expect(toasts.value.map((t) => t.singletonKey)).toEqual(["a11y-motion", "a11y-contrast"]);
  });

  it("singletonKey replacement is order-preserving for other toasts", () => {
    pushToast("plain", {});
    pushToast("motion v1", { singletonKey: "a11y-motion" });
    pushToast("contrast v1", { singletonKey: "a11y-contrast" });
    pushToast("motion v2", { singletonKey: "a11y-motion" });

    expect(toasts.value).toHaveLength(3);
    expect(toasts.value.map((t) => t.message)).toEqual([
      "plain",
      "contrast v1",
      "motion v2",
    ]);
  });

  it("toasts without singletonKey are unaffected by keyed pushes", () => {
    pushToast("plain a");
    pushToast("plain b");
    pushToast("keyed", { singletonKey: "k" });

    expect(toasts.value).toHaveLength(3);

    pushToast("keyed updated", { singletonKey: "k" });
    expect(toasts.value).toHaveLength(3);
    expect(toasts.value.map((t) => t.message)).toEqual([
      "plain a",
      "plain b",
      "keyed updated",
    ]);
  });

  it("dismissToast still removes by id regardless of singletonKey", () => {
    const id = pushToast("dismissable", { singletonKey: "x" });
    dismissToast(id);
    expect(toasts.value).toHaveLength(0);
  });

  describe("lifetime provider", () => {
    it("uses 5000ms default when no provider registered", () => {
      pushToast("hello");
      expect(toasts.value[0].lifeMs).toBe(5000);
    });

    it("reads from registered provider when no explicit lifeMs", () => {
      setLifetimeProvider(() => 3000);
      pushToast("hello");
      expect(toasts.value[0].lifeMs).toBe(3000);
    });

    it("explicit options.lifeMs always wins over provider", () => {
      setLifetimeProvider(() => 3000);
      pushToast("hello", { lifeMs: 8000 });
      expect(toasts.value[0].lifeMs).toBe(8000);
    });

    it("provider returning 0 marks toast sticky (no auto-dismiss)", () => {
      setLifetimeProvider(() => 0);
      const id = pushToast("sticky");
      expect(toasts.value[0].lifeMs).toBe(0);
      // Manual dismissal still works.
      dismissToast(id);
      expect(toasts.value).toHaveLength(0);
    });
  });

  describe("suppress-info filter", () => {
    it("when filter returns true, info toasts are dropped silently", () => {
      setSuppressInfoFilter(() => true);
      const id = pushToast("status", { severity: "info" });
      expect(toasts.value).toHaveLength(0);
      expect(id).toBe(0);  // dropped path returns 0
    });

    it("warnings + errors always render even with filter on", () => {
      setSuppressInfoFilter(() => true);
      pushToast("careful", { severity: "warning" });
      pushToast("broken", { severity: "error" });
      expect(toasts.value).toHaveLength(2);
      expect(toasts.value[0].severity).toBe("warning");
      expect(toasts.value[1].severity).toBe("error");
    });

    it("filter checked at push-time so changing it mid-session works", () => {
      let suppress = false;
      setSuppressInfoFilter(() => suppress);

      pushToast("a", { severity: "info" });
      expect(toasts.value).toHaveLength(1);

      suppress = true;
      pushToast("b", { severity: "info" });
      expect(toasts.value).toHaveLength(1);  // dropped

      suppress = false;
      pushToast("c", { severity: "info" });
      expect(toasts.value).toHaveLength(2);
    });
  });
});
