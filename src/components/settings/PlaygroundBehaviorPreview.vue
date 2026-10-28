<script setup lang="ts">
/**
 * Live previews for the playground's Runtime behavior settings, which have
 * nothing to show on the module mockup:
 *
 *   - Toasts: pushes an info, a warning and an error through the real toast
 *     store, so Toast lifetime and Suppress info toasts act on real toasts.
 *   - Autocomplete: a prompt box over a small built-in tag list, using the
 *     same `tagInsertText` / `committedSuffixFor` as the real editors, so max
 *     suggestions, minimum characters, ", ", spaces and escaping show live.
 *   - Validation: a sample conflict list filtered through the same
 *     `filterForValidation` the node rows and subgraph badges use.
 *
 * Values come in as props from the playground's own refs, so a change shows
 * here at once, before ComfyUI's store has fired its onChange.
 */
import { computed, nextTick, ref } from "vue";
import WpButton from "@/components/shared/WpButton.vue";
import { pushToast } from "@/components/shared/toast-store";
import { filterForValidation, type ValidationMode } from "@/extension/settings";
import { committedSuffixFor, tagInsertText } from "@/manager/components/rich-text/word-rows";

const props = defineProps<{
  validation: ValidationMode;
  maxSuggestions: string;
  minChars: string;
  separator: boolean;
  spaces: boolean;
  escape: boolean;
}>();

function showToasts(): void {
  pushToast("Sample info: settings saved", { severity: "info" });
  pushToast("Sample warning: $hair is set twice", { severity: "warning" });
  pushToast("Sample error: wildcard not found", { severity: "error" });
}

/** A few real Danbooru tags, picked to show each setting: underscores,
 *  brackets, an emoticon, and enough "b…" tags to hit a low max. */
const SAMPLE_TAGS = [
  "blue_hair", "blue_eyes", "blonde_hair", "black_hair", "brown_hair",
  "bob_cut", "braid", "bangs", "fate_(series)", "hatsune_miku",
  "long_hair", "looking_at_viewer", "^_^", "school_uniform", "smile",
];

const inputEl = ref<HTMLInputElement | null>(null);
const text = ref("");
const caret = ref(0);
const active = ref(0);

/** The word being typed: everything after the last comma before the caret. */
const word = computed(() => {
  const before = text.value.slice(0, caret.value);
  const start = before.lastIndexOf(",") + 1;
  return { start, query: before.slice(start).trimStart() };
});

const suggestions = computed(() => {
  const q = word.value.query.toLowerCase().replace(/ /g, "_");
  const min = parseInt(props.minChars, 10) || 3;
  if (q.length < min) return [];
  const max = parseInt(props.maxSuggestions, 10) || 20;
  return SAMPLE_TAGS.filter((t) => t.includes(q)).slice(0, max);
});

function readCaret(e: Event): void {
  const el = e.target as HTMLInputElement;
  text.value = el.value;
  caret.value = el.selectionStart ?? el.value.length;
  active.value = 0;
}

function pick(tag: string): void {
  const { start } = word.value;
  const lead = start > 0 ? " " : "";
  const insert = lead + tagInsertText(tag, { spaces: props.spaces, escape: props.escape })
    + committedSuffixFor(false, props.separator);
  text.value = text.value.slice(0, start) + insert + text.value.slice(caret.value);
  caret.value = start + insert.length;
  void nextTick(() => inputEl.value?.setSelectionRange(caret.value, caret.value));
}

function onKey(e: KeyboardEvent): void {
  const rows = suggestions.value;
  if (rows.length === 0) return;
  if (e.key === "ArrowDown") { active.value = (active.value + 1) % rows.length; e.preventDefault(); }
  else if (e.key === "ArrowUp") { active.value = (active.value - 1 + rows.length) % rows.length; e.preventDefault(); }
  else if (e.key === "Enter" || e.key === "Tab") {
    const row = rows[active.value];
    if (row) { pick(row); e.preventDefault(); }
  }
}

const SAMPLE_CONFLICTS = [
  { severity: "info", text: "$hair shadows an upstream value" },
  { severity: "warning", text: "$outfit is set by two modules" },
  { severity: "warning", text: "Template reads $pose, nothing sets it" },
] as const;

