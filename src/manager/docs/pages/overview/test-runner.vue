<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Test Runner"
    icon="pi pi-bolt"
    tone="neutral"
    blurb="Try your modules on hundreds of seeds without queueing a workflow: see every value they produce, trace any seed, and catch what changed after an edit."
  >
    <DocSection title="What it's for">
      <p>
        The Test Runner, in the manager sidebar, runs a stack of your library modules through the
        real engine, one chain seed per run, and shows what comes out. Use it to check that a
        wildcard's options all come up, that a constraint actually fires, or that a combine reads
        the variables you think it does, before you wire anything on the canvas.
      </p>
      <DocFlow
        :stages="[
          { icon: 'pi pi-box', name: 'Scenario', sub: 'stack + pins + seeds', tone: 'neutral' },
          { icon: 'pi pi-play', name: 'Run', sub: 'real engine, seeded', tone: 'node' },
          { icon: 'pi pi-chart-bar', name: 'Results', sub: 'values, traces, warnings', tone: 'neutral' },
          { icon: 'pi pi-bookmark', name: 'Baseline', sub: 'compare after edits', tone: 'neutral' },
        ]"
        :arrows="['Ctrl + Enter', 'per seed', 'save']"
        caption="A seed here is a real chain seed: the same seed on a canvas Context holding the same modules gives the same values."
      />
    </DocSection>

    <DocSection title="Build a scenario">
      <p>
        A scenario is what one Context node would hold, saved so you can run it again. Press
        <b>New</b> in the rail, then <b>Add module or bundle</b>. Cards run left to right, like the
        modules on a Context; drag them (or Alt + arrow keys) to reorder, and use a card's switch to
        leave it out of a run without removing it.
      </p>
      <DocKeyList
        :items="[
          { term: 'Stack', desc: 'The modules and bundles to run, in order. A card warns when it reads a $variable nothing earlier sets, or when a combine template is plain text and will never vary.' },
          { term: 'Pinned values', desc: 'Stand-ins for what a node further up the graph would pass in, such as $subject from an Injector. They are set before the first card runs.' },
          { term: 'Seeds', desc: 'Range runs seeds from N upward; Random draws a fresh set each run. Up to 10,000 seeds per run.' },
          { term: 'Output', desc: 'The variable treated as the prompt: the last combine\'s output unless you pick another on the Outputs tab.' },
        ]"
      />
      <p>
        <b>Save</b> (Ctrl + S) keeps the scenario, and the pin icon keeps it at the top of the rail.
        From a module or bundle editor, <b>Send to Test Runner</b> opens a quick run with just that
        item, and <b>In N scenarios</b> lists the saved scenarios that use it.
      </p>
    </DocSection>

    <DocSection title="Read a run">
      <p>
        The stats row gives runs, unique outputs, warnings and engine time. Below it, each tab
        answers one question:
      </p>
      <DocKeyList
        :items="[
          { term: 'Variables', desc: 'Every $variable and how often it took each value, with values that never changed listed once as constants.' },
          { term: 'Outputs', desc: 'The output for the first seeds, tinted by which variable wrote each part, with a NEG line for the negative words it carries.' },
          { term: 'Samples', desc: 'One row per seed with every variable (and the output\'s negative, when there is one); filter by seed or value.' },
          { term: 'Warnings', desc: 'Runtime warnings grouped by kind, with the seeds that raised them, and any runs that failed.' },
          { term: 'Compare', desc: 'What changed since the saved baseline. See below.' },
        ]"
      />
      <p>
        Click any seed to open its <b>trace</b>: every card in run order with what it wrote, plus the
        nested <VarToken>@{…}</VarToken> picks it made on the way. <b>Copy seed</b> puts it on the
        clipboard for a canvas Context.
      </p>
    </DocSection>

    <DocSection title="Inspect a module">
      <p>
        Click a stack card to open its inspector: how that module is set up next to what the last
        run did with it.
      </p>
      <DocKeyList
        :items="[
          { term: 'Wildcard', desc: 'Each option\'s share of the weight next to its share of the picks. Options that were never picked are flagged; picks through @{} references elsewhere in the stack count too.' },
          { term: 'Constraint', desc: 'Which pick it listens to, which wildcard it re-weights and how far it reaches, and how many times it applied. Zero usually means the target runs before the source.' },
          { term: 'Combine', desc: 'The template, the $variables it reads, and the outputs it produced.' },
          { term: 'Derivation', desc: 'Its rules as plain if / else lines, and the values its target ended up with.' },
          { term: 'Fixed values', desc: 'Every name and value it sets.' },
          { term: 'Bundle', desc: 'Its modules in run order (nested bundles indented) and the values each one wrote.' },
        ]"
      />
      <p><b>Edit</b> in the inspector opens that module in its editor.</p>
    </DocSection>

    <DocSection title="Baselines: catch what an edit changed">
      <p>
        On the <b>Compare</b> tab of a saved scenario, <b>Save as baseline</b> keeps this run's
        output for each seed (the first 1,000), plus every variable's spread and the warnings. Edit your modules, run
        again, and the tab lists each seed whose output changed (with the changed words marked),
        values that appeared or disappeared, shares that moved, and warnings that came or went.
        A seed whose negative changed is listed too; a baseline saved before negatives existed says
        <em>negative not recorded</em> until you save it again.
      </p>
      <p>
        <b>Re-run all</b> in the rail's Pinned header runs every pinned scenario against its
        baseline in one go, and each row then reads <em>matches</em> or <em>N changed</em>. When the
        result is the new normal, <b>Use this run as baseline</b> replaces it.
      </p>
      <DocCallout variant="tip">
        Compare needs the same seeds on both sides. A Range scenario always has them; for a Random
        one, <b>Run the baseline's seeds</b> reruns exactly the seeds the baseline used.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds & loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-debug', label: 'WP Debug', icon: 'pi pi-eye', tone: 'node' },
          { id: 'warning-types', label: 'Warning & conflict types', icon: 'pi pi-list', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
