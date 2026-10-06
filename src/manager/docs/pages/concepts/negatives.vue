<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const sources = [
  { term: "Wildcard option", desc: "Each option has an optional Negative line under its value. When that option is picked, its words attach to the wildcard's $variable. A multi-pick attaches each picked option's words to its own pick. The null option has no negative." },
  { term: "Fixed value", desc: "Each value has the same Negative line. A fixed value always applies, so its negative travels with the variable wherever it is used. Handy for style presets: $style brings “photo, 3d render” along with it." },
  { term: "Combine", desc: "A combine carries the negatives of every variable its template read, with no setup. On top of that it has one optional Negative of its own, for words that belong to the phrase as a whole." },
  { term: "Derivation “Add to negative”", desc: "A fourth action next to Replace, Append and Prepend. It leaves the target variable's text alone and adds the value to that variable's negatives, so a rule like “when $mood is gloomy, add ‘smiling’” follows $mood wherever it goes. With + And, one branch can replace a variable and add to its negative in the same step. “Replace negative” is the fifth action: it drops the variable's negative words and uses the value instead." },
  { term: "Context Injector row", desc: "Socket rows and template rows can carry a Negative, written with the same $slot grammar as the row template. It replaces whatever negatives the variable carried before, so injecting $character over a picked one swaps the pick's negative for the row's." },
];

