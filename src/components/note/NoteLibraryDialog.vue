<script setup lang="ts">
/**
 * The review step of a WP Note's "add to library" button: it lists exactly
 * what goes into the library, and for an item the library already holds
 * with other content it asks Use mine / Replace / Keep both (an id taken by
 * another kind of item: Keep both / Leave out). Nothing is written until Add.
 */
import { computed, ref } from "vue";
import Button from "@/kit/Button.vue";
import Modal from "@/kit/Modal.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import { kindIcon } from "../shared/kind-icons";
import { choicesFor, countLabel, type Choice, type LibraryPlan, type PlanItem } from "./note-library-plan";

const props = defineProps<{
  plan: LibraryPlan;
  /** "this workflow" or a WP Context's label. */
  scope: string;
  /** Library names of the items that clash, by `kind:id`. */
  existing: Record<string, string>;
}>();
const emit = defineEmits<{ (e: "done", choices: Record<string, Choice> | null): void }>();

const visible = ref(true);
const keyOf = (i: PlanItem): string => `${i.kind}:${i.id}`;
const choices = ref<Record<string, Choice>>(
  Object.fromEntries(props.plan.items.map((i) => [keyOf(i), choicesFor(i.state)[0] ?? "add"])),
);

const fresh = computed(() => props.plan.items.filter((i) => i.state === "new"));
const clashes = computed(() => props.plan.items.filter((i) => i.state !== "new"));
const going = computed(() => props.plan.items.filter((i) => choices.value[keyOf(i)] !== "skip"));

const LABEL: Record<Choice, string> = { add: "Add", skip: "Use mine", replace: "Replace", copy: "Keep both" };
function options(i: PlanItem): Array<{ value: Choice; label: string }> {
  return choicesFor(i.state).map((c) => ({ value: c, label: c === "skip" && i.state === "taken" ? "Leave out" : LABEL[c] }));
}
function kindLabel(i: PlanItem): string {
  return i.kind === "bundle" ? "bundle" : i.type.replace(/_/g, " ");
}
function clashNote(i: PlanItem): string {
  const name = props.existing[keyOf(i)];
  if (i.state === "taken") return `Its id belongs to another kind of item${name ? ` ("${name}")` : ""}. Keep both adds it under a new id.`;
  return `Your library has it with other content${name && name !== i.name ? ` as "${name}"` : ""}.`;
}

function close(result: Record<string, Choice> | null): void {
  visible.value = false;
  emit("done", result);
}
</script>

<template>
  <Modal :open="visible" size="md" flush @update:open="(v: boolean) => { if (!v) close(null); }">
    <template #header="{ titleId }">
      <div class="wp-note-lib__head">
        <span :id="titleId" class="wp-note-lib__title">Add to your library</span>
        <span class="wp-note-lib__sub">From {{ scope }}</span>
      </div>
    </template>
    <div class="wp-note-lib" data-test="note-library-dialog">
      <div class="wp-note-lib__body">
        <section v-if="fresh.length" class="wp-note-lib__group">
          <h3 class="wp-note-lib__label">New: {{ countLabel(fresh) }}</h3>
          <ul class="wp-note-lib__list" data-test="note-library-new">
            <li v-for="i in fresh" :key="keyOf(i)" class="wp-note-lib__row">
              <i :class="kindIcon(i.kind === 'bundle' ? 'bundle' : i.type)" class="wp-note-lib__icon" aria-hidden="true"></i>
              <span class="wp-note-lib__name">{{ i.name }}</span>
              <span class="wp-note-lib__kind">{{ kindLabel(i) }}</span>
              <span v-if="i.example" class="wp-note-lib__chip">Example</span>
            </li>
          </ul>
        </section>
        <section v-if="clashes.length" class="wp-note-lib__group">
          <h3 class="wp-note-lib__label">Already in your library: {{ countLabel(clashes) }}</h3>
          <ul class="wp-note-lib__list" data-test="note-library-clashes">
            <li v-for="i in clashes" :key="keyOf(i)" class="wp-note-lib__row wp-note-lib__row--clash" :data-test="`note-library-clash-${i.id}`">
              <div class="wp-note-lib__line">
                <i :class="kindIcon(i.kind === 'bundle' ? 'bundle' : i.type)" class="wp-note-lib__icon" aria-hidden="true"></i>
                <span class="wp-note-lib__name">{{ i.name }}</span>
                <span class="wp-note-lib__kind">{{ kindLabel(i) }}</span>
              </div>
              <p class="wp-note-lib__note">{{ clashNote(i) }}</p>
              <WpSegmented
                :model-value="choices[keyOf(i)]"
                :options="options(i)"
                size="sm"
                :aria-label="`What to do with ${i.name}`"
                :test-prefix="`note-library-choice-${i.id}`"
                @update:model-value="(v: Choice) => (choices = { ...choices, [keyOf(i)]: v })"
              />
            </li>
          </ul>
        </section>
        <p v-if="plan.already" class="wp-note-lib__hint">
          {{ plan.already }} more {{ plan.already === 1 ? "is" : "are" }} in your library already, just as here.
        </p>
        <p class="wp-note-lib__hint">One step: Undo on the message afterwards takes it all back out.</p>
      </div>
    </div>
    <template #footer>
      <Button size="sm" data-test="note-library-cancel" @click="close(null)">Cancel</Button>
      <Button
        size="sm"
        variant="primary"
        icon="pi-download"
        :disabled="going.length === 0"
        data-test="note-library-add"
        @click="close(choices)"
      >{{ going.length ? `Add ${countLabel(going)}` : "Nothing to add" }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-note-lib { color: var(--wp-text); font-size: 13px; }
.wp-note-lib__head { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.wp-note-lib__title { font-size: 14px; font-weight: 600; }
.wp-note-lib__sub { font-size: 12px; color: var(--wp-text-muted); }
.wp-note-lib__body { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
.wp-note-lib__group { display: flex; flex-direction: column; gap: 6px; }
.wp-note-lib__label {
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--wp-text-muted);
}
.wp-note-lib__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
}
.wp-note-lib__row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.wp-note-lib__row + .wp-note-lib__row { border-top: 1px solid var(--wp-border); }
.wp-note-lib__row--clash { flex-direction: column; align-items: stretch; gap: 6px; }
.wp-note-lib__line { display: flex; align-items: center; gap: 8px; }
.wp-note-lib__icon { font-size: 12px; color: var(--wp-text-muted); }
.wp-note-lib__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-note-lib__kind { font-size: 11px; color: var(--wp-text-dim); text-transform: capitalize; }
.wp-note-lib__chip {
  font-size: 10px;
  padding: 0 6px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-3, var(--wp-bg-2));
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.wp-note-lib__note { margin: 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-note-lib__hint { margin: 0; font-size: 11px; color: var(--wp-text-dim); }
</style>
