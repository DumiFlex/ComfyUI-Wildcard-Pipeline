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
    /** Resolved upstream `$name → value` map. Drives the live-preview
     *  pane below the syntax preview: when set, the template renders
     *  with `$var` substitutions visible at edit time so users see the
     *  same string the assembler will read. Empty map = preview pane
     *  hidden (nothing to substitute). */
    upstreamResolved?: Record<string, string>;
    /** Vars produced by other modules in the SAME Context node. */
    siblingVars?: string[];
  }>(),
  { upstreamVars: () => [], upstreamResolved: () => ({}), siblingVars: () => [] },
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

// Live-preview tokens — same token stream, but valid VAR tokens get
// substituted with their resolved value from the upstream map. Drives
// a second preview pane shown below the syntax preview when at least
// one VAR resolves. Mirrors engine semantics: unknown $var renders as
// literal `$name`, escapes resolve to literal `$` / `@`, alternations
// stay raw (would need RNG to resolve — out of scope for static
// preview). The result is the closest static approximation of what
// the assembler will read at runtime, so users can spot upstream-name
// typos before queue time.
interface ResolvedToken {
  text: string;
  /** Source kind so the renderer can color-code: `var-resolved` paints
   *  with the upstream var's color hash, `var-unresolved` flags red,
   *  literal stays default. */
  kind: "literal" | "var-resolved" | "var-unresolved";
  varName?: string;
}
const resolvedTokens = computed<ResolvedToken[]>(() => {
  const tokens: ResolvedToken[] = [];
  const map = props.upstreamResolved;
  for (const tok of previewTokens.value) {
    switch (tok.kind) {
      case "var": {
        if (tok.invalid || !tok.varName) {
          tokens.push({ text: tok.raw, kind: "var-unresolved", varName: tok.varName });
          break;
        }
        const value = map[tok.varName];
        if (typeof value === "string") {
          tokens.push({ text: value, kind: "var-resolved", varName: tok.varName });
        } else {
          tokens.push({ text: tok.raw, kind: "var-unresolved", varName: tok.varName });
        }
        break;
      }
      case "escape":
        tokens.push({ text: tok.literal ?? "", kind: "literal" });
        break;
      case "ref":
      case "alt":
      case "repeat":
        // Leave as raw — these need RNG / chain resolution.
        tokens.push({ text: tok.raw, kind: "literal" });
        break;
      case "text":
      default:
        tokens.push({ text: tok.raw, kind: "literal" });
        break;
    }
  }
  return tokens;
});

/** Show the live-preview pane only when the template references at
 *  least one upstream-resolvable var. No vars = nothing to substitute,
 *  pane stays hidden so the section doesn't grow unnecessarily. */
