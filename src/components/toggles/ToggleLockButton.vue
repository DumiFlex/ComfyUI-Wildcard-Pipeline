<script setup lang="ts">
/**
 * A toggle's lock icon, which is also the way to the rows it locks: a click
 * glides the canvas to that WP Context and blinks the row. One row goes
 * straight there; several open a menu with each row and its module's icon.
 * A row that is gone shows in the menu but can't be shown.
 */
import { computed } from "vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import DropdownMenu from "@/kit/DropdownMenu.vue";
import type { ContextMenuEntry } from "@/kit/ContextMenu.vue";
import { vTooltip } from "@/kit/tooltip";
import { kindIcon } from "../shared/kind-icons";

/** One locked row as the button lists it. */
export interface LockSpot {
  /** `codename|uid` (`targetKey`). */
  key: string;
  /** The row's name. */
  label: string;
  /** The Context's codename (and title). */
  where: string;
  /** Module kind, for its icon; "" when the row is gone. */
  kind: string;
  missing: boolean;
}

const props = defineProps<{
  spots: LockSpot[];
  /** What the tooltip says ("Locks the seed of 2 rows now"). */
  hint: string;
  /** Locking right now. */
  active: boolean;
  /** For `data-test` hooks. */
  toggleId: string;
}>();

const emit = defineEmits<{ show: [key: string] }>();

const classes = computed(() => ["wp-tgr__ctlicon", "is-lock", { "is-active": props.active }]);
const live = computed(() => props.spots.filter((s) => !s.missing));
const one = computed(() => (props.spots.length === 1 && live.value.length === 1 ? live.value[0] : undefined));
const oneHint = computed(() => (one.value ? `${props.hint}. Click to show ${one.value.label}` : props.hint));
const menuHint = computed(() => `${props.hint}. Click to pick which row to show`);

const items = computed<ContextMenuEntry[]>(() => props.spots.map((s) => ({
  label: s.label,
  icon: s.missing ? "pi-exclamation-triangle" : kindIcon(s.kind).replace(/^pi /, ""),
  subtitle: s.missing ? `${s.where} · gone` : s.where,
  disabled: s.missing,
  onSelect: () => emit("show", s.key),
})));
</script>

<template>
  <WpIconButton
    v-if="one"
    variant="bare"
    icon="pi-lock"
    :class="classes"
    :label="`Show ${one.label} on the canvas`"
    :hint="oneHint"
    :data-test="`tg-lock-icon-${toggleId}`"
    @click="emit('show', one.key)"
  />
  <DropdownMenu
    v-else-if="spots.length"
    :items="items"
    :header="{ icon: 'pi-lock', label: 'Show a locked row' }"
    placement="bottom-end"
    :label="menuHint"
  >
    <template #trigger="{ props: trigger }">
      <WpIconButton
        v-bind="trigger"
        variant="bare"
        icon="pi-lock"
        :class="classes"
        :label="menuHint"
        :hint="menuHint"
        :data-test="`tg-lock-icon-${toggleId}`"
      />
    </template>
  </DropdownMenu>
  <i
    v-else
    v-tooltip="hint"
    class="pi pi-lock"
    :class="classes"
    role="img"
    :aria-label="hint"
    :data-test="`tg-lock-icon-${toggleId}`"
  />
</template>

<style scoped>
/* Same look as the mute / bypass icon: dim while it isn't locking, the
 * accent while it is; hovering lights it like a link. */
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
.wp-tgr__ctlicon.is-active { opacity: 1; color: var(--wp-accent); }
.wp-tgr__ctlicon.wp-icon-btn:hover:not(:disabled),
.wp-tgr__ctlicon.wp-icon-btn[aria-expanded="true"] { opacity: 1; color: var(--wp-text); }
.wp-tgr__ctlicon.wp-icon-btn.is-active:hover:not(:disabled) { color: var(--wp-accent); }
.wp-tgr__ctlicon.wp-icon-btn :deep(.pi) { font-size: 10px; }
</style>
