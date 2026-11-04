<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
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
      <p>
        With nothing wired in, put it inside a canvas group instead: it then stands for every node of
        that group. Muting or bypassing it, or a toggle or relay driving it, mutes or bypasses the
        whole group.
      </p>
      <DocAnnotated
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
          'A mute or bypass switch that lives inside a canvas group, with no wires',
        ]"
        :better="[
          'A WP Toggles row driving canvas groups it sits outside: pick the groups by title in the toggle',
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

    <DocSection title="Whole canvas group">
      <p>
        A WP Node Group with nothing wired into its dots looks for the canvas group it sits in and
        gathers every node of it, so you don't wire each one. The bar then reads
        <b>Whole group: &lt;title&gt;</b> with the count. When groups nest it takes the smallest one
        around it. A WP Mode Relay wired in doesn't count as a wired node, and the nodes that relay
        watches stay out, so the relay never changes what it reads. Wire any other node in and the
        group node goes back to only its wired nodes.
      </p>
      <Banner tone="info" note>
        Notes, bookmarks and other frontend-only nodes in the group are left alone. A WP Toggles
        node driving the group node never mutes itself, even when it sits in the same group.
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
