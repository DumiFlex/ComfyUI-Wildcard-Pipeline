/**
 * The Assembler's template `$var` scan, kept apart from `negatives.ts` so
 * the startup chunk (pre-run check, template editor, conflict scanner) does
 * not carry the negative-preview code, which only the lazy helper needs.
 *
 * Pure module: no DOM, no graph.
 */

/** The reserved slot's bare name in the Assembler's negative template. */
export const NEGATIVES_VAR = "negatives";

const SLOT = `$${NEGATIVES_VAR}`;
const SLOT_TEST = /\$negatives(?![A-Za-z0-9_])/;

/** `template` with a `$negatives` slot, added at the end when missing
 *  (mirror of engine `with_slot`). Negatives are opt-in: without the slot
 *  the box is only its own text. Boxes written before that relied on the
 *  old rule (empty = the collected words, text without the slot = the words
 *  added at the end), so a workflow saved then goes through this once on
 *  load and prints the same thing. */
export function withSlot(template: string | null | undefined): string {
  const tpl = (template ?? "").trimEnd();
  if (SLOT_TEST.test(tpl)) return template ?? "";
  const base = tpl.replace(/,\s*$/, "").trimEnd();
  return base.trim() ? `${base}, ${SLOT}` : SLOT;
}

const BARE_VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * `$vars` an Assembler's templates use that nothing upstream provides: the
 * prompt template's first, then the negative template's, each once.
 * `$negatives` is reserved in the negative template and never missing;
 * engine `__` names are never reported. Used by the pre-run check.
 */
export function missingAssemblerVars(
  template: string,
  negativeTemplate: string,
  known: Iterable<string>,
): string[] {
  const have = new Set(known);
  const out: string[] = [];
  const scan = (text: string, reserved: ReadonlySet<string>) => {
    for (const m of (text ?? "").matchAll(BARE_VAR_RE)) {
      const name = m[1];
      if (name.startsWith("__") || reserved.has(name) || have.has(name) || out.includes(name)) continue;
      out.push(name);
    }
  };
  scan(template, new Set());
  scan(negativeTemplate, new Set([NEGATIVES_VAR]));
  return out;
}
