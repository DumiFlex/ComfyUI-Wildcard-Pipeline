<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const tabs = [
  { term: "Snapshot", desc: "Every $variable and its resolved value at this point in the chain — the quickest way to check that your wildcards rolled what you expected." },
  { term: "Trace", desc: "A per-module history of which values each module wrote. Use this when a variable has the wrong value and you need to see which module set it last." },
  { term: "Picks", desc: "Exactly what each wildcard rolled on this run — useful for reproducing a result or understanding which option was chosen." },
  { term: "Warnings", desc: "Runtime notices: missing variables referenced in templates, constraints that never fired, invalid bindings, and similar issues. Check here first when something looks off." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Debug"
    icon="pi pi-eye"
    tone="node"
    node-id="WP_Debug"
    blurb="See inside your pipeline at any point. Drop it anywhere in the chain and get a tabbed view of every $variable, every wildcard pick, and any runtime warnings — after every run."
  >
    <DocSection title="What it's for">
      <p>
        Drop a <b>WP Debug</b> node anywhere and wire a Context output into it. After each
        Generate the built-in viewer fills with a tabbed snapshot of everything that flowed
        through that point. It has no output — it is a read-only observation tool that
        updates every run so you always see fresh data.
      </p>
      <DocImage
        ratio="16 / 8"
        caption="The WP Debug viewer open on the Snapshot tab, showing a list of resolved $variables and their values. The tab strip shows Snapshot, Trace, Picks, and Warnings tabs."
      />
    </DocSection>

    <DocSection title="Viewer tabs">
      <DocKeyList :items="tabs" />
      <DocCallout variant="tip">
        Use the filter box at the top of each tab to search by variable name or warning type
        when the list is long.
      </DocCallout>
    </DocSection>

    <DocSection title="Placement tips">
      <p>
        Wire the debug node after a specific Context to inspect that stage of the chain, or
        wire it after the final Context to see the complete resolved map. You can have multiple
        debug nodes at different points in the same workflow — each shows what it sees at its
        own position.
      </p>
      <DocImage
        ratio="16 / 5"
        caption="A workflow with two WP Debug nodes — one wired after the first WP Context and one after the second — showing how each captures the pipeline state at that point."
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
