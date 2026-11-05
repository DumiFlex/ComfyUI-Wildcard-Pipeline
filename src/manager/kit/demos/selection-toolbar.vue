<script setup lang="ts">
import SelectionToolbar from "../../components/SelectionToolbar.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <SelectionToolbar :count="3" :tags="['winter', 'summer', 'formal']" :common-tags="['winter']" reorderable negatives />
  </div>
</template>
