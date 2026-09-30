<script setup lang="ts">
import Input from "../../ui/Input.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import SegControl, { type SegOption } from "../SegControl.vue";
import { MAX_TEST_RUNNER_SEEDS, useUiStore } from "../../../stores/uiStore";

const ui = useUiStore();

const MODES: SegOption<"range" | "random">[] = [
  { value: "range", label: "Range" },
  { value: "random", label: "Random" },
];
</script>

<template>
  <SettingGroup
    title="New scenarios"
    note="What a new Test Runner scenario (and a quick run from an editor) starts with. Saved scenarios keep their own seeds."
  >
    <SettingRow
      label="Seed mode"
      hint="Range uses consecutive seeds, so seed N here is seed N on the canvas and results compare run to run. Random picks a fresh set every run."
      setting-key="tr-mode"
    >
      <SegControl
        :model-value="ui.testRunnerDefaults.mode"
        :options="MODES"
        aria-label="Seed mode"
        test-prefix="settings-tr-mode"
        @update:model-value="(v) => ui.setTestRunnerDefaults({ mode: v === 'random' ? 'random' : 'range' })"
      />
    </SettingRow>
    <SettingRow
      v-if="ui.testRunnerDefaults.mode === 'range'"
      label="First seed"
      hint="Where the range starts. Keep it fixed to get the same prompts every time."
      setting-key="tr-from"
      for="settings-tr-from"
    >
      <Input
        id="settings-tr-from"
        :model-value="ui.testRunnerDefaults.from"
        type="number"
        :min="0"
        class="wp-set-num"
        data-test="settings-tr-from"
        @update:model-value="(v) => ui.setTestRunnerDefaults({ from: Number(v) })"
      />
    </SettingRow>
    <SettingRow
      label="Number of seeds"
      :hint="`How many prompts a run makes (1–${MAX_TEST_RUNNER_SEEDS.toLocaleString()}). More gives steadier odds, and takes longer.`"
      setting-key="tr-count"
      for="settings-tr-count"
    >
      <Input
        id="settings-tr-count"
        :model-value="ui.testRunnerDefaults.count"
        type="number"
        :min="1"
        :max="MAX_TEST_RUNNER_SEEDS"
        class="wp-set-num"
        data-test="settings-tr-count"
        @update:model-value="(v) => ui.setTestRunnerDefaults({ count: Number(v) })"
      />
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-num { width: 110px; }
</style>
