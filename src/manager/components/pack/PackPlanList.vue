<script setup lang="ts">
/**
 * PackPlanList — the plan's items grouped by section (each section becomes
 * a sub-bundle on install). Rows wrap instead of overflowing; tags show as
 * chips. Click a row to edit it by hand or ask the AI to change just that
 * item; remove and restore stay one click.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import PackItemEditor from "./PackItemEditor.vue";
import type { AiPackItem, AiPackKind } from "../../api/types";
import { usePackBuilder } from "../../composables/usePackBuilder";
import LoadingMark from "@/components/shared/LoadingMark.vue";

const pb = usePackBuilder();
const open = ref<string>("");
const folded = ref(new Set<string>());
const adding = ref(false);
const addAsk = ref("");
const TAGS_SHOWN = 4;

const items = computed(() => pb.draft.value?.items ?? []);
const flat = computed(() => pb.settings.value.structure === "flat"
  || !(pb.draft.value?.sections.length));

/** Sections in plan order, then items with none ("In the pack bundle"). */
const groups = computed(() => {
  const named = (pb.draft.value?.sections ?? []).map((s) => ({
    name: s.name, about: s.about, items: items.value.filter((i) => i.section === s.name),
  }));
  const known = new Set(named.map((s) => s.name));
  const loose = items.value.filter((i) => !i.section || !known.has(i.section));
  const out = named.filter((g) => g.items.length);
  // Extending a bundle: its own top level comes first, as it runs first.
  if (loose.length && pb.draft.value?.base) out.unshift({ name: "", about: "", items: loose });
  else if (loose.length) out.push({ name: "", about: "", items: loose });
  return out;
});

function kindLabel(i: AiPackItem): string {
  if (i.existing) return "in bundle";
  if (i.kind === "fixed_values") return "fixed";
  if (i.kind === "library") return "yours";
  return i.kind === "wildcard" && !i.var ? "vocabulary" : i.kind;
}

function label(i: AiPackItem): string {
  if (i.kind === "constraint") return `$${i.source} → $${i.target}`;
  return i.var ? `$${i.var}` : i.name;
}

function meta(i: AiPackItem): string[] {
  const out: string[] = [];
  if (i.kind === "wildcard") out.push(`${i.count} options`);
  if (i.existing) out.push("already in the bundle");
  else if (i.kind === "library") out.push(i.library_type === "fixed_values" ? "your fixed values" : "your wildcard");
  if (i.use) out.push(`use: ${i.use}`);
  return out;
}

function toggle(key: string): void {
  open.value = open.value === key ? "" : key;
}

