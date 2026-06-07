<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  parse,
  matches,
  readsAs,
  validateExpression,
} from "@/manager/parsing/subcatFilter";

interface Props {
  /** Sub-categories declared by the picked wildcard's payload. Used as
   *  the known-term set for live validation and as the flat fallback
   *  palette when no `tagGroups` axis covers a tag. */
  subCategories: string[];
  /** Map axis-name → member sub-categories, for the grouped insert
   *  palette. Tags not in any axis fall into an implicit "ungrouped"
   *  cluster. */
  tagGroups?: Record<string, string[]>;
  /** Each entry is one option's tag set — drives the live "N of M
   *  options match" count by running `matches(parse(expr), Set(tags))`. */
  optionTagSets?: string[][];
  /** Initial expression — empty for a fresh insert, prepopulated for edit. */
  initialExpr?: string;
  /** Initial exclude-null flag (inverted-null semantic: true = the
   *  wildcard's null option is dropped from the resolved pool). */
  initialExcludeNull?: boolean;
  /** "insert" hides the Delete button; "edit" shows it. */
  mode: "insert" | "edit";
  /** True when the target wildcard carries a null option. Renders the
   *  "Exclude null" toggle row above the expression editor. */
  hasNullOption?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  tagGroups: () => ({}),
  optionTagSets: () => [],
  initialExpr: "",
  initialExcludeNull: false,
  mode: "insert",
  hasNullOption: false,
});

const emit = defineEmits<{
  /** User confirmed the filter. Carries the raw boolean expression and
   *  the exclude-null flag as separate fields (§3.3 — null is a flag,
   *  not a term inside the expression). */
  "apply": [filter: { expr: string; excludeNull: boolean }];
  /** Insert / keep the ref WITHOUT a filter. */
  "skip": [];
  /** Edit mode only — remove the ref entirely. */
  "delete": [];
}>();

const expr = ref<string>(props.initialExpr);
const excludeNull = ref<boolean>(props.initialExcludeNull);
const inputEl = ref<HTMLInputElement | null>(null);

// External prop changes (e.g. opening the picker on a different chip)
// reset the local state.
watch(() => props.initialExpr, (next) => { expr.value = next; });
watch(() => props.initialExcludeNull, (next) => { excludeNull.value = next; });

const known = computed(() => new Set(props.subCategories));

/** Live two-layer validation error (§3.7), or null when valid/empty. */
const error = computed<string | null>(() =>
  validateExpression(expr.value, known.value),
);

/** Parsed AST — null when empty or unparseable. Only consulted for the
 *  reads-as preview + match count (both guard on `error`). */
const ast = computed(() => {
  try {
    return parse(expr.value);
  } catch {
    return null;
  }
});

/** Normalized "reads as" preview — empty string for an empty/invalid
 *  expression. */
const readsAsText = computed(() => (error.value ? "" : readsAs(ast.value)));

/** Live "N of M options match" count. When the expression is invalid we
 *  show 0 matches but keep the denominator so the user still sees scope. */
const matchCount = computed(() => {
  const total = props.optionTagSets.length;
  if (error.value) return { matched: 0, total };
  const a = ast.value;
  const matched = props.optionTagSets.filter((tags) =>
    matches(a, new Set(tags)),
  ).length;
  return { matched, total };
});

/** Apply is blocked only when the expression is BOTH non-empty AND
 *  invalid — an empty expression is a valid "no filter". */
const applyDisabled = computed(
  () => expr.value.trim().length > 0 && error.value !== null,
);

const groups = computed<{ axis: string; tags: string[] }[]>(() => {
  const out: { axis: string; tags: string[] }[] = [];
  const claimed = new Set<string>();
  for (const [axis, tags] of Object.entries(props.tagGroups)) {
    const present = tags.filter((t) => props.subCategories.includes(t));
    for (const t of present) claimed.add(t);
    if (present.length > 0) out.push({ axis, tags: present });
  }
  const ungrouped = props.subCategories.filter((t) => !claimed.has(t));
  if (ungrouped.length > 0) out.push({ axis: "", tags: ungrouped });
  return out;
});

const OPERATORS = ["and", "or", "not", "(", ")"] as const;

/** Insert `token` at the caret (or selection) inside the expression
 *  input, padding with a single space so adjacent tokens stay parseable
 *  (`warm` + `or` → `warm or`, not `warmor`). Re-focuses + restores the
 *  caret after the inserted token. */
function insertAtCursor(token: string): void {
  const el = inputEl.value;
  const current = expr.value;
  const selStart = el?.selectionStart ?? current.length;
  const selEnd = el?.selectionEnd ?? current.length;
  const before = current.slice(0, selStart);
  const after = current.slice(selEnd);
  // Pad with a space on each side unless we're already at a space / edge.
  const needLead = before.length > 0 && !/\s$/.test(before);
  const needTrail = after.length > 0 && !/^\s/.test(after);
  const insert = (needLead ? " " : "") + token + (needTrail ? " " : "");
  const next = before + insert + after;
  expr.value = next;
  const caret = (before + insert).length;
  void Promise.resolve().then(() => {
    const e = inputEl.value;
    if (!e) return;
    e.focus();
    e.setSelectionRange(caret, caret);
  });
}

function onApply(): void {
  if (applyDisabled.value) return;
  emit("apply", { expr: expr.value.trim(), excludeNull: excludeNull.value });
}
</script>

