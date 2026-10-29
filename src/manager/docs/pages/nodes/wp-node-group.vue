<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "node dots (in)", desc: "Wire any node's output in. A new free dot appears as you wire; a freed one goes. Each shows its node's title." },
  { term: "nodes (out)", desc: "Wire it into a WP Toggles control dot: that toggle then mutes or bypasses every node here." },
  { term: "Run / Mute / Bypass", desc: "Set every node in the group at once." },
  { term: "Mode chip", desc: "Each row's chip shows its node's mode. Click it to go Runs → Muted → Bypassed." },
];
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
      <DocKeyList :items="controls" />
      <DocCallout variant="tip">
        Muting or bypassing the group node itself does the same to its nodes, and setting it back
        lets them run.
      </DocCallout>
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
