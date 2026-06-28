<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "upstream (in)", desc: "Connect an earlier WP Context here to chain them together. Its variables flow through and can be overridden by modules in this node. Leave unconnected to start a fresh chain." },
  { term: "seed", desc: "Controls the random picks inside this node. Change it to get a different roll; right-click → Convert widget to input to drive it from a seed widget or the WP Context Loop." },
  { term: "modules", desc: "The stack of modules inside this node — wildcards, fixed values, combines, constraints, and bundles. Add modules by clicking the + button. Drag rows to reorder." },
  { term: "context (out)", desc: "The resolved variable map produced by this node. Wire it into a WP Prompt Assembler, WP Debug, WP Context Injector, or another WP Context." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context"
    icon="pi pi-sitemap"
    tone="node"
    node-id="WP_Context"
    blurb="The heart of the pipeline. Build a stack of modules, roll them with a seed, and send resolved $variables downstream to an Assembler or Debug node."
  >
    <DocSection title="What it's for">
      <p>
        A <b>WP Context</b> is where you define the named values that power your prompt.
        Add a wildcard module and it becomes <VarToken>$subject</VarToken>. Add a fixed-value
        module and it becomes <VarToken>$style</VarToken>. When you press Generate the node
        rolls every module with your seed and hands a complete map of
        <VarToken>$variable</VarToken> → value to whatever is wired downstream.
      </p>
      <p>
        Chain two Context nodes together — the downstream one can add new variables or
        override ones set above. The last write wins, so a downstream
        <VarToken>$subject</VarToken> replaces the upstream one.
      </p>
      <DocImage
        src="images/docs/wp-context.png"
        ratio="16 / 6"
        caption="A WP Context with three modules in its stack (Starter subject wildcard, Starter scene combine flagged orange MISSING VAR because $mood isn't published, Starter style fixed) wired into a WP Prompt Assembler. The assembler chip strip lists the three upstream $vars; the resolved preview shows 'cat, oil painting,, masterpiece, highly detailed' — the empty slot where $scene would have rendered makes the missing-var warning concrete."
      />
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Per-module behaviour in a loop">
      <p>
        When a <b>WP Context Loop</b> drives this node, each module chooses how it behaves across
        the batch through its Runtime settings:
      </p>
      <ul>
        <li>
          <b>Hold across run</b> — the module resolves once at the first frame and reuses that exact
          value on every frame of the run (the resolved value, not just the seed — constrained
          picks and nested <code>@{}</code> refs stay frozen too), then re-rolls next run. The
          “keep this element steady for the whole batch” switch. Flip it from the module's Runtime
          settings, or right-click the row and pick <b>Hold across run</b> for a two-click toggle.
        </li>
        <li>
          <b>Per-frame overrides</b> — using the loop's <b>edit frame</b> selector you can give one
          frame its own pick, seed lock, or enable/disable for any module in the stack, leaving the
          rest of the batch on the base.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        Lock a module's seed (via the module's instance options) to freeze that pick across
        all <b>WP Context Loop</b> iterations — handy for holding the art style steady while
        the subject varies across a batch.
      </DocCallout>
      <DocCallout variant="tip">
        Modules you add to a WP Context are <b>snapshots</b>, not live links. If you edit a module
        in the library afterward, the Context doesn't change under you — it flags that row as
        <b>drifted</b> so you can pull (sync) the updated version when you're ready. That keeps a
        saved workflow reproducible: it won't silently change because you edited a module somewhere
        else.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-bolt', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
