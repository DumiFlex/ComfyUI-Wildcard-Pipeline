/**
 * Pack builder check problems compared across a rebuild. A problem's text
 * carries its run counts ("… (95 of 200 runs)"), so the same problem after
 * a Fix reads differently when only the count moved; matched as text it
 * showed a green "fixed:" while the fallback still stood in for most runs
 * (9B bench Z17, 2026-10-26).
 */

/** The problem's text without its counts and numbers. */
export function problemShape(text: string): string {
  return text
    .replace(/\(\s*\d+\s+of\s+\d+\s+runs?\s*\)/gi, "")
    .replace(/\d+(?:\.\d+)?%?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Whether `now` (the problems after a rebuild) still holds one of `asked`
 *  (the problems the rebuild was sent to fix), counts aside. */
export function stillThere(asked: readonly string[], now: readonly string[]): boolean {
  const shapes = new Set(now.map(problemShape));
  return asked.some((t) => shapes.has(problemShape(t)));
}