const rules = [
  { term: "A write replaces, an append keeps", desc: "When a module writes a variable, the old value's negatives go with it. A derivation Replace swaps them for the negatives of whatever its new text read; Append and Prepend keep the old ones and add the new." },
  { term: "Index and axis accessors", desc: "$props.0 carries only the first pick's negative. Bare $props and $props.AXIS carry every pick's." },
  { term: "Internal variables add nothing", desc: "An internal variable never renders in a prompt, so its negatives never reach a negative output, even though they are kept for downstream modules that read it." },
  { term: "Variables in the negative template", desc: "A $var you write in the Assembler's negative template adds its text, not its own negatives." },
  { term: "Reading a variable's negatives: $name.neg", desc: "$pose.neg is the negative words $pose carries at that point in the chain, and $props.1.neg only pick 1's. It works wherever $vars do: hand one variable's negatives to another with “Add to negative” and the value $pose_portrait.neg, use it in a combine or the Assembler's negative template, or test it in a condition. Reading .neg is not a use of $pose, so it never pulls $pose's words in a second time." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Negatives"
    icon="pi pi-minus-circle"
    tone="neutral"
    blurb="Send words to the negative prompt from the pick that needs them. Pick “strawberry blonde” hair and “strawberry, fruit” lands in the negative, so the model doesn't paint fruit."
  >
    <DocSection title="The idea">
      <p>
        A negative belongs to the <VarToken>$variable</VarToken> it came with, and only reaches an
        Assembler that actually uses that variable. The main Assembler that renders
        <VarToken>$hair</VarToken>, <VarToken>$mood</VarToken> and <VarToken>$face</VarToken> gets all
        three variables' negative words; a face detailer Assembler that only renders
        <VarToken>$face</VarToken> gets only the face words from the same Context.
      </p>
      <DocFlow
        :stages="[
          { icon: 'pi pi-sparkles', name: 'Wildcard option', sub: 'negative: fruit', tone: 'wildcard' },
          { icon: 'pi pi-sitemap', name: '$hair', sub: 'carries it', tone: 'node' },
          { icon: 'pi pi-align-left', name: 'Assembler', sub: 'renders $hair', tone: 'node' },
          { icon: 'pi pi-minus-circle', name: 'negative output', sub: 'fruit', tone: 'neutral' },
        ]"
        :arrows="['picked', 'used', 'collected']"
        caption="Negatives follow usage: words only reach a negative output when their variable was rendered."
      />
    </DocSection>

    <DocSection title="Where negatives come from">
      <DocKeyList :items="sources" />
    </DocSection>

    <DocSection title="What each negative field accepts">
      <p>A negative field takes the same syntax as the value field next to it.</p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr><th>Field</th><th>Accepts</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Wildcard option negative</td>
            <td>text, <VarToken kind="inline">{a|b}</VarToken>, <VarToken kind="ref">@{ref}</VarToken> (no <VarToken>$vars</VarToken>)</td>
          </tr>
          <tr>
            <td>Fixed value negative</td>
            <td>text, <VarToken kind="inline">{a|b}</VarToken> (no refs, no <VarToken>$vars</VarToken>)</td>
          </tr>
          <tr>
            <td>Combine negative</td>
            <td><VarToken>$vars</VarToken>, <VarToken kind="inline">{a|b}</VarToken></td>
          </tr>
          <tr>
            <td>Derivation “Add to negative” value</td>
            <td><VarToken>$vars</VarToken>, <VarToken kind="ref">@{ref}</VarToken>, <VarToken kind="inline">{a|b}</VarToken></td>
          </tr>
          <tr>
            <td>Injector row negative</td>
            <td>the row's <VarToken>$input_N</VarToken> slots, like the row template</td>
          </tr>
          <tr>
            <td>Assembler negative template</td>
            <td><VarToken>$vars</VarToken> and the reserved <VarToken>$negatives</VarToken> slot</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="tip">
        Negatives never change your picks. Negative text rolls on its own seed stream, and an
        <VarToken kind="ref">@{ref}</VarToken> inside a negative resolves quietly: it doesn't count as
        a pick, isn't logged in the Test Runner trace, doesn't trigger constraints, and the picked
        option's own negative is ignored. Adding or editing a negative leaves every seed's prompt
        exactly as it was.
      </DocCallout>
    </DocSection>

    <DocSection title="How they follow the variable">
      <DocKeyList :items="rules" />
    </DocSection>

    <DocSection title="The Assembler's negative output">
      <p>
        <b>WP Prompt Assembler</b> has a second output, <code>negative</code>, next to
        <code>prompt</code>. Wire it into your negative CLIP Text Encode. Under the preview sits a
        collapsible negative template:
      </p>
      <ul>
        <li><VarToken>$negatives</VarToken> marks where the collected words go, e.g. <code>lowres, bad anatomy, $negatives</code>.</li>
        <li>An empty template outputs just the collected words.</li>
        <li>A template without <VarToken>$negatives</VarToken> gets the collected words appended at the end.</li>
      </ul>
      <p>
        Repeated tags are dropped (case-insensitive, and <code>(blurry:1.2)</code> counts as
        <code>blurry</code>), including tags you already typed in the template.
      </p>
    </DocSection>

    <DocSection title="Cleaning both prompts">
      <p>
        <b>WP Prompt Cleaner</b> takes an optional <code>negative</code> input and returns a cleaned
        <code>negative</code> output beside the prompt. Its rule list has a second column for the
        negative: it follows the prompt column's preset, except fuzzy dedupe and the blocklist are
        off. The extra rule <b>Drop negative tags also in prompt</b> (off by default)
        removes a tag from the negative when the prompt asks for it too; either way the report
        names the overlap.
      </p>
    </DocSection>

    <DocSection title="Bulk add">
      <p>
        In a wildcard's bulk add, <code>--</code> starts an option's negative. Everything after the
        first <code>--</code> is the negative, and <code>#tag</code> / <code>*N</code> still work at
        the end of either side:
      </p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr><th>Module</th><th>Line</th></tr>
        </thead>
        <tbody>
          <tr><td>Wildcard</td><td><code>strawberry blonde #warm *2 -- strawberry, fruit</code></td></tr>
          <tr><td>Fixed values</td><td><code>style = oil painting -- photo, 3d render</code></td></tr>
        </tbody>
      </table>
      <p>
        With options checked, bulk edit's <b>Negative</b> menu adds words to each checked option,
        replaces their negative, or clears it.
      </p>
    </DocSection>

    <DocSection title="Seeing where each word came from">
      <p>
        <b>WP Debug</b> lists a variable's negative words under its value, naming the module when
        they came from elsewhere (a derivation's Add to negative, a combine inheriting from
        <VarToken>$hair</VarToken>). The <b>Test Runner</b> shows a NEG line under each output,
        tinted by the variable each word came from, adds a Negative column to Samples, and
        Compare lists a seed whose negative changed.
      </p>
    </DocSection>

    <DocSection title="Sharing">
      <DocCallout variant="warn">
        A module or bundle that uses a negative (or an “Add to negative” action) is stamped
        <b>schema 8</b> when you publish it. Older versions of the extension refuse schema 8 packs
        and ask you to update, instead of silently dropping the negatives. Injector rows and
        Cleaner settings live in the workflow, not the library, so they need no schema bump.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-syntax-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  overflow: hidden;
  font-size: 12.5px;
}
.wp-doc-syntax-table th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  font-weight: 600;
  padding: 9px 14px;
  background: var(--wp-bg-2);
  border-bottom: 1px solid var(--wp-border);
}
.wp-doc-syntax-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: top;
  color: var(--wp-text-muted);
  line-height: 1.55;
}
.wp-doc-syntax-table tr:last-child td { border-bottom: none; }
.wp-doc-syntax-table td:first-child { color: var(--wp-text); white-space: nowrap; }
</style>
