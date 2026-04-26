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
  onSelect: () => void;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const activeIndex = ref(-1);

function pickableIndices(): number[] {
  const out: number[] = [];
  for (let i = 0; i < props.items.length; i++) {
    const it = props.items[i];
    if (!it.disabled) out.push(i);
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
      if (it && !it.disabled) pick(it);
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
      <template v-for="(it, i) in items" :key="i">
        <li v-if="it.divider" class="wp-ctxmenu__sep" aria-hidden="true"></li>
        <li
          class="wp-ctxmenu__item"
          :class="{
            'wp-ctxmenu__item--danger': it.danger,
            'wp-ctxmenu__item--disabled': it.disabled,
            'wp-ctxmenu__item--active': activeIndex === i,
          }"
          role="menuitem"
          :aria-disabled="it.disabled || undefined"
          @mouseenter="!it.disabled && (activeIndex = i)"
          @click="pick(it)"
        >
          <i v-if="it.icon" :class="['pi', it.icon, 'wp-ctxmenu__icon']" aria-hidden="true"></i>
          <span v-else class="wp-ctxmenu__icon-spacer" aria-hidden="true"></span>
          <span class="wp-ctxmenu__label">{{ it.label }}</span>
        </li>
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
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  padding: 4px 0;
  min-width: 180px;
  list-style: none;
  margin: 0;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  user-select: none;
}
.wp-ctxmenu__item {
  padding: 5px 12px;
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
}
.wp-ctxmenu__label { flex: 1; }
.wp-ctxmenu__sep {
  height: 1px;
  background: var(--wp-border);
  margin: 4px 0;
}
</style>
