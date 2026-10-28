<script setup lang="ts">
import Timeline, { type TimelineItem } from "@/components/shared/Timeline.vue";

const history: TimelineItem[] = [
  { id: 1, title: "Saved Hair colour", time: "5 min ago", tone: "success", icon: "pi-check", body: "Added 3 options: silver, auburn, teal." },
  { id: 2, title: "Lighting rule changed", time: "12 min ago", tone: "accent", icon: "pi-pencil" },
  { id: 3, title: "Import found 2 duplicates", time: "1 h ago", tone: "warn", icon: "pi-exclamation-triangle" },
  { id: 4, title: "Building the pack", time: "now", pending: true },
];
const steps: TimelineItem[] = [
  { id: "a", title: "read Outfit", time: "0.4 s" },
  { id: "b", title: "draft_options", time: "2.1 s", tone: "info" },
  { id: "c", title: "update Outfit refused", time: "0.1 s", tone: "danger", body: "Option 4 is a duplicate." },
];
</script>

<template>
  <div class="wp-kit__stack">
    <Timeline :items="history" aria-label="History" />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Timeline :items="steps" size="sm" aria-label="Steps" />
    </div>
  </div>
</template>
