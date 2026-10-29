<script setup lang="ts">
import Badge from "@/kit/Badge.vue";
import Button from "../../components/ui/Button.vue";
import Icon from "../../components/ui/Icon.vue";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <p class="wp-kit__caption">On a corner</p>
    <div class="wp-kit__row">
      <Badge :count="3" tone="danger" label="3 problems"><Button variant="ghost" icon="pi-bell" aria-label="Problems" /></Badge>
      <Badge :count="128" label="128 new"><Button variant="secondary">Inbox</Button></Badge>
      <Badge dot tone="warn" label="Out of date"><Icon name="pi-box" :size="20" /></Badge>
      <Badge :count="0" label="No problems"><Button variant="ghost" icon="pi-check" aria-label="Checks" /></Badge>
    </div>
    <p class="wp-kit__caption">In the line</p>
    <div class="wp-kit__row">
      <Badge dot tone="success" text="Running" pulse />
      <Badge dot tone="warn" text="Out of date" />
      <Badge dot tone="danger" text="Failed" />
      <Badge dot tone="neutral" text="Off" />
      <Badge :count="12" tone="neutral" label="12 options" />
      <Badge :count="4" tone="info" text="new" />
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas</p>
      <div class="wp-kit__row">
        <Badge dot tone="accent" label="Changed" />
        <Badge :count="2" tone="warn" text="conflicts" />
      </div>
    </div>
  </div>
</template>
