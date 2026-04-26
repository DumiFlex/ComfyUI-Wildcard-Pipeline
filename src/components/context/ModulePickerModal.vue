<template>
  <ModalShell :visible="visible" @close="$emit('close')">
    <div class="wp-picker">
      <header class="wp-picker__head">
        <Logo :size="32" />
        <div class="wp-picker__head-text">
          <div class="wp-picker__title">Add module</div>
          <div class="wp-picker__subtitle">Composable prompt context for ComfyUI</div>
        </div>
        <button type="button" class="wp-picker__close" aria-label="Close" @click="$emit('close')">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <div class="wp-picker__body">
        <button
          v-for="kind in kinds"
          :key="kind.type"
          type="button"
          class="wp-picker__item"
          :data-testid="`pick-${kind.type}`"
          @click="$emit('select', kind.type)"
        >
          <div class="wp-picker__item-row">
            <i
              :class="['pi', kind.icon, 'wp-picker__item-icon']"
              :style="{ color: kind.color }"
              aria-hidden="true"
            ></i>
            <span class="wp-picker__item-name">{{ kind.label }}</span>
          </div>
          <div class="wp-picker__item-desc">{{ kind.description }}</div>
        </button>
      </div>
    </div>
  </ModalShell>
</template>

<script setup lang="ts">
import ModalShell from "../shared/ModalShell.vue";
import Logo from "../shared/Logo.vue";

defineProps<{ visible: boolean }>();
defineEmits<{ (e: "select", type: "fixed_values"): void; (e: "close"): void }>();

// MVP only ships fixed_values. New types append here; the type-icon mapping
// lives in shared/theme.css comments + this kinds array (color via CSS class
// per type, icon via PrimeIcons name).
const kinds = [
  {
    type: "fixed_values" as const,
    label: "Fixed values",
    icon: "pi-tag",
    color: "var(--wp-rose)",
    description: "Hard-coded $variable = value pairs.",
  },
];
</script>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-picker {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  width: 480px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
}
.wp-picker__head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient);
  background-size: 200% 200%;
  position: relative;
}
.wp-picker__head::after {
  /* Translucent overlay so the gradient sits behind a dark wash — same
   * effect as the rest of the modal but with a hint of brand color. */
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.wp-picker__head > * { position: relative; z-index: 1; }
.wp-picker__head-text { flex: 1; min-width: 0; }
.wp-picker__title {
  font-size: 14px;
  font-weight: 600;
}
.wp-picker__subtitle {
  font-size: 11px;
  color: var(--wp-text2);
  margin-top: 2px;
}
.wp-picker__close {
  background: none;
  border: none;
  color: var(--wp-text3);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
}
.wp-picker__close:hover { color: var(--wp-text); }

.wp-picker__body {
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wp-picker__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  color: var(--wp-text);
  transition: all 0.15s;
}
.wp-picker__item:hover {
  border-color: var(--wp-accent);
  background: var(--wp-bg4);
}
.wp-picker__item-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wp-picker__item-icon {
  font-size: 14px;
  color: var(--wp-text2);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.wp-picker__item-name {
  font-size: 13px;
  font-weight: 600;
}
.wp-picker__item-desc {
  font-size: 11px;
  color: var(--wp-text2);
  padding-left: 26px;
}
</style>
