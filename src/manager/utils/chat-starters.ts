/**
 * The chat's starter questions: a few per page, built from what the user's
 * library holds so they never ask about things that aren't there.
 */

export interface StarterLibrary {
  /** Module counts by type (wildcard, fixed_values, …). */
  modules: Record<string, number>;
  bundles: number;
  templates: number;
  categories: number;
  /** The category with the most items, when there is one. */
  topCategory?: string;
}

export const WHAT_CAN_YOU_DO = "What can you do?";
const MAX = 3;

/** Starters for a docs page. They name the page, so a question sent after
 *  the user has moved on to another page still asks about this one. */
export function docStarters(title?: string): string[] {
  return title
    ? [docExplainPrompt(title), `Show me a small example of ${title}`]
    : ["Explain this page in simpler words", "Show me a small example of this"];
}

/** "Explain the docs page …" for the page's title. */
export function docExplainPrompt(title: string): string {
  return `Explain the docs page "${title}" in simpler words`;
}
const TEST = ["Explain this run", "Why do I never get some of these options?"];
const NEW_ITEM = ["Help me fill this in", "What should this one set up?"];

/** Starters for an open item's editor, by its list page. */
function editor(list: string): string[] {
  if (list === "wildcards") return ["What could make this better?", "Remove options that repeat each other"];
  if (list === "bundles") return ["Explain what this bundle sets up", "Is anything missing from this bundle?"];
  return ["Explain what this does", "What could make this better?"];
}

function total(lib: StarterLibrary): number {
  return Object.values(lib.modules).reduce((a, b) => a + b, 0) + lib.bundles + lib.templates;
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function listPage(name: string, lib: StarterLibrary): string[] {
  const m = lib.modules;
  const wildcards = m.wildcard ?? 0;
  switch (name) {
    case "wildcards":
      return wildcards >= 2
        ? [`Which of my ${plural(wildcards, "wildcard")} repeat each other?`,
            "Make a wildcard of weather with tags for warm and cold", "How do tags on options work?"]
        : ["Make a wildcard of weather with tags for warm and cold", "How do wildcards work?"];
    case "fixed-values":
      return ["What are fixed values for?", "Make fixed values for my quality tags"];
    case "combines":
      return ["How do combines work?", "Make a combine that joins a full outfit"];
    case "derivations":
      return ["How do derivations work?",
        wildcards ? "Make a derivation that reacts to one of my wildcards" : "Show me a small derivation example"];
    case "constraints":
      return wildcards >= 2
        ? ["How do constraints work?", "Which of my wildcards should rule each other out?"]
        : ["How do constraints work?", "Make a constraint so winter never gets beach outfits"];
    case "bundles":
      return lib.bundles
        ? [`What do my ${plural(lib.bundles, "bundle")} set up?`, "What is a bundle for?"]
        : ["What is a bundle for?", "Group my wildcards into a bundle"];
    case "templates":
      return lib.templates
        ? ["What could make my templates better?", "Write a template for a portrait"]
        : ["How do templates work?", "Write a template for a portrait"];
    case "categories":
      return ["Sort my items into categories", "What are categories for?"];
    case "tags":
      return ["Which tags mean the same thing?", "How do tags and collections work?"];
    case "pack-builder":
      return ["What should I put in a pack?", "How does the pack builder work?"];
    case "import-export":
      return ["How do I import a Dynamic Prompts pack?", "What can I export?"];
    case "settings":
      return ["Which model should I use?", "What does each AI setting do?"];
    case "test":
      return TEST;
    default:
      return home(lib);
  }
}

function home(lib: StarterLibrary): string[] {
  if (!total(lib)) return ["Help me make my first wildcard", "How does the pipeline fit together?"];
  const topic = lib.topCategory ? lib.topCategory.toLowerCase() : "characters";
  return [`What does my library set up for ${topic}?`, "What could I add to my library?"];
}

/** Up to three starters for a page; "What can you do?" fills any gap. */
export function starterQuestions(
  route: { name?: string; hasId?: boolean; docTitle?: string }, lib: StarterLibrary,
): string[] {
  const name = route.name ?? "";
  let out: string[];
  if (name === "documentation-page" || name === "documentation") out = docStarters(route.docTitle);
  else if (route.hasId && name.endsWith("-edit")) out = editor(name.slice(0, -"-edit".length));
  else if (name.endsWith("-new")) out = NEW_ITEM;
  else out = listPage(name, lib);
  const list = [...out];
  if (list.length < MAX && !list.includes(WHAT_CAN_YOU_DO)) list.push(WHAT_CAN_YOU_DO);
  return list.slice(0, MAX);
}
