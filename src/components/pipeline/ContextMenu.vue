<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuEl"
      class="wp-context-menu"
      :style="{ left: adjustedX + 'px', top: adjustedY + 'px' }"
      @mousedown.stop
    >
      <template v-for="(item, i) in items" :key="i">
        <hr v-if="item.separator" class="wp-context-sep" />
        <button
          v-else
          type="button"
          class="wp-context-item"
          :class="{ disabled: item.disabled }"
          :disabled="item.disabled"
          @click="onItemClick(item)"
        >
          <span v-if="item.icon" class="wp-context-icon">{{ item.icon }}</span>
          <span class="wp-context-label">{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'

export interface ContextMenuItem {
  label: string
  action: string
  disabled?: boolean
  separator?: boolean
  icon?: string
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', action: string): void
  (e: 'close'): void
}>()

const menuEl = ref<HTMLElement | null>(null)
const adjustedX = ref(0)
const adjustedY = ref(0)

function onItemClick(item: ContextMenuItem) {
  if (item.disabled || item.separator) return
  emit('select', item.action)
  emit('close')
}

function onDocMouseDown(e: MouseEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) {
    emit('close')
  }
}

function onDocScroll() {
  emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.visible,
  async (val) => {
    if (val) {
      adjustedX.value = props.x
      adjustedY.value = props.y
      document.addEventListener('mousedown', onDocMouseDown)
      document.addEventListener('scroll', onDocScroll, true)
      document.addEventListener('keydown', onKeyDown)
      await nextTick()
      if (menuEl.value) {
        const rect = menuEl.value.getBoundingClientRect()
        if (rect.right > window.innerWidth) {
          adjustedX.value = props.x - rect.width
        }
        if (rect.bottom > window.innerHeight) {
          adjustedY.value = props.y - rect.height
        }
      }
    } else {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('scroll', onDocScroll, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }
)

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  document.removeEventListener('scroll', onDocScroll, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.wp-context-menu, .wp-context-menu * {
  box-sizing: border-box;
}

.wp-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 4px 0;
  font-family: var(--wp-font-sans);
  font-size: 12px;
  color: var(--wp-text);
  user-select: none;
}

.wp-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  color: var(--wp-text);
  font-family: var(--wp-font-sans);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s;
}

.wp-context-item:hover:not(.disabled) {
  background: var(--wp-bg4);
  color: var(--wp-accent);
}

.wp-context-item.disabled {
  opacity: 0.4;
  pointer-events: none;
  cursor: default;
}

.wp-context-icon {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 12px;
}

.wp-context-label {
  flex: 1;
}

.wp-context-sep {
  margin: 4px 0;
  border: none;
  border-top: 1px solid var(--wp-border);
}
</style>
