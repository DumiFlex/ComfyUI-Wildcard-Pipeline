<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const sources = [
  { term: "Wildcard option", desc: "Each option has a Negative line under its value. When the option is picked, its words go with the wildcard's variable. With several picks, each pick brings its own. The null option has none." },
  { term: "Fixed value", desc: "Same Negative line. A fixed value always applies, so its negative always comes along: a $style of \"oil painting\" can bring \"photo, 3d render\". On a Context node each row shows its negative under the value; change it there for that node only, and the reset button brings back the library's." },
  { term: "Combine", desc: "A combine brings along the negatives of every variable it reads, with no setup. It can also have a Negative of its own for the phrase as a whole, which you can change per node too." },
  { term: "Derivation", desc: "Two extra actions: Add to negative keeps the variable's text and adds words to its negative (\"when $mood is gloomy, add smiling\"). Replace negative swaps its negative for new words. Use + And to change the text and the negative in one rule." },
  { term: "WP Context Injector row", desc: "A row can have a Negative, which can use the row's input. It replaces any negative the variable had before." },
];

const rules = [
  { term: "Setting a variable drops its old negative", desc: "When a module writes a variable again, the old negative goes with the old value. Append and Prepend keep it and add the new one." },
  { term: "One pick, one negative", desc: "$props.0 brings only the first pick's negative. $props and $props.GROUP bring every pick's." },
  { term: "Hidden variables add nothing", desc: "A hidden variable never prints, so its negative never reaches the negative output. Later modules that read it still get it." },
  { term: "Words you type in the negative template", desc: "A $variable you write in the Assembler's negative template adds its text, not its negative." },
  { term: "Reading a negative: $name.neg", desc: "$pose.neg is the negative $pose has at that point, and $props.1.neg the second pick's. Use it like any variable: in a combine, in the Assembler's negative template, in a derivation's \"if\", or to copy one variable's negative to another with Add to negative. Reading .neg doesn't count as printing $pose, so its words don't come in twice." },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Negatives"
    icon="pi pi-minus-circle"
    tone="neutral"
    blurb="Send words to the negative prompt from the pick that needs them. Pick “strawberry blonde” hair and “strawberry, fruit” goes to the negative, so the model doesn't paint fruit."
  >
    <DocSection title="The idea">
      <p>
        A negative belongs to the <VarToken>$variable</VarToken> it came with, and only reaches an
        Assembler that prints that variable. The main Assembler that prints
        <VarToken>$hair</VarToken>, <VarToken>$mood</VarToken> and <VarToken>$face</VarToken> gets
        all three negatives; a face detailer Assembler that prints only
        <VarToken>$face</VarToken> gets only the face words.
      </p>
      <DocFlow figure="negatives-flow"
        :stages="[
          { icon: 'pi pi-sparkles', name: 'Wildcard option', sub: 'negative: fruit', tone: 'wildcard' },
          { icon: 'pi pi-sitemap', name: '$hair', sub: 'carries it', tone: 'node' },
          { icon: 'pi pi-align-left', name: 'Assembler', sub: 'prints $hair', tone: 'node' },
          { icon: 'pi pi-minus-circle', name: 'negative output', sub: 'fruit', tone: 'neutral' },
        ]"
        :arrows="['picked', 'used', 'collected']"
        caption="Negative words only reach an Assembler that printed their variable."
      />
    </DocSection>

    <DocSection title="Where negatives come from">
      <DocKeyList :items="sources" />
    </DocSection>

    <DocSection title="What you can write in a negative">
      <p>A negative takes the same syntax as the value next to it.</p>
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
            <td>the row's input, like the row template</td>
          </tr>
          <tr>
            <td>Assembler negative template</td>
            <td><VarToken>$vars</VarToken> and <VarToken>$negatives</VarToken> (where the collected words go)</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="tip">
        Negatives never change your picks. Adding or editing one leaves every seed's prompt exactly
        as it was. A reference inside a negative rolls on its own and isn't counted as a pick: it
        doesn't show in the Test Runner, doesn't trigger constraints, and brings no negative of its
        own.
      </DocCallout>
    </DocSection>

    <DocSection title="How they follow the variable">
      <DocKeyList :items="rules" />
    </DocSection>

    <DocSection title="The Assembler's negative output">
      <p>
        <b>WP Prompt Assembler</b> has a second output, <code>negative</code>. Wire it into your
        negative CLIP Text Encode. Its negative template sits in a fold-out section under the
        preview:
      </p>
      <DocImage
        src="images/docs/assembler-negative.png"
        ratio="16 / 7"
        caption="The Assembler's negative preview and output next to the prompt."
      />
      <ul>
        <li><VarToken>$negatives</VarToken> marks where the collected words go, e.g. <code>lowres, bad anatomy, $negatives</code>.</li>
        <li>An empty template outputs just the collected words.</li>
        <li>Without <VarToken>$negatives</VarToken>, the collected words go at the end.</li>
      </ul>
      <p>
        Repeated words are dropped, also when written differently: <code>(blurry:1.2)</code> counts
        as <code>blurry</code>, and so does one you already typed in the template.
      </p>
    </DocSection>

    <DocSection title="Cleaning both prompts">
      <p>
        <b>WP Prompt Cleaner</b> has an optional <code>negative</code> input and a cleaned
        <code>negative</code> output. Its rule list has a second column for the negative, which
        follows the prompt's preset except fuzzy dedupe and the blocklist. Switch on <b>Drop
        negative tags also in prompt</b> to remove a word from the negative when the prompt asks for
        it; the report names the overlap either way.
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
        <b>WP Debug</b> lists each variable's negative under its value, and names the module when
        the words came from somewhere else (a derivation, or a combine reading
        <VarToken>$hair</VarToken>). The <b>Test Runner</b> shows a NEG line under each output,
        coloured by the variable each word came from, and a Negative column in Samples.
      </p>
    </DocSection>

    <DocSection title="Sharing">
      <p>
        A pack that uses negatives needs an extension version that knows them. An older version
        asks you to update instead of dropping the words.
      </p>
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
