<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Debug"
    icon="pi pi-eye"
    tone="node"
    node-id="WP_Debug"
    blurb="See what your pipeline picked: every $variable, every pick and every warning, after each run."
  >
    <DocSection title="What it's for">
      <p>
        Wire a Context's output into a <b>WP Debug</b>. After each Generate it shows everything
        that reached that point. It has no output and changes nothing.
      </p>
      <DocAnnotated
        src="images/docs/wp-debug-viewer.png"
        ratio="1720 / 860"
        caption="The Scene Context feeding WP Debug after a run. The Variables tab lists each variable, its value, its tags and which module set it."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Seeing why one run came out as it did: every variable, who wrote it, each pick and warning',
        ]"
        :better="[
          'How often options come up over many seeds: use the Test Runner',
        ]"
      />
    </DocSection>

    <DocSection title="Input">
      <DocFields node="WP_Debug" group="ports" />
    </DocSection>

    <DocSection title="The tabs">
      <DocFields node="WP_Debug" group="tabs" />
      <Banner tone="info" note>
        The filter box at the top of each tab searches by variable name or warning.
      </Banner>
    </DocSection>

    <DocSection title="What a trace step tells you">
      <p>Click a step in the Trace tab to see why it came out the way it did. Each kind says what matters for it:</p>
      <ul>
        <li><b>Wildcard</b>: the odds of the pick, the pool after each step (options → after the pool filter → after the node's option toggles → drawable), a locked or held seed, a multi-pick's count, whether repeats were allowed and what joins the picks, the value Match variable read, and the constraints that re-weighted it. <b>Options</b> lists every option with its weight (the node's override beside the library's), its chance, and why an option can't come up: filtered out, toggled off, excluded by a constraint, or weight 0. It opens by itself when nothing could be drawn.</li>
        <li><b>Derivation</b>: each rule, which branch fired, every test with the value it read, and each action.</li>
        <li><b>Fixed values</b>: whether the node's own rows or the library's were used, rows turned off, and a value's text before it was filled in.</li>
        <li><b>Combine</b>: the template and what each <code>$variable</code> in it read, with one nothing set flagged.</li>
        <li><b>Constraint</b>: its reach, how often it applied and which steps it re-weighted (click one to go there).</li>
        <li><b>WP Context Loop</b>: the frame, its seed and seed strategy, skipped frames and the sweep pins.</li>
        <li><b>WP Model Info</b>: the model class the family came from, the rule that matched the variant (or that none did) and the file name.</li>
        <li><b>WP Toggles</b>: the switch on the node, what an upstream variable said, a parent it needs that is off, and for Pick one which row was picked and why.</li>
        <li><b>WP Context Injector</b>: the input a value came from, and a template with what each <code>$name</code> filled with.</li>
      </ul>
    </DocSection>

    <DocSection title="Rows from other nodes">
      <p>
        Besides the modules in your Context nodes, WP Debug shows what the other context nodes
        wrote. The Variables tab groups the variables by the node that set them, under the node's title
        (and a Context's codename), each in its own card even when it is the only node, and each node's
        rows show what matters for that node. The Trace tab
        stays the run itself: every row is a numbered step in the order it ran, and these nodes differ only
        by their icon, colour and a short note on where the value came from:
      </p>
      <ul>
        <li><b>WP Context Loop</b> (orange): <code>$iteration</code>, <code>$iteration_total</code> and <code>$iteration_value</code>, under a line saying which frame this is, the frame's seed when the Loop sets seeds (click to copy), the sweep combination and the value line.</li>
        <li><b>WP Model Info</b> (lime): Family, Variant and Name, each saying where it came from: the model, a file-name rule, a pin, a wire or the loader's file.</li>
        <li><b>WP Toggles</b> (indigo): each toggle's variable as <code>true</code> / <code>false</code>, or its value text when the toggle has one (empty while off), with its <code>.bool</code> state and negative under it. In Pick one, each pick still has its own on/off variable (<code>true</code> is the picked one) and the Pick one variable holds the picked value. The source says when an upstream variable set a toggle.</li>
        <li><b>WP Context Injector</b> (blue): each wired value with its type (STR, INT, FLOAT, BOOL, or TPL for a template).</li>
      </ul>
      <p>
        <b>Show node</b> (in a step's details, a row's right-click menu, or the arrow on a node row) selects the
        node on the canvas and makes the module or field that row came from blink: a Context's module, a Model
        Info field, a toggle, an Injector row, or the Loop's iteration field. A collapsed node, a folded bundle,
        a folded Toggles group or the Injector's folded row list opens first so you can see it. A node inside a
        subgraph opens that subgraph; the subgraph itself is left as it is.
      </p>
      <p>
        A long value shows its first three lines (a long list its first three items, a long negative one
        line) until you press <b>Show all</b> under it; <b>Show less</b> folds it again.
      </p>
      <p>
        Their warnings (an unknown <code>$variable</code> in a Toggles value, a Model Info rule that couldn't be
        read, a skipped Injector name) show in the Warnings tab and on that node's row. A wildcard pinned by a
        Loop sweep says <i>swept</i>, one set to Match variable says which variable it matched, and a pool
        filter that reads a <code>$variable</code> shows the value it read. With a Loop that skips frames, the
        frame picker shows the Loop's own frame number.
      </p>
    </DocSection>

    <DocSection title="Where to put it">
      <p>
        After one Context to check that step, or after the last to see everything. Use as many as
        you like; each shows what it sees at its own spot.
      </p>
      <DocImage
        src="images/docs/wp-debug-two.png"
        ratio="2 / 1"
        caption="Two Context → Debug pairs. The second Debug shows a negative ('umbrella') riding along with $weather."
      />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'conflicts-and-warnings', label: 'Conflicts &amp; warnings', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
