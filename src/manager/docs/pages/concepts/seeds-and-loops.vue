<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
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

    <DocSection title="Seed scope: vary vs hold">
      <p>
        Inside a loop, each module decides whether it rides the per-iteration seed or the run's
        base seed. Every wildcard, combine, fixed-values and derivation module has a
        <b>Hold across run</b> toggle in its Runtime settings:
      </p>
      <ul>
        <li>
          <b>Vary</b> (default) — the module re-rolls every iteration, so its pick changes across
          the batch.
        </li>
        <li>
          <b>Hold across run</b> — the module resolves once at the first iteration and reuses that
          exact <em>value</em> on every iteration of the run, then re-rolls on the next run. It
          holds the resolved value, not just the seed: a constrained wildcard keeps its option even
          as the constraint reshapes the pool, and any nested <code>@{}</code> ref is frozen too —
          an outfit of <VarToken>@{color} jeans</VarToken> that lands on “green jeans” stays
          “green jeans” all run. A held derivation freezes its derived output the same way —
          even if the inputs it reads keep changing across the batch. No manual seed lock needed.
          Flip it from the module's Runtime settings, or right-click the row and pick
          <b>Hold across run</b> for a two-click toggle.
        </li>
      </ul>
      <p>
        Hold answers “keep the identity or outfit steady across this batch, but let it re-roll next
        time.” That's different from a <b>locked seed</b>, which freezes the pick for good — same
        every run, not just within one run.
      </p>
    </DocSection>

    <DocSection title="The flow">
      <DocFlow
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'emits N', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'fresh roll each pass', tone: 'node' },
          { icon: 'pi pi-align-left', name: 'Prompt Assembler', sub: 'N prompts', tone: 'node' },
        ]"
        :arrows="['iteration 1…N', '$vars']"
        caption="The loop fans the chain out into N passes — one resolved prompt per iteration."
      />
    </DocSection>

    <DocSection title="Sampler seeds inside a loop">
      <p>
        The loop emits a <b>list of prompts</b> — one per iteration — and ComfyUI runs the
        downstream sampler once per prompt. But a standard <b>KSampler</b> takes a single INT
        seed, not a list, so every iteration would be sampled with that same seed. If two
        iterations happen to roll the exact same prompt (e.g. your wildcards landed on the same
        options twice), the sampler produces the <em>same image</em> for both.
      </p>
      <p>
        The cleanest fix is to also emit a list of seeds. Drop a <b>WP Seed List</b> between the
        loop and your sampler:
      </p>
      <DocFlow
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'N prompts', tone: 'node' },
          { icon: 'pi pi-clone', name: 'WP Seed List', sub: 'N seeds', tone: 'node' },
          { icon: 'pi pi-image', name: 'KSampler', sub: 'N unique images', tone: 'neutral' },
        ]"
        :arrows="['loop_config', 'paired by index']"
        caption="Wire the loop's loop_config side-output into the Seed List; downstream the prompt list and seed list pair up by index so each iteration gets its own seed."
      />
      <p style="margin-top: 14px;">
        Connecting <code>loop_config</code> auto-matches the seed list's count + strategy to the
        loop's, so the two lists stay the same length without manual setup. Two other workarounds
        work too: bake <VarToken>$iteration</VarToken> into the prompt template (the prompt text
        itself never repeats), or wire <VarToken>$iteration</VarToken> through a
        <b>WP Var → Int</b> into the sampler's seed input — both fine for simple cases, but the
        Seed List scales better when you want a deterministic, reproducible series.
      </p>
    </DocSection>

    <DocSection title="WP Context Loop">
      <p>
        Add a <b>WP Context Loop</b> before your WP Context and one Generate runs the whole chain
        N times in a single click — each iteration with its own seed and its own fresh roll of
        your wildcards. The <b>Variation strategy</b> controls how those per-iteration seeds are
        spread:
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

    <DocSection title="Per-iteration seed locks">
      <p>
        Both <b>WP Context Loop</b> and <b>WP Seed List</b> carry a <b>Per-iteration seeds</b>
        button that opens a list of the seed each iteration will use. From there you can:
      </p>
      <ul>
        <li>
          Lock any single iteration to a fixed seed (the rest stay derived), or <b>Lock all</b> /
          <b>Unlock all</b> at once.
        </li>
        <li>
          <b>Copy</b> / <b>Paste</b> the whole list as <code>#N: seed</code> text to reproduce a
          series elsewhere — Alt-click <b>Copy</b> grabs only the locked rows.
        </li>
        <li>
          <b>Prev</b> — lock the seed an iteration <em>actually used on the previous run</em>,
          rather than the upcoming one.
        </li>
      </ul>
      <DocCallout variant="tip">
        Reach for <b>Prev</b> after a run you liked. The list normally shows the seeds for the
        <em>next</em> run; with control-after-generate set to <em>randomize</em>, the base seed has
        already rotated, so those upcoming seeds won't reproduce what you just saw. Prev pins the
        seed that iteration rolled last time — greyed out until a run has happened (and, on the
        loop, until <b>Override seed</b> is on). So: run once, then lock the iterations worth
        keeping.
      </DocCallout>
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
        output text — for example to label each iteration's output as "frame 1 of 4".
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
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
