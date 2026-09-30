<script setup lang="ts">
/**
 * "Send to Test Runner" — jumps to the Test Runner with a module (or bundle)
 * preselected via `?kind=&module=`, which TestRunner reads on mount.
 *
 * `compact` renders an icon-only row action (its aria-label doubles as the
 * hover tooltip); the full form carries a label for an editor header. Only
 * makes sense for a SAVED module — callers gate on an existing id.
 *
 * The full form also says how many saved scenarios use the item, linking to
 * the Test Runner with the rail narrowed to them (`?uses=<id>`).
 */
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "./ui/Button.vue";
import { api } from "../api/client";

/** The Test Runner's selectable kinds — module types plus the bundle pseudo-kind. */
export type TestRunnerKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

const props = defineProps<{
  kind: TestRunnerKind;
  id: string;
  /** Icon-only row action (true) vs labelled header button (false/omitted). */
  compact?: boolean;
}>();

const router = useRouter();

function go(): void {
  void router.push({ name: "test", query: { kind: props.kind, module: props.id } });
}

/** Saved scenarios whose stack holds this item (full form only). */
const usedIn = ref(0);

onMounted(async () => {
  if (props.compact) return;
  try {
    const res = await api.scenarios.list(props.kind === "bundle" ? { bundle: props.id } : { module: props.id });
    usedIn.value = res.total;
  } catch {
    // Advisory only: a failed lookup just hides the count.
  }
});

function goScenarios(): void {
  void router.push({ name: "test", query: { uses: props.id } });
}
</script>

<template>
  <Button
    v-if="compact"
    variant="ghost"
    size="sm"
    icon="pi-bolt"
    aria-label="Send to Test Runner"
    data-test="send-to-test-runner"
    @click="go"
  />
  <span v-else class="wp-stt">
    <Button
      variant="secondary"
      size="sm"
      icon="pi-bolt"
      aria-label="Send to Test Runner"
      data-test="send-to-test-runner"
      @click="go"
    >Test Runner</Button>
    <Button
      v-if="usedIn"
      variant="ghost"
      size="sm"
      :title="`Open the Test Runner showing the ${usedIn} saved scenario${usedIn === 1 ? '' : 's'} that use this`"
      data-test="used-in-scenarios"
      @click="goScenarios"
    >In {{ usedIn }} scenario{{ usedIn === 1 ? "" : "s" }}</Button>
  </span>
</template>

<style scoped>
.wp-stt { display: inline-flex; align-items: center; gap: var(--wp-space-2); }
</style>
