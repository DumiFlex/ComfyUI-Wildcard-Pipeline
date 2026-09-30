<script setup lang="ts">
/**
 * Settings › Canvas. The node settings from ComfyUI › Settings › Wildcard
 * Pipeline, editable here too (see `useCanvasSettings` for how the two stay
 * in step), plus the one run setting the engine reads from the server.
 */
import { computed, ref, watch } from "vue";
import Toggle from "../../ui/Toggle.vue";
import Select from "../../ui/Select.vue";
import Input from "../../ui/Input.vue";
import type { SelectOption } from "../../ui/select-types";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { CANVAS_SETTINGS, type CanvasSettingGroup, type CanvasSettingMeta } from "../../../../extension/settings-catalog";
import { canvasKey } from "../settings-index";
import { useCanvasSettings } from "../../../composables/useCanvasSettings";
import { useServerSettings } from "../../../composables/useServerSettings";
import { useUiStore } from "../../../stores/uiStore";

const canvas = useCanvasSettings();
const server = useServerSettings();
const ui = useUiStore();

const GROUPS: Array<{ id: CanvasSettingGroup; title: string }> = [
  { id: "look", title: "Look" },
  { id: "behavior", title: "Behavior" },
  { id: "feedback", title: "Warnings and toasts" },
  { id: "accessibility", title: "Accessibility" },
];

function inGroup(g: CanvasSettingGroup): CanvasSettingMeta[] {
  return CANVAS_SETTINGS.filter((s) => s.group === g);
}

function options(s: CanvasSettingMeta): SelectOption[] {
  return (s.options ?? []).map((o) => ({ value: o.value, label: o.text }));
}

/* ── Ref recursion limit (server) ─────────────────────────────────────── */

const depthDraft = ref<number>(8);
const depth = computed(() => server.settings.value?.max_ref_depth ?? null);
watch(depth, (d) => { if (d !== null) depthDraft.value = d; }, { immediate: true });
const depthSaved = ref(false);

async function commitDepth(): Promise<void> {
  const n = Math.round(Number(depthDraft.value));
  if (!Number.isFinite(n)) { depthDraft.value = depth.value ?? 8; return; }
  const clamped = Math.min(32, Math.max(1, n));
  depthDraft.value = clamped;
  if (clamped === depth.value) return;
  await server.update({ max_ref_depth: clamped });
  // The store keeps a copy for anything local that wants the number.
  ui.setMaxRefDepth(clamped);
  depthSaved.value = true;
  window.setTimeout(() => { depthSaved.value = false; }, 1600);
}
</script>

<template>
  <p class="wp-set-callout">
    The same settings as ComfyUI › Settings › Wildcard Pipeline. A change here applies to any canvas tab
    that is open right now, and is saved for the next one. For a live preview, open the display
    playground from ComfyUI's settings panel.
  </p>
  <p v-if="canvas.error.value" class="wp-set-error" role="alert" data-test="canvas-settings-error">
    Couldn't reach ComfyUI's settings: {{ canvas.error.value }}
  </p>

  <SettingGroup title="Runs">
    <SettingRow
      label="Ref recursion limit"
      hint="How deep nested @{uuid} references resolve when a workflow runs, and in previews and the Test Runner. 1–32, default 8. Saved on the server, so it applies to every browser."
      setting-key="ref-depth"
      for="wildcard-max-ref-depth"
    >
      <span v-if="depthSaved" class="wp-set-pill" data-tone="ok">Saved</span>
      <Input
        id="wildcard-max-ref-depth"
        v-model.number="depthDraft"
        type="number"
        :min="1"
        :max="32"
        :step="1"
        class="wp-set-num"
        aria-label="Wildcard ref recursion limit"
        data-test="settings-wildcard-max-ref-depth"
        :disabled="depth === null"
        @blur="commitDepth"
        @keydown.enter="commitDepth"
      />
    </SettingRow>
  </SettingGroup>

  <SettingGroup v-for="g in GROUPS" :key="g.id" :title="g.title">
    <SettingRow
      v-for="s in inGroup(g.id)"
      :key="s.id"
      :label="s.name"
      :hint="s.tooltip"
      :setting-key="canvasKey(s.id)"
    >
      <Toggle
        v-if="s.type === 'boolean'"
        :model-value="canvas.values.value[s.id] === true"
        :aria-label="s.name"
        :disabled="!canvas.loaded.value"
        :data-test="`canvas-${s.id}`"
        @update:model-value="canvas.set(s.id, $event)"
      />
      <Select
        v-else
        :model-value="String(canvas.values.value[s.id])"
        :options="options(s)"
        :filterable="false"
        :aria-label="s.name"
        :disabled="!canvas.loaded.value"
        :data-test="`canvas-${s.id}`"
        @update:model-value="(v) => canvas.set(s.id, String(v))"
      />
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-num { width: 96px; }
</style>
