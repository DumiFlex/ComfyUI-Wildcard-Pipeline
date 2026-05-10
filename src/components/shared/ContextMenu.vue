<script setup lang="ts">
import { onBeforeUnmount, ref, watch, nextTick } from "vue";

export interface ContextMenuItem {
  label: string;
  /** PrimeIcons class (e.g. "pi-trash"). ComfyUI loads PrimeIcons globally. */
  icon?: string;
  /** Optional separator above the item. */
  divider?: boolean;
  /** Render the label in red (destructive action). */
  danger?: boolean;
  disabled?: boolean;
  /** Optional dim secondary line under the label. Useful for
   *  explaining non-obvious actions like "Pull current library
   *  version" or "Restore frozen state from bundle". When provided,
   *  the row becomes two-line and uses more vertical space. */
  subtitle?: string;
  onSelect: () => void;
}

/** Section labels group related items inside a single menu. Renders
 *  as an uppercase, dim, non-interactive separator above the items
 *  that follow. Distinguished from `ContextMenuItem` at type level
 *  by the absence of `onSelect`. */
export interface ContextMenuSection {
  section: string;
}

/** Optional header rendered at the top of the menu — kind icon + a
 *  scope label like "Bundle · subject_phrase". Tells the user WHICH
 *  entity the menu is for. Color of the icon can be overridden per
 *  invocation (e.g. bundle's user-picked color, or a kind token). */
