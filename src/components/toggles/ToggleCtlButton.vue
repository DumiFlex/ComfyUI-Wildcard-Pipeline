<script setup lang="ts">
/**
 * A toggle's mute / bypass icon, which is also the way to its targets: a
 * click glides the canvas to what it mutes or bypasses. One place (the wired
 * node, or one group) goes straight there; several open a menu with "All
 * targets" first, then each node or canvas group. With nothing to show it
 * stays a plain icon.
 */
import { computed } from "vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import DropdownMenu from "@/kit/DropdownMenu.vue";
import type { ContextMenuEntry } from "@/kit/ContextMenu.vue";
import { vTooltip } from "@/kit/tooltip";
import type { ControlState, FocusSpotView } from "../../extension/toggle-control";

const props = defineProps<{
  state: ControlState;
  spots: FocusSpotView[];
  /** For `data-test` hooks. */
  toggleId: string;
}>();

const emit = defineEmits<{ show: [key: string] }>();

const glyph = computed(() => (props.state.control === "mute" ? "pi-volume-off" : "pi-forward"));
const classes = computed(() => ["wp-tgr__ctlicon", `is-${props.state.control}`, { "is-active": props.state.active }]);

const nodes = (n: number): string => `${n} node${n === 1 ? "" : "s"}`;
function subtitle(s: FocusSpotView): string {
  if (s.kind === "node") return "Node";
  if (s.kind === "group") return `Group · ${nodes(s.count)}`;
  return nodes(s.count);
}
const ICONS: Record<FocusSpotView["kind"], string> = { all: "pi-expand", group: "pi-objects-column", node: "pi-stop" };

const items = computed<ContextMenuEntry[]>(() => {
  const out: ContextMenuEntry[] = [];
  for (const s of props.spots) {
    out.push({ label: s.label, icon: ICONS[s.kind], subtitle: subtitle(s), onSelect: () => emit("show", s.key) });
    if (s.kind === "all") out.push({ section: "Show one" });
  }
  return out;
});

const one = computed(() => (props.spots.length === 1 ? props.spots[0] : undefined));
const oneHint = computed(() => (one.value ? `${props.state.hint}. Click to show ${one.value.kind === "group" ? "the group" : "it"}` : props.state.hint));
const menuHint = computed(() => `${props.state.hint}. Click to pick which to show`);
</script>

<template>
  <WpIconButton
    v-if="one"
    variant="bare"
    :icon="glyph"
    :class="classes"
    :label="`Show ${one.label} on the canvas`"
    :hint="oneHint"
    :data-test="`tg-ctl-show-${toggleId}`"
    @click="emit('show', one.key)"
  />
  <DropdownMenu
    v-else-if="spots.length > 1"
    :items="items"
    :header="{ icon: glyph, label: state.control === 'mute' ? 'Show what it mutes' : 'Show what it bypasses' }"
    placement="bottom-end"
    :label="menuHint"
  >
    <template #trigger="{ props: trigger }">
      <WpIconButton
        v-bind="trigger"
        variant="bare"
        :icon="glyph"
        :class="classes"
        :label="menuHint"
        :hint="menuHint"
        :data-test="`tg-ctl-show-${toggleId}`"
      />
    </template>
  </DropdownMenu>
  <i
    v-else
    v-tooltip="state.hint"
    class="pi"
    :class="[glyph, ...classes]"
    role="img"
    :aria-label="state.hint"
  />
</template>

<style scoped>
/* Dim while it isn't acting, coloured while it is (bypass in the host's
 * bypass violet, mute in amber); the button keeps the plain icon's look. */
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
.wp-tgr__ctlicon.is-active { opacity: 1; }
.wp-tgr__ctlicon.is-active.is-bypass { color: var(--wp-violet); }
.wp-tgr__ctlicon.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
/* As a button: hovering lights it fully, like a link to its targets. */
.wp-tgr__ctlicon.wp-icon-btn:hover:not(:disabled),
.wp-tgr__ctlicon.wp-icon-btn[aria-expanded="true"] { opacity: 1; color: var(--wp-text); }
.wp-tgr__ctlicon.wp-icon-btn.is-active.is-bypass:hover:not(:disabled) { color: var(--wp-violet); }
.wp-tgr__ctlicon.wp-icon-btn.is-active.is-mute:hover:not(:disabled) { color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__ctlicon.wp-icon-btn :deep(.pi) { font-size: 10px; }
</style>