const hasResolvableVar = computed(() =>
  resolvedTokens.value.some((t) => t.kind === "var-resolved"),
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
    <div class="wp-tpl__head">
      <span class="wp-tpl__label">Template</span>
      <span class="wp-tpl__hint">$name refs · $$ for literal $ · {a|b|c} inline choice</span>
      <div class="wp-tpl__head-actions">
        <div class="wp-tpl__menu-wrap">
          <button
            v-if="availableVars.length > 0"
            type="button"
            class="wp-tpl__menu-btn"
            data-test="tpl-insert-var"
            :title="`Insert $var (${availableVars.length} available)`"
            aria-label="Insert variable"
            :aria-expanded="showVarMenu"
            @click="toggleVarMenu"
          ><i class="pi pi-plus" aria-hidden="true" /> $var</button>
          <div
            v-if="showVarMenu"
            class="wp-tpl__menu"
            data-test="tpl-var-menu"
            role="listbox"
          >
            <button
              v-for="name in availableVars"
              :key="name"
              type="button"
              class="wp-tpl__menu-item"
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
          class="wp-tpl__reset"
          data-test="tpl-reset"
          title="Restore template to library default"
          aria-label="Reset template to library default"
          @click="onResetTemplate"
        ><i class="pi pi-replay" aria-hidden="true" /></button>
      </div>
    </div>

    <textarea
      ref="taRef"
      class="wp-tpl__input"
      :class="{ 'wp-tpl__input--mod': templateOverridden }"
      data-test="tpl-textarea"
      :value="templateValue"
      :placeholder="libraryTemplate || '$first_name, a $age-year-old with $hair_color hair'"
      aria-label="Template"
      rows="3"
      @input="onTemplateInput"
    />

    <div class="wp-tpl__detected">
      <span class="wp-tpl__detected-label">Detected</span>
      <span class="wp-tpl__detected-summary" data-test="tpl-detected-summary">
        {{ detectedSummary }}
      </span>
      <div v-if="detectedVars.length" class="wp-tpl__detected-pills">
        <span
          v-for="v in detectedVars"
          :key="v"
          class="wp-tpl__pill"
          :class="varColorClass(v)"
          data-test="tpl-detected-pill"
        >${{ v }}</span>
      </div>
    </div>

    <div class="wp-tpl__preview-label">PREVIEW</div>
    <div class="wp-tpl__preview" data-test="tpl-preview">
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

    <template v-if="hasResolvableVar">
      <div class="wp-tpl__preview-label wp-tpl__preview-label--resolved">RESOLVED</div>
      <div class="wp-tpl__preview wp-tpl__preview--resolved" data-test="tpl-preview-resolved">
        <template v-for="(tok, i) in resolvedTokens" :key="i">
          <span v-if="tok.kind === 'literal'" class="tpl-tok--text">{{ tok.text }}</span>
          <span
            v-else-if="tok.kind === 'var-resolved'"
            class="tpl-tok--var-resolved"
            :class="varColorClass(tok.varName ?? '')"
            :title="`$${tok.varName}`"
          >{{ tok.text }}</span>
          <span
            v-else
            class="tpl-tok--var-unresolved"
            :title="`$${tok.varName} not found upstream`"
          >{{ tok.text }}</span>
        </template>
      </div>
    </template>

    <div class="wp-tpl__stored" data-test="tpl-stored-as">
      <span class="wp-tpl__stored-arrow">→ stored as</span>
      <span
        class="wp-tpl__stored-var"
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
.wp-tpl__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.wp-tpl__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-tpl__hint {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  letter-spacing: 0;
}
.wp-tpl__head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Insert-var menu button + reset button + dropdown panel + items —
 * shared with the InjectorBindingModal via
 * src/components/context/editors/_modal-template-ctrls.css. Single
 * source of truth keeps both modals at the same 22px button height. */

.wp-tpl__input {
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
.wp-tpl__input:focus { outline: none; border-color: var(--wp-accent); }
.wp-tpl__input--mod {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-tpl__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }

.wp-tpl__detected {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-tpl__detected-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-tpl__detected-summary {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-tpl__detected-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wp-tpl__pill {
  padding: 2px 6px;
  font: 600 10px var(--wp-font-mono);
  background: color-mix(in srgb, currentColor 12%, var(--wp-bg-deep, var(--wp-bg)));
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 999px;
}

.wp-tpl__preview-label {
  margin-top: 10px;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 4px;
}
.wp-tpl__preview {
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
/* Live-preview pane variants. `--var-resolved` paints with the var's
 * hash color (same as detected pills) so users trace each substituted
 * chunk back to its source. `--var-unresolved` warns: the template
 * references a var the chain doesn't produce → assembler will see
 * literal `$name`. */
.tpl-tok--var-resolved {
  font-weight: 600;
  background: color-mix(in srgb, currentColor 14%, transparent);
  padding: 0 3px;
  border-radius: 2px;
}
.tpl-tok--var-unresolved {
  color: var(--wp-status-modified, #f59e0b);
  text-decoration: underline dashed;
  text-underline-offset: 2px;
  font-weight: 600;
}
.wp-tpl__preview-label--resolved {
  margin-top: 8px;
  color: var(--wp-accent);
}
.wp-tpl__preview--resolved {
  border-style: solid;
  border-color: color-mix(in srgb, var(--wp-accent) 35%, var(--wp-border));
  background: color-mix(in srgb, var(--wp-accent) 6%, var(--wp-bg-deep, var(--wp-bg)));
}

.wp-tpl__stored {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  display: flex;
  align-items: center;
  gap: 4px;
}
.wp-tpl__stored-arrow { color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tpl__stored-var { font-weight: 600; }
</style>