function fold(name: string): void {
  const next = new Set(folded.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  folded.value = next;
}

const ADD_KINDS: Array<{ kind: AiPackKind; label: string }> = [
  { kind: "wildcard", label: "Wildcard" },
  { kind: "fixed_values", label: "Fixed values" },
  { kind: "derivation", label: "Derivation" },
  { kind: "combine", label: "Combine" },
  { kind: "constraint", label: "Constraint" },
];

const graphed = computed(() => !!pb.draft.value?.graph);

function add(kind: AiPackKind, section: string): void {
  if (graphed.value) {
    // A graph plan: the item appears once the server compiles the graph.
    if (kind === "wildcard") pb.addSlot(section);
    else if (kind === "fixed_values") pb.editGraph((g) => ({ ...g, fixed: [...g.fixed, { name: `Fixed ${g.fixed.length + 1}`, var: `fixed_${g.fixed.length + 1}`, text: "text", negative: "" }] }));
    else if (kind === "constraint" && pb.draft.value!.graph!.slots.length >= 2) {
      const [a, b] = pb.draft.value!.graph!.slots;
      pb.addRelation({ kind: "exclude", from: { slot: a.name, axis: "", value: "" }, to: { slot: b.name, axis: "", value: "" } });
    } else if (kind === "derivation") {
      const a = pb.draft.value!.graph!.slots[0];
      pb.addRelation({ kind: "derive", from: { slot: a?.name ?? "", axis: "", value: "" }, var: "new_var", text: "", otherwise: "" });
    }
    adding.value = false;
    return;
  }
  open.value = pb.addItem(kind, section);
  adding.value = false;
}

async function addWithAi(): Promise<void> {
  if (await pb.changeItem("", addAsk.value)) {
    addAsk.value = "";
    adding.value = false;
  }
}
</script>

<template>
  <div class="wp-pack-list" data-test="pack-plan-list">
    <section v-for="g in groups" :key="g.name || '-'" class="wp-pack-list__group">
      <button
        v-if="!flat"
        type="button"
        class="wp-pack-list__section"
        :aria-expanded="!folded.has(g.name)"
        data-test="pack-section"
        @click="fold(g.name)"
      >
        <i :class="['pi', folded.has(g.name) ? 'pi-chevron-right' : 'pi-chevron-down']" aria-hidden="true" />
        <i class="pi pi-box" aria-hidden="true" />
        <span class="wp-pack-list__section-name">{{ g.name || (pb.draft.value?.base ? `In ${pb.draft.value.base.name} itself` : 'In the pack bundle') }}</span>
        <span class="wp-pack-list__count">{{ g.items.length }}</span>
        <span v-if="g.about" class="wp-pack-list__section-about">{{ g.about }}</span>
      </button>
      <ul v-if="flat || !folded.has(g.name)" class="wp-pack-list__items">
        <li
          v-for="i in g.items"
          :key="i.key"
          data-test="pack-item"
          :data-removed="pb.removed.value.has(i.key) ? 'true' : undefined"
          :data-existing="i.existing ? 'true' : undefined"
        >
          <div class="wp-pack-list__row">
            <span class="wp-pack-list__kind" :data-kind="i.kind">{{ kindLabel(i) }}</span>
            <button
              type="button"
              class="wp-pack-list__main"
              :aria-expanded="open === i.key"
              :disabled="pb.removed.value.has(i.key) || i.existing"
              :title="i.existing ? 'Already in the bundle' : open === i.key ? 'Close' : 'Edit'"
              data-test="pack-item-open"
              @click="toggle(i.key)"
            >
              <span class="wp-pack-list__name">
                <code v-if="i.kind !== 'template'">{{ label(i) }}</code>
                {{ i.kind === 'template' || i.var ? i.name : '' }}
                <LoadingMark v-if="pb.changing.value === i.key" decorative />
                <span
                  v-if="pb.changes.value[i.key]"
                  class="wp-pack-list__change"
                  :data-change="pb.changes.value[i.key].kind"
                  :title="pb.changes.value[i.key].kind === 'new' ? 'Added this round' : `Changed this round: ${pb.changes.value[i.key].what.join(', ')}`"
                  data-test="pack-item-changed"
                ><i :class="['pi', pb.changes.value[i.key].kind === 'new' ? 'pi-plus' : 'pi-pencil']" aria-hidden="true" />{{ pb.changes.value[i.key].kind === 'new' ? 'new' : pb.changes.value[i.key].what.slice(0, 2).join(', ') }}</span>
                <span
                  v-if="pb.locked(i.key)"
                  class="wp-pack-list__change"
                  data-change="yours"
                  title="You set this by hand; the AI's next answer keeps it as it is"
                  data-test="pack-item-locked"
                ><i class="pi pi-lock" aria-hidden="true" />yours</span>
              </span>
              <span v-if="i.about" class="wp-pack-list__about">{{ i.about }}</span>
              <span v-if="meta(i).length || i.tags.length" class="wp-pack-list__meta">
                <span v-for="m in meta(i)" :key="m">{{ m }}</span>
                <span v-for="t in i.tags.slice(0, TAGS_SHOWN)" :key="t" class="wp-pack-list__tag">#{{ t }}</span>
                <span v-if="i.tags.length > TAGS_SHOWN" class="wp-pack-list__tag" :title="i.tags.slice(TAGS_SHOWN).map((t) => `#${t}`).join(' ')">+{{ i.tags.length - TAGS_SHOWN }}</span>
              </span>
            </button>
            <button
              v-if="!i.existing"
              type="button"
              class="wp-pack-list__icon"
              :aria-label="pb.removed.value.has(i.key) ? `Keep ${i.name}` : `Remove ${i.name}`"
              :title="pb.removed.value.has(i.key) ? 'Keep it' : 'Leave it out'"
              data-test="pack-remove"
              @click="pb.removeItem(i.key); if (open === i.key) open = ''"
            ><i :class="['pi', pb.removed.value.has(i.key) ? 'pi-undo' : 'pi-times']" aria-hidden="true" /></button>
          </div>
          <PackItemEditor v-if="open === i.key && !pb.removed.value.has(i.key)" :item="i" />
        </li>
      </ul>
    </section>
    <div class="wp-pack-list__add">
      <Button v-if="!adding" size="sm" variant="ghost" icon="pi-plus" :disabled="pb.convo.loading.value" data-test="pack-add" @click="adding = true">Add an item</Button>
      <div v-else class="wp-pack-list__adder" data-test="pack-adder">
        <div class="wp-pack-list__ask">
          <input
            v-model="addAsk"
            class="wp-input wp-input--sm"
            placeholder="Describe what to add and the AI plans it…"
            aria-label="Describe items to add"
            :disabled="!!pb.changing.value"
            data-test="pack-add-ask"
            @keydown.enter.prevent="addWithAi"
          >
          <Button size="sm" icon="pi-microchip-ai" :disabled="!addAsk.trim() || !!pb.changing.value" :loading="pb.changing.value === '+'" data-test="pack-add-ai" @click="addWithAi">Plan it</Button>
        </div>
        <div class="wp-pack-list__kinds">
          <span class="wp-pack-list__dim">or add a blank one:</span>
          <button v-for="k in ADD_KINDS.filter((k) => !graphed || k.kind !== 'combine')" :key="k.kind" type="button" class="wp-pack-list__chip" data-test="pack-add-kind" @click="add(k.kind, '')">{{ k.label }}</button>
          <button v-if="!graphed && !items.some((i) => i.kind === 'template')" type="button" class="wp-pack-list__chip" @click="add('template', '')">Template</button>
          <button type="button" class="wp-pack-list__chip wp-pack-list__cancel" @click="adding = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-pack-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.wp-pack-list__section {
  width: 100%; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; padding: 6px 4px; border: 0;
  border-radius: min(6px, var(--wp-radius-cap, 999px)); background: none; color: var(--wp-text); font: inherit; cursor: pointer; text-align: left;
}
.wp-pack-list__section:hover { background: var(--wp-bg-2); }
.wp-pack-list__section .pi { font-size: 11px; color: var(--wp-text-dim); }
.wp-pack-list__section-name { font-size: 13px; font-weight: 600; }
.wp-pack-list__count { font-size: 11px; padding: 0 6px; border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-2); color: var(--wp-text-muted); }
.wp-pack-list__section-about { flex-basis: 100%; padding-left: 36px; font-size: 12px; color: var(--wp-text-dim); }
.wp-pack-list__items { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-direction: column; }
.wp-pack-list__row { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; border-top: 1px solid var(--wp-border); min-width: 0; }
.wp-pack-list__items > li:first-child > .wp-pack-list__row { border-top: 0; }
li[data-removed] > .wp-pack-list__row { opacity: 0.45; }
li[data-existing] .wp-pack-list__main { opacity: 0.7; cursor: default; }
li[data-removed] .wp-pack-list__main { text-decoration: line-through; }
.wp-pack-list__kind {
  flex: none; width: 84px; margin-top: 2px; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; padding: 2px 0; border-radius: min(4px, var(--wp-radius-cap, 999px));
  color: var(--wp-kind-wildcard); background: var(--wp-kind-wildcard-bg);
}
.wp-pack-list__kind[data-kind="fixed_values"] { color: var(--wp-kind-fixed); background: var(--wp-kind-fixed-bg); }
.wp-pack-list__kind[data-kind="derivation"] { color: var(--wp-kind-derivation); background: var(--wp-kind-derivation-bg); }
.wp-pack-list__kind[data-kind="combine"] { color: var(--wp-kind-combine); background: var(--wp-kind-combine-bg); }
.wp-pack-list__kind[data-kind="constraint"] { color: var(--wp-kind-constraint); background: var(--wp-kind-constraint-bg); }
.wp-pack-list__kind[data-kind="template"] { color: var(--wp-kind-ref); background: var(--wp-kind-ref-bg); }
.wp-pack-list__kind[data-kind="library"] { color: var(--wp-success); background: color-mix(in oklab, var(--wp-success) 14%, transparent); }
li[data-existing] .wp-pack-list__kind { color: var(--wp-text-muted); background: var(--wp-bg-2); }
.wp-pack-list__main {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: none; padding: 0;
  text-align: left; color: inherit; font: inherit; cursor: pointer;
}
.wp-pack-list__main:disabled { cursor: default; }
.wp-pack-list__name { font-size: 13px; overflow-wrap: anywhere; }
.wp-pack-list__name code { color: var(--wp-kind-wildcard); font-size: 12px; }
.wp-pack-list__change {
  display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 0 6px; border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-size: 10px; font-weight: 500; vertical-align: 1px; color: var(--wp-accent-text); border: 1px solid var(--wp-accent-400);
}
.wp-pack-list__change[data-change="new"] { color: var(--wp-success); border-color: color-mix(in srgb, var(--wp-success) 60%, transparent); }
.wp-pack-list__change[data-change="yours"] { color: var(--wp-text-muted); }
.wp-pack-list__change .pi { font-size: 9px; }
.wp-pack-list__about {
  font-size: 12px; color: var(--wp-text-muted); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wp-pack-list__main[aria-expanded="true"] .wp-pack-list__about { -webkit-line-clamp: unset; line-clamp: unset; }
.wp-pack-list__meta { display: flex; flex-wrap: wrap; gap: 3px 8px; font-size: 11px; color: var(--wp-text-dim); overflow-wrap: anywhere; }
.wp-pack-list__tag { padding: 0 6px; border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-2); color: var(--wp-text-muted); }
.wp-pack-list__icon {
  flex: none; width: 26px; height: 26px; border: 0; border-radius: min(6px, var(--wp-radius-cap, 999px)); background: none;
  color: var(--wp-text-dim); cursor: pointer;
}
.wp-pack-list__icon:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack-list__add { margin-top: 4px; }
.wp-pack-list__adder { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: min(8px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-1); }
.wp-pack-list__ask { display: flex; gap: 6px; }
.wp-pack-list__ask input { flex: 1; min-width: 0; }
.wp-pack-list__kinds { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wp-pack-list__dim { font-size: 12px; color: var(--wp-text-dim); }
.wp-pack-list__chip {
  padding: 3px 9px; border-radius: min(6px, var(--wp-radius-cap, 999px)); font-size: 12px; cursor: pointer;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text);
}
.wp-pack-list__cancel { border-style: dashed; color: var(--wp-text-muted); }
</style>
