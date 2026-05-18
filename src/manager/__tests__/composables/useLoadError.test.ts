import { describe, expect, it } from "vitest";
import { useLoadError } from "../../composables/useLoadError";

describe("useLoadError", () => {
  it("starts with error=null", () => {
    const { error } = useLoadError();
    expect(error.value).toBeNull();
  });

  it("captures error message from a thrown Error and rethrows", async () => {
    const { error, run } = useLoadError();
    await expect(run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(error.value).toBe("boom");
  });

  it("captures non-Error throwables via String() coercion", async () => {
    const { error, run } = useLoadError();
    await expect(run(async () => { throw "nope"; })).rejects.toBe("nope");
    expect(error.value).toBe("nope");
  });

  it("clears error before each run (success hides the banner)", async () => {
    const { error, run } = useLoadError();
    await expect(run(async () => { throw new Error("first"); })).rejects.toThrow();
    expect(error.value).toBe("first");
    const result = await run(async () => "ok");
    expect(result).toBe("ok");
    expect(error.value).toBeNull();
  });

  it("clear() resets error", async () => {
    const { error, run, clear } = useLoadError();
    await expect(run(async () => { throw new Error("e"); })).rejects.toThrow();
    expect(error.value).toBe("e");
    clear();
    expect(error.value).toBeNull();
  });

  it("returns the value from the wrapped function on success", async () => {
    const { run } = useLoadError();
    const value = await run(async () => 42);
    expect(value).toBe(42);
  });
});
