<script setup lang="ts">
/**
 * StarterButton — the doc-page CTA that creates a real starter-set row.
 *
 * Drives the "Create starter X" / "Build starter bundle" buttons embedded in
 * the module doc pages + the Templates page (Phase A2 of the Starter Set
 * Tutorial, `docs/superpowers/plans/2026-05-28-starter-set-tutorial.md`).
 *
 * Three visual states:
 *   - idle     — a button labelled "Create starter X" (or a custom `label`,
 *                or "Build starter bundle" for the bundle slot).
 *   - in-flight — the same button, spinner + disabled (double-click guarded).
 *   - created  — a "✓ Created" line + an "Open" link routing to the editor of
 *                the recorded row (read live from `starterStore`).
 *
 * The actual create work lives in `useStarterSet()`; this component only wires
 * a click to the right composable function and reflects the store's state.
 */
import { computed, ref } from "vue";
import { STARTER_EDIT_ROUTE, useStarterSet } from "../../docs/useStarterSet";
import { STARTER_MODULE_NAMES, type StarterModuleSlot, type StarterSlot } from "../../docs/starter-recipe";
import { useStarterStore } from "../../stores/starterStore";
import { useToast } from "../../composables/useToast";
import Button from "../ui/Button.vue";

/** Every slot this button can drive: the starter slots (incl. `template`)
 *  plus the assembled `bundle`. */
type ButtonSlot = StarterSlot | "bundle";

const props = defineProps<{ slot: ButtonSlot; label?: string }>();

const starter = useStarterStore();
const toast = useToast();
const { createStarterModule, createStarterTemplate, buildStarterBundle } = useStarterSet();

const busy = ref(false);

/** Module slots are everything except `template`/`bundle`. */
function isModuleSlot(slot: ButtonSlot): slot is StarterModuleSlot {
  return slot !== "template" && slot !== "bundle";
}

/** Friendly noun for the default idle label, e.g. "subject", "template". */
const slotNoun = computed<string>(() => {
  if (props.slot === "bundle") return "bundle";
  if (props.slot === "template") return "template";
  return STARTER_MODULE_NAMES[props.slot].replace(/^Starter /, "");
});

/** Idle button label: explicit `label` wins; bundle has its own verb. */
const idleLabel = computed<string>(() => {
  if (props.label) return props.label;
  if (props.slot === "bundle") return "Build starter bundle";
  return `Create starter ${slotNoun.value}`;
});

/** Whether the recorded row exists (reactive — flips after a create). */
const created = computed<boolean>(() => starter.has(props.slot));

/** Route the "Open" affordance targets for the recorded row. */
const openRoute = computed(() => {
  const id = starter.idFor(props.slot);
  if (!id) return null;
  return { name: STARTER_EDIT_ROUTE[props.slot], params: { id } };
});

async function run(): Promise<void> {
  if (busy.value) return; // double-click guard
  busy.value = true;
  try {
    if (props.slot === "bundle") {
      await buildStarterBundle();
    } else if (props.slot === "template") {
      await createStarterTemplate();
    } else if (isModuleSlot(props.slot)) {
      await createStarterModule(props.slot);
    }
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Couldn’t create that",
      detail: err instanceof Error ? err.message : "Something went wrong. Please try again.",
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wp-starter-btn">
    <template v-if="created && openRoute">
      <span class="wp-starter-btn__done">
        <i class="pi pi-check-circle" aria-hidden="true" /> Created
      </span>
      <RouterLink class="wp-starter-btn__open" :to="openRoute" data-test="starter-open">
        Open <i class="pi pi-arrow-up-right" aria-hidden="true" />
      </RouterLink>
    </template>
    <Button
      v-else
      variant="primary"
      size="md"
      icon="pi pi-plus"
      :loading="busy"
      data-test="starter-create"
      @click="run"
    >
      {{ idleLabel }}
    </Button>
  </div>
</template>

<style scoped>
.wp-starter-btn { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wp-starter-btn__done {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  color: var(--wp-success);
}
.wp-starter-btn__done .pi { font-size: 14px; }
.wp-starter-btn__open {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--wp-bg-2); border: 1px solid var(--wp-border);
  color: var(--wp-text); font-size: 12px; text-decoration: none; cursor: pointer;
}
.wp-starter-btn__open:hover { border-color: var(--wp-border-strong); background: var(--wp-bg-3); }
.wp-starter-btn__open .pi { font-size: 11px; }
</style>
