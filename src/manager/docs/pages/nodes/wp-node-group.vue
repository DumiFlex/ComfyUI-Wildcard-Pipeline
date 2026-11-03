<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Node Group"
    icon="pi pi-sitemap"
    tone="node"
    node-id="WP_NodeGroup"
    blurb="Gather nodes so one WP Toggles switch mutes or bypasses them all."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Node Group</b> collects nodes for a WP Toggles control. Wire the nodes in on the left
        and its output into a toggle's dot: when the toggle is off, every node in the group is muted
        or bypassed. Groups can go into groups. It never runs and is left out of the prompt.
      </p>
      <DocImage
        src="images/docs/wp-node-group.png"
        ratio="1720 / 752"
        caption="Two nodes in a group, wired into Detailer's dot. Detailer is off, so both are muted."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'One switch for a whole branch: a detailer, an upscale pass, a LoRA stack',
          'Muting or bypassing by hand from one place',
        ]"
        :better="[
          'Nodes that already sit in one canvas group: pick the group in the toggle instead',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_NodeGroup" group="controls" />
      <Banner tone="info" note>
        Muting or bypassing the group node itself does the same to its nodes, and setting it back
        lets them run.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-toggles', label: 'WP Toggles', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-mode-relay', label: 'WP Mode Relay', icon: 'pi pi-arrow-right-arrow-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
