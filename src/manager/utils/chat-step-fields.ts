/**
 * Step fields a JSON-mode reply leaks into its message text.
 *
 * A model answering in JSON steps (`{plan, message, calls}`) sometimes
 * writes the rest of the step into "message" too, so the reply ends with
 * `calls: []`, `**calls**: []`, `"calls": []}` or the calls list itself.
 * `stripStepFields` takes those lines off the start and end of the text;
 * the words in between are left alone, and a line inside a code fence never
 * counts (the last line is then the fence).
 *
 * Mirrors `engine/ai/step_fields.py` (which cleans new answers) via
 * `tests/fixtures/step-fields-corpus.json`; this side cleans stored chats
 * and the live text.
 */

/** Markup a model puts around a key or value: bold, code, quotes. */
const WRAP = String.raw`(?:\*\*|__|[\x60"'])*`;
/** A field line: optional bullet or quote mark, the key, `:` or `=`, the rest. */
const FIELD = new RegExp(
  String.raw`^[ \t]*(?:[-*+>][ \t]+)?` + WRAP
  + String.raw`[ \t]*(calls|tool_calls|function_calls|plan|say|message)[ \t]*` + WRAP
  + String.raw`[ \t]*[:=][ \t]*(.*?)[ \t]*$`, "i");
/** A value that says nothing: empty, an empty list or object, null, "". */
const EMPTY = new RegExp(
  "^" + WRAP + String.raw`[ \t]*(?:\[[ \t]*\]|\{[ \t]*\}|null|none|nil|n\/a|)?[ \t]*` + WRAP
  + String.raw`[ \t]*,?$`, "i");
/** The JSON tail of a step glued to the last words: `…", "calls": []}`. */
const JSON_TAIL = /["\s,]*"(?:calls|tool_calls|plan|say)"\s*:\s*(?:\[\s*\]|\{\s*\}|null|"")\s*\}?\s*$/i;
const CALL_KEYS = new Set(["calls", "tool_calls", "function_calls"]);

/** Where the JSON value at the start of `text` ends, or -1. */
function jsonEnd(text: string): number {
  // Shortest prefix that parses, then the closing marks after it.
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        try {
          JSON.parse(text.slice(0, i + 1));
          return i + 1;
        } catch {
          return -1;
        }
      }
    }
  }
  return -1;
}

/** `text` (from a calls key's value on) is a JSON list or object, or the
 *  start of one cut off mid-stream, with nothing but closing marks after. */
function jsonRest(raw: string): boolean {
  const text = raw.trim().replace(/^`+|`+$/g, "");
  if (!/^[[{]/.test(text)) return false;
  const end = jsonEnd(text);
  // A list still being written (live text), on one line.
  if (end < 0) return !text.includes("\n");
  return /^[\s,}\]`]*$/.test(text.slice(end));
}

/** Drop the trailing field, if the last lines are one. */
function dropTail(lines: string[]): boolean {
  const m = FIELD.exec(lines[lines.length - 1]);
  if (m && EMPTY.test(m[2])) {
    lines.pop();
    return true;
  }
  // A calls list, maybe over several lines: find where it starts.
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 200; i--) {
    if (lines[i].trimStart().startsWith("```")) return false;
    const f = FIELD.exec(lines[i]);
    if (f && CALL_KEYS.has(f[1].toLowerCase())) {
      if (!jsonRest([f[2], ...lines.slice(i + 1)].join("\n"))) return false;
      lines.splice(i);
      return true;
    }
  }
  return false;
}

/** `text` without the step fields written around its words. */
export function stripStepFields(text: string): string {
  if (!text.trim()) return text;
  let out = text.trimEnd();
  for (;;) {
    const cut = out.replace(JSON_TAIL, "").trimEnd();
    if (cut === out) break;
    out = cut;
  }
  const lines = out.split("\n");
  while (lines.length && dropTail(lines)) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  }
  while (lines.length) {
    const m = FIELD.exec(lines[0]);
    if (!(m && EMPTY.test(m[2]))) break;
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  const joined = lines.join("\n");
  return joined === text.trimEnd() ? text : joined.trim();
}
