<script setup lang="ts">
/**
 * "Send to Test Runner" — jumps to the Test Runner with a module (or bundle)
 * preselected via `?kind=&module=`, which TestRunner reads on mount.
 *
 * `compact` renders an icon-only row action (its aria-label doubles as the
 * hover tooltip); the full form carries a label for an editor header. Only
 * makes sense for a SAVED module — callers gate on an existing id.
 */
import { useRouter } from "vue-router";
import Button from "./ui/Button.vue";

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
  <Button
    v-else
    variant="secondary"
    size="sm"
    icon="pi-bolt"
    aria-label="Send to Test Runner"
    data-test="send-to-test-runner"
    @click="go"
  >Test Runner</Button>
</template>
