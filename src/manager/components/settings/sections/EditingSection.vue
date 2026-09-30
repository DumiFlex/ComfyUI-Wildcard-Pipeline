<script setup lang="ts">
import Toggle from "../../ui/Toggle.vue";
import Select from "../../ui/Select.vue";
import type { SelectOption } from "../../ui/select-types";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { useUiStore, type SubcatDefault } from "../../../stores/uiStore";

const ui = useUiStore();

const SUBCAT_DEFAULT_OPTIONS: SelectOption[] = [
  { value: "populated", label: "Expanded when it has groups" },
  { value: "always", label: "Always expanded" },
  { value: "never", label: "Always collapsed" },
];
</script>

<template>
  <SettingGroup title="Wildcard editor">
    <SettingRow
      label="Keep empty tag groups"
      hint="A group with no tags in it normally disappears when you save the wildcard. Turn this on to keep the empty box so you can fill it later."
      setting-key="keep-empty-groups"
    >
      <Toggle
        :model-value="ui.keepEmptyTagGroups"
        aria-label="Keep empty tag groups"
        data-test="settings-keep-empty-groups"
        @update:model-value="ui.setKeepEmptyTagGroups($event)"
      />
    </SettingRow>
    <SettingRow
      label="Sub-categories panel"
      hint="Whether the sub-categories / axes panel opens on its own when you edit a wildcard."
      setting-key="subcat-panel"
    >
      <Select
        :model-value="ui.subcatDefault"
        :options="SUBCAT_DEFAULT_OPTIONS"
        :filterable="false"
        aria-label="Sub-categories panel default"
        data-test="settings-subcat-default"
        @update:model-value="(v) => ui.setSubcatDefault(v as SubcatDefault)"
      />
    </SettingRow>
  </SettingGroup>
</template>
