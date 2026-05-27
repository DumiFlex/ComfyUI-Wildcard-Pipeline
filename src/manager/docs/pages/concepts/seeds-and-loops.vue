<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Seeds &amp; loops"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="How the chain seed drives per-module RNG, what locked seeds do, and how WP Context Loop generates batches with 1-based iteration variables."
  >
    <DocSection title="The chain seed">
      <p>
        Every <b>WP Context</b> node has a <code>seed</code> INT input. At execution time the
        engine derives an independent per-module RNG via <code>derive_module_rng(chain_seed,
        module_id)</code>. Each module therefore gets a deterministic but independent stream of
        random numbers — changing the chain seed changes every module, but changing one module's
        position does not disturb the others.
      </p>
      <p>
        The seed uses <code>control_after_generate</code> so it advances automatically each queue
        cycle, giving you a new pick on every generation without manual edits.
      </p>
    </DocSection>

    <DocSection title="Locked seeds">
      <p>
        A module's instance overrides include a <b>locked_seed</b> field. When set, the engine
        uses that fixed value instead of the chain-derived RNG. The module makes the same pick
        every queue cycle regardless of the chain seed — useful for fixing a background style while
        randomising the subject, or for freezing one module's pick across all WP Context Loop
        iterations.
      </p>
      <DocCallout variant="tip">
        Locked modules are also unaffected by the WP Context Loop seed strategies — their pick
        does not vary between iterations.
      </DocCallout>
    </DocSection>

    <DocSection title="WP Context Loop">
      <p>
        <b>WP Context Loop</b> emits a list of N Contexts in a single execution pass
        (<code>is_output_list=True</code>), driving downstream image generation over multiple
        seeds without requiring a batch node. Three seed strategies control how the per-iteration
        seed is derived from the base seed:
      </p>
      <ul>
        <li><b>sequential</b> — seed for iteration i = base + i</li>
        <li><b>hash_index</b> — seed = first 8 bytes of SHA-256(<code>{base}:{i}</code>), read as a big-endian 64-bit integer</li>
        <li><b>prime_stride</b> — seed = base + i × 1 000 003</li>
      </ul>
      <p>
        The <code>override_seed</code> toggle controls whether those strategies apply. When
        <b>on</b>, the loop derives N seeds from the base and overrides each iteration's Context
        seed. When <b>off</b> (the default), the base seed is ignored and each downstream Context
        rolls from its own widget seed independently — the loop only layers per-iteration variation.
      </p>
    </DocSection>

    <DocSection title="Iteration variables">
      <p>
        Inside each iteration the engine injects two special variables into the Context:
      </p>
      <ul>
        <li>
          <VarToken>$iteration</VarToken> — the current iteration number, <b>1-based</b>
          (first iteration = 1, last = N).
        </li>
        <li>
          <VarToken>$iteration_total</VarToken> — a constant equal to the total iteration
          count N (the name follows the configured loop variable name).
        </li>
      </ul>
      <p>
        Internally the engine tracks a 0-based index
        (<VarToken kind="inline">__wp_loop_index__</VarToken>), but the user-visible
        <VarToken>$iteration</VarToken> is always 1-based.
      </p>
      <DocCallout variant="warn">
        These variables are injected with the <b>internal</b> flag by default
        (<code>iteration_internal</code> / <code>total_internal</code> config options). Set
        either flag to <code>false</code> if you want <VarToken>$iteration</VarToken> to appear
        in the rendered prompt.
      </DocCallout>
    </DocSection>

    <DocSection title="Bypass and mute">
      <DocCallout variant="warn">
        Native ComfyUI Ctrl-B bypass does <b>not</b> work correctly for WP Context Loop. Use
        the node's own <b>bypass</b> switch instead. Native Ctrl-M mute works normally.
      </DocCallout>
    </DocSection>

    <DocSection title="External seed nodes">
      <p>
        You can convert the <code>seed</code> widget to an input socket and connect any INT
        source — a Primitive node, a seed from rgthree's Seed Anywhere, or any other integer
        output. This lets you synchronise the loop seed with an upstream sampler seed.
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
