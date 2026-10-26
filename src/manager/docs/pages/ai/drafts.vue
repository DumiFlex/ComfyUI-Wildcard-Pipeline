<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Draft with AI"
    icon="pi pi-pencil"
    tone="neutral"
    blurb="The AI button in each editor: write new options, rules, values and templates, or change the ones you have. You see the result first; nothing is saved until you press Save."
  >
    <DocSection title="Add options to a wildcard">
      <ol>
        <li>Open a wildcard and press <b>AI</b> above the options. Stay on the <b>Add</b> tab.</li>
        <li>Say what you want and how many, for example <em>8 more outfits for a rainy city at
          night</em>. Press <b>Draft</b> (Ctrl + Enter).</li>
        <li>Untick anything you don't want and press <b>Add</b>. The rest go in like pasted
          options, with new tags marked.</li>
      </ol>
      <p>
        The model sees the wildcard's name, options and tags, so it writes in the same style and
        reuses your tags. <b>Draft again</b> asks for another set, and <b>Stop</b> cancels a slow one.
      </p>
      <p>
        Options can use the syntax you'd type: <code>{red|blue}</code> picks one each run, and
        <code>@{Colors:warm}</code> draws from another wildcard. Ask for "a scarf in a warm colour
        from my Colors wildcard" and the assistant writes the reference for you.
      </p>
      <p>
        Ask for <b>tag groups</b> and it makes them too. "Outfits and the shoes they go with" makes
        an accepts group (SHOES: loafers, sneakers, boots) and tags each outfit with the shoes that
        suit it. A constraint on that group then makes your Shoes wildcard agree with the outfit.
      </p>
      <DocCallout variant="tip">
        Drafts can't add broken options. Repeats, options that read a <code>$variable</code>, and
        references to a wildcard or tag you don't have are left out and listed under the result.
      </DocCallout>
    </DocSection>

    <DocSection title="Change the options you have">
      <p>
        The other tabs work on every option, or only on the ones you ticked in <b>Bulk edit</b>.
        You get a before/after list with a tick box per change; press <b>Apply</b> (or
        <b>Remove</b>) for the ones you keep.
      </p>
      <DocKeyList
        :items="[
          { term: 'Remove', desc: 'Finds options matching what you describe (\'drop anything modern\') and says why. Options other modules point at stay; delete those by hand.' },
          { term: 'Rewrite', desc: 'Changes the wording: tags to sentences, another style, shorter, typos fixed.' },
          { term: 'Retag', desc: 'Sets each option\'s tags (\'tag each by the seasons it suits\'). The new tags replace the old ones.' },
          { term: 'Weights', desc: 'Makes options rarer or more common. 1 is normal, 0.5 half as likely, 2 twice, 0 never.' },
        ]"
      />
      <p>Up to 300 options go in one request; select some first for a longer list.</p>
    </DocSection>

    <DocSection title="Rules, values and templates">
      <p>The other editors have an <b>AI</b> button too. Describe what you want in your own words:</p>
      <DocKeyList
        :items="[
          { term: 'Derivation', desc: 'For example: when $class is mage, set $title to Archmage and add robes to $outfit. It uses the real variable and option names from your library and warns about anything nothing sets. New rules go to the end.' },
          { term: 'Constraint', desc: 'Pick the source and target wildcards first, then press AI on the Rule matrix. For example: mages never carry swords, warriors rarely get staves. Switch to Preview to see each option\'s chances with the ticked rules.' },
          { term: 'Fixed values', desc: 'A style preset or quality tags, each with the negative words it should add.' },
          { term: 'Combine', desc: 'Joins variables into one phrase. Set the output variable first.' },
          { term: 'Template', desc: 'The Assembler prompt from your variables, plus a standing negative with $negatives.' },
        ]"
      />
      <p>
        You see the result first, with a warning for any variable nothing sets. <b>Add</b>,
        <b>Apply</b> or <b>Use</b> puts it in the editor.
      </p>
      <DocCallout variant="tip">
        Rules need a model that follows instructions well. If the answer comes back unusable,
        switch to a builder model.
      </DocCallout>
    </DocSection>

    <DocSection title="Describe and tag">
      <p>
        Every editor's <b>Identity</b> card has a <b>Describe</b> button. The model reads what the
        item holds and writes a short description plus tags to find it by, reusing your tags (new
        ones are dashed). Type a note first to steer it. <b>Apply</b> replaces the description and
        adds the tags.
      </p>
    </DocSection>

    <DocSection title="Close, but not quite? Refine it">
      <p>
        Type a follow-up in the request box ("darker", "shorter names", "keep the first three") and
        press <b>Refine</b>. The model gets the conversation so far, including what you unticked,
        and sends a revised answer.
      </p>
      <ul>
        <li><b>Try again</b> asks the same request afresh for another take. The new try goes on
          that request's own line as <b>try 2 of 2</b>, so tries never mix with refinements.</li>
        <li>Your requests are listed above the answer, one line per step. A line's arrows flip
          between its tries, and between different refines of the same answer (<b>refine 1 of 2</b>).
          The lines under it follow the branch you flip to.</li>
        <li>Click an earlier line to see its answer. Refine or Try again from there starts a new
          branch; nothing is overwritten.</li>
        <li><b>Start over</b> puts your first request back in the box.</li>
        <li>Adding or applying ends the conversation; the next request starts fresh.</li>
      </ul>
    </DocSection>

    <DocSection title="Images and web search">
      <p>
        With a model that sees images, paste, drop or pick up to 4 reference images under the
        request box ("options from this photo"). They go with each request of that panel until you
        remove them.
      </p>
      <p>
        With web search set up, the wildcard and text panels may suggest a search for facts the
        model doesn't know well (a game's characters, an artist's style). Nothing is searched until
        you press <b>Search</b>. Then pick which results to use: <b>Use what fits and refine</b>,
        <b>Use N ticked</b>, or <b>None of these</b>.
      </p>
      <DocDetails>
        <ul>
          <li>Changes land in the editor like your own edits, so you can still tweak or undo them.</li>
          <li>Retag on every option that comes back empty is asked once more, unless the model
            says why nothing changes; that reason shows in the panel. A rewrite that would make two
            options the same is left out.</li>
          <li>Derivation option names are fixed to the exact spelling, since the test is
            case-sensitive.</li>
          <li>Constraint rules between two tags go in the matrix, between two options become
            exceptions, and a tag paired with one option becomes an exception per option. A rule for
            a pair that already has one is marked “replaces”.</li>
          <li>Fixed values with a name you already have are rewritten in place. Values can use
            <code>{a|b}</code> but not <code>$variables</code>. A template never gets
            <code>{a|b}</code>, because the Assembler has no seed and would print it as is.</li>
          <li>A refine works on the same rows the first request saw, even if you edit the list
            meanwhile.</li>
          <li>The image strip is hidden for a model that can't see images.</li>
        </ul>
      </DocDetails>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'ai-chat', label: 'Chat', icon: 'pi pi-comments', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
