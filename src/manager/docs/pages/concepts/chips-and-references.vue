<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const chipStates = [
  {
    term: "Resolved",
    desc: "The chip points at something real. A ref chip is tinted with the colour of the module it points at (violet ✦ for a wildcard) and hovering it shows the target's id and option count. A var chip (⌘) is tinted by its name, and hovering it says which module writes it, or that it binds at runtime.",
  },
  {
    term: "Filtered",
    desc: "A resolved ref chip that narrows its pool. A funnel icon means it carries a sub-category filter, a ban icon means it excludes the null option. Hover shows the filter as it reads and how many options still match, e.g. \"3 of 8 options match\". Click the chip to edit the filter.",
  },
  {
    term: "Broken",
    desc: "A red chip with a ? icon: the reference points at a module id that isn't in your library (deleted, or never imported here). Hover shows the name it had, when the reference stored one. Click it to point it at another module. At run time it produces nothing and the run reports an \"Unresolved reference\" warning.",
  },
];
</script>

<template>
  <DocPage
    group="How it connects"
    title="Chips & references"
    icon="pi pi-tag"
    tone="neutral"
    blurb="What the chips in text fields are, the three states they show, the @{…} reference syntax, and the sub-category filter grammar (not / and / or / parentheses)."
  >
    <DocSection title="What a chip is">
      <p>
        Text fields that understand pipeline syntax show each <VarToken>$name</VarToken> and each
        <VarToken kind="ref">@{…}</VarToken> reference as a <b>chip</b>: a small tinted pill instead of raw characters. A chip is one unit. The caret
        steps over it in one move and Backspace deletes it whole, so you can't half-delete a
        reference and leave broken syntax behind.
      </p>
      <p>
        Under the chip the field still stores plain text. Copying a chip copies its syntax, and
        pasting that syntax anywhere turns back into the same chip. There are two kinds:
      </p>
      <ul>
        <li>
          <b>Var chips</b> (<VarToken>$mood</VarToken>, <VarToken>$outfit.SHOES</VarToken>) read a
          variable from the Context. They appear where variables can be read: combine and
          derivation text and the Prompt Assembler template. Each name keeps the same colour
          everywhere, so the chip in a combine matches the one in the Assembler's variable strip.
        </li>
        <li>
          <b>Ref chips</b> (<VarToken kind="ref">@{abcd1234#Mood}</VarToken>) embed a fresh pick
          from another module. They appear where references work: wildcard options and derivation
          actions. They show the target's name, not its id.
        </li>
      </ul>
    </DocSection>

    <DocSection title="The three states">
      <DocKeyList :items="chipStates" />
      <DocCallout variant="tip">
        A var chip never turns red just because nothing produces it yet: variables can be set at
        run time (by an injector, a loop, or a Context further up the chain), so an unknown name
        stays a normal chip. Its hover says <i>binds at runtime</i>, and on the canvas <i>no
        upstream producer</i> when the graph really has none. The one var-chip warning is an
        accessor like <VarToken>$outfit.SHOES</VarToken> whose axis the wildcard doesn't declare,
        which is underlined because it would render empty.
      </DocCallout>
    </DocSection>

    <DocSection title="Making chips (and placeholders)">
      <p>
        Type <b>$</b> to open the variable list, or <b>@</b> to open the module list. Keep typing
        to narrow the list, then pick with Enter or a click.
      </p>
      <p>
        Picking a wildcard that has sub-categories (or a null option) opens a second step, the
        <b>filter picker</b>, where you can type a filter expression and tick <b>Exclude null</b>.
        Press Enter to insert the chip, or leave the expression empty for an unfiltered
        reference. You can reopen the same picker later by clicking the chip.
      </p>
      <p>
        <b>Placeholders.</b> To use a variable nothing produces yet, type
        <VarToken>$</VarToken> and the name, e.g. <VarToken>$lighting</VarToken>, then a space or
        a comma (or press Enter when the list is empty). The name becomes a chip right away and is
        filled in by
        whatever module later writes <VarToken>$lighting</VarToken>. Until then it renders empty
        and the Assembler marks it as missing, which is a handy to-do marker while you build a
        template ahead of its modules.
      </p>
    </DocSection>

    <DocSection title="@{uuid#name:filter} versus plain @name">
      <p>
        A reference is always written with braces and the target's 8-character id. Typing
        <code>@name</code> does <b>not</b> make a reference: it stays literal text and goes into
        the prompt as written. Use the <b>@</b> list to insert the chip and the editor writes the
        full form for you. The long form has four segments, and only the id is required:
      </p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Example</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>id</td>
            <td><VarToken kind="ref">@{abcd1234}</VarToken></td>
            <td>The module's 8 lowercase hex characters. This is what the engine resolves, so
              renaming the target never breaks the reference.</td>
          </tr>
          <tr>
            <td><code>#name</code></td>
            <td><VarToken kind="ref">@{abcd1234#Mood}</VarToken></td>
            <td>A remembered label. Only used for display, and to tell you what a broken chip used
              to point at.</td>
          </tr>
          <tr>
            <td><code>:filter</code></td>
            <td><VarToken kind="ref">@{abcd1234#Mood:warm or calm}</VarToken></td>
            <td>Only options whose sub-categories satisfy the expression can be picked. Grammar
              below.</td>
          </tr>
          <tr>
            <td><code>!null</code></td>
            <td><VarToken kind="ref">@{abcd1234#Mood:warm!null}</VarToken></td>
            <td>Drops the wildcard's null option from the pool. Without it, the null option always
              stays in, whatever the filter says.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Where a plain name is enough, reach for a variable instead: <VarToken>$mood</VarToken>
        reads the value an upstream wildcard already picked, while
        <VarToken kind="ref">@{…}</VarToken> rolls the referenced wildcard again, on the spot,
        from its (optionally filtered) pool.
      </p>
    </DocSection>

    <DocSection title="Filter expression grammar">
      <p>
        A filter is plain boolean English over the referenced wildcard's sub-category names. Each
        option is tested against its own tags, and it stays in the pool when the expression is
        true.
      </p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr>
            <th>Write</th>
            <th>Keeps options that</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>warm</code></td>
            <td>carry the <code>warm</code> tag</td>
          </tr>
          <tr>
            <td><code>not warm</code></td>
            <td>don't carry <code>warm</code> (options with no tags at all count)</td>
          </tr>
          <tr>
            <td><code>warm and bright</code></td>
            <td>carry both</td>
          </tr>
          <tr>
            <td><code>warm or cool</code> · <code>warm, cool</code></td>
            <td>carry either (a comma is short for <code>or</code>)</td>
          </tr>
          <tr>
            <td><code>not warm and (low or high)</code></td>
            <td>don't carry <code>warm</code>, and carry <code>low</code> or <code>high</code></td>
          </tr>
          <tr>
            <td><code>not (warm or cool)</code></td>
            <td>carry neither</td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          <b>Precedence:</b> <code>not</code> binds tightest, then <code>and</code>, then
          <code>or</code>. So <code>a or b and c</code> means <code>a or (b and c)</code>. Use
          parentheses whenever you mean something else; they nest to any depth.
        </li>
        <li>
          <b>Operators are lowercase words.</b> Symbols like <code>!</code>, <code>&amp;</code> or
          <code>|</code> are not operators, and <code>!</code> is reserved for the
          <code>!null</code> flag. Write <code>not warm</code>, never <code>!warm</code>.
        </li>
        <li>
          <b>Tag names match exactly</b>, including case. A name can't contain spaces or any of
          <code>( ) ! , # : { } @ $</code>, and <code>and</code>, <code>or</code>,
          <code>not</code> and <code>null</code> are reserved.
        </li>
        <li>
          <b>Null is a flag, not a term.</b> To keep the null option out, tick Exclude null (the
          <code>!null</code> segment); writing <code>not null</code> in the expression is an error.
        </li>
      </ul>
      <p>
        The filter picker checks the expression as you type. It shows how the expression
        <b>reads as</b> (fully parenthesised where it matters), how many options match, and flags
        an unknown sub-category with a <i>did you mean</i> fix. If a valid filter matches no
        option, the reference resolves to empty at run time and raises a
        <i>Sub-category filter matched nothing</i> warning that lists the tags the pool actually
        has (see <DocRef id="warning-types" />).
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'warning-types', label: 'Warning & conflict types', icon: 'pi pi-list', tone: 'neutral' },
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
  margin: 8px 0 12px;
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
</style>
