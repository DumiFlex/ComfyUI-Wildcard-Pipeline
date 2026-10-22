<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const keepSteady = [
  { term: "Nothing (default)", desc: "The module rolls again on every Generate and on every loop frame." },
  { term: "Hold across run", desc: "The module rolls once per Generate and keeps that result on every loop frame. The next Generate rolls again. Good for keeping one character or outfit through a batch." },
  { term: "Lock pick / Lock seed", desc: "The module keeps the same result on every frame and every Generate until you unlock it. Good for an art style you've settled on. Wildcards call it Lock pick, other modules Lock seed." },
];

const strategies = [
  { term: "hash (default)", desc: "Each frame gets a seed worked out from the base seed. The seeds look random." },
  { term: "sequential", desc: "Seeds count up: base, base+1, base+2 … Easy to read out and type back in." },
  { term: "stride", desc: "Seeds take large even jumps from the base." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Seeds &amp; loops"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="How the seed decides every pick, how to keep something steady, and how to make many variations in one click."
  >
    <DocSection title="The seed decides the picks">
      <p>
        Every <b>WP Context</b> has a <code>seed</code>. The seed decides what each wildcard picks.
        Same seed, same picks; a new seed, new picks. With <b>control after generate</b> on
        <i>randomize</i> (ComfyUI's default), every Generate gives you a fresh set.
      </p>
      <p>
        Each module rolls on its own, so moving modules around, adding an option to one wildcard or
        adding a new module never changes what the others picked. To get back a prompt you liked,
        set the seed back to the number it used (WP Debug shows it).
      </p>
    </DocSection>

    <DocSection title="Keep something steady">
      <p>
        Open a module's editor (or right-click its row) and use the <b>Runtime</b> buttons:
      </p>
      <DocKeyList :items="keepSteady" />
      <DocCallout variant="tip">
        Lock the style and leave the subject free to see how one style looks across many subjects.
      </DocCallout>
      <DocDetails title="How Hold across run works">
        <p>
          Hold keeps the finished text, not just the seed. A wildcard holds its option even when a
          constraint changes the odds later in the batch, and a reference inside it is held too: an
          outfit of <VarToken>@{color} jeans</VarToken> that lands on "green jeans" stays "green
          jeans" for the whole run. It is worked out with the first frame's inputs, so a constraint
          that follows <VarToken>$iteration</VarToken> doesn't move it on later frames.
        </p>
        <p>
          A held <b>derivation</b> still picks its rule from the current inputs on every frame. What
          it holds is the random part of each rule, so a rule that fires again gives the same text it
          gave on the first frame.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="Many variations in one click">
      <p>
        Put a <b>WP Context Loop</b> in front of your first WP Context and set its <b>count</b>.
        One Generate then runs the workflow that many times, each frame with its own picks.
      </p>
      <DocFlow figure="seeds-and-loops-flow"
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'count N', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'new picks each frame', tone: 'node' },
          { icon: 'pi pi-align-left', name: 'Prompt Assembler', sub: 'N prompts', tone: 'node' },
        ]"
        :arrows="['frame 1…N', '$vars']"
        caption="The loop runs the chain N times and you get one prompt per frame."
      />
      <p style="margin-top: 14px;">
        Inside a loop you can use <VarToken>$iteration</VarToken> (the frame number, from 1) and
        <VarToken>$iteration_total</VarToken> (the count). Both are hidden from the prompt at first. To print
        them, switch off the globe button (for <VarToken>$iteration</VarToken>) and the Σ button
        (for <VarToken>$iteration_total</VarToken>) next to <b>Iteration var</b> on the loop.
      </p>
    </DocSection>

    <DocSection title="Give each image its own sampler seed">
      <p>
        A plain KSampler uses one seed for every frame. If two frames roll the same prompt, you get
        the same image twice. Add a <b>WP Seed List</b> and wire the loop's
        <code>loop_config</code> into it: it gives the sampler one seed per frame and matches the
        loop's count by itself.
      </p>
      <DocFlow figure="seeds-and-loops-flow-2"
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'N prompts', tone: 'node' },
          { icon: 'pi pi-clone', name: 'WP Seed List', sub: 'N seeds', tone: 'node' },
          { icon: 'pi pi-image', name: 'KSampler', sub: 'N different images', tone: 'neutral' },
        ]"
        :arrows="['loop_config', 'paired in order']"
        caption="Prompt 1 goes with seed 1, prompt 2 with seed 2, and so on."
      />
      <p style="margin-top: 14px;">
        Simpler options: put <VarToken>$iteration</VarToken> in the prompt so no two prompts match,
        or send <VarToken>$iteration</VarToken> through <b>WP Var → Int</b> into the sampler's seed.
      </p>
    </DocSection>

    <DocSection title="Make a batch you can repeat">
      <p>
        Turn on <b>Override Context seed</b> on the loop. The loop then works out every frame's
        seed from its own seed, so the same loop seed always gives the same batch. The
        <b>strategy</b> buttons choose how those seeds are spread. It only changes which numbers are
        used; every strategy gives each frame its own picks.
      </p>
      <DocKeyList :items="strategies" />
      <p style="margin-top: 14px;">
        With it off (the default), each WP Context uses its own seed and the loop changes it a
        little per frame.
      </p>
    </DocSection>

    <DocSection title="Keep the frames you liked">
      <p>
        <b>Per-iteration seeds</b> (on the loop and on WP Seed List) lists the seed each frame will
        use. Lock a frame's seed to keep it while the rest keep changing. <b>Lock all</b>,
        <b>Copy</b> and <b>Paste</b> (as <code>#N: seed</code> lines) work on the whole list.
      </p>
      <DocCallout variant="tip">
        After a run you liked, use <b>Prev</b>. The list shows the seeds for the next run, and with
        randomize on those have already moved. Prev locks the seed the frame used last time. On the
        loop it needs Override Context seed on.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li><b>Count 1</b> or the loop's <b>Bypass loop</b> switch runs a single frame without
          unwiring anything.</li>
        <li>To drive the seed from another node, right-click the node and convert <code>seed</code>
          to an input.</li>
        <li>To compare chosen options instead of random ones, use the loop's
          <b>Sweep combinations</b> (see WP Context Loop).</li>
        <li>To change one frame on its own, see Per-iteration overrides.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
