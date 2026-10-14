<script setup lang="ts">
/**
 * BundleSplitModal — "Make sub-bundles" in the bundle editor. Each child
 * that isn't a bundle gets a sub-bundle name (typed, picked, or suggested
 * by the AI); children with the same name become one sub-bundle, placed
 * where its first child was. The AI only suggests runs of neighbours, so
 * the bundle runs in the same order; a hand-made group with a gap is
 * flagged because the children after the gap would run earlier.
 */
import { computed, ref, watch } from "vue";
import Button from "./ui/Button.vue";
import Modal from "./ui/Modal.vue";
import { api, ApiError } from "../api/client";
import { useAiConfig } from "../composables/useAiConfig";

export interface SplitGroup {
  name: string;
  about: string;
  /** Child indexes, in order. */
  members: number[];
}

const props = defineProps<{
  open: boolean;
  bundleName: string;
  children: Array<Record<string, unknown>>;
  /** Another bundle holds this one, so it can't hold sub-bundles. */
  nested: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "apply", groups: SplitGroup[]): void;
}>();

const { ready } = useAiConfig();
const labels = ref<string[]>([]);
const about = ref<Record<string, string>>({});
const ask = ref("");
const loading = ref(false);
const error = ref("");
let controller: AbortController | null = null;

watch(() => props.open, (v) => {
  if (!v) {
    controller?.abort();
    return;
  }
  labels.value = props.children.map(() => "");
  about.value = {};
  error.value = "";
  ask.value = "";
}, { immediate: true });

function childName(c: Record<string, unknown>): string {
  if (c.type === "bundle") return String(c.name ?? "bundle");
  const meta = c.meta as { name?: string; library_name?: string } | undefined;
  return meta?.name ?? meta?.library_name ?? String(c.name ?? c.id ?? "module");
}

const groups = computed<SplitGroup[]>(() => {
  const out = new Map<string, SplitGroup>();
  labels.value.forEach((raw, n) => {
    const name = raw.trim();
    if (!name || props.children[n]?.type === "bundle") return;
    const key = name.toLowerCase();
    const g = out.get(key) ?? { name, about: about.value[key] ?? "", members: [] };
    g.members.push(n);
    out.set(key, g);
  });
  return [...out.values()];
});

const names = computed(() => groups.value.map((g) => g.name));

/** Groups with a gap: the children after it would run earlier. */
const gaps = computed(() => groups.value.filter(
  (g) => g.members[g.members.length - 1] - g.members[0] + 1 !== g.members.length,
));

async function suggest(): Promise<void> {
  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  error.value = "";
  try {
    const res = await api.ai.bundleSplit({
      name: props.bundleName, children: props.children,
      ...(ask.value.trim() ? { instruction: ask.value.trim() } : {}),
    }, mine.signal);
    const next = props.children.map(() => "");
    const notes: Record<string, string> = {};
    for (const g of res.groups) {
      for (let n = g.start; n <= g.end; n += 1) {
        if (props.children[n]?.type !== "bundle") next[n] = g.name;
      }
      notes[g.name.toLowerCase()] = g.about;
    }
    labels.value = next;
    about.value = notes;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
  } finally {
    if (controller === mine) {
      controller = null;
      loading.value = false;
    }
  }
}

function setLabel(n: number, v: string): void {
  const next = [...labels.value];
  next[n] = v;
  labels.value = next;
}

function apply(): void {
  if (groups.value.length) emit("apply", groups.value);
}
</script>

<template>
  <Modal :open="open" title="Make sub-bundles" size="md" @update:open="(v: boolean) => !v && emit('close')">
    <p v-if="nested" class="wp-split__note" data-test="split-nested">
      Another bundle holds {{ bundleName || 'this bundle' }}, so it can't hold sub-bundles (two levels at most).
    </p>
    <template v-else>
      <p class="wp-split__note">
        Give children a sub-bundle name. Children with the same name become one sub-bundle, placed where the first
        of them was, so each part can be reused on its own.
      </p>
      <div v-if="ready" class="wp-split__ai">
        <input
          v-model="ask"
          class="wp-input wp-input--sm"
          placeholder="How to group them (optional): by body part, character vs. scene…"
          aria-label="How to group the children"
          :disabled="loading"
          data-test="split-ask"
          @keydown.enter.prevent="suggest"
        >
        <Button size="sm" icon="pi-microchip-ai" :loading="loading" data-test="split-suggest" @click="suggest">Suggest with AI</Button>
      </div>
      <p v-if="error" class="wp-split__error" role="alert">{{ error }}</p>
      <ol class="wp-split__list" data-test="split-list">
        <li v-for="(c, n) in children" :key="n" :data-bundle="c.type === 'bundle' ? 'true' : undefined">
          <span class="wp-split__name">{{ childName(c) }}</span>
          <span class="wp-split__type">{{ c.type }}</span>
          <span v-if="c.type === 'bundle'" class="wp-split__dim">already a sub-bundle</span>
          <input
            v-else
            class="wp-input wp-input--sm wp-split__label"
            :value="labels[n]"
            list="wp-split-names"
            placeholder="stays in the bundle"
            :aria-label="`Sub-bundle for ${childName(c)}`"
            data-test="split-label"
            @input="setLabel(n, ($event.target as HTMLInputElement).value)"
          >
        </li>
      </ol>
      <datalist id="wp-split-names">
        <option v-for="g in names" :key="g" :value="g" />
      </datalist>
      <p v-if="gaps.length" class="wp-split__warn" data-test="split-gap">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" />
        {{ gaps.map((g) => g.name).join(', ') }} {{ gaps.length === 1 ? 'has' : 'have' }} children that aren't next to
        each other: the ones after the gap will run earlier. Check rules that read them.
      </p>
    </template>
    <template #footer>
      <span class="wp-split__dim">
        {{ groups.length ? `${groups.length} sub-bundle${groups.length === 1 ? '' : 's'}: ${groups.map((g) => `${g.name} (${g.members.length})`).join(', ')}` : 'No groups yet' }}
      </span>
      <span class="wp-spacer" />
      <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
      <Button variant="primary" size="sm" icon="pi-box" :disabled="nested || !groups.length || loading" data-test="split-apply" @click="apply">Make sub-bundles</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-split__note { margin: 0 0 10px; font-size: 13px; color: var(--wp-text-muted); }
.wp-split__ai { display: flex; gap: 6px; margin-bottom: 10px; }
.wp-split__ai input { flex: 1; min-width: 0; }
.wp-split__error { margin: 0 0 8px; font-size: 12px; color: var(--wp-danger); }
.wp-split__list { margin: 0; padding: 0 0 0 22px; display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto; }
.wp-split__list li { display: flex; gap: 8px; align-items: center; font-size: 13px; min-width: 0; }
.wp-split__list li[data-bundle] { color: var(--wp-text-muted); }
.wp-split__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wp-split__type { flex: none; font-size: 11px; color: var(--wp-text-dim); }
.wp-split__label { flex: none; width: 150px; }
.wp-split__dim { font-size: 12px; color: var(--wp-text-dim); }
.wp-split__warn { margin: 10px 0 0; font-size: 12px; color: var(--wp-warn); display: flex; gap: 6px; align-items: baseline; }
</style>
