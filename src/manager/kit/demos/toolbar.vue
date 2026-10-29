<script setup lang="ts">
import { ref } from "vue";
import Separator from "@/kit/Separator.vue";
import Toolbar from "@/kit/Toolbar.vue";
import WpButton from "@/kit/WpButton.vue";
import Button from "../../components/ui/Button.vue";

const last = ref("");
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <Toolbar label="Option tools">
      <Button size="sm" variant="ghost" icon="pi-tag" @click="last = 'Tag'">Tag</Button>
      <Button size="sm" variant="ghost" icon="pi-sliders-h" @click="last = 'Weight'">Weight</Button>
      <Separator orientation="vertical" />
      <Button size="sm" variant="ghost" icon="pi-copy" aria-label="Duplicate" @click="last = 'Duplicate'" />
      <Button size="sm" variant="danger" icon="pi-trash" aria-label="Delete" @click="last = 'Delete'" />
    </Toolbar>
    <p class="wp-kit__muted">Tab in once, then use the arrow keys. {{ last ? `Last: ${last}` : "" }}</p>
    <p class="wp-kit__caption">Attached (button group)</p>
    <div class="wp-kit__row">
      <Toolbar label="Zoom" attached>
        <Button size="sm" variant="secondary" icon="pi-minus" aria-label="Zoom out" />
        <Button size="sm" variant="secondary">100%</Button>
        <Button size="sm" variant="secondary" icon="pi-plus" aria-label="Zoom in" />
      </Toolbar>
      <Toolbar label="Disabled member" attached>
        <Button size="sm" variant="secondary">Grid</Button>
        <Button size="sm" variant="secondary" disabled>Detail</Button>
        <Button size="sm" variant="secondary">Zoom</Button>
      </Toolbar>
    </div>
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm</p>
      <Toolbar label="Row tools" size="sm">
        <WpButton variant="ghost" icon="pi-eye" aria-label="Preview" />
        <WpButton variant="ghost" icon="pi-pencil" aria-label="Edit" />
        <WpButton variant="ghost" icon="pi-ellipsis-h" aria-label="More" />
      </Toolbar>
    </div>
  </div>
</template>
