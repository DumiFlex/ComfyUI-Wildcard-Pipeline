<script setup lang="ts">
import { ref } from "vue";
import DatePicker from "@/kit/DatePicker.vue";
import { fromDate, toYmd, addDays } from "@/kit/calendar";

const today = toYmd(fromDate(new Date()));
const weekAgo = toYmd(addDays(fromDate(new Date()), -7));
const since = ref<string | null>(weekAgo);
const empty = ref<string | null>(null);
const canvas = ref<string | null>(today);
</script>

<template>
  <div class="wp-kit__stack">
    <div class="wp-kit__row">
      <DatePicker v-model="since" :max="today" clearable aria-label="Changed since" />
      <DatePicker v-model="empty" aria-label="Run on" />
      <DatePicker :model-value="today" disabled aria-label="Disabled" />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <DatePicker v-model="canvas" size="sm" aria-label="Canvas date" />
    </div>
  </div>
</template>
