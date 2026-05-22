<script setup lang="ts">
/**
 * RichTextPreview
 *
 * Read-only counterpart to {@link RichTextInput}. Parses the bound text
 * into atoms (via `atomicEditorModel.parse`) and renders var/ref atoms as
 * {@link RefChip} chips — the same component the editor's rest state uses —
 * so the preview looks identical to the editor at rest. Plain text atoms
 * render as `<span class="wp-rt__text">` so existing CSS hooks still apply.
 *
 * Accepts both `modelValue` (new, Vue convention) and `value` (legacy,
 * preserved for the existing callers in TestRunner / Wildcards / Combine
 * editor that already pass `:value="..."`). Whichever is set first wins;
 * if both are set, `modelValue` takes precedence.
 *
 * When `clickable-refs` is true, ref chips emit a `ref-click` event with
 * the resolved UUID — consumers (e.g. TestRunner) navigate to the
 * referenced wildcard editor on click. Only resolved refs are clickable
 * (unresolved chips have no actionable target).
 */
import { computed } from "vue";
import RefChip from "./RefChip.vue";
import { parse, type Atom } from "./atomicEditorModel";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { SurfaceKind, ResolveWarning } from "../utils/resolveTokens";

interface Props {
  /** New, preferred API. Mirrors RichTextInput's `modelValue`. */
  modelValue?: string;
  /** Legacy alias for `modelValue`. Existing callers use `:value="..."`. */
  value?: string;
  /** Map from UUID to display name; used to render `@{uuid}` refs as human labels. */
  uuidToName?: Map<string, string>;
  /** $var names known to the surrounding scope. Drives the var chip's resolved state. */
  varSuggestions?: string[];
  /** Surface gates ref styling: non-wildcard surfaces mark refs as "ignored". */
  surface?: SurfaceKind;
  /** Warning markers rendered at the trailing edge of the preview. */
  warnings?: ResolveWarning[];
  /** When set, merges `warnings` with the shared `useResolveWarnings` store
   *  filtered to `module_id === moduleId`. Mirrors RichTextInput's behavior
   *  so import-export's post-commit broken-ref warnings show up here too. */
  moduleId?: string;
  /** When true, resolved ref chips become clickable and emit `ref-click(uuid)`. */
  clickableRefs?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  value: undefined,
  uuidToName: () => new Map(),
  varSuggestions: () => [],
  surface: "wildcard",
  warnings: () => [],
  moduleId: undefined,
  clickableRefs: false,
});

const { forModule: forModuleWarnings } = useResolveWarnings();
const storeWarnings = computed<ResolveWarning[]>(() =>
  props.moduleId ? forModuleWarnings(props.moduleId).value : [],
);
const effectiveWarnings = computed<ResolveWarning[]>(() => [
  ...props.warnings,
  ...storeWarnings.value,
]);

const emit = defineEmits<{
  "ref-click": [uuid: string];
}>();

// `modelValue` wins if both are passed (callers should pick one). Falls back
// to the legacy `value` prop for existing call sites that haven't migrated.
const sourceText = computed(() => props.modelValue ?? props.value ?? "");
const atoms = computed<Atom[]>(() => parse(sourceText.value));
const isWildcard = computed(() => props.surface === "wildcard");

function atomIsResolved(atom: Atom): boolean {
  // Vars bind at runtime — a $name not in the static catalog may still
  // resolve via upstream context / derivation / runtime overrides. The
  // conflict scanner surfaces genuine missing-var advisories elsewhere.
  if (atom.kind === "var") return atom.name.length > 0;
  if (atom.kind === "ref") return props.uuidToName.has(atom.uuid);
  return true;
}

function onRefChipClick(atom: Atom): void {
  if (!props.clickableRefs) return;
  if (atom.kind !== "ref") return;
  if (!props.uuidToName.has(atom.uuid)) return;
  emit("ref-click", atom.uuid);
}
</script>

<template>
  <span class="wp-rtp wp-rt-preview wp-rt--rest" :class="{ 'wp-rt-preview--clickable': clickableRefs }">
    <template v-for="(atom, idx) in atoms" :key="idx">
      <RefChip
        v-if="atom.kind === 'ref'"
        :kind="'ref'"
        :name="uuidToName.get(atom.uuid) ?? ''"
        :uuid="atom.uuid"
        :sub-categories="atom.subCategories"
        :resolved="atomIsResolved(atom)"
        :class="[
          'wp-rt-ref',
          !isWildcard ? 'wp-rt-ref--ignored' : null,
          clickableRefs && atomIsResolved(atom) ? 'wp-rt-ref--clickable' : null,
        ]"
        @click="onRefChipClick(atom)"
      />
      <RefChip
        v-else-if="atom.kind === 'var'"
        :kind="'var'"
        :name="atom.name"
        :sub-categories="[]"
        :resolved="atomIsResolved(atom)"
        class="wp-rt-var"
      />
      <span v-else class="wp-rt-text wp-rtp__text">{{ atom.text }}</span>
    </template>
    <span
      v-for="w in effectiveWarnings"
      :key="`${w.position}-${w.severity}-${w.module_id}-${w.source_field}`"
      class="wp-rt-warn-marker"
      :class="`wp-rt-warn-${w.severity}`"
      :data-warning-position="w.position"
      :title="w.message"
      aria-hidden="true"
    />
  </span>
</template>

<style scoped>
.wp-rtp {
  display: inline;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--wp-text);
}
.wp-rtp__text {
  white-space: pre-wrap;
}
</style>
