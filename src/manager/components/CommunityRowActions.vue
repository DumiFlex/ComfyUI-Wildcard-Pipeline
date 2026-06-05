<script setup lang="ts">
/**
 * Two-button row action group: Upload-to-community + Copy-payload.
 *
 * Drops into every list view's #actions slot + every editor's footer
 * toolbar so the community publish path isn't hidden inside the
 * Import/Export tab. Same engine-row shape as the Export tab's
 * "Publish to community" button — both code paths go through
 * `single-row-publish` helpers.
 *
 * Renders as bare icon buttons styled to match the existing
 * actions-column convention (the trash icon at the row's right
 * edge). Sized small so they don't dominate the row.
 */
import type { BundleRow, ModuleRow } from "../api/types";
import Button from "./ui/Button.vue";
import { useToast } from "../composables/useToast";
import {
  buildBundlePublishable,
  buildModulePublishable,
  copyPayloadToClipboard,
  publishToCommunity,
} from "../import-export/single-row-publish";

interface Props {
  /** Library row to act on. Module rows carry `type`; bundle rows carry `children`. */
  row: ModuleRow | BundleRow;
  /** Discriminator for the shape — module vs bundle. */
  kind: "module" | "bundle";
  /**
   * When true, renders Upload+Copy as full pill buttons (label+icon).
   * Default is icon-only, which is what the per-row actions column
   * wants. Editor footers pass `true` so the action is more
   * discoverable next to the Delete pill.
   */
  labeled?: boolean;
}
const props = defineProps<Props>();
const toast = useToast();

function publishablePayload() {
  if (props.kind === "bundle") {
    return buildBundlePublishable(props.row as BundleRow);
  }
  return buildModulePublishable(props.row as ModuleRow);
}

function onPublish() {
  publishToCommunity(publishablePayload());
}

async function onCopy() {
  const ok = await copyPayloadToClipboard(publishablePayload());
  if (ok) {
    toast.push({
      severity: "success",
      summary: "Payload copied",
      detail: "Engine-row JSON is on your clipboard.",
      life: 2500,
    });
  } else {
    toast.push({
      severity: "error",
      summary: "Copy failed",
      detail: "Clipboard access was denied by the browser.",
      life: 3500,
    });
  }
}
</script>

<template>
  <template v-if="labeled">
    <Button
      variant="secondary"
      size="sm"
      icon="pi-share-alt"
      :aria-label="`Publish ${row.name} to community`"
      :title="`Publish ${row.name} to community`"
      @click="onPublish"
    >Publish</Button>
    <Button
      variant="ghost"
      size="sm"
      icon="pi-copy"
      :aria-label="`Copy ${row.name} payload`"
      :title="`Copy ${row.name} payload to clipboard`"
      @click="onCopy"
    >Copy</Button>
  </template>
  <template v-else>
    <Button
      variant="ghost"
      size="sm"
      icon="pi-share-alt"
      :aria-label="`Publish ${row.name} to community`"
      :title="`Publish ${row.name} to community`"
      @click="onPublish"
    />
    <Button
      variant="ghost"
      size="sm"
      icon="pi-copy"
      :aria-label="`Copy ${row.name} payload`"
      :title="`Copy ${row.name} payload to clipboard`"
      @click="onCopy"
    />
  </template>
</template>
