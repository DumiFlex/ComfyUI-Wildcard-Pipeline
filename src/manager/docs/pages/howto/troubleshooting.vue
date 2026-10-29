<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const printing = [
  { term: "A $variable prints nothing (MISSING VAR)", desc: "Nothing before the Assembler sets it, the name is misspelt, or it's hidden (the globe on its row is on). WP Model Info and the loop's $iteration are hidden by default." },
  { term: "A wildcard prints nothing", desc: "It picked its null option, a constraint ruled out every option, or a tag filter matched none. Give it a fallback option; WP Debug's Warnings tab says which it was." },
  { term: "{a|b} prints as typed", desc: "The Assembler doesn't roll anything. Put the choice in a wildcard, fixed value or combine and print its variable." },
  { term: "@{…} prints nothing", desc: "References only work in wildcard options and derivation actions. In a combine or the Assembler they print nothing." },
  { term: "$name in a wildcard option prints as typed", desc: "Options and fixed values can't read variables. Use a Combine below them." },
  { term: "Commas or words go missing around an empty variable", desc: "The Assembler tidies the commas and joining words around a variable that came out empty. Write the template so it still reads well when something is empty." },
];

const rolling = [
  { term: "The same prompt every Generate", desc: "The Context's seed is set to fixed, or the rows are locked or hold their pick. Set the seed to randomize, or unlock the rows." },
  { term: "Every loop frame gives the same image", desc: "The sampler uses one seed for all frames. Add a WP Seed List between the loop and the sampler." },
  { term: "A constraint does nothing", desc: "Check the order: source wildcard, then the constraint, then the target. WP Debug's Trace tab shows whether it applied; Constraint never applied means the target didn't run after it." },
  { term: "An option never comes up", desc: "Its weight is 0, it's unticked on the node, a constraint excludes it, or a filter leaves it out. The Test Runner shows each option's share over many seeds." },
  { term: "A later Context undoes my pick", desc: "When two Contexts set the same variable, the later one wins. The row shows a blue dot for this." },
];

const library = [
  { term: "A row says missing", desc: "The module isn't in your library, often because the workflow came from someone else. It still works; right-click → Save to library to keep it." },
  { term: "A row says drift (library updated on a bundle)", desc: "You changed the library entry after adding it. Right-click → Refresh from library (Reset to library snapshot on a bundle) to take the change." },
  { term: "A pack won't install and asks for an update", desc: "It uses a feature from a newer version. Update Wildcard Pipeline and try again." },
  { term: "A constraint shows a missing wildcard", desc: "Open it and use Reattach to point it at a wildcard you have, or Download from community." },
  { term: "Undo a change to the library", desc: "Settings › Library & data › Backups lists every backup; Restore puts one back the next time ComfyUI starts, after backing up the current library. Backups to keep keeps the newest ones, the ones you make yourself too. Pin a backup (the bookmark button) to keep it for good: pinned ones are never deleted for you and don't count toward the limit. A row marked Removed at next backup goes the next time a backup is made. Type a short note next to Back up now to tell your own backups apart." },
];
</script>

<template>
  <DocPage
    group="How to"
    title="Fix common problems"
    icon="pi pi-wrench"
    tone="neutral"
    blurb="Something prints nothing, never changes, or won't install: the usual causes and fixes."
  >
    <DocCallout variant="tip">
      Start with a <b>WP Debug</b> on the Context's output. Its Variables tab shows every value and
      who set it, and the Warnings tab names most of the problems below.
    </DocCallout>

    <DocSection title="Something prints wrong">
      <DocKeyList :items="printing" />
    </DocSection>

    <DocSection title="Picks don't change the way you expect">
      <DocKeyList :items="rolling" />
    </DocSection>

    <DocSection title="Library and packs">
      <DocKeyList :items="library" />
    </DocSection>

    <DocSection title="Still stuck?">
      <p>
        Every warning is explained on <DocRef id="warning-types" />. Problems with the AI
        assistant have their own page: <DocRef id="ai-troubleshooting" />.
      </p>
    </DocSection>

    <DocSection title="Related">
      <CrossLinks
        :links="[
          { id: 'wp-debug', label: 'WP Debug', icon: 'pi pi-eye', tone: 'node' },
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
