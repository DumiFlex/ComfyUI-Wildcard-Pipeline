<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const strategies = [
  {
    term: "Hashed (default)",
    desc: "Each iteration gets an unrelated seed derived from the base. Produces the most variety — neighbouring iterations look nothing alike.",
  },
  {
    term: "Sequential",
    desc: "Seeds walk seed, seed+1, seed+2 … so adjacent iterations feel related and drift gradually.",
  },
  {
    term: "Prime stride",
    desc: "Takes large even jumps through the seed space. Good for sampling widely spread results from a known base.",
  },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Seeds &amp; loops"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="How the seed drives per-module randomness, what locked seeds do, and how WP Context Loop generates batches."
  >
    <DocSection title="The seed and per-module randomness">
      <p>
        Every <b>WP Context</b> node has a <code>seed</code> input. At generation time, each
        module in the stack gets its own independent random stream derived from that seed — so
        changing the seed changes every module's picks together, but reordering modules does not
        disturb each other's results.
      </p>
      <p>
        The seed advances automatically after each generation, so you get a fresh set of picks
        every time you press Generate without editing anything manually.
      </p>
    </DocSection>

    <DocSection title="Locked seeds">
      <p>
        Any module can have its seed locked. When a module's seed is locked, it always makes the
        same pick regardless of what the Context seed is doing — perfect for holding a background
        style or an art direction steady while everything else randomises. Locked modules are also
        unaffected by the WP Context Loop seed strategies, so they do not vary between iterations.
      </p>
      <DocCallout variant="tip">
        Lock one module and leave the rest free to compare how different random picks combine with
        a fixed element — useful for testing whether a style works with a variety of subjects.
      </DocCallout>
    </DocSection>

    <DocSection title="WP Context Loop">
      <p>
        Add a <b>WP Context Loop</b> before your WP Context and one Generate produces N images in
        a single run — each with its own seed. The <b>Variation strategy</b> controls how those
        seeds are spread:
      </p>
      <DocKeyList :items="strategies" />
      <p style="margin-top: 14px;">
        The <b>Override seed</b> toggle on the loop controls whether these strategies apply. When
        <b>on</b>, the loop derives N seeds from the base and sets each iteration's seed
        accordingly, making the whole batch reproducible from that one base seed. When <b>off</b>
        (the default), each downstream Context uses its own widget seed independently and the loop
        only provides per-iteration variation on top.
      </p>
    </DocSection>

    <DocSection title="Iteration variables">
      <p>
        Inside each loop iteration, two variables are available for your templates:
      </p>
      <ul>
        <li>
          <VarToken>$iteration</VarToken> — which run you are on, starting at 1 (so 1, 2, 3 … up
          to the count).
        </li>
        <li>
          <VarToken>$iteration_total</VarToken> — the total number of runs, constant across every
          iteration.
        </li>
      </ul>
      <p>
        By default both are hidden from the rendered prompt. You can turn off the
        <b>internal</b> flag for either one in the loop settings if you want them to appear in the
        output text — for example to caption images "frame 1 of 4".
      </p>
      <DocCallout variant="warn">
        These variables are injected as internal by default, so they will not appear in your prompt
        unless you deliberately expose them.
      </DocCallout>
    </DocSection>

    <DocSection title="Turning the loop off">
      <DocCallout variant="tip">
        The loop has a <b>Bypass</b> switch that collapses it to a single run while keeping the
        node wired — handy for comparing looped vs single output without rebuilding the graph.
      </DocCallout>
    </DocSection>

    <DocSection title="Connecting an external seed">
      <p>
        You can convert the <code>seed</code> widget to an input socket and connect any integer
        source — a Primitive node, or any other INT output. This lets you synchronise the loop
        seed with an upstream sampler or another node.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
