<script setup lang="ts">
import { ref } from "vue";
import Button from "../../../kit/Button.vue";
import DraftBanner from "../../components/DraftBanner.vue";

const draftShown = ref(true);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <DraftBanner :has-draft="draftShown" :age-ms="12 * 60_000" @restore="draftShown = false" @discard="draftShown = false" />
    <Button v-if="!draftShown" size="sm" @click="draftShown = true">Show it again</Button>
  </div>
</template>
