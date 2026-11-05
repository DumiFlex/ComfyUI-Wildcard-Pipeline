<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context Loop"
    icon="pi pi-replay"
    tone="node"
    node-id="WP_ContextLoop"
    blurb="Make several variations in one click. Put it before your WP Context and one Generate runs the workflow N times."
  >
    <DocSection title="What it does">
      <p>
        Set the <b>count</b> to 8, press Generate once, and you get eight prompts (and eight images
        from your sampler), each with its own picks. No queueing the same workflow by hand.
      </p>
      <DocUseWhen
        :good="[
          'A batch of variations from one click',
          'A story told over several frames',
          'Comparing chosen options side by side (Sweep)',
        ]"
        :better="[
          'Just giving the sampler a new seed per frame: add WP Seed List',
        ]"
      />
      <DocAnnotated
        src="images/docs/wp-context-loop-graph.png"
        ratio="1720 / 860"
        caption="WP Context Loop sweeping 9 frames into the Character and Scene Contexts and an Assembler; Preview as Text shows the prompt of the run."
      />
    </DocSection>

    <DocSection title="Set it up">
      <ol>
        <li>Add <b>WP Context Loop</b> and wire its <code>context</code> output into your first
          WP Context's <code>upstream</code>.</li>
        <li>Set <b>count</b>.</li>
        <li>Optional: add a <b>WP Seed List</b> on <code>loop_config</code> so each image also gets
          its own sampler seed.</li>
      </ol>
      <Banner tone="warn" note>
        Without a Seed List, a plain KSampler uses one seed for every frame. Two frames that roll the
        same prompt then give the same image.
      </Banner>
    </DocSection>

    <DocSection title="The controls">
      <DocFields node="WP_ContextLoop" group="controls" />
    </DocSection>

    <DocSection title="Sweep combinations">
      <p>
        Instead of random rolls, run every combination of the options you choose. Open
        <b>Sweep combinations</b>, switch it on and add wildcards from the WP Contexts after the
        loop. Sweep <VarToken>$hair</VarToken> (3 options) against <VarToken>$mood</VarToken>
        (2 options) and one Generate makes 6 frames: red + calm, red + sad, blue + calm, and so on.
        The window shows the total and lists every frame before you run.
      </p>
      <DocImage
        src="images/docs/loop-sweep.png"
        ratio="2 / 1"
        caption="The Sweep window: $subject (4 options) × $hair (4 options) = 16 combinations, each listed as a frame."
      />
      <DocKeyList
        :items="[
          { term: 'all / none / enabled only', desc: 'Quick ways to tick a wildcard\'s options. A wildcard with nothing ticked isn\'t swept.' },
          { term: 'Order', desc: 'The first wildcard changes slowest, so two wildcards read like a grid. Use the arrows to reorder.' },
          { term: 'Limit', desc: 'The most frames a sweep runs (64 by default, up to 999). Past it, the first combinations run and the window says so.' },
          { term: 'Hold other picks', desc: 'On by default: everything you aren\'t sweeping keeps one pick on every frame, so only the swept part changes.' },
        ]"
      />
      <Banner tone="info" note>
        Keep the sampler on one fixed seed for a clean comparison, so the image only changes where
        the prompt does.
      </Banner>
      <DocDetails>
        <p>
          A swept wildcard's pick is set by the sweep, so constraints don't change its odds. That
          means sweeping a constraint's target can show pairs your pack normally rules out.
          Constraints it drives still apply to the wildcards after it, and its tags still roll.
        </p>
        <p>
          Skipped frames and seed locks move with their combination when you change the sweep, and
          are dropped when that combination no longer runs.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="Frame numbers in the prompt">
      <p>
        <VarToken>$iteration</VarToken> is the frame number (from 1) and
        <VarToken>$iteration_total</VarToken> the count. A template of
        <VarToken>frame $iteration of $iteration_total, $subject</VarToken> gives "frame 1 of 4, a
        fox", "frame 2 of 4, a cat" and so on. Both are hidden from the prompt until you switch off
        the globe and Σ buttons; while hidden you can still use them in derivation rules.
      </p>
      <DocImage
        src="images/docs/wp-context-loop-grid.png"
        ratio="1720 / 752"
        caption="A full looped workflow: the loop's loop_config feeds a WP Seed List on the sampler, so each of the four frames gets its own prompt and its own seed."
      />
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>A module on <b>Lock pick</b> / <b>Lock seed</b> keeps its pick on every frame.
          <b>Hold across run</b> keeps it for one Generate. See <DocRef id="seeds-and-loops" />.</li>
        <li>Per-frame changes stay on the canvas: bundles don't save them and the Test Runner
          doesn't run them.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