const shownConflicts = computed(() => filterForValidation(props.validation, [...SAMPLE_CONFLICTS]));
</script>

<template>
  <div class="wp-pg-behave" data-test="playground-behavior-preview">
    <div class="wp-pg-mockup__caption">Behavior preview</div>

    <section class="wp-pg-behave__card">
      <div class="wp-pg-behave__title">Toasts</div>
      <WpButton size="sm" data-test="pg-sample-toasts" @click="showToasts">Show sample toasts</WpButton>
    </section>

    <section class="wp-pg-behave__card">
      <div class="wp-pg-behave__title">Autocomplete</div>
      <input
        ref="inputEl"
        class="wp-pg-behave__input"
        :value="text"
        placeholder="Type “blu”, “fate” or “^_”"
        aria-label="Autocomplete preview"
        role="combobox"
        aria-controls="wp-pg-ac-list"
        :aria-expanded="suggestions.length > 0"
        :aria-activedescendant="suggestions.length ? `wp-pg-ac-${active}` : undefined"
        data-test="pg-ac-input"
        spellcheck="false"
        autocomplete="off"
        @input="readCaret"
        @click="readCaret"
        @keydown="onKey"
      >
      <ul v-if="suggestions.length" id="wp-pg-ac-list" class="wp-pg-behave__list" role="listbox" data-test="pg-ac-list">
        <li
          v-for="(tag, i) in suggestions" :id="`wp-pg-ac-${i}`"
          :key="tag" role="option" tabindex="-1" :aria-selected="i === active"
          class="wp-pg-behave__opt" :class="{ 'wp-pg-behave__opt--on': i === active }"
          @mousedown.prevent="pick(tag)"
        >{{ tag }}</li>
      </ul>
      <p v-else class="wp-pg-behave__hint">
        Suggestions show after {{ minChars }} characters, {{ maxSuggestions }} at most. Sample tags only.
      </p>
    </section>

    <section class="wp-pg-behave__card">
      <div class="wp-pg-behave__title">Validation</div>
      <ul v-if="shownConflicts.length" class="wp-pg-behave__conflicts" data-test="pg-conflicts">
        <li v-for="c in shownConflicts" :key="c.text" class="wp-pg-behave__conflict">
          <span class="wp-pg-behave__sev" :data-sev="c.severity">{{ c.severity }}</span>{{ c.text }}
        </li>
      </ul>
      <p v-else class="wp-pg-behave__hint" data-test="pg-conflicts-off">Conflict checks are off.</p>
    </section>
  </div>
</template>

<style>
@layer wp-extension {
.wp-pg-behave {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.wp-pg-behave__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
}
.wp-pg-behave__title {
  font-size: 11px;
  font-weight: 600;
  color: var(--wp-text2);
}
.wp-pg-behave__input {
  width: 100%;
  box-sizing: border-box;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  background: var(--wp-bg);
  color: var(--wp-text);
  font: 12px var(--wp-font-mono, monospace);
}
.wp-pg-behave__input:focus { outline: none; border-color: var(--wp-border-focus); }
.wp-pg-behave__list,
.wp-pg-behave__conflicts {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
}
.wp-pg-behave__list {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  background: var(--wp-bg);
  max-height: 140px;
  overflow-y: auto;
}
.wp-pg-behave__opt {
  padding: 3px 8px;
  font: 12px var(--wp-font-mono, monospace);
  color: var(--wp-text);
  cursor: pointer;
}
.wp-pg-behave__opt--on,
.wp-pg-behave__opt:hover { background: var(--wp-bg-4); }
.wp-pg-behave__hint {
  margin: 0;
  font-size: 11px;
  color: var(--wp-text3);
}
.wp-pg-behave__conflict {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--wp-text);
  padding: 2px 0;
}
.wp-pg-behave__sev {
  --sev: var(--wp-accent);
  font: 600 9px/1 var(--wp-font-mono, monospace);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 5px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  color: var(--sev);
  background: color-mix(in oklab, var(--sev) 18%, transparent);
}
.wp-pg-behave__sev[data-sev="warning"] { --sev: var(--wp-warn); }
.wp-pg-behave__sev[data-sev="error"] { --sev: var(--wp-danger); }
} /* end @layer wp-extension */
</style>
