/**
 * TS mirror of `engine/converters.py`. Kept in lock-step via the shared
 * fixture `tests/fixtures/converter_cases.json` — see `parser.test.ts`
 * + `tests/test_parser_parity.py`.
 *
 * Function names are prefixed `parse*` (not the TS built-in `parseInt` /
 * `parseFloat`) and exported under the same name; callers import as
 * `{ parseInt as parseIntStr }` if they need to avoid shadowing.
 */

const INT_RE = /-?\d+/g;
const FLOAT_RE = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;
const BOOL_SPLIT_RE = /[\s,;|/]+/;
const TRUTHY = new Set(["true", "yes", "on", "1"]);
const FALSY = new Set(["false", "no", "off", "0"]);

export function parseInt(text: string, index: number, defaultValue: number): number {
  if (!text) return defaultValue;
  const matches = text.match(INT_RE) ?? [];
  if (index < 0 || index >= matches.length) return defaultValue;
  const n = Number(matches[index]);
  return Number.isFinite(n) ? Math.trunc(n) : defaultValue;
}

export function parseFloat(text: string, index: number, defaultValue: number): number {
  if (!text) return defaultValue;
  const matches = text.match(FLOAT_RE) ?? [];
  if (index < 0 || index >= matches.length) return defaultValue;
  const n = Number(matches[index]);
  return Number.isFinite(n) ? n : defaultValue;
}

export function parseBool(text: string, index: number, defaultValue: boolean): boolean {
  if (!text) return defaultValue;
  const tokens = text.split(BOOL_SPLIT_RE);
  const bools: boolean[] = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (TRUTHY.has(low)) bools.push(true);
    else if (FALSY.has(low)) bools.push(false);
  }
  if (index < 0 || index >= bools.length) return defaultValue;
  return bools[index];
}
