<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { kindIcon } from "../../components/shared/kind-icons";
import Button from "../components/ui/Button.vue";
import Modal from "../components/ui/Modal.vue";
import { useCascadeApply, type CascadeApplyRequest } from "./useCascadeApply";

interface Props {
  open: boolean;
  kind: string;
  id: string;
  action: "delete" | "rename";
  extra?: Record<string, unknown>;
  newName?: string;
  cascadeRefs?: boolean;
}
const props = withDefaults(defineProps<Props>(), { cascadeRefs: true });

const emit = defineEmits<{
  (e: "confirmed", result: { undo_entry_id: string; affected_count: number }): void;
  (e: "cancelled"): void;
}>();

const m = useCascadeApply();
const loading = ref(true);
const affected = ref<Array<{ kind: string; id: string; name: string }>>([]);
const error = ref<string>("");

const title = computed(() =>
  props.action === "delete" ? "Confirm delete" : "Confirm rename",
);
const confirmLabel = computed(() =>
  props.action === "delete" ? "Delete + clean up" : "Rename + update refs",
);
const confirmVariant = computed<"danger" | "primary">(() =>
  props.action === "delete" ? "danger" : "primary",
);

/** Module-subtype `fixed_values` collapses to `fixed` so the icon
 * + badge variant class matches the convention already in use by
 * PickerRow / ConflictModal. Unknown kinds fall back to `bundle`'s
 * neutral indigo tint. */
const KIND_CLASS_MAP: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
  bundle: "bundle",
  category: "category",
};

function kindClassFor(kind: string): string {
  return KIND_CLASS_MAP[kind] ?? "bundle";
}

function kindLabelFor(kind: string): string {
  if (kind === "fixed_values") return "Fixed";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

async function refreshDryRun(): Promise<void> {
  loading.value = true;
  error.value = "";
  affected.value = [];
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: props.action,
    cascade_refs: props.cascadeRefs,
    new_name: props.newName,
    extra: props.extra,
  };
  const result = await m.dryRun(req);
  if (!result.ok) {
    error.value = result.error ?? "Unknown error";
  } else {
    affected.value = result.affected_entities ?? [];
  }
  loading.value = false;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await refreshDryRun();
    }
  },
  { immediate: true },
);

async function onConfirm(): Promise<void> {
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: props.action,
    cascade_refs: props.cascadeRefs,
    new_name: props.newName,
    extra: props.extra,
  };
  const result = await m.apply(req);
  if (result.ok) {
    emit("confirmed", {
      undo_entry_id: result.undo_entry_id,
      affected_count: result.affected_count,
    });
  } else {
    error.value = result.error ?? "Apply failed";
  }
}

function onCancel(): void {
  emit("cancelled");
}

function onOpenUpdate(v: boolean): void {
  if (!v) onCancel();
}
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    size="sm"
    @update:open="onOpenUpdate"
  >
    <div v-if="loading" class="wp-cascade-confirm__body">
      <p class="wp-cascade-confirm__msg">Scanning impact…</p>
    </div>
    <div v-else-if="error" class="wp-cascade-confirm__body">
      <p class="wp-cascade-confirm__error">⚠ {{ error }}</p>
    </div>
    <div v-else class="wp-cascade-confirm__body">
      <p v-if="affected.length === 0" class="wp-cascade-confirm__msg">
        No downstream refs — safe to proceed.
      </p>
      <p v-else class="wp-cascade-confirm__intro">
        This will also affect
        <strong>{{ affected.length }}</strong>
        {{ affected.length === 1 ? "entity" : "entities" }}:
      </p>
      <ul v-if="affected.length > 0" class="wp-cascade-confirm__list">
        <li
          v-for="a in affected"
          :key="a.id"
          class="wp-cascade-confirm__row"
          :data-kind="a.kind"
        >
          <span
            class="wp-row-type-icon"
            :class="`wp-row-type-icon--${kindClassFor(a.kind)}`"
            aria-hidden="true"
          >
            <i :class="kindIcon(a.kind)" />
          </span>
          <div class="wp-row-name">
            <span class="wp-row-name__text">{{ a.name }}</span>
            <span class="wp-id">{{ a.id.slice(0, 8) }}</span>
          </div>
          <span
            class="wp-mod-badge"
            :class="`wp-mod-badge--kind-${kindClassFor(a.kind)}`"
          >
            {{ kindLabelFor(a.kind) }}
          </span>
        </li>
      </ul>
    </div>
    <template #footer>
      <Button variant="ghost" size="sm" @click="onCancel">Cancel</Button>
      <Button
        :variant="confirmVariant"
        size="sm"
        :disabled="loading"
        data-test="cascade-confirm"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-cascade-confirm__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-cascade-confirm__msg,
.wp-cascade-confirm__intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--wp-text);
}
.wp-cascade-confirm__intro strong {
  font-weight: 600;
}
.wp-cascade-confirm__error {
  margin: 0;
  color: var(--wp-color-error-fg, var(--wp-danger, #ef4444));
  font-size: 13px;
}
.wp-cascade-confirm__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-cascade-confirm__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--wp-border, #38383f);
  border-radius: 6px;
  background: var(--wp-bg2, var(--wp-color-surface-2, #25252a));
  min-width: 0;
}
.wp-cascade-confirm__row .wp-row-type-icon {
  width: 22px;
  height: 22px;
}
.wp-cascade-confirm__row .wp-row-type-icon .pi {
  font-size: 12px;
}
.wp-cascade-confirm__row .wp-row-name {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
  flex: 1;
}
.wp-cascade-confirm__row .wp-row-name__text {
  font-weight: 500;
  color: var(--wp-text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-cascade-confirm__row .wp-id {
  font-family: var(--wp-font-mono, ui-monospace, Menlo, monospace);
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  font-weight: 500;
  flex-shrink: 0;
}
.wp-cascade-confirm__row .wp-mod-badge {
  margin-left: auto;
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
/* Kind-tinted badges — same color family as the icon tile so badge +
 * tile read together. Color-mix at 18% bg / 100% fg matches the
 * `.wp-row-type-icon--<kind>` formula in row-primitives.css. */
.wp-mod-badge--kind-wildcard {
  background: color-mix(in oklab, var(--wp-kind-wildcard) 18%, transparent);
  color: var(--wp-kind-wildcard);
}
.wp-mod-badge--kind-fixed {
  background: color-mix(in oklab, var(--wp-kind-fixed) 18%, transparent);
  color: var(--wp-kind-fixed);
}
.wp-mod-badge--kind-combine {
  background: color-mix(in oklab, var(--wp-kind-combine) 18%, transparent);
  color: var(--wp-kind-combine);
}
.wp-mod-badge--kind-derivation {
  background: color-mix(in oklab, var(--wp-kind-derivation) 18%, transparent);
  color: var(--wp-kind-derivation);
}
.wp-mod-badge--kind-constraint {
  background: color-mix(in oklab, var(--wp-kind-constraint) 18%, transparent);
  color: var(--wp-kind-constraint);
}
.wp-mod-badge--kind-bundle {
  background: color-mix(in oklab, var(--wp-bundle-default, #6366f1) 18%, transparent);
  color: var(--wp-bundle-default, #6366f1);
}
.wp-mod-badge--kind-category {
  background: color-mix(in oklab, var(--wp-text-muted, #8a8a93) 18%, transparent);
  color: var(--wp-text-muted, #8a8a93);
}
</style>
