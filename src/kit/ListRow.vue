<script setup lang="ts">
/**
 * One row of a list you click through: a facet ("portrait 12"), a child in a
 * bundle's list, a category in a tree, a dependency that opens its page. The
 * whole row is the target, full width, with an optional icon (or `#start`
 * for anything else, e.g. a KindChip), a label, a second `description` line,
 * and a `count` or `#end` at the right; `arrow` adds a "goes somewhere"
 * arrow that moves on hover.
 *
 *   <ListRow :selected="tag === t" toggle icon="tag" :count="12" @click="pick(t)">portrait</ListRow>
 *   <ListRow :selected="current === c.key" :icon="kindIcon(c.type)" :description="summary(c)" :muted="!c.enabled">{{ c.name }}</ListRow>
 *   <ListRow :as="RouterLink" :to="`/p/${dep.slug}`" arrow><template #start><KindChip … /></template>{{ dep.slug }}</ListRow>
 *
 * `selected` marks the row in the accent with a bar on its left. A row that
 * turns a filter on and off says so with `aria-pressed` (pass `toggle`);
 * otherwise a selected row is `aria-current`, the one being shown. `muted`
 * dims a row that is still clickable (a child that is switched off);
 * `disabled` stops it. `depth` indents a row for a simple tree.
 *
 * ArrowUp / ArrowDown / Home / End move between the rows of the same list:
 * the nearest ancestor with `data-wp-rows` (put it on the outer element of a
 * nested tree), else the row's parent. It reads only the shared tokens, so it
 * works on a page and on the canvas.
 */
import { computed, useSlots, type Component } from "vue";
import Icon from "./Icon.vue";

const props = withDefaults(defineProps<{
  /** What to render: a button (default), `"a"`, or a link component such as RouterLink. */
  as?: string | Component | undefined;
  selected?: boolean | undefined;
  /** The row turns something on and off: `aria-pressed` instead of `aria-current`. */
  toggle?: boolean | undefined;
  /** PrimeIcons name (`tag` or `pi-tag`) before the label. */
  icon?: string | undefined;
  /** Colour of the icon: any CSS colour. */
  iconColor?: string | undefined;
  /** A second, smaller line under the label. */
  description?: string | undefined;
  count?: number | string | undefined;
  /** An arrow at the right end, for a row that opens another page. */
  arrow?: boolean | undefined;
  /** Dim the row; it stays clickable. */
  muted?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Indent level for a simple tree (0 = top). */
  depth?: number | undefined;
  size?: "sm" | "md" | undefined;
}>(), { as: "button", size: "md", depth: 0 });

const slots = useSlots();
const isButton = computed(() => props.as === "button");

const aria = computed(() => {
  const a: Record<string, string | boolean | undefined> = {};
  if (props.toggle) a["aria-pressed"] = !!props.selected;
  else if (props.selected) a["aria-current"] = "true";
  if (props.disabled && !isButton.value) a["aria-disabled"] = "true";
  return a;
});

const style = computed(() => {
  const s: Record<string, string> = {};
  if (props.depth) s["--wp-list-row-depth"] = String(props.depth);
  if (props.iconColor) s["--wp-list-row-icon"] = props.iconColor;
  return Object.keys(s).length ? s : undefined;
});

function onKey(e: KeyboardEvent): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const el = e.currentTarget as HTMLElement;
  const list = el.closest("[data-wp-rows]") ?? el.parentElement;
  if (!list) return;
  const rows = Array.from(list.querySelectorAll<HTMLElement>(".wp-list-row"))
    .filter((r) => !r.matches(":disabled, [aria-disabled='true']"));
  const at = rows.indexOf(el);
  if (at < 0) return;
  const next = e.key === "Home" ? 0
    : e.key === "End" ? rows.length - 1
    : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1)
    : Math.max(0, at - 1);
  e.preventDefault();
  rows[next]?.focus();
}

