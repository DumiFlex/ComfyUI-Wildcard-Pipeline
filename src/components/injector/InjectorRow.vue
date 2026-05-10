<script setup lang="ts">
import { computed } from "vue";
import type { InjectorRow } from "../../widgets/_shared";

const props = defineProps<{
  row: InjectorRow;
  /** Type label from upstream connection (STRING / INT / FLOAT / *). */
  valueType?: string;
  /** True when the underlying ComfyUI socket has a live wire. False
   *  while the row exists but the connection has been severed. */
  isConnected?: boolean;
}>();

const emit = defineEmits<{
  (e: "update", patch: Partial<InjectorRow>): void;
  (e: "remove", uid: string): void;
}>();

const isEmpty = computed(() => !props.row.binding.trim());

function onBindingInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update", { binding: next });
}
</script>

<template>
  <div
    class="wp-inj-row"
    :class="{ 'wp-inj-row--disconnected': props.isConnected === false }"
  >
    <label class="wp-inj-toggle" :title="row.enabled ? 'Disable' : 'Enable'">
      <input
        type="checkbox"
        :checked="row.enabled"
        data-test="inj-row-enabled"
        :aria-label="`enable injector row ${row._uid}`"
        @change="(ev) => emit('update', { enabled: (ev.target as HTMLInputElement).checked })"
      />
      <span class="wp-inj-toggle-mark"></span>
    </label>

    <div class="wp-inj-main">
      <div class="wp-inj-binding-line">
        <input
          type="text"
          class="wp-inj-row-binding"
          :class="{ 'wp-inj-row-binding--empty': isEmpty }"
          data-test="inj-row-binding"
          :value="row.binding"
          :aria-label="`binding for ${row.slot_name}`"
          placeholder="binding…"
          spellcheck="false"
          @input="onBindingInput"
        />
        <span
          v-if="valueType"
          class="wp-inj-type-chip"
          :class="`wp-inj-type-chip--${valueType.toLowerCase()}`"
          data-test="inj-row-type"
        >{{ valueType }}</span>
        <span
          v-if="props.isConnected === false"
          data-test="inj-row-nolink"
          class="wp-inj-nolink-badge"
        >no link</span>
      </div>
    </div>

    <div class="wp-inj-actions">
      <button
        type="button"
        class="wp-inj-action"
        :class="{ 'is-active': row.internal }"
        data-test="inj-row-internal"
        :title="row.internal ? 'Internal flag active — hidden from assembler chip strip' : 'Mark internal — hide from assembler chip strip'"
        @click="emit('update', { internal: !row.internal })"
      ><i class="pi pi-globe" aria-hidden="true" /></button>
      <button
        type="button"
        class="wp-inj-action wp-inj-action--danger"
        data-test="inj-row-trash"
        title="Remove input"
        @click="emit('remove', row._uid)"
      ><i class="pi pi-trash" aria-hidden="true" /></button>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-inj-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.wp-inj-row:last-child { border-bottom: 0; }
.wp-inj-row--disconnected {
  border-left: 2px dashed var(--wp-warn);
  background: color-mix(in srgb, var(--wp-warn) 4%, transparent);
}

.wp-inj-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.wp-inj-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-inj-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
  transition: background-color 0.15s, border-color 0.15s;
}
.wp-inj-toggle input:checked + .wp-inj-toggle-mark {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-inj-toggle input:focus-visible + .wp-inj-toggle-mark {
  box-shadow: 0 0 0 2px var(--wp-violet);
}

.wp-inj-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-inj-binding-line { display: flex; align-items: center; gap: 8px; }
.wp-inj-row-binding {
  flex: 1;
  background: var(--wp-input-shade);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: 600 12px var(--wp-font-mono);
  padding: 3px 8px;
  min-width: 0;
}
.wp-inj-row-binding--empty {
  color: var(--wp-warn);
  font-style: italic;
}
.wp-inj-row-binding--empty::placeholder {
  color: var(--wp-warn);
  font-style: italic;
}

.wp-inj-type-chip {
  font: 600 9px var(--wp-font-mono);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.06em;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--wp-text-muted, var(--wp-text2)) 18%, transparent);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-inj-type-chip--string { background: color-mix(in srgb, var(--wp-amber) 22%, transparent); color: var(--wp-amber); }
.wp-inj-type-chip--int    { background: color-mix(in srgb, var(--wp-green) 22%, transparent); color: var(--wp-green); }
.wp-inj-type-chip--float  { background: color-mix(in srgb, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-inj-type-chip--boolean{ background: color-mix(in srgb, var(--wp-var-5) 22%, transparent); color: var(--wp-var-5); }

.wp-inj-nolink-badge {
  font: 600 8px var(--wp-font-sans);
  padding: 1px 5px;
  border-radius: 6px;
  letter-spacing: 0.06em;
  background: color-mix(in srgb, var(--wp-warn) 14%, transparent);
  color: var(--wp-warn);
}

/* Mirrors ContextWidget's `.wp-btn--icon-sm` so the injector's
 * action cluster reads as part of the same family — transparent
 * border by default, hover-reveals border + bg, accent-tint when
 * active. */
.wp-inj-actions { display: flex; gap: 1px; flex-shrink: 0; }
.wp-inj-action {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 11px/1 var(--wp-font-sans);
  padding: 3px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-inj-action:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border2));
  color: var(--wp-text);
}
.wp-inj-action .pi { font-size: 11px; }
.wp-inj-action.is-active {
  color: var(--wp-accent-text, var(--wp-accent));
  background: color-mix(in srgb, var(--wp-accent) 14%, transparent);
}
.wp-inj-action--danger:hover {
  color: var(--wp-danger);
  border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border-soft, var(--wp-border2)));
}
</style>
