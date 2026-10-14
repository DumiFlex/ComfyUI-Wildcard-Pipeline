<script setup lang="ts">
/**
 * PackSettings — what the user decides before the planner does: library
 * reuse, negatives, sub-bundles, writing style, rating, options per
 * wildcard, and how the pack runs (single images, a story over a Loop, a
 * sweep sheet), LoRAs, model families and inputs. Sent with every plan
 * request; no model involved.
 */
import Input from "../ui/Input.vue";
import Select from "../ui/Select.vue";
import type { SelectOption } from "../ui/select-types";
import type { AiPackSettings } from "../../api/types";

const props = defineProps<{
  modelValue: AiPackSettings;
  disabled?: boolean;
  /** Show what each choice does under its field (the Settings step). */
  detailed?: boolean;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: AiPackSettings): void }>();

type Field = Exclude<keyof AiPackSettings, "count" | "frames">;

/** Each choice with a line saying what it does (shown under the field and
 *  as the option's tooltip). */
const FIELDS: Array<{ key: Field; label: string; about: string; options: Array<SelectOption & { hint: string }> }> = [
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
  { key: "run", label: "Run style", about: "What one queue of the pack makes.", options: [
    { value: "single", label: "Single images", hint: "Every run is its own random prompt." },
    { value: "story", label: "Story over a Loop", hint: "A WP Context Loop plays the frames in order: a story beat per frame from $iteration, with the character and outfit held." },
    { value: "sweep", label: "Sweep sheet", hint: "Two or three short wildcards made as Loop sweep axes; everything else held, so only the axes change." },
  ] },
  { key: "loras", label: "LoRAs", about: "LoRAs the pack expects you to wire in.", options: [
    { value: "none", label: "None", hint: "No LoRA inputs." },
    { value: "style", label: "Style LoRA", hint: "An input $style_lora (the <lora:…> tag and its trigger words) from a WP Context Injector, read first by the template." },
    { value: "character", label: "Character LoRA", hint: "A random character as usual, plus an input $character_lora that replaces it when you wire one in." },
    { value: "both", label: "Style + character", hint: "Both inputs." },
  ] },
  { key: "model", label: "Model", about: "Whether the pack adapts to the checkpoint.", options: [
    { value: "any", label: "Any model", hint: "One set of quality and negative tags." },
    { value: "family", label: "Per model family", hint: "Quality and negative tags per model (Pony score tags, Illustrious / NoobAI tags…) from a WP Model Info node." },
  ] },
  { key: "inputs", label: "Subject", about: "Where the subject comes from.", options: [
    { value: "auto", label: "Planner decides", hint: "Wildcards for the subject unless your request names one." },
    { value: "subject", label: "I give it", hint: "An input $subject you wire from a WP Context Injector; no subject wildcard." },
  ] },
];

const FRAMES_HINT = "How many frames the story has: the Loop's count.";

const COUNT_HINT = "How many options each wildcard gets. Empty is Auto: the planner sizes each one.";

function hintFor(key: Field): string {
  return FIELDS.find((f) => f.key === key)?.options.find((o) => o.value === props.modelValue[key])?.hint ?? "";
}

function options(f: (typeof FIELDS)[number]): SelectOption[] {
  return f.options.map(({ hint, ...o }) => ({ ...o, title: hint }));
}

function set<K extends keyof AiPackSettings>(key: K, value: AiPackSettings[K]): void {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function setFrames(v: string | number): void {
  const n = Math.round(Number(v));
  // The server keeps it within 2–12.
  set("frames", Number.isFinite(n) && n > 0 ? Math.max(2, Math.min(12, n)) : 4);
}

function setCount(v: string | number): void {
  const n = Math.round(Number(v));
  // 0 (or empty) is "Auto"; the server keeps a set number within 4–60.
  set("count", Number.isFinite(n) && n > 0 ? Math.min(60, n) : 0);
}
</script>

<template>
  <div class="wp-pack-settings" data-test="pack-settings">
    <label v-for="f in FIELDS" :key="f.key" class="wp-pack-settings__field">
      <span class="wp-pack-settings__label">{{ f.label }}</span>
      <Select
        size="sm"
        :model-value="modelValue[f.key]"
        :options="options(f)"
        :title="f.about"
        :filterable="false"
        :disabled="disabled"
        :aria-label="f.label"
        :data-test="`pack-setting-${f.key}`"
        @update:model-value="(v) => set(f.key, v as never)"
      />
      <span v-if="detailed" class="wp-pack-settings__hint" :data-test="`pack-setting-hint-${f.key}`">{{ hintFor(f.key) }}</span>
    </label>
    <label class="wp-pack-settings__field">
      <span class="wp-pack-settings__label">Options per wildcard</span>
      <Input
        type="number"
        size="sm"
        :model-value="modelValue.count || ''"
        :min="0"
        :max="60"
        placeholder="Auto"
        :disabled="disabled"
        aria-label="Options per wildcard"
        data-test="pack-setting-count"
        @update:model-value="setCount"
      />
      <span v-if="detailed" class="wp-pack-settings__hint">{{ COUNT_HINT }}</span>
    </label>
    <label v-if="modelValue.run === 'story'" class="wp-pack-settings__field">
      <span class="wp-pack-settings__label">Story frames</span>
      <Input
        type="number"
        size="sm"
        :model-value="modelValue.frames"
        :min="2"
        :max="12"
        :disabled="disabled"
        aria-label="Story frames"
        data-test="pack-setting-frames"
        @update:model-value="setFrames"
      />
      <span v-if="detailed" class="wp-pack-settings__hint">{{ FRAMES_HINT }}</span>
    </label>
  </div>
</template>

<style scoped>
.wp-pack-settings {
  display: grid; gap: 8px 12px; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}
.wp-pack-settings:has(.wp-pack-settings__hint) {
  gap: 14px 16px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.wp-pack-settings__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-pack-settings__hint { font-size: 11.5px; line-height: 1.4; color: var(--wp-text-muted); }
.wp-pack-settings__label { font-size: 11px; color: var(--wp-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
</style>
