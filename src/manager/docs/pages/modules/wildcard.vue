<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const tagGroupKinds = [
  { term: "classify (default)", desc: "The tags describe what the option is: casual, t-shirt, skirt. All of them are true at once, and a constraint on the group uses them together." },
  { term: "accepts", desc: "The tags are choices the option offers: an outfit that goes with sneakers, heels or sandals. One of them is rolled with the pick, you can print it as $outfit.SHOES, and a constraint reacts to that one tag." },
];

const optionFields = [
  { term: "Value", desc: 'The text that goes into the prompt, such as "a cat". It can hold {a|b} choices and @{} references to other wildcards.' },
  { term: "Weight", desc: "How likely the option is next to the others: weight 2 comes up twice as often as weight 1. 0 switches it off without deleting it." },
  { term: "Sub-categories (tags)", desc: 'Labels on an option, such as "feline" or "warm". An option can have several. Constraints and the category filter work with them, and you can sort them into groups (species, temperature).' },
  { term: "Null option", desc: 'An option that prints nothing, for "sometimes leave this out". At most one per wildcard.' },
  { term: "Fallback", desc: 'Hover an option\'s probability and click "set as fallback". It rolls like any other option, and is also used when nothing else is left to pick (constraints ruled everything out, or every weight is 0). Give it weight 0 if it should only ever stand in. One per wildcard. WP Debug and the Test Runner say "Fallback used" when it kicks in.' },
];

const instanceOptions = [
  { term: "Variable binding", desc: "The variable this use writes. It starts as the library's; change it to use the same wildcard twice ($hair and $hair_b) without one overwriting the other." },
  { term: "Option toggles", desc: "Untick options this use may not pick. Leaving one ticked fixes the value, though a constraint can still rule it out (keep a fallback for that)." },
  { term: "Per-use weights", desc: "Change an option's weight for this use only. The library editor doesn't show them." },
  { term: "Category filter", desc: 'Only pick options with certain tags, e.g. "feline and warm, not lynx" (a comma means or). Click the tag pills or type it under Advanced.' },
  { term: "Pick, separator, Allow repeats", desc: "Pick several options at once. See below." },
  { term: "Exclude null", desc: "Leaves the null option out for this use, so something always prints." },
  { term: "Fallback", desc: "Untick the fallback to switch it off for this use; then nothing prints when nothing is left." },
  { term: "Match variable", desc: "Instead of rolling, pick the option whose text equals a variable's value (case doesn't matter), e.g. $model_variant from WP Model Info. No match uses the fallback, or rolls as usual. This is how a variable can drive a constraint." },
  { term: "Lock pick", desc: "Keeps the same pick on every Generate and loop frame until you unlock it. Good for an art style you've settled on." },
  { term: "Hold across run", desc: "The same pick on every frame of one loop run, a new one next Generate. Good for a character who stays the same through a story." },
  { term: "Hide from prompt", desc: "The variable prints nothing, but constraints, combines and derivations can still use it." },
];

</script>

