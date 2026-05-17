<script setup lang="ts">
/**
 * Mockup module card — slimmed render of ModuleRow.vue used only by
 * PlaygroundMockup for the Display Playground live-preview pane.
 *
 * ModuleRow.vue itself depends on `ModuleRowCtxKey` (kindIcon /
 * summaryFor / siblingInfo / drag + drop wiring) which would mean
 * fabricating a full ContextWidget context just to render a preview
 * card. Instead this component carries only the shape needed to
 * exercise display-prefs.css and theme tokens: kind border + chip,
 * state dots + badges, action-button cluster, enable/collapse
 * interactivity. Visual output is intentionally 1:1 with the real
 * ModuleRow rendering on canvas — same class names, same DOM order,
 * same icon mapping via shared `kindIcon`.
 *
 * Drift risk: if ModuleRow's markup changes, this card stays static.
 * The cost of duplication is bounded — the mockup needs to match the
 * preview moment, not every behavioral edge.
 */
import { computed } from "vue";
import { kindIcon } from "../shared/kind-icons";

export interface SummaryToken { isVar: boolean; text: string; }

export interface ModuleStates {
  mod?: boolean;
  drift?: boolean;
  missing?: boolean;
  override?: boolean;
}

export interface MockModule {
  /** Stable key used by the parent for state lookup + v-for. */
  key: string;
  /** Drives the kind-icon + border-left color + kind-chip modifier. */
  kind: "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint";
  /** Human label shown in the kind chip (e.g. "wildcard", "fixed"). */
  chipLabel: string;
  /** Modifier used in the `.wp-kind-chip--<mod>` class. */
  chipMod: string;
  /** Display name. */
  name: string;
  /** Mixed var/literal tokens shown in the summary line. */
  summary: SummaryToken[];
  /** Which state markers to display in the dots+badges cluster. */
  states?: ModuleStates;
  /** Show the lock master button (seed-lockable kinds on canvas). */
  lockable?: boolean;
  /** Show the internal master button (wildcards, fixed_values,
   *  combines, derivations on canvas). */
  internalable?: boolean;
}

export interface ModRuntimeState {
  enabled: boolean;
  collapsed: boolean;
  locked: boolean;
  internal: boolean;
}

const props = defineProps<{
  module: MockModule;
  state: ModRuntimeState;
}>();

const emit = defineEmits<{
  (e: "toggle-collapse"): void;
  (e: "toggle-enabled"): void;
  (e: "toggle-lock"): void;
  (e: "toggle-internal"): void;
}>();

const states = computed(() => props.module.states ?? {});
</script>

<template>
  <div
    class="wp-module"
    :class="{
      'wp-disabled': !state.enabled,
      'wp-state-modified': states.mod,
      'wp-state-drift': states.drift,
      'wp-state-missing': states.missing,
      'wp-mod--mod': states.mod,
      'wp-mod--drift': states.drift,
      'wp-mod--err': states.missing,
      'wp-conflict-info': states.override,
    }"
    :data-kind="module.kind"
  >
    <div class="wp-module-header">
      <span class="wp-drag-handle" aria-hidden="true">
        <svg class="wp-drag-handle__grip" viewBox="0 0 6 12" width="6" height="12" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="1.5" cy="2" r="1" />
          <circle cx="4.5" cy="2" r="1" />
          <circle cx="1.5" cy="6" r="1" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="1.5" cy="10" r="1" />
          <circle cx="4.5" cy="10" r="1" />
        </svg>
      </span>
      <button
        class="wp-collapse-btn"
        type="button"
        :title="state.collapsed ? 'Expand' : 'Collapse'"
        @click="emit('toggle-collapse')"
      ><i :class="['pi', state.collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i></button>
      <label class="wp-toggle" :title="state.enabled ? 'Disable' : 'Enable'">
        <input type="checkbox" :checked="state.enabled" @change="emit('toggle-enabled')" />
        <span class="wp-toggle-mark"></span>
      </label>
      <span class="wp-row-type-icon" aria-hidden="true">
        <i :class="kindIcon(module.kind)"></i>
      </span>
      <span class="wp-kind-chip" :class="`wp-kind-chip--${module.chipMod}`">{{ module.chipLabel }}</span>
      <span class="wp-module-name">{{ module.name }}</span>
      <span class="wp-mod-dots">
        <template v-if="states.mod">
          <span class="wp-mod-dot wp-mod-dot--modified" aria-hidden="true"></span>
          <span class="wp-mod-badge wp-mod-badge--mod">mod</span>
        </template>
        <template v-if="states.drift">
          <span class="wp-mod-dot wp-mod-dot--drift" aria-hidden="true"></span>
          <span class="wp-mod-badge wp-mod-badge--drift">drift</span>
        </template>
        <template v-if="states.missing">
          <span class="wp-mod-dot wp-mod-dot--missing" aria-hidden="true"></span>
          <span class="wp-mod-badge wp-mod-badge--missing">missing</span>
        </template>
        <template v-if="states.override">
          <span class="wp-conflict-dot wp-conflict-dot--info" aria-hidden="true"></span>
          <span class="wp-conflict-badge wp-conflict-badge--info">override</span>
        </template>
      </span>
      <div class="wp-mod-actions">
        <button
          v-if="module.lockable"
          type="button"
          class="wp-btn--icon-sm wp-btn--warn"
          :class="{ 'is-locked': state.locked }"
          :title="state.locked ? 'Unlock seed' : 'Lock seed'"
          @click="emit('toggle-lock')"
        ><i class="pi pi-lock" aria-hidden="true"></i></button>
        <button
          v-if="module.internalable"
          type="button"
          class="wp-btn--icon-sm wp-btn--accent"
          :class="{ 'is-active': state.internal }"
          :title="state.internal ? 'Unmark internal' : 'Mark internal'"
          @click="emit('toggle-internal')"
        ><i class="pi pi-globe" aria-hidden="true"></i></button>
        <button
          type="button"
          class="wp-btn--icon-sm wp-btn--danger"
          title="Remove module"
        ><i class="pi pi-trash" aria-hidden="true"></i></button>
      </div>
    </div>
    <Transition name="wp-collapse">
      <div v-if="!state.collapsed" class="wp-summary">
        <span class="wp-summary__main">
          <template v-for="(tok, i) in module.summary" :key="i">
            <span v-if="tok.isVar" class="wp-pg-mockup__var">{{ tok.text }}</span>
            <span v-else class="wp-pg-mockup__lit">{{ tok.text }}</span>
          </template>
        </span>
      </div>
    </Transition>
  </div>
</template>
