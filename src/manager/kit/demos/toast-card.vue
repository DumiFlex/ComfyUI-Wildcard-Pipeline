<script setup lang="ts">
import ToastCard from "@/kit/ToastCard.vue";
</script>

<template>
  <div class="wp-kit__stack">
    <ToastCard tone="success" summary="Saved Hair colour" action-label="Undo" />
    <ToastCard tone="info" summary="Copied to the library" />
    <ToastCard tone="warn" summary="Mood fits weather" detail="Its source wildcard is missing." />
    <ToastCard tone="error" summary="Couldn't save" detail="The server said: database is locked." />
  </div>
</template>
