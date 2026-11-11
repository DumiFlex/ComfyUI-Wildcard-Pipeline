<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Debug"
    icon="pi pi-eye"
    tone="node"
    node-id="WP_Debug"
    blurb="See what your pipeline picked: every $variable, every pick and every warning, after each run."
  >
    <DocSection title="What it's for">
      <p>
        Wire a Context's output into a <b>WP Debug</b>. After each Generate it shows everything
        that reached that point. It has no output and changes nothing.
      </p>
      <DocAnnotated
        src="images/docs/wp-debug-viewer.png"
        ratio="1720 / 860"
        caption="The Scene Context feeding WP Debug after a run. The Variables tab lists each variable, its value, its tags and which module set it."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Seeing why one run came out as it did: every variable, who wrote it, each pick and warning',
        ]"
        :better="[
          'How often options come up over many seeds: use the Test Runner',
        ]"
      />
    </DocSection>

    <DocSection title="Input">
      <DocFields node="WP_Debug" group="ports" />
    </DocSection>

    <DocSection title="The tabs">
      <DocFields node="WP_Debug" group="tabs" />
      <Banner tone="info" note>
        The filter box at the top of each tab searches by variable name or warning.
      </Banner>
    </DocSection>

    <DocSection title="Rows from other nodes">
      <p>
        Besides the modules in your Context nodes, WP Debug shows what the other context nodes
        wrote. The Variables tab groups the variables by the node that set them, and in both tabs each
        of these nodes gets a card drawn the way it works, with its own icon and colour:
      </p>
      <ul>
        <li><b>WP Context Loop</b> (orange): <code>$iteration</code>, <code>$iteration_total</code> and <code>$iteration_value</code>, as a frame card: "Frame 5 of 18" with a bar, the frame's seed when the Loop sets seeds (click to copy), the sweep combination and the value line.</li>
        <li><b>WP Model Info</b> (lime): Family, Variant and Name as fields, each saying where it came from: the model, a file-name rule, a pin, a wire or the loader's file.</li>
        <li><b>WP Toggles</b> (indigo): each switch as ON / OFF and the Pick one value as the picked row, with an arrow when an upstream variable set it.</li>
        <li><b>WP Context Injector</b> (blue): each wired value with its type (STR, INT, FLOAT, BOOL, or TPL for a template).</li>
      </ul>
      <p>
        Their warnings (an unknown <code>$variable</code> in a Toggles value, a Model Info rule that couldn't be
        read, a skipped Injector name) show in the Warnings tab and on that node's row. A wildcard pinned by a
        Loop sweep says <i>swept</i>, one set to Match variable says which variable it matched, and a pool
        filter that reads a <code>$variable</code> shows the value it read. With a Loop that skips frames, the
        frame picker shows the Loop's own frame number.
      </p>
    </DocSection>

    <DocSection title="Where to put it">
      <p>
        After one Context to check that step, or after the last to see everything. Use as many as
        you like; each shows what it sees at its own spot.
      </p>
      <DocImage
        src="images/docs/wp-debug-two.png"
        ratio="2 / 1"
        caption="Two Context → Debug pairs. The second Debug shows a negative ('umbrella') riding along with $weather."
      />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'conflicts-and-warnings', label: 'Conflicts &amp; warnings', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