export interface ContextMenuHeader {
  icon?: string;
  label: string;
  iconColor?: string;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSection;

function isSection(e: ContextMenuEntry): e is ContextMenuSection {
  return "section" in e;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
  header?: ContextMenuHeader;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const activeIndex = ref(-1);

function pickableIndices(): number[] {
  const out: number[] = [];
  for (let i = 0; i < props.items.length; i++) {
    const e = props.items[i];
    if (isSection(e)) continue;
    if (!e.disabled) out.push(i);
  }
  return out;
}

function moveActive(delta: 1 | -1) {
  const idxs = pickableIndices();
  if (!idxs.length) return;
  const cur = idxs.indexOf(activeIndex.value);
  const next = cur < 0 ? (delta > 0 ? 0 : idxs.length - 1) : (cur + delta + idxs.length) % idxs.length;
  activeIndex.value = idxs[next];
}

function gotoEdge(edge: "first" | "last") {
  const idxs = pickableIndices();
  if (!idxs.length) return;
  activeIndex.value = edge === "first" ? idxs[0] : idxs[idxs.length - 1];
}

function onWindowClick() {
  emit("close");
}

function onKey(ev: KeyboardEvent) {
  switch (ev.key) {
    case "Escape": ev.preventDefault(); emit("close"); break;
    case "ArrowDown": ev.preventDefault(); moveActive(1); break;
    case "ArrowUp": ev.preventDefault(); moveActive(-1); break;
    case "Home": ev.preventDefault(); gotoEdge("first"); break;
    case "End": ev.preventDefault(); gotoEdge("last"); break;
    case "Enter":
    case " ": {
      ev.preventDefault();
      const it = props.items[activeIndex.value];
      if (it && !isSection(it) && !it.disabled) pick(it);
      break;
    }
  }
}

watch(() => props.visible, async (v) => {
  if (v) {
    activeIndex.value = -1;
    window.addEventListener("click", onWindowClick);
    window.addEventListener("keydown", onKey);
    // Defer one tick so the click that opened the menu doesn't immediately
    // close it — and so the first ArrowDown lands on the first item.
    await nextTick();
  } else {
    window.removeEventListener("click", onWindowClick);
    window.removeEventListener("keydown", onKey);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("click", onWindowClick);
  window.removeEventListener("keydown", onKey);
});

function pick(item: ContextMenuItem) {
  if (item.disabled) return;
  item.onSelect();
  emit("close");
}

function isSectionEntry(entry: ContextMenuEntry): entry is ContextMenuSection {
  return isSection(entry);
}
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="visible"
      class="wp-ctxmenu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      role="menu"
      @click.stop
      @contextmenu.prevent
    >
      <!-- Header — kind icon + scope label, only renders when prop provided.
           Non-interactive — divider between header and items handled by
           the `.wp-ctxmenu__header` border-bottom. -->
      <li v-if="header" class="wp-ctxmenu__header" aria-hidden="true">
        <i
          v-if="header.icon"
          :class="['pi', header.icon, 'wp-ctxmenu__header-icon']"
          :style="header.iconColor ? { color: header.iconColor } : {}"
        ></i>
        <span class="wp-ctxmenu__header-label">{{ header.label }}</span>
      </li>

      <template v-for="(entry, i) in items" :key="i">
        <!-- Section label — uppercase dim title, groups items semantically. -->
        <li v-if="isSectionEntry(entry)" class="wp-ctxmenu__section" aria-hidden="true">
          {{ entry.section }}
        </li>
        <!-- Item action — same shape as before plus optional subtitle. -->
        <template v-else>
          <li v-if="entry.divider" class="wp-ctxmenu__sep" aria-hidden="true"></li>
          <li
            class="wp-ctxmenu__item"
            :class="{
              'wp-ctxmenu__item--danger': entry.danger,
              'wp-ctxmenu__item--disabled': entry.disabled,
              'wp-ctxmenu__item--active': activeIndex === i,
              'wp-ctxmenu__item--with-sub': !!entry.subtitle,
            }"
            role="menuitem"
            :aria-disabled="entry.disabled || undefined"
            @mouseenter="!entry.disabled && (activeIndex = i)"
            @click="pick(entry)"
          >
            <i v-if="entry.icon" :class="['pi', entry.icon, 'wp-ctxmenu__icon']" aria-hidden="true"></i>
            <span v-else class="wp-ctxmenu__icon-spacer" aria-hidden="true"></span>
            <span class="wp-ctxmenu__text">
              <span class="wp-ctxmenu__title">{{ entry.label }}</span>
              <span v-if="entry.subtitle" class="wp-ctxmenu__sub">{{ entry.subtitle }}</span>
            </span>
          </li>
        </template>
      </template>
    </ul>
  </Teleport>
</template>

<style>
@import "./theme.css";
</style>

<style scoped>
.wp-ctxmenu {
  position: fixed;
  z-index: 10000;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  box-shadow: var(--wp-shadow-sm, 0 4px 16px rgba(0, 0, 0, 0.5));
  /* Tighter padding than the old 4px-0 to match the v2 mockup. Items
   * carry their own 6px padding + rounded corners so the menu reads
   * as a stack of pills, not a flat list. */
  padding: 4px;
  /* Bumped from 180px to 250px — subtitles wrap awkwardly at narrower
   * widths. Existing callers without subtitles still fit comfortably. */
  min-width: 250px;
  list-style: none;
  margin: 0;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  user-select: none;
}
/* Header — scope label at the top of the menu. Border-bottom acts as
 * a divider between header and the first item. */
.wp-ctxmenu__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 4px 8px;
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  margin-bottom: 4px;
}
.wp-ctxmenu__header-icon {
  font-size: 12px;
  width: 14px;
  text-align: center;
}
/* Section label — non-interactive uppercase tag separating groups of
 * related items. Smaller + dimmer than the header label so the
 * header still reads as the primary scope and sections read as
 * subdivisions. */
.wp-ctxmenu__section {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text3);
  padding: 6px 8px 4px 8px;
}
.wp-ctxmenu__item {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-ctxmenu__item--active,
.wp-ctxmenu__item:hover { background: var(--wp-accent-glow); color: var(--wp-accent); }
.wp-ctxmenu__item--danger { color: var(--wp-red); }
.wp-ctxmenu__item--danger.wp-ctxmenu__item--active,
.wp-ctxmenu__item--danger:hover { background: var(--wp-red-bg); color: var(--wp-red); }
.wp-ctxmenu__item--disabled {
  color: var(--wp-text3);
  cursor: not-allowed;
}
.wp-ctxmenu__item--disabled:hover { background: transparent; color: var(--wp-text3); }
.wp-ctxmenu__icon,
.wp-ctxmenu__icon-spacer {
  width: 14px;
  font-size: 11px;
  text-align: center;
  flex-shrink: 0;
  /* Align with title baseline when subtitle is present (two-line layout). */
  align-self: flex-start;
  margin-top: 1px;
}
.wp-ctxmenu__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.wp-ctxmenu__title {
  font: 500 12px/1.2 var(--wp-font-sans);
  color: inherit;
}
.wp-ctxmenu__sub {
  color: var(--wp-text-dim, var(--wp-text3));
  font: 400 10px/1.3 var(--wp-font-sans);
  white-space: normal;
}
.wp-ctxmenu__sep {
  height: 1px;
  background: var(--wp-border-soft, var(--wp-border));
  margin: 4px 6px;
}
</style>
