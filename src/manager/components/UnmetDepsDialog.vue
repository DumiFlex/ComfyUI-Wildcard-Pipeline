<script setup lang="ts">
/**
 * Guided-publish gating dialog (Feature B3).
 *
 * Shown when the user tries to publish a module that references wildcards
 * which are in their library but NOT yet on the community. Lists each unmet
 * dependency (name + a kind icon) with a per-dep Publish button so the user
 * can publish the missing wildcards first, plus a soft "Publish <module>
 * anyway" escape hatch and Cancel. Never a hard block.
 *
 * Presentational only — it emits intent; the guided-publish store
 * (`guided-publish-store.ts`) owns the pending module + actually drives
 * `publishToCommunity` (per-dep build, publish-anyway, reset). Mirrors
 * `ExportDepWarningModal`'s props+emits shape so the host wiring is uniform.
 */
import type { BundleRow, ModuleRow } from "../api/types";
import { kindIcon } from "../../components/shared/kind-icons";
import Modal from "./ui/Modal.vue";
import Button from "./ui/Button.vue";

/** A gated dependency row: a wildcard `ModuleRow` (module publish) or an
 *  inner-bundle `BundleRow` (bundle publish, BR-A2). A `BundleRow` carries no
 *  `type`, so the kind icon falls back to the bundle glyph. */
type UnmetRow = ModuleRow | BundleRow;

interface Props {
  open: boolean;
  /** Display name of the module the user is trying to publish. */
  moduleName: string;
  /** In-library, unpublished dependency rows to gate on. */
  unmetRows: UnmetRow[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  /** User chose to publish ONE missing dependency first. */
  (e: "publish-dep", row: UnmetRow): void;
  /** User chose to publish the module despite the unmet deps. */
  (e: "publish-anyway"): void;
  /** User dismissed the gate. */
  (e: "cancel"): void;
}>();

/** Module-subtype `fixed_values` collapses to `fixed` so the icon tint
 *  class matches the `.wp-row-type-icon--<kind>` convention. */
const KIND_CLASS: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
  bundle: "bundle",
  category: "category",
};
function kindClass(kind: string): string {
  return KIND_CLASS[kind] ?? "bundle";
}

/** The row's kind for icon lookup. A `BundleRow` has no `type` field, so an
 *  inner-bundle dep resolves to `"bundle"`. */
function rowKind(row: UnmetRow): string {
  return "type" in row && typeof row.type === "string" ? row.type : "bundle";
}

function onModalUpdateOpen(v: boolean): void {
  emit("update:open", v);
  if (!v) emit("cancel");
}
function onCancel(): void {
  emit("update:open", false);
  emit("cancel");
}
function onPublishDep(row: UnmetRow): void {
  emit("publish-dep", row);
}
function onPublishAnyway(): void {
  emit("update:open", false);
  emit("publish-anyway");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Publish dependencies first?"
    size="md"
    @update:open="onModalUpdateOpen"
  >
    <div class="wpc-unmet-deps" data-test="unmet-deps-dialog">
      <p class="wpc-unmet-deps__lede">
        <strong>{{ props.moduleName }}</strong> references
        {{ props.unmetRows.length === 1 ? "a wildcard" : "wildcards" }}
        that aren't on the community yet — anyone who downloads it won't be
        able to reattach
        {{ props.unmetRows.length === 1 ? "it" : "them" }}. Publish
        {{ props.unmetRows.length === 1 ? "it" : "them" }} first, or publish
        anyway.
      </p>

      <ul class="wpc-unmet-deps__list">
        <li
          v-for="row in props.unmetRows"
          :key="row.id"
          class="wpc-unmet-deps__row"
          data-test="unmet-dep-row"
        >
          <span
            class="wp-row-type-icon"
            :class="`wp-row-type-icon--${kindClass(rowKind(row))}`"
            aria-hidden="true"
          >
            <i :class="kindIcon(rowKind(row))" />
          </span>
          <div class="wpc-unmet-deps__row-name">
            <span class="wpc-unmet-deps__row-text">{{ row.name }}</span>
            <span class="wp-id">{{ row.id.slice(0, 8) }}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon="pi-share-alt"
            data-test="unmet-dep-publish"
            :data-test-id="row.id"
            :aria-label="`Publish ${row.name} to community`"
            @click="onPublishDep(row)"
          >Publish</Button>
        </li>
      </ul>
    </div>

    <template #footer>
      <Button
        variant="ghost"
        size="sm"
        data-test="unmet-deps-cancel"
        @click="onCancel"
      >Cancel</Button>
      <span class="wpc-unmet-deps__spacer" />
      <Button
        variant="secondary"
        size="sm"
        data-test="unmet-deps-publish-anyway"
        @click="onPublishAnyway"
      >Publish "{{ props.moduleName }}" anyway</Button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wpc-unmet-deps {
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
}
.wpc-unmet-deps__lede {
  margin: 0 0 14px;
  color: var(--wp-text-muted);
  line-height: 1.5;
}
.wpc-unmet-deps__lede strong {
  color: var(--wp-text);
  font-weight: 700;
}
.wpc-unmet-deps__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 340px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.wpc-unmet-deps__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  min-width: 0;
}
.wpc-unmet-deps__row .wp-row-type-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--wp-radius-sm);
  flex-shrink: 0;
}
.wpc-unmet-deps__row .wp-row-type-icon .pi {
  font-size: 11px;
}
.wpc-unmet-deps__row-name {
  display: flex;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
  flex: 1;
}
.wpc-unmet-deps__row-text {
  font-weight: 500;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-id {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  font-weight: 500;
  flex-shrink: 0;
}
.wpc-unmet-deps__spacer {
  flex: 1;
}
</style>
