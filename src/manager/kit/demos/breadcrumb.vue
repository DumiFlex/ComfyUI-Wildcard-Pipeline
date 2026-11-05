<script setup lang="ts">
import Breadcrumb from "../../components/Breadcrumb.vue";

</script>

<template>
  <Breadcrumb :items="[{ to: '/wildcards', label: 'Wildcards' }, { label: 'Hair colour' }]" />
</template>
