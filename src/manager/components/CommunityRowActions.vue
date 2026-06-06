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
import { useRouter } from "vue-router";
import type { BundleRow, ModuleRow } from "../api/types";
import Button from "./ui/Button.vue";
import { useToast } from "../composables/useToast";
import {
  buildBundlePublishable,
  buildModulePublishable,
  copyPayloadToClipboard,
  publishToCommunity,
  type PublishablePayload,
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
const router = useRouter();

/** Build the publishable payload. Bundle children ship as verbatim
 *  widget snapshots (history stripped); modules ship as engine rows. */
function publishablePayload(): PublishablePayload {
  if (props.kind === "bundle") {
    return buildBundlePublishable(props.row as BundleRow);
  }
  return buildModulePublishable(props.row as ModuleRow);
}

function onPublish() {
  try {
    publishToCommunity(publishablePayload(), router);
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Can't publish",
      detail: e instanceof Error ? e.message : String(e),
      life: 5000,
    });
  }
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
  <!-- Labeled mode wraps the two pills in a single flex container so
       hosts that flex-distribute their children (editor header-extra
       uses justify-content: space-between) keep the two buttons
       grouped instead of splitting Publish to the middle and Copy
       to the far right. Icon-only mode stays as a fragment because
       row-action cells expect each button as a sibling flex item. -->
  <div v-if="labeled" class="wpc-row-actions-labeled">
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
  </div>
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

<style scoped>
.wpc-row-actions-labeled {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
}
</style>
