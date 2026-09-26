<script setup lang="ts">
/**
 * Per-seed trace, slid in from the right: every module in run order with
 * what it wrote. The seed is a real chain seed, so pasting it into a canvas
 * Context holding the same modules reproduces these values.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "../ui/Button.vue";
import type { ScenarioSample } from "../../api/types";
import { renderValue } from "../../utils/scenario";
import { KIND_META } from "./kinds";
import type { StackKind } from "../../utils/scenario";

const props = defineProps<{ sample: ScenarioSample | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const copied = ref(false);

const steps = computed(() => (props.sample?.trace ?? []).map((row) => ({
  ...row,
  kindMeta: KIND_META[(row.type in KIND_META ? row.type : "wildcard") as StackKind],
  off: row.status.startsWith("skipped"),
})));

async function copySeed(): Promise<void> {
  if (!props.sample) return;
  try {
    await navigator.clipboard.writeText(String(props.sample.seed));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    /* clipboard refused — the seed is visible in the header to select by hand */
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.sample) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <aside class="wp-trd" :data-open="sample ? 'true' : 'false'" aria-label="Seed trace" data-test="trace-drawer">
    <template v-if="sample">
      <header class="wp-trd__head">
        <h3>Seed <span class="wp-trd__seed">{{ sample.seed }}</span></h3>
        <span class="wp-trd__sp" />
        <Button variant="ghost" size="sm" icon="pi-copy" data-test="copy-seed" @click="copySeed">{{ copied ? "Copied" : "Copy seed" }}</Button>
        <Button variant="ghost" size="sm" icon="pi-times" aria-label="Close trace" data-test="close-trace" @click="emit('close')" />
      </header>
      <p class="wp-trd__note">Same seed on a canvas Context with these modules gives these values.</p>
      <p v-if="sample.error" class="wp-trd__err">{{ sample.error }}</p>
      <ol class="wp-trd__steps">
        <li
          v-for="(s, i) in steps"
          :key="i"
          class="wp-trd__step"
          :data-off="s.off ? 'true' : 'false'"
          :style="{ '--kc': s.kindMeta.color }"
          data-test="trace-step"
        >
          <div class="wp-trd__step-head">
            <span class="wp-trd__kind">{{ s.kindMeta.label }}</span>
            <strong>{{ s.name || s.id }}</strong>
            <span v-if="s.off" class="wp-trd__status">{{ s.status.replace("skipped_", "skipped: ") }}</span>
          </div>
          <div v-if="s.error" class="wp-trd__err">{{ s.error }}</div>
          <div v-else-if="s.writes.length" class="wp-trd__writes">
            <div v-for="(w, j) in s.writes" :key="j"><code>${{ w.variable }}</code> = {{ renderValue(w.value) }}</div>
          </div>
          <div v-else class="wp-trd__none">{{ s.type === "constraint" ? "re-weights a later pick, writes nothing" : "no change" }}</div>
          <ul v-if="s.refs?.length" class="wp-trd__refs" aria-label="Nested picks" data-test="trace-refs">
            <li
              v-for="(r, j) in s.refs"
              :key="j"
              :style="{ '--depth': r.depth }"
              data-test="trace-ref"
            >
              <span class="wp-trd__ref-name">@{{ r.name }}</span>
              <span class="wp-trd__ref-val">{{ renderValue(r.value) || "(empty)" }}</span>
            </li>
          </ul>
        </li>
      </ol>
      <section v-if="sample.warnings.length" class="wp-trd__warns">
        <h4>Warnings on this seed</h4>
        <p v-for="(w, i) in sample.warnings" :key="i">{{ w.message }}</p>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.wp-trd {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
  width: min(460px, 100vw); background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border-strong); box-shadow: -20px 0 40px rgba(0, 0, 0, .4);
  transform: translateX(100%); transition: transform .2s ease;
  display: flex; flex-direction: column; overflow: auto;
}
.wp-trd[data-open="true"] { transform: none; }
.wp-trd__head {
  position: sticky; top: 0; background: var(--wp-bg-1);
  display: flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-6); border-bottom: 1px solid var(--wp-border);
}
.wp-trd__head h3 { margin: 0; font-size: var(--wp-text-md); }
.wp-trd__seed { font-family: var(--wp-font-mono); }
.wp-trd__sp { flex: 1; }
.wp-trd__note { margin: 0; padding: var(--wp-space-5) var(--wp-space-6) 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trd__steps { list-style: none; margin: 0; padding: var(--wp-space-5) var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-trd__step {
  background: var(--wp-bg-2); border-left: 3px solid var(--kc); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-4) var(--wp-space-5); display: flex; flex-direction: column; gap: var(--wp-space-2);
  font-size: var(--wp-text-sm);
}
.wp-trd__step[data-off="true"] { opacity: .5; }
.wp-trd__step-head { display: flex; align-items: baseline; gap: var(--wp-space-4); }
.wp-trd__kind { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--kc); text-transform: uppercase; }
.wp-trd__status { margin-left: auto; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trd__writes { font: var(--wp-text-xs)/1.5 var(--wp-font-mono); color: var(--wp-text-muted); word-break: break-word; }
.wp-trd__writes code { color: var(--wp-accent-text); }
.wp-trd__refs {
  list-style: none; margin: var(--wp-space-1) 0 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--wp-space-1);
  font-size: var(--wp-text-xs); border-top: 1px dashed var(--wp-border); padding-top: var(--wp-space-2);
}
.wp-trd__refs li {
  display: flex; gap: var(--wp-space-3); align-items: baseline; min-width: 0;
  padding-left: calc(var(--depth) * var(--wp-space-5));
}
.wp-trd__refs li::before { content: "↳"; color: var(--wp-text-dim); }
.wp-trd__ref-name { font-family: var(--wp-font-mono); color: var(--wp-accent-text); white-space: nowrap; }
.wp-trd__ref-val { color: var(--wp-text-muted); word-break: break-word; }
.wp-trd__none { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trd__err { margin: 0; color: var(--wp-danger-text); font-size: var(--wp-text-xs); padding: 0 var(--wp-space-6); }
.wp-trd__step .wp-trd__err { padding: 0; }
.wp-trd__warns { padding: 0 var(--wp-space-6) var(--wp-space-6); font-size: var(--wp-text-xs); color: var(--wp-warn); }
.wp-trd__warns h4 { margin: 0 0 var(--wp-space-3); font-size: var(--wp-text-xs); color: var(--wp-text-muted); }
.wp-trd__warns p { margin: 0 0 var(--wp-space-2); }
@media (prefers-reduced-motion: reduce) { .wp-trd { transition: none; } }
</style>
