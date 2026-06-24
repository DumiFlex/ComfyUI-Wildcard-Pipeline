<script setup lang="ts">
import { inject } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";
import { ModuleRowCtxKey } from "./module-row-ctx";
import PairBadge from "./PairBadge.vue";

defineProps<{ module: ModuleEntry; idx: number }>();

const ctx = inject(ModuleRowCtxKey);
if (!ctx) throw new Error("ModuleRow: missing moduleRowCtx provider");
// Destructuring refs from the ctx object would unwrap their .value at
// once and lose reactivity. Keep `ctx` whole; functions destructured for
// brevity in the template.
const {
  KIND_TITLE, kindIcon, kindChipModifier, varColorClass,
  isCollapsed, isLocked, isInternal, isSeedLockable,
  isModified, isDrifted, isMissingFromLibrary, isTypeConflict,
  severityFor, conflictTooltip, conflictBadgeText,
  modifiedTooltip, summaryFor, summaryTokens, siblingInfo,
  rowGap,
  toggleCollapsed, toggleEnabled, removeModule,
  toggleLockOnCard, toggleInternalOnCard,
  onDragStart, onDragEnd, openContextMenu, onCardKeydown,
  pairingFor,
  viaInboundFor,
  contributorsFor,
} = ctx;
</script>

