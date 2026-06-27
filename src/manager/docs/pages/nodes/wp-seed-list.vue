<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "Base seed", desc: "The starting point for the seed series. Change it for a different batch of seeds; keep it the same to reproduce the same set. Right-click → Convert widget to input to drive it from another seed node." },
  { term: "Count", desc: "How many seeds to emit in one run (1–999). When you wire a WP Context Loop into loop_config, the count auto-mirrors the loop's count so the two lists stay the same length." },
  { term: "Strategy", desc: "How the per-iteration seeds are spread out — Hashed (default), Sequential (base, base+1, base+2 …), or Stride (large prime jumps). Picks a chip inside the node's DOM widget." },
  { term: "Override base seed from loop", desc: "When ON and loop_config is wired, the node uses the loop's base seed instead of the local widget. Independent of the count + strategy toggles so you can mix sources." },
  { term: "Override count from loop", desc: "When ON and loop_config is wired, the node uses the loop's count. Auto-flips ON the moment you connect a loop_config wire — flip it off manually if you want a different count." },
  { term: "Override strategy from loop", desc: "When ON and loop_config is wired, the node uses the loop's strategy. Also auto-flips ON when you connect the wire." },
  { term: "loop_config (in)", desc: "Optional WP Context Loop side-output. Wire it in to have the seed series mirror the loop's shape automatically." },
  { term: "seed (out)", desc: "List of N derived seeds — one per iteration. Connect it to a KSampler's seed input (or anything that takes INT) and the downstream node fans out across the series in lockstep with the loop's prompts." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Seed List"
    icon="pi pi-clone"
    tone="node"
    node-id="WP_SeedList"
    blurb="Emit a list of seeds — one per loop iteration — so a downstream KSampler gets a different seed each pass. The cleanest way to keep every (prompt, image) pair unique inside a WP Context Loop batch."
  >
    <DocSection title="What it's for">
      <p>
        A standard <b>KSampler</b> takes a single INT seed. When a <b>WP Context Loop</b> emits N
        prompts, the sampler runs N times but reads the same seed every pass — so two iterations
        that happen to roll the exact same prompt string would produce the exact same image.
        Drop a <b>WP Seed List</b> between the loop and your sampler: it emits a list of N
        derived seeds, pairing one with each prompt, so every iteration gets its own
        (prompt, seed) combo.
      </p>
      <p>
        The node works standalone too — even without a loop wired in, the widget controls
        produce a stable, reproducible series of N seeds you can fan out across any node that
        accepts INT.
      </p>
    </DocSection>

    <DocSection title="The controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="The flow with WP Context Loop">
      <DocFlow
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'N prompts', tone: 'node' },
          { icon: 'pi pi-clone', name: 'WP Seed List', sub: 'N seeds', tone: 'node' },
          { icon: 'pi pi-image', name: 'KSampler', sub: 'N unique images', tone: 'neutral' },
        ]"
        :arrows="['loop_config', 'paired by index']"
        caption="The loop's side-output drives the seed list's count + strategy; the loop's prompt list and the seed list pair up one-to-one downstream so every iteration gets a unique seed."
      />
      <p style="margin-top: 14px;">
        Wire the loop's <code>loop_config</code> side-output into the seed list's
        <code>loop_config</code> input and the override-count + override-strategy toggles auto-flip
        ON. From that point on the seed series matches the loop's length and shape without you
        touching the widgets. Flip <b>Override base seed from loop</b> on as well if you want the
        loop's base seed to anchor the series too; leave it off to keep a different sampler base.
      </p>
      <DocCallout variant="tip">
        Disconnecting the loop_config wire leaves the override toggles where they are — the
        widget values stay as the fallback so the node keeps running standalone. Re-connecting
        the wire auto-arms the toggles again.
      </DocCallout>
    </DocSection>

    <DocSection title="Variation strategies">
      <p>
        Same three strategies as <b>WP Context Loop</b>, applied to the seed series instead of
        per-iteration Context seeds:
      </p>
      <ul>
        <li>
          <b>Hashed</b> (default) — each iteration gets an unrelated seed derived from the base.
          Most variety; recommended.
        </li>
        <li>
          <b>Sequential</b> — base, base+1, base+2 … Adjacent iterations feel related and drift
          gradually.
        </li>
        <li>
          <b>Stride</b> — large prime jumps through the seed space. Wide spread, deterministic.
        </li>
      </ul>
      <p>
        Every emitted seed is masked to 50 bits so it stays inside the range ComfyUI's frontend
        produces when you press the seed randomise button — you can copy any seed back into a
        standalone sampler and it'll reproduce identically.
      </p>
    </DocSection>

    <DocSection title="Per-iteration seed locks">
      <p>
        The <b>Per-iteration seeds</b> button opens the seed list, where you can pin any iteration
        to a fixed seed while the rest stay derived — handy for keeping a couple of results you
        liked while the others keep exploring. <b>Lock all</b> / <b>Unlock all</b>, <b>Copy</b> /
        <b>Paste</b> (as <code>#N: seed</code> text), and a per-row <b>Prev</b> button round it out.
      </p>
      <DocCallout variant="tip">
        <b>Prev</b> locks the seed an iteration actually used on the <em>previous</em> run, not the
        upcoming one — the right choice when control-after-generate is randomising the base. The
        Seed List captures its series on every run, so Prev lights up after the first generate.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        The seed list pairs with the loop by <em>list index</em>, not by any wire-based handshake.
        As long as the counts match (which the auto-on override guarantees when you wire
        loop_config), iteration <em>N</em>'s prompt always gets paired with seed <em>N</em>.
      </DocCallout>
      <DocCallout variant="warn">
        Without a loop wired in, the seed list still emits N seeds — useful for fanning a single
        sampler out N ways from one click. But if you connect it to a non-loop chain that
        expects a single seed, ComfyUI will iterate the downstream node N times anyway. Set the
        count to 1 to collapse to single-seed behaviour without removing the node.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
