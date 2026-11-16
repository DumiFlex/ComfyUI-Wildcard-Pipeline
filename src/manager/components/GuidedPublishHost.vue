<script setup lang="ts">
/**
 * The single host of the guided-publish gate (B3): both publish entry
 * points (CommunityRowActions, ExportTab) route through the guided-publish
 * store, and this lone dialog renders whenever it opens.
 *
 * Its own async chunk: the store pulls in the publish path and its Zod
 * validators (~40 KB gzip), which the boot chunk shouldn't carry. AppLayout
 * mounts this only once something has used the store (see
 * `publishGateUsed` there), and anything that does already loaded the store.
 */
import UnmetDepsDialog from "./UnmetDepsDialog.vue";
import { useGuidedPublishStore } from "../import-export/guided-publish-store";

const guidedPublish = useGuidedPublishStore();
</script>

<template>
  <UnmetDepsDialog
    :open="guidedPublish.open"
    :module-name="guidedPublish.pendingModule?.name ?? ''"
    :unmet-rows="guidedPublish.unmetRows"
    @publish-dep="guidedPublish.publishDep"
    @publish-anyway="guidedPublish.publishAnyway"
    @cancel="guidedPublish.cancel"
  />
</template>
