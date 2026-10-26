/**
 * The pack settings' fields: each choice with a line saying what it does.
 * Shared by the settings form and the recommended-settings line.
 */
import type { SelectOption } from "../ui/select-types";
import type { AiPackSettings } from "../../api/types";

export type Field = Exclude<keyof AiPackSettings, "count">;

/** Each choice with a line saying what it does (shown under the field and
 *  as the option's tooltip). */
export const FIELDS: Array<{ key: Field; label: string; about: string; options: Array<SelectOption & { hint: string }> }> = [
  { key: "planner", label: "Planner", about: "How the AI plans the pack.", options: [
    { value: "graph", label: "Shape, wired by code", hint: "The AI writes the pack's shape (slots, what they vary on, what depends on what, the prompt order) and the options; the code wires every rule and the template. Works on small local models." },
    { value: "items", label: "Every item by the AI", hint: "The AI writes the item list and every rule, constraint and template itself. For large models." },
  ] },
  { key: "drafts", label: "Plan drafts", about: "How many plans the AI drafts first.", options: [
    { value: "auto", label: "When needed", hint: "One plan draft, and a second only when the code sees a problem in the first (a rule you gave with no rule in the plan, a part that names nothing, something the review would fix); the code keeps the better one. A clean first plan costs nothing extra." },
    { value: "one", label: "One", hint: "One plan draft. Fastest." },
    { value: "three", label: "Best of three", hint: "The AI drafts the plan three times and the code keeps the one that fits your request best (every part you named, the rules you gave). About three times as long to plan; helps small local models most." },
  ] },
  { key: "library", label: "Your library", about: "Whether the pack uses what you already have.", options: [
    { value: "reuse", label: "Reuse what fits", hint: "Uses your wildcards and fixed values where they fit (marked yours) and builds the rest." },
    { value: "inspire", label: "New, in its style", hint: "Builds everything fresh, written the way your library is (tags or sentences, tag names)." },
    { value: "new", label: "Everything new", hint: "Builds everything fresh and ignores how your library is written." },
  ] },
  { key: "negatives", label: "Negatives", about: "How the pack fills the negative prompt.", options: [
    { value: "auto", label: "Standing + per option", hint: "A standing negative in the template, plus negatives on options that need one (no hat when bald)." },
    { value: "template", label: "Template only", hint: "Only the template's standing negative (bad anatomy, blurry…)." },
    { value: "none", label: "None", hint: "No negatives at all; wire your own." },
  ] },
  { key: "structure", label: "Structure", about: "How the installed bundle is laid out.", options: [
    { value: "sections", label: "Sub-bundle per section", hint: "Each part (Character, Outfit, Scene…) is its own sub-bundle you can reuse alone." },
    { value: "flat", label: "One bundle", hint: "Everything in one bundle, in running order." },
  ] },
  { key: "style", label: "Written as", about: "How every option is worded.", options: [
    { value: "auto", label: "Planner decides", hint: "Picks from your request and library; Danbooru tags for anime models, phrases for others." },
    { value: "tags", label: "Tags", hint: "Danbooru-style tags: red_hair, school_uniform." },
    { value: "sentences", label: "Natural phrases", hint: "Short phrases: \"long red hair\", \"a school uniform\"." },
  ] },
  { key: "rating", label: "Rating", about: "Whether the pack may be explicit.", options: [
    { value: "auto", label: "Planner decides", hint: "Reads it from your request." },
    { value: "safe", label: "Safe", hint: "Nothing explicit; the pack is marked Safe." },
    { value: "nsfw", label: "NSFW", hint: "Explicit content allowed; the pack is marked NSFW." },
  ] },
  { key: "model", label: "Model", about: "Whether the pack adapts to the checkpoint.", options: [
    { value: "any", label: "Any model", hint: "One set of quality and negative tags." },
    { value: "family", label: "Per model family", hint: "Quality and negative tags per model (Pony score tags, Illustrious / NoobAI tags…) from a WP Model Info node." },
  ] },
  { key: "youth_negative", label: "Youth negative", about: "Whether NSFW packs add youth words to the negative.", options: [
    { value: "on", label: "On", hint: "NSFW packs add child, loli, aged down… to the template's negative, so the model leans away from youthful looks." },
    { value: "off", label: "Off", hint: "Nothing is added; the negative is yours to write." },
  ] },
];

/** "Written as: Tags" for one setting's value. */
export function settingLabel(key: keyof AiPackSettings, value: unknown): string {
  if (key === "count") return `Options per wildcard: ${value ? String(value) : "Auto"}`;
  const f = FIELDS.find((x) => x.key === key);
  const o = f?.options.find((x) => x.value === value);
  return `${f?.label ?? key}: ${o?.label ?? String(value)}`;
}
