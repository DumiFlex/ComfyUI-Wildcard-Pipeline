<script setup lang="ts" generic="T extends string">
/**
 * Tabs: a row of tabs that switch the panel under them. Works on the canvas
 * (`size="sm"`) and in the manager (`md`, the default).
 *
 * Keyboard follows the APG tabs pattern with automatic activation: only the
 * current tab is in the Tab order, the arrow keys move to the next enabled
 * tab and select it, Home/End jump to the ends. A row too wide for its box
 * scrolls sideways and keeps the current tab in view.
 *
 *   <WpTabs v-model="tab" :tabs="[{ id: 'options', label: 'Options', count: 12 }]" aria-label="Editor sections">
 *     <template #panel="{ id }">…</template>
 *   </WpTabs>
 *
 * Leave out `#panel` when the panels live elsewhere; give them
 * `:id="panelId(tab)"`-style wiring yourself or let the tabs stand alone.
 */
import { nextTick, ref, useId, useSlots } from "vue";

export interface TabItem<I extends string = string> {
  id: I;
  label: string;
  /** A PrimeIcons class, e.g. `pi-list`. */
  icon?: string;
  disabled?: boolean;
  /** A small count after the label (rows, errors…). */
  count?: number | string;
  /** Colour of the count: `success` for all good, `warn` for problems. */
  tone?: "neutral" | "success" | "warn" | "danger";
}

const props = withDefaults(defineProps<{
  modelValue: T;
  tabs: TabItem<T>[];
  size?: "sm" | "md";
  ariaLabel?: string;
  /** `data-test` of each tab is `<testPrefix>-<id>`. */
  testPrefix?: string;
}>(), { size: "md" });

const emit = defineEmits<{ (e: "update:modelValue", id: T): void }>();
const slots = useSlots();

const uid = `wp-tabs-${useId()}`;
const tabId = (id: string): string => `${uid}-tab-${id}`;
const panelId = (id: string): string => `${uid}-panel-${id}`;
const listEl = ref<HTMLElement | null>(null);

function select(id: T): void {
  if (id !== props.modelValue) emit("update:modelValue", id);
}

function focusTab(id: string): void {
  void nextTick(() => {
    const i = props.tabs.findIndex((t) => t.id === id);
    const el = listEl.value?.querySelectorAll<HTMLElement>("[role=tab]")[i];
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });
}

/** The tab that takes Tab focus: the current one, else the first enabled. */
function tabStop(): T | undefined {
  const enabled = props.tabs.filter((t) => !t.disabled);
  return (enabled.find((t) => t.id === props.modelValue) ?? enabled[0])?.id;
}

function onKeydown(ev: KeyboardEvent): void {
  const enabled = props.tabs.filter((t) => !t.disabled);
  if (!enabled.length) return;
  const at = enabled.findIndex((t) => t.id === props.modelValue);
  let next: number;
  switch (ev.key) {
    case "ArrowRight": next = (at + 1) % enabled.length; break;
    case "ArrowLeft": next = at < 0 ? enabled.length - 1 : (at - 1 + enabled.length) % enabled.length; break;
    case "Home": next = 0; break;
    case "End": next = enabled.length - 1; break;
    default: return;
  }
  ev.preventDefault();
  const id = enabled[next].id;
  select(id);
  focusTab(id);
}
</script>

<template>
  <div class="wp-tabset" :data-size="size">
    <div
      ref="listEl"
      class="wp-tabset__list"
      role="tablist"
      :aria-label="ariaLabel"
    >
      <button
        v-for="t in tabs"
        :id="tabId(t.id)"
        :key="t.id"
        type="button"
        role="tab"
        class="wp-tabset__tab"
        :aria-selected="t.id === modelValue"
        :aria-controls="slots.panel ? panelId(t.id) : undefined"
        :tabindex="t.id === tabStop() ? 0 : -1"
        :disabled="t.disabled"
        :data-active="t.id === modelValue"
        :data-test="testPrefix ? `${testPrefix}-${t.id}` : undefined"
        @click="select(t.id)"
        @keydown="onKeydown"
      >
        <slot name="tab" :tab="t" :active="t.id === modelValue">
          <i v-if="t.icon" class="pi" :class="t.icon" aria-hidden="true" />
          <span>{{ t.label }}</span>
          <span v-if="t.count !== undefined" class="wp-tabset__count" :data-tone="t.tone">{{ t.count }}</span>
        </slot>
      </button>
    </div>
    <div
      v-if="slots.panel"
      :id="panelId(modelValue)"
      class="wp-tabset__panel"
      role="tabpanel"
      :aria-labelledby="tabId(modelValue)"
      tabindex="0"
    >
      <slot :id="modelValue" name="panel" />
    </div>
  </div>
</template>

<style scoped>
.wp-tabset { display: flex; flex-direction: column; min-width: 0; }
.wp-tabset__list {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--wp-border);
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--wp-scrollbar-thumb) transparent;
}
.wp-tabset__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: var(--wp-control-h-md);
  margin: 0 0 -1px;
  padding: 0 var(--wp-space-5);
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--wp-text-muted);
  font: 500 var(--wp-text-sm)/1 var(--wp-font-sans);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--wp-motion-hover), border-color var(--wp-motion-hover);
}
.wp-tabset[data-size="sm"] .wp-tabset__tab {
  height: var(--wp-control-h-sm);
  padding: 0 var(--wp-space-4);
  font-size: var(--wp-text-xs);
  gap: 4px;
}
.wp-tabset__tab:hover:not(:disabled) { color: var(--wp-text); }
.wp-tabset__tab[data-active="true"] { color: var(--wp-text); border-bottom-color: var(--wp-accent-400); }
.wp-tabset__tab:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--wp-border-focus); border-radius: var(--wp-radius-sm); }
.wp-tabset__tab:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-tabset__tab .pi { font-size: 0.95em; }
.wp-tabset__count {
  min-width: 16px;
  padding: 1px 5px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.wp-tabset__tab[data-active="true"] .wp-tabset__count { background: var(--wp-accent-glow); color: var(--wp-accent-text); }
.wp-tabset__count[data-tone="success"] { background: color-mix(in srgb, var(--wp-success) 16%, transparent); color: var(--wp-success); }
.wp-tabset__count[data-tone="warn"] { background: color-mix(in srgb, var(--wp-warn) 16%, transparent); color: var(--wp-warn); }
.wp-tabset__count[data-tone="danger"] { background: color-mix(in srgb, var(--wp-danger) 16%, transparent); color: var(--wp-danger); }
.wp-tabset__panel { min-width: 0; }
.wp-tabset__panel:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); border-radius: var(--wp-radius-sm); }
@media (prefers-reduced-motion: reduce) {
  .wp-tabset__tab { transition: none; }
}
</style>
