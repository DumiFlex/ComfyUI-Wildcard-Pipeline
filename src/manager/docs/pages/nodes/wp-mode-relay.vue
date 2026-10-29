<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "watch dots (in)", desc: "Wire the nodes to watch. A new free dot appears as you wire." },
  { term: "drives (out)", desc: "Wire it into a WP Node Group: the relay sets that group's nodes." },
  { term: "All muted", desc: "What to send when every watched node is muted: Run, Mute, Bypass or nothing (—)." },
  { term: "All bypassed", desc: "What to send when every watched node is bypassed." },
  { term: "Any runs", desc: "What to send when at least one watched node runs." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Mode Relay"
    icon="pi pi-arrow-right-arrow-left"
    tone="node"
    node-id="WP_ModeRelay"
    blurb="When the nodes it watches get muted or bypassed, mute, bypass or run a WP Node Group."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Mode Relay</b> chains mutes and bypasses. It watches the nodes wired into it and, when
        what they do changes, sets the nodes of the WP Node Group its output goes into. So muting
        a sampler can bypass its whole save branch, or bypassing one LoRA can let a different one run.
        It never runs and is left out of the prompt.
      </p>
      <DocImage
        src="images/docs/wp-mode-relay.png"
        ratio="1720 / 752"
        caption="The watched node is muted, so the relay mutes the node in its WP Node Group."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Turning one branch off when another is off',
          'Swapping: bypass A when B runs',
        ]"
        :better="[
          'One switch for several nodes: a WP Toggles row with a WP Node Group',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
      <DocCallout variant="tip">
        A mix of muted and bypassed sends nothing. The relay acts at once when the watched nodes
        change and when you change one of its choices, never when a workflow loads.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-node-group', label: 'WP Node Group', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-toggles', label: 'WP Toggles', icon: 'pi pi-check-square', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
