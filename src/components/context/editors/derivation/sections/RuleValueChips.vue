<script setup lang="ts">
/**
 * RuleValueChips — read-only chip renderer for a derivation rule's
 * action.value / condition.value strings in the canvas instance-modal
 * summary. Thin wrapper over the shared {@link RichTextPreview}: it owns only
 * the empty-value placeholder; all token rendering (var/ref chips at EVERY
 * brace depth, brace/escape scaffolding) delegates to RichTextPreview so a
 * value like `{@{a}|@{b}}` chips its inner refs instead of leaking raw hex.
 *
 * Previously this hand-rolled a `tokenizeRich` loop that emitted `dp-brace`
 * blocks as `{{ tok.raw }}` — so nested `@{}` / `$var` inside `{a|b}` never
 * chipped (issue #1). Consolidating on RichTextPreview (which decomposes
 * braces via `atomicEditorModel.parse` and renders every chip as `RefChip`)
 * fixes that AND means one hover/click surface for all chips.
 *
 * `surface="wildcard"` so refs render as ACTIVE purple chips (derivation
 * action values are `@{}` carriers — the engine resolves them), matching the
 * prior appearance; `$var` reads still render as green var chips.
 */
import { computed } from "vue";
import RichTextPreview from "../../../../../manager/components/RichTextPreview.vue";

const props = withDefaults(
  defineProps<{
    value?: string;
    /** UUID → display name, from the modal's catalog fetch. Forwarded to
     *  RichTextPreview so ref chips show the human label. */
    uuidToName?: ReadonlyMap<string, string>;
    /** Label for the empty state. Defaults to "empty" — an empty value is a
     *  VALID derivation action (replace-with-nothing), so it must read as an
     *  intentional empty, NOT the `?` that looked like a failed resolve. */
    placeholder?: string;
  }>(),
  { value: "", uuidToName: () => new Map(), placeholder: "empty" },
);

const isEmpty = computed(() => (props.value ?? "").length === 0);
</script>

<template>
  <span class="rvc">
    <!-- Empty is a first-class, VALID state (replace $var with ""). Render a
         muted ∅ pill — visually distinct from both a real value (chips) and an
         unresolved/broken ref (red) — so it never reads as "didn't resolve". -->
    <span
      v-if="isEmpty"
      class="rvc__empty"
      title="Replaced with an empty value"
      data-test="rvc-empty"
    >
      <span class="rvc__empty-glyph" aria-hidden="true">∅</span>{{ placeholder }}
    </span>
    <RichTextPreview
      v-else
      :value="value"
      :uuid-to-name="uuidToName"
      surface="wildcard"
    />
  </span>
</template>

<style scoped>
.rvc {
  display: inline;
}
.rvc__empty {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 0 5px;
  border: 1px dashed color-mix(in srgb, var(--wp-text-dim, var(--wp-text3)) 45%, transparent);
  border-radius: 3px;
  color: var(--wp-text-dim, var(--wp-text3));
  font: italic 10px/1.4 var(--wp-font-mono);
  letter-spacing: 0.02em;
}
.rvc__empty-glyph {
  font-size: 9px;
  font-style: normal;
  opacity: 0.8;
}
</style>
