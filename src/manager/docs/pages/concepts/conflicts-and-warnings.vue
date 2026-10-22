<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

// User-facing descriptions of the most common things you'll see flagged —
// described by what they MEAN + what to do, not by the internal rule names.
const commonFlags = [
  { term: "Shadowed variable", desc: "An earlier WP Context already sets this variable and this one replaces it. Normal when you chain Contexts; shown in blue so you know it's happening." },
  { term: "Duplicate variable", desc: "Two modules on the same Context set the same variable, and the lower one wins. Rename one, or reorder them if the wrong value comes through." },
  { term: "Missing variable", desc: "The Assembler template uses a $variable nothing sets (or a hidden one), so it prints nothing. The token is underlined in the template. Add a module that sets it, or remove the token." },
  { term: "Constraint can't reach", desc: "A constraint can't find one of its wildcards, or they're in the wrong order. It must sit after the source wildcard and before the target." },
  { term: "Constraint never applied", desc: "The constraint's target never ran after it, so it changed nothing. Often fine; it's just telling you." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Conflicts &amp; warnings"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Possible problems show on the node while you build, and WP Debug lists what happened after a run. Nothing here stops a run."
  >
    <DocSection title="Where you'll see them">
      <ul>
        <li><b>On the node, while you build.</b> A WP Context shows a small coloured dot and a short
          label on the row, such as MISSING VAR. Hover it for the message. A subgraph with WP nodes
          inside gets one badge with the worst issue, so you don't have to open it.</li>
        <li><b>In WP Debug, after a run.</b> The <b>Warnings</b> tab lists what came up during the
          run, one line each.</li>
      </ul>
      <DocImage
        src="images/docs/conflicts-warning.png"
        ratio="16 / 6"
        caption="The Starter scene combine reads $mood, which nothing sets, so its row shows MISSING VAR. The run still goes ahead."
      />
    </DocSection>

    <DocSection title="What the colours mean">
      <ul>
        <li><b>Blue:</b> for your information, usually nothing to fix.</li>
        <li><b>Amber:</b> worth a look; something probably isn't doing what you meant.</li>
        <li><b>Red:</b> something points nowhere, such as a reference to a deleted wildcard. The run
          still finishes; that piece just does nothing.</li>
      </ul>
      <DocCallout variant="tip">
        None of these ever stops a run. Setting a variable twice is fine, for example; the later
        one wins and the dot just shows it.
      </DocCallout>
    </DocSection>

    <DocSection title="Common things it flags">
      <DocKeyList :items="commonFlags" />
      <p style="margin-top: 14px;">
        The full list is on <b>Warning &amp; conflict types</b>.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
          { id: 'wp-debug', label: 'WP Debug', icon: 'pi pi-eye', tone: 'node' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
