<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const conditionOps = [
  { term: "equals", desc: "The value is exactly this text. Capitals count." },
  { term: "contains", desc: "The text appears somewhere in the value. Capitals count." },
  { term: "matches", desc: "The value fits a regular expression (a text pattern). A broken pattern never matches." },
  { term: "exists", desc: "The variable is there at all. A second switch narrows it: any, is empty (there but empty, such as a wildcard that rolled its null option) or has value." },
  { term: "is set / is unset", desc: "Is set: there and not empty. Is unset: missing or empty." },
  { term: "NOT", desc: "The NOT switch turns any test around: equals becomes not equals, contains does not contain, and so on. Does not contain and does not match need this version or newer." },
];

const actionModes = [
  { term: "Replace", desc: "The variable becomes the action text." },
  { term: "Append", desc: "Adds the text at the end. Nothing goes in between, so start it with its own comma (\", with a scarf\")." },
  { term: "Prepend", desc: "Adds the text at the start. End it with its own comma (\"wet, \")." },
  { term: "Add to negative", desc: "Leaves the variable's text alone and adds the words to its negative, so they go wherever the variable is printed." },
  { term: "Replace negative", desc: "Like Add to negative, but the words replace whatever negative the variable had." },
];

const instanceOptions = [
  { term: "Switch off a rule or branch", desc: "Skip one rule, or one IF, ELIF or ELSE, on this node only." },
  { term: "Change a value", desc: "Change what an action writes, or the text a test compares with, on this node only." },
  { term: "Rule order", desc: "Reorder the rules on this node." },
  { term: "Lock seed", desc: "Keeps the {a|b} and @{} rolls inside the actions the same on every Generate." },
  { term: "Hold across run", desc: "Keeps those rolls the same for one loop run. The tests still run every frame, so a frame can still take another branch." },
  { term: "Hide from prompt", desc: "The variables the rules set print nothing; other modules can still read them." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Derivation"
    icon="pi pi-arrow-right-arrow-left"
    tone="derivation"
    blurb="If/then rules: when a variable says one thing, change another. Runs after the picks it reads."
  >
    <DocSection title="What it does">
      <p>
        A derivation checks variables that earlier modules set and changes others to match. For
        example: IF <VarToken>$subject</VarToken> equals "ocean", append ", with crashing waves"
        to <VarToken>$mood</VarToken>.
      </p>
      <DocImage
        src="images/docs/derivation.png"
        ratio="2 / 1"
        caption="The Starter accent derivation: when $mood is dramatic, $accent becomes cinematic lighting."
      />
      <DocUseWhen
        :good="[
          'Text that follows from a pick (“if winter, add a scarf”)',
          'A pick that only happens sometimes (an action holding @{Accessories:winter})',
          'A LoRA or injected value replacing a rolled pick',
          'Story text on $iteration, and negatives that depend on a pick',
        ]"
        :better="[
          'Changing the odds of another pick: use a Constraint',
          'A long lookup from one pick to another: a constraint on a tagged list',
          'Overwriting a variable a constrained wildcard sets: the pick is thrown away',
        ]"
      />
    </DocSection>

    <DocSection title="How rules run">
      <p>
        A derivation can hold several rules, and every rule is checked, top to bottom, even when an
        earlier one fired. Inside one rule only the first branch that matches runs: IF, then each
        ELIF, then ELSE. Several small rules are easier to read than one big one.
      </p>
    </DocSection>

    <DocSection title="Tests">
      <DocKeyList :items="conditionOps" />
      <p>
        A test compares with plain text. <VarToken>$variable</VarToken>,
        <VarToken kind="ref">@{}</VarToken> and <VarToken kind="inline">&#123;a|b&#125;</VarToken>
        written there are not read. To compare two variables, test one and write the other's values
        as branches. You can test <VarToken>$colors.0</VarToken>, <VarToken>$outfit.SHOES</VarToken>
        or <VarToken>$hair.neg</VarToken> like any variable.
      </p>
    </DocSection>

    <DocSection title="Several tests in one branch">
      <p>
        Click <b>+ Condition</b> to add another test. The word between them reads <b>AND</b> (all
        must match); click it to make it <b>OR</b> (any may match). AND groups tighter than OR, the
        way it reads, and tests joined by AND are drawn in a box so you see what goes together.
      </p>
      <p>
        <b>+ Group</b> adds a box yourself: IF <VarToken>$time</VarToken> equals "night" AND
        (<VarToken>$weather</VarToken> equals "rain" OR <VarToken>$weather</VarToken> equals
        "fog"). Groups nest up to three deep.
      </p>
    </DocSection>

    <DocSection title="Actions">
      <DocKeyList :items="actionModes" />
      <p>
        Click <b>+ And</b> under an action to add another. They run in order, and each sees what the
        one before wrote: IF <VarToken>$tier</VarToken> equals "warmup", set
        <VarToken>$pose</VarToken> to <VarToken>$pose_portrait</VarToken> AND add
        <VarToken>$pose_portrait.neg</VarToken> to its negative.
      </p>
      <p>
        An action's text can hold <VarToken>$variables</VarToken>, a <VarToken kind="inline">&#123;a|b&#125;</VarToken>
        choice or a <VarToken kind="ref">@{}</VarToken> reference with a filter, so a rule can pull a
        fresh pick: <code>cinematic lighting, @{Lighting:dramatic}</code> writes "cinematic
        lighting," plus a pick from the dramatic lights.
      </p>
      <DocDetails title="What happens to negatives">
        <p>
          Replace swaps the variable's negative for those of the variables its new text read;
          Append and Prepend keep the old one and add. A reference inside Add to negative never
          changes a pick.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="LoRA by model">
      <p>
        <b>LoRA by model</b> in the editor adds a ready-made rule for WP Model Info: if
        <VarToken>$model_variant</VarToken> is pony, <VarToken>$loras</VarToken> gets a Pony LoRA
        tag; if illustrious, an Illustrious one; otherwise nothing. Put your LoRA names in, add a
        branch per model you use, and write <VarToken>$loras</VarToken> in your template.
      </p>
    </DocSection>

    <DocSection title="Change it for one node">
      <DocKeyList :items="instanceOptions" />
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter derivation that sets <VarToken>$accent</VarToken> from the mood: if
        <VarToken>$mood</VarToken> is "dramatic" it writes "cinematic lighting", otherwise "soft
        lighting".
      </p>
      <StarterButton slot="accent" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'negatives', label: 'Negatives', icon: 'pi pi-minus-circle', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