function onClick(e: MouseEvent): void {
  // A link can't be disabled natively; stop it here.
  if (props.disabled && !isButton.value) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
</script>

<template>
  <component
    :is="as"
    class="wp-list-row"
    :class="[`wp-list-row--${size}`, { 'wp-list-row--muted': muted, 'wp-list-row--two-line': !!description || !!slots.description }]"
    :type="isButton ? 'button' : undefined"
    :disabled="isButton ? disabled : undefined"
    :data-selected="selected || undefined"
    :style="style"
    v-bind="aria"
    @keydown="onKey"
    @click.capture="onClick"
  >
    <span v-if="slots.start" class="wp-list-row__start"><slot name="start" /></span>
    <Icon v-else-if="icon" class="wp-list-row__icon" :name="icon" />
    <span class="wp-list-row__main">
      <span class="wp-list-row__label"><slot /></span>
      <span v-if="description || slots.description" class="wp-list-row__desc">
        <slot name="description">{{ description }}</slot>
      </span>
    </span>
    <span v-if="count !== undefined" class="wp-list-row__count">{{ count }}</span>
    <span v-if="slots.end" class="wp-list-row__end"><slot name="end" /></span>
    <Icon v-if="arrow" class="wp-list-row__arrow" name="arrow-right" />
  </component>
</template>

<style scoped>
.wp-list-row {
  --wp-list-row-icon: var(--wp-text-muted);
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  box-sizing: border-box;
  width: 100%;
  min-height: var(--wp-control-h-md);
  margin: 0;
  padding: var(--wp-space-2) var(--wp-space-4);
  padding-left: calc(var(--wp-space-4) + var(--wp-list-row-depth, 0) * var(--wp-space-6));
  border: 0;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: transparent;
  color: var(--wp-text);
  font: inherit;
  font-family: var(--wp-font-sans);
  font-size: var(--wp-text-sm);
  line-height: 1.35;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--wp-motion-quick) ease, color var(--wp-motion-quick) ease;
}
.wp-list-row--sm {
  min-height: var(--wp-control-h-sm);
  padding-top: var(--wp-space-1);
  padding-bottom: var(--wp-space-1);
  gap: var(--wp-space-2);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
}
.wp-list-row--two-line { align-items: flex-start; }
.wp-list-row:hover:not(:disabled) { background: var(--wp-row-hover); color: var(--wp-text); }
.wp-list-row:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-list-row:disabled, .wp-list-row[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
.wp-list-row--muted { opacity: 0.55; }
.wp-list-row[data-selected] {
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  box-shadow: inset 2px 0 var(--wp-accent-500);
  color: var(--wp-accent-text-strong);
}
.wp-list-row[data-selected]:focus-visible { box-shadow: inset 2px 0 var(--wp-accent-500), var(--wp-focus-ring); }
.wp-list-row__icon {
  flex: none;
  width: 1.1em;
  font-size: 0.9em;
  text-align: center;
  color: var(--wp-list-row-icon);
}
.wp-list-row--two-line .wp-list-row__icon { padding-top: 0.25em; }
.wp-list-row[data-selected] .wp-list-row__icon { color: var(--wp-accent-text); }
.wp-list-row__start { display: inline-flex; align-items: center; flex: none; }
.wp-list-row__main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.wp-list-row__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-list-row__desc {
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  overflow-wrap: anywhere;
}
.wp-list-row__count {
  flex: none;
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  font-variant-numeric: tabular-nums;
}
.wp-list-row[data-selected] .wp-list-row__count { color: inherit; }
.wp-list-row__end { display: inline-flex; align-items: center; gap: var(--wp-space-2); flex: none; }
.wp-list-row__arrow {
  flex: none;
  align-self: center;
  font-size: 0.85em;
  color: var(--wp-text-dim);
  transition: transform var(--wp-motion-quick) ease, color var(--wp-motion-quick) ease;
}
.wp-list-row:hover .wp-list-row__arrow { color: var(--wp-accent-text); transform: translateX(2px); }
@media (prefers-reduced-motion: reduce) {
  .wp-list-row, .wp-list-row__arrow { transition: none; }
  .wp-list-row:hover .wp-list-row__arrow { transform: none; }
}
</style>
