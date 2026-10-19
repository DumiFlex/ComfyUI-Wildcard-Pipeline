<script setup lang="ts">
/**
 * PackFindings — the plan review. Each finding can be applied (a fix the
 * checker knows, no model), dismissed, or ticked and sent to the planner
 * with "Fix with AI".
 */
import { computed } from "vue";
import Button from "../ui/Button.vue";
import type { AiPackFinding } from "../../api/types";
import { usePackBuilder } from "../../composables/usePackBuilder";

const pb = usePackBuilder();
const busy = computed(() => pb.convo.loading.value || !!pb.changing.value);
const fixes = computed(() => pb.findings.value.filter((f) => f.level === "fix").length);
const stuck = computed(() => pb.findings.value.filter((f) => pb.unfixed.value.has(f.id)).length);
const ticked = computed(() => pb.findings.value.filter((f) => pb.selected.value.has(f.id)).length);

function itemName(key: string): string {
  return pb.draft.value?.items.find((i) => i.key === key)?.name ?? "";
}

function patchLabel(f: AiPackFinding): string {
  const p = f.patch;
  if (!p) return "";
  if (p.label) return p.label;
  if (p.op === "plan") return "Apply";
  if (p.op === "add") return `Add ${p.item.kind === "template" ? "a template" : "it"}`;
  if (p.op === "remove") return "Remove it";
  if (p.op === "slot") return "Apply";
  return p.set.kind === "library" ? "Use yours" : "Apply";
}
</script>

<template>
  <div class="wp-pack-findings" data-test="pack-review">
    <p v-if="!pb.findings.value.length" class="wp-pack-findings__ok">
      <i class="pi pi-check" aria-hidden="true" /> Nothing to fix: every rule has what it needs.
    </p>
    <ul v-else class="wp-pack-findings__list">
      <li v-for="f in pb.findings.value" :key="f.id" :data-level="f.level" data-test="pack-finding">
        <input
          type="checkbox"
          class="wp-pack-findings__tick"
          :checked="pb.selected.value.has(f.id)"
          :aria-label="`Send to the AI: ${f.text}`"
          :disabled="busy"
          @change="pb.toggleSelected(f.id)"
        >
        <i :class="['pi', f.level === 'fix' ? 'pi-exclamation-triangle' : 'pi-lightbulb']" aria-hidden="true" />
        <span class="wp-pack-findings__text">
          <b v-if="f.key && itemName(f.key)">{{ itemName(f.key) }}: </b>{{ f.text }}<span v-if="f.by === 'model'" class="wp-pack-findings__by"> · AI review</span><span v-if="pb.stuck.value.has(f.id)" class="wp-pack-findings__by" data-test="pack-finding-stuck"> · the AI couldn't change this; do it by hand, dismiss it, or tick it to send it again</span><span v-else-if="pb.unfixed.value.has(f.id)" class="wp-pack-findings__by" data-test="pack-finding-unfixed"> · the AI left this unchanged</span>
        </span>
        <span class="wp-pack-findings__acts">
          <button v-if="f.patch" type="button" class="wp-pack-findings__btn" :disabled="busy" data-test="pack-finding-apply" @click="pb.applyFinding(f)">{{ patchLabel(f) }}</button>
          <button type="button" class="wp-pack-findings__btn wp-pack-findings__dismiss" :aria-label="`Dismiss: ${f.text}`" title="Dismiss" :disabled="busy" data-test="pack-finding-dismiss" @click="pb.dismissFinding(f.id)"><i class="pi pi-times" aria-hidden="true" /></button>
        </span>
      </li>
    </ul>
    <div class="wp-pack-findings__row">
      <span class="wp-pack-findings__dim">{{ stuck ? `The AI couldn't fix ${stuck} last time: apply its fix, edit the item, or dismiss it.` : fixes ? `${fixes} to fix before building.` : 'Checked against the authoring guide.' }}</span>
      <Button size="sm" variant="ghost" icon="pi-microchip-ai" :loading="pb.reviewing.value" :disabled="busy" data-test="pack-review-ai" @click="pb.reviewPlan()">Review with AI</Button>
      <Button
        v-if="pb.findings.value.length"
        size="sm"
        icon="pi-wrench"
        :disabled="busy"
        data-test="pack-fix"
        @click="pb.fixFindings"
      >{{ ticked ? `Fix ${ticked} with AI` : 'Fix all with AI' }}</Button>
    </div>
  </div>
</template>

<style scoped>
.wp-pack-findings__ok { margin: 0 0 4px; color: var(--wp-success); font-size: 13px; display: flex; gap: 6px; align-items: center; }
.wp-pack-findings__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.wp-pack-findings__list li { display: flex; gap: 8px; align-items: baseline; }
.wp-pack-findings__list li[data-level="fix"] > .pi { color: var(--wp-warn); }
.wp-pack-findings__list li[data-level="tip"] > .pi { color: var(--wp-accent-text); }
.wp-pack-findings__tick { flex: none; margin: 0; position: relative; top: 2px; accent-color: var(--wp-accent-500); }
.wp-pack-findings__text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wp-pack-findings__by { color: var(--wp-text-dim); }
.wp-pack-findings__acts { flex: none; display: inline-flex; gap: 4px; }
.wp-pack-findings__btn {
  padding: 2px 8px; border-radius: 5px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--wp-accent-400); background: none; color: var(--wp-accent-text);
}
.wp-pack-findings__dismiss { border-color: transparent; color: var(--wp-text-dim); padding: 2px 5px; }
.wp-pack-findings__dismiss:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack-findings__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.wp-pack-findings__dim { flex: 1; font-size: 12px; color: var(--wp-text-dim); }
</style>
