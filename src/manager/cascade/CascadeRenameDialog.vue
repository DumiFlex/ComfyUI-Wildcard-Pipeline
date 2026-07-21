<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { kindIcon } from "../../components/shared/kind-icons";
import Button from "../components/ui/Button.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import Input from "../components/ui/Input.vue";
import Modal from "../components/ui/Modal.vue";
import { useCascadeApply, type CascadeApplyRequest } from "./useCascadeApply";
import { validateSubcatName, validateRefGrammarName, validateVariableName } from "../validation/names";

interface Props {
  open: boolean;
  kind: string;
  id: string;
  extra?: Record<string, unknown>;
  initialName?: string;
}
const props = withDefaults(defineProps<Props>(), { initialName: "" });

const emit = defineEmits<{
  (e: "confirmed", result: {
    undo_entry_id: string;
    new_name: string;
    broken_refs?: Array<{ kind: string; id: string; name: string }>;
  }): void;
  (e: "cancelled"): void;
}>();

const m = useCascadeApply();
const newName = ref<string>(props.initialName);
const cascadeRefs = ref<boolean>(true);
const affected = ref<Array<{ kind: string; id: string; name: string }>>([]);
const loading = ref(true);
const error = ref<string>("");

/** Validate the typed new name against the SAME canonical validator its
 *  matching "add"/"create" surface uses (see `validation/names`), keyed by
 *  what kind of thing is being renamed. Reusing the shared validators keeps
 *  rename and create in lockstep — previously rename hand-rolled a weaker
 *  check that let invalid sub-category names (e.g. with spaces) through
 *  until save (issue #7), and variable renames weren't validated at all. */
const nameError = computed<string | null>(() => {
  // Empty is gated by `canConfirm` (Rename button stays disabled) — don't
  // surface an error while the field is simply blank.
  if (!newName.value) return null;
  if (props.kind === "subcategory") return validateSubcatName(newName.value);
  if (props.kind === "combine_output_var") return validateVariableName(newName.value);
  if (props.kind === "wildcard") return validateRefGrammarName(newName.value);
  return null;
});

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
    action: "rename",
    cascade_refs: true,
    new_name: newName.value,
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
      newName.value = props.initialName ?? "";
      cascadeRefs.value = true;
      await refreshDryRun();
    }
  },
  { immediate: true },
);

const canConfirm = computed<boolean>(
  () => !!newName.value && !loading.value && nameError.value === null,
);

async function onConfirm(): Promise<void> {
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: "rename",
    cascade_refs: cascadeRefs.value,
    new_name: newName.value,
    extra: props.extra,
  };
  const result = await m.apply(req);
  if (result.ok) {
    emit("confirmed", {
      undo_entry_id: result.undo_entry_id,
      new_name: newName.value,
      broken_refs: result.broken_refs,
    });
  } else {
    error.value = result.error ?? "Rename failed";
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
    title="Rename"
    size="sm"
    @update:open="onOpenUpdate"
  >
    <div v-if="loading" class="wp-cascade-rename__body">
      <p class="wp-cascade-rename__msg">Scanning impact…</p>
    </div>
    <div v-else class="wp-cascade-rename__body">
      <label class="wp-cascade-rename__field">
        <span class="wp-cascade-rename__label">New name</span>
        <Input v-model="newName" type="text" aria-label="New name" />
      </label>
      <p v-if="nameError" class="wp-cascade-rename__error">⚠ {{ nameError }}</p>
      <p v-if="error" class="wp-cascade-rename__error">⚠ {{ error }}</p>
      <div v-if="affected.length > 0" class="wp-cascade-rename__toggle">
        <Checkbox
          v-model="cascadeRefs"
          aria-label="Update refs to new name"
        />
        <span class="wp-cascade-rename__toggle-text" @click="cascadeRefs = !cascadeRefs">
          Update <strong>{{ affected.length }}</strong>
          {{ affected.length === 1 ? "ref" : "refs" }}
          to new name <span class="wp-cascade-rename__hint">(recommended)</span>
        </span>
      </div>
      <template v-if="affected.length > 0">
        <span class="wp-cascade-rename__section">Affected</span>
        <ul class="wp-cascade-rename__list">
          <li
            v-for="a in affected"
            :key="a.id"
            class="wp-cascade-rename__row"
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
      </template>
    </div>
    <template #footer>
      <Button variant="ghost" size="sm" @click="onCancel">Cancel</Button>
      <Button
        variant="primary"
        size="sm"
        :disabled="!canConfirm"
        data-test="cascade-rename-confirm"
        @click="onConfirm"
      >
        Rename
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-cascade-rename__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wp-cascade-rename__msg {
  margin: 0;
  font-size: 13px;
  color: var(--wp-text);
}
.wp-cascade-rename__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-cascade-rename__label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
}
.wp-cascade-rename__section {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  margin-bottom: -6px;
}
.wp-cascade-rename__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--wp-border, #38383f);
  background: var(--wp-bg2, var(--wp-color-surface-2, #25252a));
  font-size: 13px;
}
.wp-cascade-rename__toggle-text {
  cursor: pointer;
  user-select: none;
  flex: 1;
}
.wp-cascade-rename__toggle strong {
  font-weight: 600;
}
.wp-cascade-rename__hint {
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
}
.wp-cascade-rename__error {
  margin: 0;
  color: var(--wp-color-error-fg, var(--wp-danger, #ef4444));
  font-size: 13px;
}
.wp-cascade-rename__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-cascade-rename__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--wp-border, #38383f);
  border-radius: 6px;
  background: var(--wp-bg2, var(--wp-color-surface-2, #25252a));
  min-width: 0;
}
.wp-cascade-rename__row .wp-row-type-icon {
  width: 22px;
  height: 22px;
}
.wp-cascade-rename__row .wp-row-type-icon .pi {
  font-size: 12px;
}
.wp-cascade-rename__row .wp-row-name {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
  flex: 1;
}
.wp-cascade-rename__row .wp-row-name__text {
  font-weight: 500;
  color: var(--wp-text);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-cascade-rename__row .wp-id {
  font-family: var(--wp-font-mono, ui-monospace, Menlo, monospace);
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3, #8a8a93));
  font-weight: 500;
  flex-shrink: 0;
}
.wp-cascade-rename__row .wp-mod-badge {
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
