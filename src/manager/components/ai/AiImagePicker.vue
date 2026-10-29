<script setup lang="ts">
/**
 * AiImagePicker — reference images for an AI request (pack builder plan
 * step, Draft with AI panels). Drop, paste or pick; thumbnails with a
 * remove button. State lives in the caller's `useAiImages()`; this only
 * draws it. Hidden behind a line of text when the model can't see images
 * (compact: hidden altogether, so the Draft panels stay small).
 */
import { onMounted, ref, watch } from "vue";
import { useAiConfig } from "../../composables/useAiConfig";
import { checkVision, type AiImages } from "../../composables/useAiImages";
import LoadingMark from "@/components/shared/LoadingMark.vue";

const props = withDefaults(defineProps<{
  images: AiImages;
  disabled?: boolean;
  /** What the model does with them, shown under the drop zone. */
  hint?: string;
  compact?: boolean;
}>(), { hint: "", compact: false });

const fileInput = ref<HTMLInputElement | null>(null);
const over = ref(false);

onMounted(() => { void checkVision(); });
// A new model (Settings, the chat's model picker) may see images or not.
const { config } = useAiConfig();
watch(() => config.value?.model, () => { void checkVision(); });

function pick(): void {
  if (!props.disabled) fileInput.value?.click();
}

function onFiles(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  if (input.files?.length) void props.images.add([...input.files]);
  input.value = "";
}

function onDrop(ev: DragEvent): void {
  over.value = false;
  if (props.disabled) return;
  const files = ev.dataTransfer?.files;
  if (files?.length) void props.images.add([...files]);
}

function onPaste(ev: ClipboardEvent): void {
  if (props.disabled) return;
  const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    ev.preventDefault();
    void props.images.add(files);
  }
}
</script>

<template>
  <div
    v-if="!(compact && images.blind.value)"
    class="wp-ai-images"
    :data-compact="compact ? 'true' : undefined"
    data-test="ai-images"
  >
    <p v-if="images.blind.value" class="wp-ai-images__blind">
      <i class="pi pi-eye-slash" aria-hidden="true" />
      {{ images.visionModel.value || 'This model' }} can't see images; pick a vision model in
      <RouterLink to="/settings/ai">Settings › AI assistant</RouterLink> to add reference pictures.
    </p>
    <template v-else>
      <div
        class="wp-ai-images__zone"
        :data-over="over ? 'true' : undefined"
        role="button"
        tabindex="0"
        :aria-disabled="disabled || images.full.value || undefined"
        aria-label="Add reference images: drop, paste or pick"
        data-test="ai-images-zone"
        @click="pick"
        @keydown.enter.prevent="pick"
        @keydown.space.prevent="pick"
        @dragover.prevent="over = true"
        @dragleave="over = false"
        @drop.prevent="onDrop"
        @paste="onPaste"
      >
        <div
          v-for="(img, i) in images.images.value"
          :key="img.url.slice(-24) + i"
          class="wp-ai-images__thumb"
        >
          <img :src="img.url" :alt="img.name">
          <span v-if="images.images.value.length > 1" class="wp-ai-images__num" :title="`Image ${i + 1}: call it that in your request`" data-test="ai-image-num">{{ i + 1 }}</span>
          <button
            type="button"
            class="wp-ai-images__remove"
            :aria-label="`Remove ${img.name}`"
            :disabled="disabled"
            data-test="ai-image-remove"
            @click.stop="images.remove(i)"
          ><i class="pi pi-times" aria-hidden="true" /></button>
        </div>
        <span v-if="!images.full.value" class="wp-ai-images__add">
          <LoadingMark v-if="images.busy.value" decorative />
          <i v-else class="pi pi-image" aria-hidden="true" />
          {{ images.images.value.length ? 'Add' : compact ? 'Add images' : 'Drop, paste or pick reference images' }}
        </span>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Pick reference images"
          data-test="ai-images-input"
          @change="onFiles"
        >
      </div>
      <p v-if="images.error.value" class="wp-ai-images__error" role="alert">{{ images.error.value }}</p>
      <p v-else-if="hint && !compact" class="wp-ai-images__hint">{{ hint }}</p>
    </template>
  </div>
</template>

<style scoped>
.wp-ai-images { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-ai-images__zone {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; min-height: 44px;
  border: 1px dashed var(--wp-border); border-radius: min(8px, var(--wp-radius-cap, 999px)); cursor: pointer; background: var(--wp-bg-1);
}
.wp-ai-images[data-compact] .wp-ai-images__zone { padding: 5px; min-height: 34px; }
.wp-ai-images__zone[data-over], .wp-ai-images__zone:focus-visible {
  border-color: var(--wp-accent-400); outline: none;
  background: color-mix(in oklab, var(--wp-accent-500) 10%, var(--wp-bg-1));
}
.wp-ai-images__zone[aria-disabled="true"] { cursor: default; }
.wp-ai-images__thumb { position: relative; width: 56px; height: 56px; border-radius: min(6px, var(--wp-radius-cap, 999px)); overflow: hidden; flex: none; }
.wp-ai-images[data-compact] .wp-ai-images__thumb { width: 40px; height: 40px; }
.wp-ai-images__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wp-ai-images__remove {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: min(50%, var(--wp-radius-cap, 999px));
  background: rgb(0 0 0 / 0.65); color: #fff; cursor: pointer; font-size: 9px; display: grid; place-items: center;
}
.wp-ai-images__num {
  position: absolute; left: 2px; bottom: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: rgb(0 0 0 / 0.65); color: #fff; font-size: 10px; font-weight: 600; line-height: 16px; text-align: center;
}
.wp-ai-images__add { font-size: 12px; color: var(--wp-text-muted); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-images__hint, .wp-ai-images__blind { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-images__blind { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.wp-ai-images__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
</style>