<template>
  <DocPage
    group="Modules"
    title="Wildcard"
    icon="pi pi-sparkles"
    tone="wildcard"
    blurb="A list of options. Each run picks one and writes it to a $variable. The building block of every pipeline."
  >
    <DocSection title="What it does">
      <p>
        A wildcard holds options such as "a cat", "a dog", "a fox" and picks one each run. The pick
        goes into a <VarToken>$variable</VarToken> you name, so your template and later modules can
        use it. Weights make some options more likely, and tags let constraints and filters work
        with groups of options.
      </p>
      <DocUseWhen
        :good="[
          'Any choice something else reacts to: a constraint, a derivation, Match variable, a sweep',
          'Any list you want weights, tags, a fallback or Test Runner counts on',
          'A shared vocabulary with no variable, drawn through @{} references',
        ]"
        :better="[
          'Always-on text: use Fixed Values',
          'A tiny variant inside one option: an inline {a|b}',
          'A phrase built from other picks: use a Combine',
        ]"
      />
      <DocImage
        src="images/docs/wildcard-editor.png"
        ratio="2 / 1"
        caption="The Starter subject wildcard: four options with weights, chances and categories, and the Runtime buttons (Lock pick, Hide from prompt, Hold across run, Match variable)."
      />
    </DocSection>

    <DocSection title="Make one">
      <ol>
        <li>In the manager, use <b>Quick create → Wildcard</b> on the dashboard, or the new button on
          the Wildcards page.</li>
        <li>Give it a name. The variable name follows it (<VarToken>$subject</VarToken>).</li>
        <li>Add options, one per row, or paste a list with <b>Bulk edit</b>.</li>
        <li>Save, then add it to a WP Context with <b>Add module</b>.</li>
      </ol>
    </DocSection>

    <DocSection title="Option fields">
      <DocKeyList :items="optionFields" />
    </DocSection>

    <DocSection title="Change it for one node">
      <p>
        Open the row's editor on the node to change how this one use behaves. The library entry stays
        as it is.
      </p>
      <DocKeyList :items="instanceOptions" />
      <DocCallout variant="tip">
        To fix one value on a node, untick every other option or use Lock pick.
      </DocCallout>
    </DocSection>

    <DocSection title="Pick several at once">
      <p>
        Set <b>Pick</b> to a range, e.g. 2–3, and the wildcard picks that many options, joined by the
        <b>separator</b>. <b>Allow repeats</b> lets the same option come up twice.
        <VarToken>$colors</VarToken> prints them all ("red, blue, green");
        <VarToken>$colors.0</VarToken> is just the first ("red").
      </p>
      <DocCallout variant="tip">
        When picking several, the null option is left out. Set the lower end to 0 for "maybe none".
      </DocCallout>
    </DocSection>

    <DocSection title="Wildcards inside wildcards">
      <p>
        An option can hold a reference to another wildcard: type <b>@</b> and pick it. Picking
        "<VarToken kind="ref">@{color}</VarToken> jeans" then also picks a color. A reference can
        narrow what it draws, such as only the warm colors. See
        <DocRef id="chips-and-references" />.
      </p>
      <DocCallout variant="warn">
        Option text can't read a <VarToken>$variable</VarToken>: <code>$mood</code> in an option
        prints as typed. To build text from other picks, use a Combine.
      </DocCallout>
    </DocSection>

    <DocSection title="Tags you can read as variables">
      <p>
        Each tag group has a kind, set on its header:
      </p>
      <DocKeyList :items="tagGroupKinds" />
      <p>
        Ask what the tag says about the option. "Is this outfit casual?" is classify. "Which shoes go
        with this outfit?" is accepts.
      </p>
      <DocDetails title="Reading an accepts group">
        <p>
          If <VarToken>$outfit</VarToken> has an accepts group named
          <VarToken kind="inline">SHOES</VarToken>, then <VarToken>$outfit.SHOES</VarToken> is the
          shoe rolled with this run's outfit. It is rolled once, so it reads the same everywhere.
          With several picks, <VarToken>$outfit.0.SHOES</VarToken> is the first pick's. Only accepts
          groups can be read this way; anything else prints nothing and gets a warning. The group
          name must be letters, digits and underscores, and renaming it breaks templates that read
          it.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="With constraints">
      <p>
        A <b>Constraint</b> can change this wildcard's odds based on another pick, such as making
        "stormy" likelier when the subject is "ocean". It must sit after the source wildcard and
        before this one.
      </p>
      <DocImage
        src="images/docs/wildcard-constraint-order.png"
        ratio="16 / 6"
        caption="Source wildcard, then the constraint, then the target wildcard. The #1 badges link the constraint to its target."
      />
      <p>
        Constraints react to picks, not variables. To steer one from a variable (such as the loaded
        model), give a wildcard options that spell the variable's values and set <b>Match
        variable</b> on it. WP Model Info has an example.
      </p>
    </DocSection>

    <DocSection title="Coming from A1111 or Forge?">
      <p>
        Your wildcard packs can be imported: see <DocRef id="wildcard-import" />.
      </p>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a ready-made <VarToken>$subject</VarToken> wildcard with four options (cat, tiger,
        dog, wolf) in two categories. It's the first piece of the starter set.
      </p>
      <StarterButton slot="subject" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wildcard-import', label: 'Import wildcard packs', icon: 'pi pi-download', tone: 'wildcard' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
