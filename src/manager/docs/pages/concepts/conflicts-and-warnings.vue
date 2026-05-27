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
  {
    term: "Shadowed variable",
    desc: "An earlier WP Context already sets this variable and yours overrides it. Normal when you chain Contexts — it's shown (as info, not a warning) so the override is on purpose, not a surprise.",
  },
  {
    term: "Duplicate variable",
    desc: "Two modules in the same Context produce the same variable. The lower one wins. Rename one, or reorder them if the wrong value is coming through.",
  },
  {
    term: "Missing variable",
    desc: "Your Prompt Assembler template uses a $variable that nothing upstream produces — it'll appear literally in the prompt. Add a module that sets it, or drop the token.",
  },
  {
    term: "Constraint not wired",
    desc: "A constraint can't find one of its two wildcards, or they're in the wrong order — the constraint has to sit between its source and target wildcard to fire.",
  },
  {
    term: "Constraint never fired",
    desc: "A constraint was set up correctly but its target wildcard never came up on this run, so it had no effect. Often fine — just letting you know it didn't do anything.",
  },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Conflicts &amp; warnings"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="As you build, Wildcard Pipeline quietly flags possible issues on the node itself. After a run, WP Debug lists what actually happened. Nothing here ever blocks a generation."
  >
    <DocSection title="Where you'll see them">
      <p>
        You never have to go looking — problems come to you in two places:
      </p>
      <ul>
        <li>
          <b>On the node, while you build</b> — the WP Context shows small coloured dots with a
          short label (e.g. a duplicate variable, a missing one). Hover any dot for the full,
          plain-English message. A Subgraph that contains WP nodes gets a single badge summarising
          the worst issue inside it, so you can spot trouble without opening it.
        </li>
        <li>
          <b>In WP Debug, after a run</b> — open the <b>Warnings</b> tab on a WP Debug node to see
          what came up during the actual generation, in order, one line each.
        </li>
      </ul>
      <DocImage
        src="images/docs/conflicts-warning.png"
        ratio="16 / 6"
        caption="A WP Context node in the canvas showing an advisory warning badge, and the WP Debug Warnings tab open alongside it listing the same warning with its message."
      />
    </DocSection>

    <DocSection title="Reading the colour">
      <p>
        The dot's colour tells you how much to care — the wording in the hover message tells you
        exactly what:
      </p>
      <ul>
        <li><b>Blue (info)</b> — just so you know. Usually nothing to fix (an intended override, a constraint that didn't come up).</li>
        <li><b>Amber (warning)</b> — worth a look. Something probably isn't doing what you meant (a duplicate, a missing variable, a mis-ordered constraint).</li>
        <li><b>Red</b> — something won't resolve as written (a reference that points nowhere). The run still completes; that piece just won't take effect.</li>
      </ul>
      <DocCallout variant="tip">
        Every flag here is <b>advisory</b>. It never blocks generation or raises an error. Writing a
        variable twice is perfectly valid — the later write wins; the dot just makes the override
        visible so it's a choice, not an accident.
      </DocCallout>
    </DocSection>

    <DocSection title="Common things it flags">
      <DocKeyList :items="commonFlags" />
      <p style="margin-top: 14px;">
        That's the short list. The <b>Warning &amp; conflict types</b> reference page has the full
        set with what each one means and what to do about it.
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
