<script setup lang="ts">
/**
 * Combine TemplateSection — textarea bound to instance.template_override
 * (falling back to payload.template), detected $vars pills, multi-token
 * preview using shared preview-tokens, "stored as $name" line, and
 * per-section reset button when override active.
 *
 * Token rendering is surface-aware ("combine"): VAR + alt + repeat +
 * escape resolve as valid; REF (`@{uuid}`) flagged with error class
 * because combine doesn't recurse into nested wildcards (refs only
 * resolve from wildcard surface — RefOutOfSurfaceError at engine).
 */
import { computed, ref } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";
import { varColorClass } from "../../../../shared/var-color";
import { tokenize, type PreviewToken } from "../../_shared/preview-tokens";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** Vars produced upstream of this Context node — surfaced in the
     *  insert-var dropdown so users don't have to remember names. */
    upstreamVars?: string[];
    /** Vars produced by other modules in the SAME Context node. */
    siblingVars?: string[];
  }>(),
  { upstreamVars: () => [], siblingVars: () => [] },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const taRef = ref<HTMLTextAreaElement | null>(null);
const showVarMenu = ref(false);

/** Combined upstream + sibling vars, deduped, alpha-sorted. Drives
 *  both the validity-coloring on detected pills and the insert-var
 *  dropdown. */
const availableVars = computed<string[]>(() => {
  const set = new Set<string>();
  for (const n of props.upstreamVars) if (n) set.add(n);
  for (const n of props.siblingVars) if (n) set.add(n);
  return [...set].sort();
});

const payload = computed(() => (props.module.payload ?? {}) as {
  template?: string;
  output_var?: string;
});
const instance = computed(() => props.module.instance ?? {});
const libraryTemplate = computed(() => payload.value.template ?? "");
const outputVar = computed(() =>
  (payload.value.output_var ?? "").replace(/^\$+/, ""),
);

// Source of truth: instance override wins, falls back to library default.
const templateValue = computed(() =>
  instance.value.template_override ?? libraryTemplate.value,
);

// `--mod` highlight + per-section reset visibility — "diverges from
// library default" is the only signal. Empty override field is treated
// as "no override" (collapsed); only a non-null string that differs
// from library counts.
const templateOverridden = computed(() => {
  const ov = instance.value.template_override;
  return ov !== undefined && ov !== null && ov !== libraryTemplate.value;
});

// Tokenize once with surface="combine". Frontend tokenizer mirrors
// engine grammar — invalid REF tokens get `invalid: true` flag, which
// renders with the error class.
const previewTokens = computed<PreviewToken[]>(() =>
  tokenize(templateValue.value, "combine"),
);

// Detected variables = VAR tokens (deduped, library order preserved).
const detectedVars = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of previewTokens.value) {
    if (tok.kind === "var" && tok.varName && !seen.has(tok.varName)) {
      seen.add(tok.varName);
      out.push(tok.varName);
    }
  }
  return out;
});

const altCount = computed(
  () => previewTokens.value.filter((t) => t.kind === "alt").length,
);
const repeatCount = computed(
  () => previewTokens.value.filter((t) => t.kind === "repeat").length,
);
const invalidCount = computed(
  () => previewTokens.value.filter((t) => t.invalid === true).length,
);

const detectedSummary = computed(() => {
  const parts: string[] = [`${detectedVars.value.length} vars`];
  if (altCount.value > 0) parts.push(`${altCount.value} alternations`);
  if (repeatCount.value > 0) parts.push(`${repeatCount.value} repeats`);
  if (invalidCount.value > 0) parts.push(`${invalidCount.value} invalid`);
  return parts.join(" · ");
});

function onTemplateInput(ev: Event): void {
  const next = (ev.target as HTMLTextAreaElement).value;
  // Collapse: if user types back to library default, drop the override
  // (null) so engine reads payload.template directly. Same precedence
  // pattern wildcard's variable_binding empty-collapse uses.
  const collapsed = next === libraryTemplate.value ? null : next;
  emit("update", patchInstance(props.module, "template_override", collapsed));
}

function onResetTemplate(): void {
  emit("update", patchInstance(props.module, "template_override", null));
}

/** Insert `$varname` at the textarea's current caret position. Falls
 *  back to appending when no element ref / focus state. Closes the
 *  dropdown after each pick so it acts like a real autocomplete. */
function insertVar(name: string): void {
  const ta = taRef.value;
  const insertion = `$${name}`;
  const current = templateValue.value;
  let next: string;
  if (ta && typeof ta.selectionStart === "number") {
    const start = ta.selectionStart;
    const end = ta.selectionEnd ?? start;
    next = current.slice(0, start) + insertion + current.slice(end);
    // Persist override + restore caret after the inserted token so
    // typing continues smoothly. Vue re-renders synchronously after
    // the emit; the setSelectionRange call below runs after that.
    const caret = start + insertion.length;
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  } else {
    next = current + insertion;
  }
  showVarMenu.value = false;
  const collapsed = next === libraryTemplate.value ? null : next;
  emit("update", patchInstance(props.module, "template_override", collapsed));
}

function toggleVarMenu(): void {
  showVarMenu.value = !showVarMenu.value;
}
</script>

