<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Pack builder"
    icon="pi pi-box"
    tone="neutral"
    blurb="Describe a pack in your own words. The assistant plans it, builds every item, tests it on the engine and installs it as one bundle you can undo."
  >
    <DocSection title="What you get">
      <p>
        <b>Pack builder</b> in the sidebar (shown once the assistant is on) makes a complete pack
        from one description: wildcards, fixed values, rules, combines, constraints and a prompt
        template, filed into one bundle with a sub-bundle per section. A pack holds up to 60 items.
      </p>
    </DocSection>

    <DocSection title="The five steps">
      <ol>
        <li><b>Describe</b> what the pack makes and the rules between its parts ("elves never use
          guns, mages get robes"). Add up to 4 reference images if your model sees them, and refer
          to them by number ("the skirt in image 2").</li>
        <li><b>Settings.</b> <b>Next: pack settings</b> shows the options below. They're kept in
          this browser, so next time <b>Plan it</b> is the only click. Above them, <b>Recommended
          for this pack</b> lists the settings that fit your request, each with why (Flux reads
          natural phrases and ignores negatives; two image models want Per model family).
          <b>Use recommended</b> takes them; nothing changes until you press it.</li>
        <li><b>Plan.</b> The assistant lists every item it will build, grouped by section, and asks
          what it can't guess. Answer, edit items, or ask for changes until the plan looks right.</li>
        <li><b>Build &amp; check.</b> Each item is built, then the pack runs 200 seeds on the real
          engine. Items with problems are rebuilt, up to twice.</li>
        <li><b>Install</b> adds everything, tagged with the pack's name, and tells you how to wire it:
          the bundle in a WP Context, the template in a WP Prompt Assembler, an Injector row per
          input. <b>Undo</b> removes all of it.</li>
      </ol>
      <DocCallout variant="tip">
        Building takes one request per item, so a local model needs a few minutes. Use a builder
        model. If an item fails, you can retry it, rebuild it or leave it out.
      </DocCallout>
    </DocSection>

    <DocSection title="Pack settings">
      <DocKeyList
        :items="[
          { term: 'Planner', desc: 'Pack graph (the default): the model plans the picks and how they relate, and the code writes every rule and the template from that. Items one by one: the older planner, where the model writes each rule itself.' },
          { term: 'Plan drafts', desc: 'When needed (the default) drafts the plan once, and once more only when the code sees a problem in the first, keeping the better one. Best of three drafts the first plan three times and keeps the one that fits your request best; about three times as long, helps small local models most. One: a single draft.' },
          { term: 'Your library', desc: 'New, in its style (the default), Reuse what fits (your existing wildcards and fixed values, marked yours), or Everything new.' },
          { term: 'Negatives', desc: 'Standing + per option, Template only, or None.' },
          { term: 'Structure', desc: 'Sub-bundle per section, or One bundle.' },
          { term: 'Written as', desc: 'Tags, Natural phrases, or let the planner decide.' },
          { term: 'Rating', desc: 'Safe or NSFW, or let the planner decide.' },
          { term: 'Options per wildcard', desc: 'How many options each wildcard gets. Auto sizes each one.' },
          { term: 'Model', desc: 'Any model, or Per model family: quality and negative tags per model (Pony score tags, Illustrious / NoobAI tags), chosen from $model_variant set by WP Model Info.' },
        ]"
      />
      <p>
        These are preferences for any pack. What the pack is about (its subject, LoRAs, a story)
        comes from your description.
      </p>
    </DocSection>

    <DocSection title="Working on the plan">
      <ul>
        <li><b>Questions.</b> Answer by clicking, type your own under <b>Other</b>, or press
          <b>Decide for me</b> (<b>Decide the rest</b> for all open ones). Then <b>Send answers</b>.
          Your answers show under <b>You decided</b> and the model's guesses under <b>The assistant
          assumed</b>; click either to change it.</li>
        <li><b>Edit an item.</b> Click it to change it by hand, ask the AI to change just that item,
          or remove it. <b>Add an item</b>, <b>Add a slot</b> or <b>Add a relation</b> adds your own.
          What you edit by hand is marked "yours" and kept through every update.</li>
        <li><b>Change the plan.</b> Type what to change and press <b>Update plan</b>. Each item then
          says whether it's new or what changed. <b>Plan 2 of 3</b> flips between versions, and
          nothing is overwritten.</li>
        <li><b>Runs as</b> under the title: <b>Single images</b>, <b>Story over a Loop</b> (a WP
          Context Loop plays a story beat per frame from <code>$iteration</code>, with the character
          and outfit held) or <b>Sweep sheet</b> (2 or 3 short wildcards as Loop sweep axes). The
          planner reads it from your description, and you can change it.</li>
        <li><b>Inputs.</b> A subject you give it ("my OC") or a LoRA you name becomes an input you
          wire from a WP Context Injector. A character LoRA gets a rule that swaps it in for the
          rolled character when set.</li>
        <li><b>How it fits together</b> under the title is the planner's own account of which pick
          decides which, and why each rule is there.</li>
        <li><b>Web search.</b> If it's set up, the planner may ask to search first (a franchise's
          characters, an era's clothing). <b>Search and update the plan</b> shows what was found;
          then <b>Use what fits</b>, <b>Use N ticked</b> or <b>None of these</b>. <b>Skip the
          search</b> doesn't search.</li>
      </ul>
    </DocSection>

    <DocSection title="Plan review and fixes">
      <p>
        The plan is checked as you edit it: a variable nothing sets, a rule on a tag that doesn't
        exist, two constraints that loop, a story without beats, a LoRA input nothing reads. Each
        finding has <b>Apply</b> (when there's a ready fix) and <b>Dismiss</b>. Tick findings and
        press <b>Fix with AI</b>, or <b>Fix all with AI</b>. <b>Review with AI</b> asks the model
        for a second opinion on the design.
      </p>
      <p>
        After the build, each problem on an item has <b>Fix with AI</b> (rebuild it with the problem
        as a note), <b>Explain</b> and <b>Dismiss</b>. The test run also shows each variable's most
        common values, options that never came up, and a few sample prompts. A story pack plays
        every frame of its Loop.
      </p>
    </DocSection>

    <DocSection title="More ways to start">
      <ul>
        <li><b>Start from a prompt you like.</b> Paste a prompt and the planner splits it into
          parts, one wildcard each, to make more like it.</li>
        <li><b>Extend with AI</b> in a bundle's editor opens the Pack builder on that bundle:
          describe what to add ("a weather wildcard the outfits follow"). New items are installed
          where they belong, and Undo puts the bundle back.</li>
        <li><b>Make sub-bundles</b> in a bundle's editor groups its children by a name you type, pick
          or let <b>Suggest with AI</b> choose. The AI only groups children that sit next to each
          other, so the run order stays the same.</li>
        <li><b>Open in Pack builder</b> on a chat card hands a pack the chat suggested to the Pack
          builder, with the settings the chat recommends. It doesn't plan yet, so you can add
          reference images and check the settings first.</li>
      </ul>
      <p>
        The planner first reads your library's style (tags or sentences, your tags, variables and
        standing negatives) so the pack matches what you have.
      </p>
    </DocSection>

    <DocSection title="Good to know">
      <DocDetails title="How the pack graph planner works">
        <p>
          With <b>Pack graph</b>, the model writes a small graph instead of the items: a
          <b>slot</b> per choice the image makes (one wildcard each, with how many options, whether
          it prints or only feeds rules, "pick 2", hold, a share of "none"), each slot's
          <b>axes</b> (the ways its options differ, like Season: winter, summer), the
          <b>relations</b> between slots (never gets, only gets, favours, rarely gets, agrees with
          on an axis, accepts, sets a variable, adds to a variable, draws from) and the <b>template
          order</b>. The code then writes every constraint, derivation and the template from the
          graph, so a rule can only name a slot and value that exist.
        </p>
        <ul>
          <li>A relation naming something the graph doesn't have is dropped and listed as "Left out
            a rule"; the model is asked once to write it again. <b>Fix with AI</b> on the note asks
            for just that rule.</li>
          <li>Each relation names the words it's about ("sandals" for "no sandals in winter"), so the
            target wildcard gets options with those words and the test run checks the prompts for
            them.</li>
          <li>What the run and settings need is wired by the code, not asked of the model: the
            story beat derivation from <code>$iteration</code>, sweep axes, holds, and the per-model
            quality rule. "Wired by the code" above the plan lists what it did. Those rules can't be
            changed with AI; change the run or the setting instead.</li>
          <li>Settings land on the plan without an AI call: Options per wildcard caps every slot,
            Style and Rating replace the planner's, One bundle folds the sections. <b>Runs as</b>
            stays as you set it.</li>
          <li>The code asks its own questions when the graph has an open fork, marked "applied by
            the code": <b>Story or single</b> and <b>Sweep axes</b>. Their answers apply at once.</li>
          <li>"Change with AI" on an item changes just that slot, value, rule or the template. An
            image added after the plan is read on its own. <b>Fix all with AI</b> sends each finding
            about one item as a change to that item.</li>
          <li>The template reads every printed slot, fixed value and derived variable. Defect tags
            written in its lead (ugly, bad anatomy) move to the negative, and "1girl, solo" is taken
            out when the request names no person.</li>
          <li>Things your request names that the plan says nowhere ("sandals", "parka") become a
            finding, sent back to the planner once; if there's still no place, a note to add by
            hand.</li>
          <li>What your request asks for is held to the plan. "A hat 30% of the time" leaves the hat
            out of 70% of runs, "the same hero in every image" holds the hero in a story, and the
            thing the pack is about ("Outfits and shoes: …") is shown in the prompt; the code sets
            these itself. A rule between two picks it names ("winter never gets pastel colours")
            with no relation between them is a finding for the planner, and a rule keyed on a
            shared list instead of what was drawn from it is a tip.</li>
          <li>An option tagged with two axis values (a mountain that is cold and temperate) rolls
            one of them each run, so two rules never empty the pool together. The test run names
            rules that left a slot empty in three runs out of ten or more.</li>
          <li>A rule writing a bare number ("1.5" for "long styles more common") is a weight on the
            tagged options, not text. A Quality slot becomes fixed values; a Negative slot becomes
            the template's negative. The per-model quality rule gets an "otherwise" with the pack's
            own quality words, so <code>$quality</code> is set even without WP Model Info.</li>
        </ul>
      </DocDetails>
      <DocDetails title="How building and checking work">
        <ul>
          <li>Each item is built in its own request, wildcards first so rules can use their tags.
            Every item's id is reserved in the plan, so references point at items before they're
            built. On a graph plan only wildcards ask the model; everything else is written by the
            code.</li>
          <li>Each option must carry one of its slot's axis values. When a value a rule needs is
            missing, the model is asked only to add options with it.</li>
          <li>Before each test, words the prompt says twice are removed from the later item, but
            only when every test run reads the same without them.</li>
          <li>The test run checks every relation on real runs ("never gets" that still happened, a
            rule that never fired) and says how many held. An item with a problem (a rule that never
            applies, a variable nothing sets, a prompt showing what a rule keeps out, like snow in a
            desert) is rebuilt with the problem as a note, up to twice.</li>
          <li>An item that takes longer than 4 minutes is stopped; <b>Skip this item</b> moves on. If
            the template fails twice, a plain one that reads every pick is written for you.</li>
          <li>Findings are known by what they're about, not their wording, so a dismissal holds. One
            the AI hands back unchanged twice is marked as something it couldn't change and isn't
            sent again unless you tick it. After Fix all, Review with AI adds at most two new
            findings.</li>
          <li>Images go with the first plan, and again only when you add or remove one, mention
            them, or tick <b>Show the images again</b>; each costs about 1,000 tokens a request.
            What the planner took from them is listed under <b>From your images</b>.</li>
          <li>A meter under the request shows how much context the last plan request took; every
            update sends the whole conversation again. A thinking model that spends its whole
            output reasoning is asked once more with thinking off, and the plan, item and Draft with
            AI calls stay that way for that model. The plan and each item have a folded
            <b>Thinking</b>, so you can see whether the model misread the request.</li>
          <li>Pack builder suggestions use your tag list and LoRA files when their autocomplete is
            on; tags your list doesn't have get a note, never an error.</li>
        </ul>
      </DocDetails>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-assistant', label: 'AI assistant', icon: 'pi pi-microchip-ai', tone: 'neutral' },
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
        ]"
      />
      <p>For adult packs, read <DocRef id="adult-packs" /> first.</p>
    </DocSection>
  </DocPage>
</template>
