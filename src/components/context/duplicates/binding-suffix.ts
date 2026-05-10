/**
 * Picks the lowest free `_N` suffix for a binding name given the
 * set of bindings already in use. Used by:
 *   - Right-click → Duplicate (auto-suffix the cloned module's binding)
 *   - Picker add when uuid already in current Context
 *
 * Strips an existing `_N` suffix from the input so chained
 * duplications stay clean: `$foo` → `$foo_2` → `$foo_3` (not
 * `$foo` → `$foo_2` → `$foo_2_2`).
 *
 * Loops up to 1000 iterations then falls back to a timestamp suffix
 * — practical workflows never hit the cap, but the fallback prevents
 * infinite loops in adversarial / corrupted state.
 */
export function nextBindingSuffix(baseName: string, taken: ReadonlySet<string>): string {
  const m = baseName.match(/^(.+?)_(\d+)$/);
  const base = m ? m[1] : baseName;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}