<template>
  <section class="tpl">
    <div class="tpl__head">
      <span class="tpl__label">Template</span>
      <span class="tpl__hint">$name refs · $$ for literal $ · {a|b|c} inline choice</span>
      <div class="tpl__head-actions">
        <div class="tpl__menu-wrap">
          <button
            v-if="availableVars.length > 0"
            type="button"
            class="tpl__menu-btn"
            data-test="tpl-insert-var"
            :title="`Insert $var (${availableVars.length} available)`"
            aria-label="Insert variable"
            :aria-expanded="showVarMenu"
            @click="toggleVarMenu"
          ><i class="pi pi-plus" aria-hidden="true" /> $var</button>
          <div
            v-if="showVarMenu"
            class="tpl__menu"
            data-test="tpl-var-menu"
            role="listbox"
          >
            <button
              v-for="name in availableVars"
              :key="name"
              type="button"
              class="tpl__menu-item"
              :class="varColorClass(name)"
              :data-test="`tpl-var-item-${name}`"
              role="option"
              :aria-selected="false"
              @click="insertVar(name)"
            >${{ name }}</button>
          </div>
        </div>
        <button
          v-if="templateOverridden"
          type="button"
          class="tpl__reset"
          data-test="tpl-reset"
          title="Restore template to library default"
          aria-label="Reset template to library default"
          @click="onResetTemplate"
        ><i class="pi pi-replay" aria-hidden="true" /></button>
      </div>
    </div>

    <textarea
      ref="taRef"
      class="tpl__input"
      :class="{ 'tpl__input--mod': templateOverridden }"
      data-test="tpl-textarea"
      :value="templateValue"
      :placeholder="libraryTemplate || '$first_name, a $age-year-old with $hair_color hair'"
      aria-label="Template"
      rows="3"
      @input="onTemplateInput"
    />

    <div class="tpl__detected">
      <span class="tpl__detected-label">Detected</span>
      <span class="tpl__detected-summary" data-test="tpl-detected-summary">
        {{ detectedSummary }}
      </span>
      <div v-if="detectedVars.length" class="tpl__detected-pills">
        <span
          v-for="v in detectedVars"
          :key="v"
          class="tpl__pill"
          :class="varColorClass(v)"
          data-test="tpl-detected-pill"
        >${{ v }}</span>
      </div>
    </div>

    <div class="tpl__preview-label">PREVIEW</div>
    <div class="tpl__preview" data-test="tpl-preview">
      <template v-for="(tok, i) in previewTokens" :key="i">
        <span v-if="tok.kind === 'text'" class="tpl-tok--text">{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'var' && !tok.invalid"
          class="tpl-tok--var"
          :class="varColorClass(tok.varName ?? '')"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'var' && tok.invalid"
          class="tpl-tok--var-error"
          :title="`$var refs not supported in combine surface`"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'ref' && !tok.invalid"
          class="tpl-tok--ref"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'ref' && tok.invalid"
          class="tpl-tok--ref-error"
          :title="`@{uuid} refs not supported in combine surface`"
        >{{ tok.raw }}</span>
        <span v-else-if="tok.kind === 'alt'" class="tpl-tok--alt">{{ tok.raw }}</span>
        <span v-else-if="tok.kind === 'repeat'" class="tpl-tok--repeat">{{ tok.raw }}</span>
        <span v-else-if="tok.kind === 'escape'" class="tpl-tok--escape">{{ tok.raw }}</span>
      </template>
    </div>

    <div class="tpl__stored" data-test="tpl-stored-as">
      <span class="tpl__stored-arrow">→ stored as</span>
      <span
        class="tpl__stored-var"
        :class="varColorClass(outputVar)"
      >${{ outputVar || "output" }}</span>
    </div>
  </section>
</template>

<style scoped>
.tpl {
  padding: 12px 16px;
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.tpl__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.tpl__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.tpl__hint {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  letter-spacing: 0;
}
.tpl__head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tpl__menu-wrap { position: relative; }
.tpl__menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 600 10px var(--wp-font-mono);
  cursor: pointer;
}
.tpl__menu-btn:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.tpl__menu-btn .pi { font-size: 9px; }
.tpl__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 20;
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tpl__menu-item {
  text-align: left;
  padding: 4px 8px;
  background: transparent;
  border: 0;
  border-radius: 2px;
  font: 600 11px var(--wp-font-mono);
  cursor: pointer;
  color: var(--wp-text);
}
.tpl__menu-item:hover {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
}
.tpl__reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
}
.tpl__reset:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.tpl__reset .pi { font-size: 10px; }

.tpl__input {
  width: 100%;
  box-sizing: border-box;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 6px 8px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text);
  min-height: 56px;
  resize: vertical;
}
.tpl__input:focus { outline: none; border-color: var(--wp-accent); }
.tpl__input--mod {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.tpl__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }

.tpl__detected {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.tpl__detected-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.tpl__detected-summary {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.tpl__detected-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tpl__pill {
  padding: 2px 6px;
  font: 600 10px var(--wp-font-mono);
  background: color-mix(in srgb, currentColor 12%, var(--wp-bg-deep, var(--wp-bg)));
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
}

.tpl__preview-label {
  margin-top: 10px;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 4px;
}
.tpl__preview {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px dashed var(--wp-border);
  border-radius: 3px;
  padding: 8px 10px;
  font: 11px/1.5 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 28px;
}
.tpl-tok--text { color: var(--wp-text); }
.tpl-tok--var { font-weight: 600; }
.tpl-tok--var-error {
  color: var(--wp-danger, #e05252);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
}
.tpl-tok--ref {
  color: var(--wp-accent);
  font-weight: 600;
}
.tpl-tok--ref-error {
  color: var(--wp-danger, #e05252);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
}
.tpl-tok--alt {
  color: var(--wp-amber, #d4a04a);
  font-weight: 600;
}
.tpl-tok--repeat {
  color: var(--wp-teal, #4ad4c4);
  font-weight: 600;
}
.tpl-tok--escape {
  color: var(--wp-text-dim, var(--wp-text3));
}

.tpl__stored {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  display: flex;
  align-items: center;
  gap: 4px;
}
.tpl__stored-arrow { color: var(--wp-text-dim, var(--wp-text3)); }
.tpl__stored-var { font-weight: 600; }
</style>
