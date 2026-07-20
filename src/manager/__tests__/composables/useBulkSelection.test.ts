import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useBulkSelection } from "../../composables/useBulkSelection";

describe("useBulkSelection", () => {
  it("toggles individual ids", () => {
    const rows = ref(["a", "b", "c"]);
    const s = useBulkSelection(() => rows.value);
    expect(s.count.value).toBe(0);
    s.toggle("a");
    s.toggle("c");
    expect(s.count.value).toBe(2);
    expect(s.isSelected("a")).toBe(true);
    expect(s.isSelected("b")).toBe(false);
    s.toggle("a");
    expect(s.isSelected("a")).toBe(false);
    expect(s.count.value).toBe(1);
  });

  it("select-all / clear via toggleAll", () => {
    const rows = ref(["a", "b"]);
    const s = useBulkSelection(() => rows.value);
    expect(s.allSelected.value).toBe(false);
    s.toggleAll();
    expect(s.allSelected.value).toBe(true);
    expect(s.count.value).toBe(2);
    s.toggleAll(); // all selected → clears
    expect(s.count.value).toBe(0);
  });

  it("someSelected drives the indeterminate state", () => {
    const rows = ref(["a", "b"]);
    const s = useBulkSelection(() => rows.value);
    expect(s.someSelected.value).toBe(false);
    s.toggle("a");
    expect(s.someSelected.value).toBe(true);
    expect(s.allSelected.value).toBe(false);
  });

  it("ignores ids no longer present (count + selectedIds prune)", () => {
    const rows = ref(["a", "b", "c"]);
    const s = useBulkSelection(() => rows.value);
    s.toggleAll();
    expect(s.count.value).toBe(3);
    // A row is removed elsewhere; its stale id must stop counting.
    rows.value = ["a", "b"];
    expect(s.count.value).toBe(2);
    expect(s.selectedIds().sort()).toEqual(["a", "b"]);
    expect(s.allSelected.value).toBe(true);
  });

  it("toggleMode enters/leaves and leaving clears the selection", () => {
    const rows = ref(["a"]);
    const s = useBulkSelection(() => rows.value);
    s.toggleMode();
    expect(s.active.value).toBe(true);
    s.toggle("a");
    expect(s.count.value).toBe(1);
    s.toggleMode(); // leave
    expect(s.active.value).toBe(false);
    expect(s.count.value).toBe(0);
  });

  it("allSelected is false for an empty list", () => {
    const rows = ref<string[]>([]);
    const s = useBulkSelection(() => rows.value);
    expect(s.allSelected.value).toBe(false);
  });
});
