<script setup lang="ts">
import { ref } from "vue";
import InlineEdit from "@/kit/InlineEdit.vue";

const name = ref("Hair colour");
const chat = ref("");
const taken = ["Outfit", "Pose"];
const unique = ref("Lighting");
</script>

<template>
  <div class="wp-kit__stack">
    <span class="wp-kit__inline"><InlineEdit v-model="name" label="Wildcard name" /></span>
    <span class="wp-kit__inline"><InlineEdit v-model="chat" label="Chat title" placeholder="New chat" :required="false" /></span>
    <span class="wp-kit__inline">
      <InlineEdit v-model="unique" label="Name" :validate="(v: string) => (taken.includes(v) ? 'That name is taken' : null)" />
      <span class="wp-kit__muted">(Outfit and Pose are taken)</span>
    </span>
    <span class="wp-kit__inline"><InlineEdit model-value="Built in" label="Name" disabled /></span>
    <span class="wp-kit__inline" style="font-size: var(--wp-text-lg); font-weight: 600;"><InlineEdit v-model="name" label="Title" size="lg" /></span>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <InlineEdit v-model="name" label="Module name" size="sm" />
    </div>
  </div>
</template>
