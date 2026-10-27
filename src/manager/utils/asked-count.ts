/**
 * How many options a typed request asks for: "draft 6 desert weather
 * options" is 6, so the Draft panel's How many box follows the request
 * instead of staying at 10 (bench W3 asked 8, W18 asked 6, both got 10).
 *
 * Mirrors `engine/ai/asked.py::option_count` through the shared
 * `tests/fixtures/asked-count-corpus.json`; change both together.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  dozen: 12,
};
const COUNT = new RegExp(
  String.raw`(?<![\w.$@#{|:-])(\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})(?![\w.%°'’-])`, "gi");
const NOT_NOUNS = new Set([
  "this", "is", "was", "has", "its", "as", "us", "yes", "less", "plus", "thus",
  "words", "letters", "characters", "chars", "tokens", "times", "seconds", "minutes",
  "hours", "days", "weeks", "months", "years", "syllables", "tags", "sentences",
  "steps", "seeds", "runs", "points", "pixels", "percent", "weights",
]);
const STOPS = new Set(["for", "of", "in", "to", "with", "from", "and", "or", "than", "each",
  "per", "at", "by", "on", "a", "an", "the", "x"]);
const REACH = 4;
const RUN = new RegExp(String.raw`^\s+((?:[A-Za-z][A-Za-z'’-]*[ \t]+){0,${REACH - 1}}[A-Za-z][A-Za-z'’-]*)`);
const BEFORE = /\b(?:the|these|those|all|my|its|their|under|over|than|max|maximum|least|most|every|only|first|last)\s+$/i;
const MAX = 100;
/** After a counted noun: the count is per something, not the total. */
const PER = new Set(["each", "per", "apiece", "every"]);

function nextWord(rest: string): string {
  const m = /^\s+([A-Za-z]+)/.exec(rest);
  return m ? m[1].toLowerCase() : "";
}

/** The count `text` asks for (1 to 100), or 0 when it names none. */
export function optionCount(text: string): number {
  if (typeof text !== "string") return 0;
  for (const m of text.matchAll(COUNT)) {
    const word = m[1].toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (!(n >= 1 && n <= MAX)) continue;
    const at = m.index ?? 0;
    if (BEFORE.test(text.slice(0, at))) continue;
    const run = RUN.exec(text.slice(at + m[0].length));
    if (!run) continue;
    const words = run[1].toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const low = words[i];
      if (NOT_NOUNS.has(low) || (STOPS.has(low) && i > 0)) break;
      if ((low.endsWith("s") && low.length > 3) || (n === 1 && (low === "option" || low === "one"))) {
        // "one option each", "3 options per class": a share, not a total.
        const after = i + 1 < words.length
          ? words[i + 1]
          : nextWord(text.slice(at + m[0].length + run[0].length));
        if (PER.has(after)) break;
        return n;
      }
      // "6 more, bolder than what's there": the noun is left out.
      if (low === "more" && i === words.length - 1) return n;
    }
  }
  return 0;
}
