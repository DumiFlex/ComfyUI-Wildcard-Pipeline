<script setup lang="ts">
import { ref } from "vue";
import SortableList from "@/components/shared/SortableList.vue";
import Chip from "../../components/ui/Chip.vue";

interface Rule { id: string; name: string; kind: string }
const rules = ref<Rule[]>([
  { id: "a", name: "Rogue → Shadowblade", kind: "derivation" },
  { id: "b", name: "Winter → no pastels", kind: "constraint" },
  { id: "c", name: "Night → moody light", kind: "derivation" },
  { id: "d", name: "Hair colour", kind: "wildcard" },
]);
const small = ref(["Hair", "Outfit", "Pose"]);
</script>

<template>
  <div class="wp-kit__stack">
    <SortableList v-model="rules" :item-key="(r: Rule) => r.id" :item-label="(r: Rule) => r.name" label="Rules">
      <template #item="{ item, index }">
        <div class="wp-kit__row" style="padding: 6px 8px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius);">
          <span class="wp-kit__muted">{{ index + 1 }}</span>
          <span style="flex: 1; color: var(--wp-text); font-size: var(--wp-text-sm);">{{ item.name }}</span>
          <Chip>{{ item.kind }}</Chip>
        </div>
      </template>
    </SortableList>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <SortableList v-model="small" :item-key="(s: string) => s" :item-label="(s: string) => s" label="Modules" size="sm">
        <template #item="{ item }"><span style="font-size: 12px;">{{ item }}</span></template>
      </SortableList>
    </div>
  </div>
</template>