<template>
  <div class="wp-subcat-picker" data-test="subcat-picker">
    <label
      v-if="hasNullOption"
      class="wp-subcat-picker__null-row"
      data-test="subcat-exclude-null"
    >
      <input v-model="excludeNull" type="checkbox" />
      <i class="pi pi-ban" aria-hidden="true" />
      <span>Exclude null</span>
    </label>

    <!-- Expression input — source of truth. -->
    <div class="wp-subcat-picker__field">
      <label class="wp-subcat-picker__field-label">Expression</label>
      <input
        ref="inputEl"
        v-model="expr"
        type="text"
        aria-label="Sub-category filter expression"
        class="wp-subcat-picker__input"
        :class="{ 'wp-subcat-picker__input--invalid': error !== null }"
        data-test="expr-input"
        placeholder="e.g. warm or cold"
        spellcheck="false"
        autocomplete="off"
      />
    </div>

    <!-- Inline validation error (§3.7). -->
    <p v-if="error" class="wp-subcat-picker__error" data-test="expr-error">
      {{ error }}
    </p>

    <!-- Reads-as normalized preview + live match count. -->
    <div class="wp-subcat-picker__derived">
      <div class="wp-subcat-picker__reads">
        <span class="wp-subcat-picker__derived-label">Reads as</span>
        <code class="wp-subcat-picker__reads-val" data-test="reads-as">{{
          readsAsText || "—"
        }}</code>
      </div>
      <div
        v-if="optionTagSets.length > 0"
        class="wp-subcat-picker__match"
        data-test="match-count"
      >
        {{ matchCount.matched }} of {{ matchCount.total }} options match
      </div>
    </div>

    <!-- Insert-at-cursor palettes: grouped sub-categories + operators. -->
    <div v-if="subCategories.length > 0" class="wp-subcat-picker__palette">
      <div
        v-for="g in groups"
        :key="g.axis || '__ungrouped'"
        class="wp-subcat-picker__group"
      >
        <span v-if="g.axis" class="wp-subcat-picker__group-name">{{ g.axis }}</span>
        <div class="wp-subcat-picker__chips">
          <button
            v-for="sub in g.tags"
            :key="sub"
            type="button"
            class="wp-subcat-chip"
            data-test="subcat-chip"
            :data-value="sub"
            @click="insertAtCursor(sub)"
          >{{ sub }}</button>
        </div>
      </div>
    </div>
    <div class="wp-subcat-picker__ops">
      <button
        v-for="op in OPERATORS"
        :key="op"
        type="button"
        class="wp-subcat-chip wp-subcat-chip--op"
        :data-test="'subcat-op'"
        :data-value="op"
        @click="insertAtCursor(op)"
      >{{ op }}</button>
    </div>

    <div class="wp-subcat-picker__actions">
      <button
        v-if="mode === 'edit'"
        type="button"
        class="wp-btn wp-btn--danger"
        data-test="picker-delete"
        @click="emit('delete')"
      >Delete</button>
      <button
        type="button"
        class="wp-btn"
        data-test="picker-skip"
        @click="emit('skip')"
      >Skip</button>
      <button
        type="button"
        class="wp-btn wp-btn--primary"
        data-test="picker-apply"
        :disabled="applyDisabled || undefined"
        @click="onApply"
      >Apply</button>
    </div>
  </div>
</template>

<style scoped>
.wp-subcat-picker {
  padding: 14px 16px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-accent);
  border-radius: 6px;
  min-width: 340px;
  max-width: 460px;
}
.wp-subcat-picker__null-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
  margin-bottom: 8px;
}
.wp-subcat-picker__null-row .pi { font-size: 11px; }

.wp-subcat-picker__field { margin-bottom: 6px; }
.wp-subcat-picker__field-label {
  display: block;
  font: 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 3px;
}
.wp-subcat-picker__input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border-radius: 4px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2, var(--wp-bg));
  color: var(--wp-text, var(--wp-text1));
  font: 13px/1.4 var(--wp-font-mono);
  outline: none;
}
.wp-subcat-picker__input:focus {
  border-color: var(--wp-accent);
}
.wp-subcat-picker__input--invalid {
  border-color: var(--wp-danger, #ef4444);
}
.wp-subcat-picker__error {
  margin: 0 0 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-danger, #ef4444);
}

.wp-subcat-picker__derived {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
}
.wp-subcat-picker__reads {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.wp-subcat-picker__derived-label {
  font: 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim, var(--wp-text3));
  flex: none;
}
.wp-subcat-picker__reads-val {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  word-break: break-word;
}
.wp-subcat-picker__match {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}

.wp-subcat-picker__palette {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.wp-subcat-picker__group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wp-subcat-picker__group-name {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-subcat-picker__chips,
.wp-subcat-picker__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-subcat-picker__ops {
  margin-bottom: 10px;
  padding-top: 6px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.wp-subcat-chip {
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-subcat-chip:hover {
  border-color: var(--wp-accent);
  color: var(--wp-text, var(--wp-text1));
}
.wp-subcat-chip--op {
  font-family: var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-subcat-picker__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
/* Shrink the Delete/Skip/Apply buttons — the default .wp-btn size was too
 *  bulky for this compact popover (bug #5). */
.wp-subcat-picker__actions .wp-btn {
  padding: 4px 12px;
  font-size: 12px;
}
</style>
