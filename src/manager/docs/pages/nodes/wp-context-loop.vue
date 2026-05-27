<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PropTable from "../../../components/docs/PropTable.vue";
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
    blurb="Optional loop head that emits N Contexts in a single run, auto-iterating the entire downstream chain without manual queue repeats."
  >
    <DocSection title="What it does">
      <p>
        Place <b>WP Context Loop</b> before any WP Context node to make the chain run N times in
        one workflow queue. It emits a list output (<code>is_output_list=True</code>) so ComfyUI
        automatically iterates every downstream node — Context, Assembler, KSampler, SaveImage —
        once per item. Each iteration gets its own seed variation and a pair of iteration
        variables: <VarToken>$iteration</VarToken> (1-based, e.g. 1, 2, 3) and
        <VarToken>$iteration_total</VarToken> (N, same each iteration).
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'seed', type: 'INT', required: true, desc: 'Base seed. Has control_after_generate (randomize / fixed / increment). Right-click → Convert widget to input to wire an external seed node.' },
          { name: 'count', type: 'INT', required: true, desc: 'Number of iterations (1–999). 1 = single run, no looping.' },
          { name: 'config', type: 'WP_CONTEXT_LOOP_CONFIG', required: true, desc: 'Loop widget: strategy, override_seed, iteration var name, bypass switch, and internal flags for the iteration vars.' },
          { name: 'context (out)', type: 'PIPELINE_CONTEXT', required: true, desc: 'List output — one payload per iteration. ComfyUI auto-iterates all downstream nodes.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>Cacheable (not_idempotent = false)</b> — given the same seed + count + config, the
          emitted list is deterministic. ComfyUI may skip re-execution when inputs are unchanged.
        </li>
        <li>
          <b>1-based iteration vars</b> — <VarToken>$iteration</VarToken> is 1 on the first
          iteration and N on the last. The internal <code>__wp_loop_index__</code> is 0-based
          (engine-private; stripped before render).
        </li>
        <li>
          <b>Seed strategies</b> — three modes derive N seeds from the base:
          <code>hash_index</code> (default, independent per-iteration SHA-256 derivation),
          <code>sequential</code> (base, base+1, …), <code>prime_stride</code> (base + i × 1 000 003).
          When <b>override_seed</b> is off, the base seed is ignored and downstream Context widget
          seeds drive rolls (loop iteration adds only a small XOR variation).
        </li>
        <li>
          <b>Locked modules ignore the loop</b> — any module with a <code>locked_seed</code>
          in its instance overrides always rolls its fixed seed, producing the same pick every
          iteration.
        </li>
      </ul>
      <DocCallout variant="warn">
        ComfyUI's native bypass shortcut (Ctrl-B) does <b>not</b> work on this node. Use the
        <b>bypass</b> switch in the config widget instead — it collapses to a single iteration
        while preserving the list output shape. Native mute (Ctrl-M) does work.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
