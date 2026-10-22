<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const tabs = [
  { term: "Variables", desc: "Every $variable and its value at this point, with the module that set it. The quickest way to check what your wildcards picked. Negative words show under the value in red, with the module they came from when it isn't the variable's own." },
  { term: "Trace", desc: "Every module in the order it ran, grouped by Context. Open one to see why it did what it did: a wildcard's odds and the constraints that changed them, which derivation branch ran, and the negative each one left." },
  { term: "Warnings", desc: "What came up during the run, such as missing variables or a constraint that changed nothing. Look here first when something seems off." },
  { term: "Raw", desc: "Everything as JSON, with a download button. Handy for bug reports." },
];
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
      <DocImage
        src="images/docs/wp-debug-viewer.png"
        ratio="2 / 1"
        caption="A WP Context with the Starter set bundle and Hair, feeding WP Debug. The Variables tab lists each variable, its value, its tags and which module set it."
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

    <DocSection title="The tabs">
      <DocKeyList :items="tabs" />
      <DocCallout variant="tip">
        The filter box at the top of each tab searches by variable name or warning.
      </DocCallout>
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