<template>
  <div
    :data-module-id="module.id"
    :data-module-idx="idx"
    :data-kind="module.type"
    class="wp-module"
    tabindex="0"
    draggable="true"
    :class="{
      'wp-disabled': !(ctx?.effectiveEnabled(module) ?? (module.enabled !== false)),
      'wp-conflict-error': severityFor(module._uid ?? module.id) === 'error',
      'wp-conflict-warning': severityFor(module._uid ?? module.id) === 'warning',
      'wp-conflict-info': severityFor(module._uid ?? module.id) === 'info',
      'wp-state-modified': isModified(module),
      'wp-state-drift': isDrifted(module),
      'wp-state-missing': isMissingFromLibrary(module),
      'wp-gap-before': rowGap(idx) === 'before',
      'wp-gap-after': rowGap(idx) === 'after',
      'wp-module--dragging': module._uid === ctx.draggingModuleUid.value,
      'wp-drop-pulse': !!module._uid && ctx.recentDropUids.value.has(module._uid),
      'wp-mod--mod': isModified(module),
      'wp-mod--drift': isDrifted(module),
      'wp-mod--err': isMissingFromLibrary(module),
    }"
    :style="!!module._uid && ctx.recentDropUids.value.has(module._uid)
      ? { animationDelay: ctx.pulseDelayFor(module._uid) }
      : undefined"
    @dragstart="(ev) => onDragStart(ev, module, idx)"
    @dragend="onDragEnd"
    @contextmenu.stop.prevent="(ev) => openContextMenu(ev, module, idx)"
    @keydown="(ev) => onCardKeydown(ev, module, idx)"
  >
    <div class="wp-module-header">
      <span class="wp-drag-handle" aria-hidden="true" title="Drag to reorder">
        <svg class="wp-drag-handle__grip" viewBox="0 0 6 12" width="6" height="12" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="1.5" cy="2" r="1" />
          <circle cx="4.5" cy="2" r="1" />
          <circle cx="1.5" cy="6" r="1" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="1.5" cy="10" r="1" />
          <circle cx="4.5" cy="10" r="1" />
        </svg>
      </span>
      <button type="button" class="wp-collapse-btn" draggable="false"
        :title="isCollapsed(module) ? 'Expand' : 'Collapse'" @click="toggleCollapsed(idx)">
        <i :class="['pi', isCollapsed(module) ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true"></i>
      </button>
      <label class="wp-toggle" draggable="false"
        :title="ctx && ctx.currentFrame.value != null ? (ctx.effectiveEnabled(module) ? 'Disable on this frame' : 'Enable on this frame') : (module.enabled ? 'Disable' : 'Enable')">
        <input type="checkbox"
          :checked="ctx ? ctx.effectiveEnabled(module) : module.enabled"
          :aria-label="`enable ${module.meta.name}`"
          @change="toggleEnabled(idx)" />
        <span class="wp-toggle-mark"></span>
      </label>
      <span class="wp-row-type-icon" :title="module.type" aria-hidden="true">
        <i :class="kindIcon(module.type)" />
      </span>
      <span v-if="KIND_TITLE[module.type] || module.type"
        class="wp-kind-chip" :class="`wp-kind-chip--${kindChipModifier(module.type)}`">
        {{ KIND_TITLE[module.type] ?? module.type }}
      </span>
      <!-- Constraint (SENDER) row: the constraint's own `#N` chip,
           carrying its reach selector (`·all` / `·first` / `·n2` /
           `·pick`) + the ↪ via-glyph when its target is reached through
           a nested ref. One chip per constraint row. -->
      <PairBadge
        v-if="module.type === 'constraint' && pairingFor(module._uid ?? module.id)"
        :pair="pairingFor(module._uid ?? module.id)!"
        variant="sender"
      />
      <!-- Target (WILDCARD) row: the CONTRIBUTOR CLUSTER — every
           constraint whose reach covers this instance. ≤2 contributors
           render as individual `#N` chips; ≥3 collapse into ONE solid
           `↥×N` chip (popover lists them all) so a heavily-constrained
           row never sprawls into 3+ chips. -->
      <template v-else-if="module.type !== 'constraint' && contributorsFor(module._uid ?? module.id).length > 0">
        <template v-if="contributorsFor(module._uid ?? module.id).length <= 2">
          <PairBadge
            v-for="(c, ci) in contributorsFor(module._uid ?? module.id)"
            :key="`contrib-${c.number}-${c.targetUuid}-${ci}`"
            :pair="c"
            variant="direct"
          />
        </template>
        <PairBadge
          v-else
          :pairs="contributorsFor(module._uid ?? module.id)"
          :count="contributorsFor(module._uid ?? module.id).length"
          variant="collapse"
        />
      </template>
      <!-- Carrier-side: ONE collapsed `↪×N` chip aggregating every
           constraint whose target lives in one of THIS wildcard's
           nested @{} refs. Solid background; multi-color fallback when
           routed pairs target different uuids. Popover lists each
           routed pair so users can drill into the individual targets. -->
      <PairBadge
        v-if="viaInboundFor(module._uid ?? module.id).length > 0"
        :pairs="viaInboundFor(module._uid ?? module.id)"
        variant="carrier"
      />
      <span class="wp-module-name" :title="module.meta.name || '(unnamed)'">
        {{ module.meta.name || "(unnamed)" }}
      </span>
      <span class="wp-mod-dots">
        <span v-if="isModified(module)" class="wp-mod-dot wp-mod-dot--modified" :title="modifiedTooltip(module)" aria-hidden="true"></span>
        <span v-if="isModified(module)" class="wp-mod-badge wp-mod-badge--mod" :title="modifiedTooltip(module)">mod</span>
        <span v-if="isDrifted(module)" class="wp-mod-dot wp-mod-dot--drift"
          title="Drifted — library has a newer version. Right-click → Refresh from library." aria-hidden="true"></span>
        <span v-if="isDrifted(module)" class="wp-mod-badge wp-mod-badge--drift"
          title="Drifted — library has a newer version. Right-click → Refresh from library.">drift</span>
        <span v-if="isTypeConflict(module)" class="wp-mod-dot wp-mod-dot--clash"
          title="Id clash — a different kind of item uses this id in your library. Right-click → Push to library to add this one as a new entry." aria-hidden="true"></span>
        <span v-if="isTypeConflict(module)" class="wp-mod-badge wp-mod-badge--clash"
          title="Id clash — a different kind of item uses this id in your library. Right-click → Push to library to add this one as a new entry.">clash</span>
        <span v-if="isMissingFromLibrary(module)" class="wp-mod-dot wp-mod-dot--missing"
          title="Not in library — right-click → Save to library to add it" aria-hidden="true"></span>
        <span v-if="isMissingFromLibrary(module)" class="wp-mod-badge wp-mod-badge--missing"
          title="Not in library — right-click → Save to library to add it">missing</span>
        <span v-if="severityFor(module._uid ?? module.id)" class="wp-conflict-dot"
          :class="`wp-conflict-dot--${severityFor(module._uid ?? module.id)}`" :title="conflictTooltip(module._uid ?? module.id)" aria-hidden="true"></span>
        <span v-if="severityFor(module._uid ?? module.id) && conflictBadgeText(module._uid ?? module.id)"
          class="wp-conflict-badge"
          :class="`wp-conflict-badge--${severityFor(module._uid ?? module.id)}`"
          :title="conflictTooltip(module._uid ?? module.id)">{{ conflictBadgeText(module._uid ?? module.id) }}</span>
        <span v-if="ctx?.isHeld(module)" class="wp-mod-badge wp-mod-badge--clash" data-test="mod-held" title="Held across the run">held</span>
        <span v-if="ctx?.isOverriddenOnFrame(module)" class="wp-conflict-badge wp-conflict-badge--warning" data-test="mod-override" title="Overridden on this frame">override #{{ (ctx.currentFrame.value ?? 0) + 1 }}</span>
        <span v-if="ctx?.frameEnableOverride(module) === 'off'" class="wp-mod-badge wp-mod-badge--missing" data-test="mod-frame-disabled" title="Disabled on this frame">off #{{ (ctx.currentFrame.value ?? 0) + 1 }}</span>
        <span v-else-if="ctx?.frameEnableOverride(module) === 'on'" class="wp-mod-badge wp-mod-badge--on" data-test="mod-frame-enabled" title="Enabled on this frame">on #{{ (ctx.currentFrame.value ?? 0) + 1 }}</span>
      </span>
      <div class="wp-mod-actions" draggable="false">
        <button v-if="isSeedLockable(module)" type="button" class="wp-btn--icon-sm wp-btn--warn"
          :class="{ 'is-locked': isLocked(module) }" data-test="row-action-lock"
          :title="isLocked(module) ? `Locked seed: ${ctx?.effectiveLockedSeed(module)}. Click to unlock.` : 'Lock seed'"
          :aria-label="isLocked(module) ? 'Unlock seed' : 'Lock seed'"
          @click.stop="toggleLockOnCard(idx)"><i class="pi pi-lock" /></button>
        <button v-if="module.type === 'wildcard' || module.type === 'fixed_values' || module.type === 'combine' || module.type === 'derivation'"
          type="button" class="wp-btn--icon-sm wp-btn--accent"
          :class="{ 'is-active': isInternal(module) }" data-test="row-action-internal"
          :title="isInternal(module) ? 'Unmark internal' : 'Mark internal'"
          :aria-label="isInternal(module) ? 'Unmark internal' : 'Mark internal'"
          @click.stop="toggleInternalOnCard(idx)"><i class="pi pi-globe" /></button>
        <button type="button" class="wp-btn--icon-sm wp-btn--danger"
          data-test="row-action-remove" title="Remove" aria-label="Remove module"
          @click.stop="removeModule(idx)"><i class="pi pi-trash" /></button>
      </div>
    </div>
    <div class="wp-collapse-row" :data-collapsed="isCollapsed(module) ? 'true' : 'false'">
      <div class="wp-summary" :title="summaryFor(module)">
        <span class="wp-summary__main">
          <template v-for="(tok, i) in summaryTokens(module)" :key="i"><span
            v-if="tok.kind === 'var'"
            :class="['var-tok', varColorClass(tok.varName ?? '')]"
          >{{ tok.text }}</span><template v-else>{{ tok.text }}</template></template>
        </span>
        <span v-if="siblingInfo(module)" class="wp-summary__sibling"
          data-test="sibling-chip"
          :title="`used ${siblingInfo(module)!.total} times in this Context`">#{{ siblingInfo(module)!.index }} of {{ siblingInfo(module)!.total }}</span>
      </div>
    </div>
  </div>
</template>
