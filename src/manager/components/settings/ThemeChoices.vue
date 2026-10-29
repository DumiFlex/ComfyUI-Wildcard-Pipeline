<script setup lang="ts">
/**
 * The Colours and Look pickers: a radio group of small cards. `kind="palette"`
 * shows each colour theme's page, card and accent in the current mode;
 * `kind="look"` draws a tiny button, chip and panel in each look's shape,
 * wearing the current colours. Used by Settings › Appearance and the Tweaks
 * panel (`compact`).
 */
import { computed } from "vue";
import ChoiceCards, { type ChoiceCardOption } from "../../../kit/ChoiceCards.vue";
import {
  LOOK_OPTIONS,
  PALETTE_OPTIONS,
  useTweaksStore,
  type LookName,
  type PaletteName,
} from "../../stores/tweaksStore";
import { useUiStore } from "../../stores/uiStore";

const props = defineProps<{ kind: "palette" | "look"; compact?: boolean; testPrefix?: string }>();

const tweaks = useTweaksStore();
const ui = useUiStore();

/** How each look's mini drawing is shaped. Mirrors kit/theme/looks.css. */
const LOOK_SHAPE: Record<LookName, { radius: string; pill: string; font: string; border: string; shadow: string; title: string }> = {
  orbit:     { radius: "6px", pill: "6px",   font: "var(--wp-font)",      border: "1px solid var(--wp-border)",        shadow: "none",               title: "Aa" },
  crisp:     { radius: "2px", pill: "2px",   font: "var(--wp-font)",      border: "1px solid var(--wp-border-strong)", shadow: "none",               title: "Aa" },
  soft:      { radius: "12px", pill: "999px", font: "Manrope, var(--wp-font)", border: "1px solid transparent",    shadow: "var(--wp-shadow-md)", title: "Aa" },
  terminal:  { radius: "0",   pill: "0",     font: "var(--wp-font-mono)", border: "1px dashed var(--wp-border-strong)", shadow: "none",              title: "$_" },
  editorial: { radius: "0",   pill: "4px",   font: "Fraunces, Georgia, serif", border: "0",                         shadow: "none",               title: "Aa" },
  compact:   { radius: "4px", pill: "4px",   font: "var(--wp-font)",      border: "1px solid var(--wp-border)",        shadow: "none",               title: "Aa" },
  tui:       { radius: "0",   pill: "0",     font: "var(--wp-font-mono)", border: "1px solid var(--wp-border-strong)", shadow: "none",               title: "[x]" },
};

const choices = computed<ChoiceCardOption[]>(() => {
  if (props.kind === "palette") {
    return PALETTE_OPTIONS.map((p) => {
      const [page, card, accent] = p.swatch[ui.resolvedTheme];
      return { value: p.id, label: p.label, hint: p.hint, style: { "--sw-page": page, "--sw-card": card, "--sw-accent": accent } };
    });
  }
  return LOOK_OPTIONS.map((l) => {
    const s = LOOK_SHAPE[l.id];
    return {
      value: l.id, label: l.label, hint: l.hint,
      style: { "--lk-radius": s.radius, "--lk-pill": s.pill, "--lk-font": s.font, "--lk-border": s.border, "--lk-shadow": s.shadow },
    };
  });
});

const current = computed(() => (props.kind === "palette" ? tweaks.palette : tweaks.look));

function title(id: string): string {
  return LOOK_SHAPE[id as LookName]?.title ?? "Aa";
}

function pick(id: string): void {
  if (props.kind === "palette") tweaks.setPalette(id as PaletteName);
  else tweaks.setLook(id as LookName);
}
</script>

<template>
  <ChoiceCards
    :model-value="current"
    :options="choices"
    :compact="compact"
    :aria-label="kind === 'palette' ? 'Colours' : 'Look'"
    :test-prefix="testPrefix ?? kind"
    @update:model-value="pick"
  >
    <template #preview="{ option }">
      <span v-if="kind === 'palette'" class="wp-theme-choice__swatch" aria-hidden="true" data-look-exempt>
        <span class="wp-theme-choice__bar" />
        <span class="wp-theme-choice__dot" />
      </span>
      <span v-else class="wp-theme-choice__look" aria-hidden="true" data-look-exempt>
        <span class="wp-theme-choice__panel">{{ title(option.value) }}</span>
        <span class="wp-theme-choice__btn" />
        <span class="wp-theme-choice__chip" />
      </span>
    </template>
  </ChoiceCards>
</template>

<style scoped>
/* Palette swatch: the theme's page, a card bar and its accent. */
.wp-theme-choice__swatch {
  position: relative;
  display: block;
  height: 40px;
  border-radius: var(--wp-radius-sm);
  background: var(--sw-page);
  border: 1px solid var(--wp-border);
  overflow: hidden;
}
.wp-choice-cards--compact .wp-theme-choice__swatch { height: 28px; }
.wp-theme-choice__bar {
  position: absolute;
  left: 8px; right: 34px; top: 9px;
  height: 8px;
  border-radius: 4px; /* audit-exempt: a palette preview, same in every look */
  background: var(--sw-card);
}
.wp-theme-choice__dot {
  position: absolute;
  right: 8px; bottom: 7px;
  width: 20px; height: 11px;
  border-radius: 4px; /* audit-exempt: a palette preview, same in every look */
  background: var(--sw-accent);
}

/* Look drawing: a panel, a button and a chip in the look's shape. */
.wp-theme-choice__look {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 6px;
  align-items: center;
  height: 40px;
  font-family: var(--lk-font);
}
.wp-choice-cards--compact .wp-theme-choice__look { height: 28px; gap: 4px; }
.wp-theme-choice__panel {
  grid-row: 1 / 3;
  display: grid;
  place-items: center;
  height: 100%;
  border: var(--lk-border);
  border-radius: var(--lk-radius);
  box-shadow: var(--lk-shadow);
  background: var(--wp-bg-1);
  font-size: var(--wp-text-sm);
  font-weight: 600;
  color: var(--wp-text-muted);
}
.wp-theme-choice__btn {
  width: 34px; height: 14px;
  border-radius: var(--lk-pill);
  background: var(--wp-accent-600);
}
.wp-theme-choice__chip {
  width: 34px; height: 10px;
  border-radius: var(--lk-pill);
  border: var(--lk-border);
  background: var(--wp-bg-3);
}
.wp-choice-cards--compact :is(.wp-theme-choice__btn, .wp-theme-choice__chip) { width: 24px; height: 9px; }
</style>
