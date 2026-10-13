<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import { SUGGESTED_LOCAL_MODELS, SUGGESTED_MODEL_GROUPS } from "../../../components/settings/ai-models";
</script>

<template>
  <DocPage
    group="Overview"
    title="AI assistant"
    icon="pi pi-microchip-ai"
    tone="neutral"
    blurb="Optional and off by default: connect a model you choose and let it write wildcards, fixed values, combines, rules, constraints and templates, test them on the engine, explain a Test Runner run and build whole packs, all for you to review."
  >
    <DocSection title="What it does">
      <p>
        The assistant uses a model <em>you</em> supply: one running on your own PC (Ollama,
        LM Studio, llama.cpp or any OpenAI-compatible server) or the Claude or OpenAI API with
        your own key. Wildcard Pipeline ships no model and sends nothing anywhere until you turn
        the assistant on.
      </p>
      <p>
        It writes and edits every kind of module (wildcard options with tags, tag groups,
        negatives, an empty option and a fallback; fixed values; combines; derivation and
        constraint rules; prompt templates and bundles), runs what it made on the real engine to
        check it, explains a Test Runner run, organizes your library and builds whole packs from
        a description. Every request includes the item's name, description and tags, so writing
        a good description first points the model in the right direction.
      </p>
    </DocSection>

    <DocSection title="Set it up">
      <p>Open <b>Settings → AI assistant</b>.</p>
      <DocKeyList
        :items="[
          { term: 'Enable', desc: 'Turns the assistant on. While it is off, the AI button in the editors is hidden and the model routes refuse every call.' },
          { term: 'Provider', desc: 'Ollama, LM Studio, llama.cpp, Claude, OpenAI, or Custom for any other OpenAI-compatible server. Each provider remembers its own address, model and key, so you can switch back and forth without typing them again.' },
          { term: 'Server address', desc: 'Filled in for each provider; change it if your server runs on another port or machine.' },
          { term: 'API key', desc: 'Only needed for Claude, OpenAI or a server that asks for one. It is stored on ComfyUI\'s side and never shown again; Remove deletes it. WP_AI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment work too.' },
          { term: 'Model', desc: 'Picked from the list your server reports (refresh after downloading a new one), or typed in.' },
          { term: 'Unload after', desc: 'For local servers: how many idle seconds before the model leaves the GPU, so ComfyUI gets its memory back. 0 unloads right away.' },
          { term: 'Model size', desc: 'How much the assistant asks of the model. Small models (under 20B) get shorter instructions, smaller tool results and steadier settings; large ones and hosted models get everything. Automatic reads the size from the model\'s name; set it when the name doesn\'t say.' },
          { term: 'Most context to use', desc: 'For Ollama: the assistant asks for as much context as each request needs, up to this many tokens (16384 by default). Ollama\'s own default is far smaller and silently cuts the instructions off. Lower it if the model no longer fits on your GPU.' },
          { term: 'Test connection', desc: 'Lists the models, then asks the chosen one for a tiny JSON answer, and tells you whether it worked and how long it took. For LM Studio and llama.cpp it also reads how much context the model was loaded with and warns when it is under 16k, since the chat\'s instructions, a few turns and the answer need that much. These servers fix the context when they load the model, so set it there (in LM Studio: the Context Length in the model\'s load settings) and load the model again.' },
        ]"
      />
    </DocSection>

    <DocSection title="Add options to a wildcard">
      <p>
        In a wildcard's editor, press <b>AI</b> above the options and stay on the <b>Add</b> tab.
        Say what you want (for example <em>more outfits for a rainy city at night</em>) and how
        many, then <b>Draft</b> (Ctrl + Enter). The model sees the wildcard's name, its options
        and its tags, so it writes in the same style and reuses your tags.
      </p>
      <p>
        You get a list to review. Untick anything you don't want and press <b>Add</b>; the rest
        go in like pasted options, with new tags marked. <b>Draft again</b> asks for another
        set, and <b>Stop</b> cancels a slow one. Nothing is saved until you press <b>Save</b>.
      </p>
      <p>
        Options can hold the same syntax you'd type: <code>{red|blue}</code> picks one each run, and
        <code>@{Colors:warm}</code> draws from another wildcard (only its options tagged warm). The
        model names the wildcard; the assistant finds it in your library and writes the reference,
        so ask for "a scarf in a warm colour from my Colors wildcard" and it points there.
      </p>
      <DocCallout variant="tip">
        Options that repeat an existing one, read a <code>$variable</code> (options can't), point
        at a wildcard you don't have or at a tag it doesn't have, or point back at the wildcard
        itself are left out and listed under the result, so a draft can never add a broken
        reference.
      </DocCallout>
    </DocSection>

    <DocSection title="Edit the options you have">
      <p>
        The other tabs change options that are already there. They work on every option, or on
        just the ones you selected (tick their boxes in <b>Bulk edit</b> first). Say what you
        want and the model answers with a before/after list, one tick box per change.
      </p>
      <DocKeyList
        :items="[
          { term: 'Remove', desc: 'Finds options that match what you describe (\'drop anything modern\') and says why. Options other modules point at stay; delete those by hand so you can see what refers to them.' },
          { term: 'Rewrite', desc: 'Changes the wording: tags to sentences, a different style, shorter, typos fixed. A rewrite that would make two options the same is left out.' },
          { term: 'Retag', desc: 'Sets each option\'s tags (\'tag each by the seasons it suits\'). The new list replaces the old one; new tags are marked and created when you apply.' },
          { term: 'Weights', desc: 'Makes options rarer or more common (\'heavy winter gear rarer\'). 1 is normal, 0.5 half as likely, 2 twice, 0 never.' },
        ]"
      />
      <p>
        Untick what you don't want and press <b>Apply</b> (or <b>Remove</b>). The changes land in
        the editor like your own edits, so you can still tweak or undo them, and nothing is
        saved until you press <b>Save</b>. Up to 300 options go in one request; select some
        first for a longer list.
      </p>
    </DocSection>

    <DocSection title="Write rules from a description">
      <p>
        The derivation and constraint editors have an <b>AI</b> button too. Describe what the
        rules should do in your own words and the model writes them. You get each rule in plain
        words with a tick box, and nothing changes until you press <b>Add</b> or
        <b>Apply</b>; nothing is saved until you press <b>Save</b>.
      </p>
      <DocKeyList
        :items="[
          { term: 'Derivations', desc: 'For example: when $class is mage, set $title to Archmage and add robes to $outfit. The model sees every variable your library sets and the options of its wildcards, so it uses their real names. A rule that reads a variable nothing sets, or tests for an option the wildcard doesn\'t have, comes with a warning. Option names are fixed to the exact spelling, since the test is case-sensitive. New rules go to the end of the list.' },
          { term: 'Constraints', desc: 'Pick the source and target wildcards first, then press AI on the Rule matrix. For example: mages never carry swords, warriors rarely get staves. Rules between two tags go in the matrix, rules between two options become exceptions, and a tag paired with one option becomes an exception per option. A rule for a pair that already has one is marked “replaces” and takes its place. Switch to Preview to see each option\'s chances with the ticked rules, with arrows on what they change.' },
        ]"
      />
      <DocCallout variant="tip">
        Rules need a model that follows instructions well. If the answer comes back unusable,
        switch to one of the builder models below.
      </DocCallout>
    </DocSection>

    <DocSection title="Fixed values, combines and templates">
      <p>
        The fixed values, combine and template editors have an <b>AI</b> button as well. Describe
        what you want and the model writes it with the variables your library sets:
      </p>
      <DocKeyList
        :items="[
          { term: 'Fixed values', desc: 'A style preset or quality tags, each with the negative words it should add (an anime preset adds 3d render to the negative). A value with a name you already have is rewritten in place; the rest are added. Values can use {a|b} picks but not $variables.' },
          { term: 'Combine', desc: 'Joins variables into one phrase in the order the model reads best, and can add a negative. Set the output variable first.' },
          { term: 'Template', desc: 'Writes the Assembler prompt from your variables, plus a standing negative with $negatives where the negatives of the variables it used go. Choices belong in wildcards, so it never writes {a|b} here (the Assembler has no seed and would print it as is).' },
        ]"
      />
      <p>
        You see the result first, with a warning for any variable nothing in the library sets.
        <b>Use</b> puts it in the editor; nothing is saved until you press <b>Save</b>.
      </p>
    </DocSection>

    <DocSection title="Describe and tag">
      <p>
        Every editor's <b>Identity</b> card has a <b>Describe</b> button. The model reads what the
        item holds (a wildcard's options, a derivation's rules, a bundle's modules, a template's
        text) and writes a short description saying what it is for, plus tags to find it by. It
        reuses tags your library already has; new ones are dashed. Type a note first to steer it
        (optional). Untick what you don't want and press <b>Apply</b>: the description is
        replaced, the tags are added to the ones there, and nothing is saved until you press
        <b>Save</b>.
      </p>
    </DocSection>

    <DocSection title="Organize the library">
      <p>
        Select modules or bundles in any library list (up to 60), then press <b>Organize with AI</b>
        in the selection bar. The model reads each item (its name, description, what it holds and
        its current category, tags and rating) together with your library's categories and tags,
        and suggests:
      </p>
      <ul>
        <li>a <b>category</b>, reusing yours where one fits (a new one is dashed and created when
          you apply; bundles have no category),</li>
        <li><b>tags</b> to add or remove, reusing tags the library already has,</li>
        <li>a <b>content rating</b> change, Safe or NSFW, when the content calls for it.</li>
      </ul>
      <p>
        Only items that would change are listed, each with a short reason. Every change is a chip:
        click one to leave it out, or untick an item to skip it. Type a note first to steer it
        (optional, e.g. "one category per subject"). <b>Apply</b> saves right away, and the toast
        that follows has <b>Undo</b>.
      </p>
    </DocSection>

    <DocSection title="Chat with the assistant">
      <p>
        The <b>AI</b> button in the top bar (shown once the assistant is on) opens a chat on the
        right. Ask about your library ("which wildcards set $outfit?", "what's missing for a
        fantasy pack?"), ask how something works, or ask for a change. The assistant searches and
        reads your items and these docs itself; the lines above each reply say what it looked at.
      </p>
      <p>
        It sees the page you're on. In an editor it reads the item as it is in the editor, unsaved
        changes included, so "this wildcard" means what you see. In a list it knows the filters
        and which rows you selected, in the Test Runner the last run's results and warnings, and in
        the Pack builder the plan.
      </p>
      <p>
        Every change comes back as a card, and nothing happens until you press <b>Apply</b> on
        it. It can:
      </p>
      <ul>
        <li>create a wildcard (with tag groups, negatives, an empty option, a fallback and
          references to other wildcards), or a vocabulary wildcard other options draw from,</li>
        <li>add options to a wildcard, or remove, rewrite, retag and re-weight the ones it has,
          set their negatives, pick the fallback, change how often the empty option comes up and
          group tags,</li>
        <li>create or change fixed values, a combine or a prompt template,</li>
        <li>create a derivation, add rules, or replace and remove rules by number,</li>
        <li>create a constraint between two wildcards, or change its rules and its reach,</li>
        <li>create a bundle in the right running order with per-use settings (pick 2-3, a tag
          filter, never empty, hold for a whole Loop run, internal), or add, remove and change its
          items,</li>
        <li>change an item's description, tags, category or rating,</li>
        <li>open an item's editor, a docs page or a manager page such as a Settings section,</li>
        <li>hand a whole new pack to the Pack builder: <b>Plan it</b> on the card opens the Pack
          builder with the pack described and starts the plan (a plan already there is kept and
          the description waits in its box).</li>
      </ul>
      <p>
        It can also <b>run a stack on the engine</b> before it answers: modules and bundles from
        your library, with pinned values and a template for sample prompts. It reads each
        variable's most common values, options that never came up and warnings, and with its own
        proposals swapped in it reports what moves ("wool coat 40% → 0%"). Ask it to check a
        change and it tries it first. Running changes nothing in your library.
      </p>
      <p>
        A change to the item open in your editor goes into the editor, and you keep it with
        <b>Save</b> there as usual. If you edit the item yourself after asking, the card says it's
        out of date; ask again. Other changes save to the library when you apply them. Options a
        constraint points at are never removed this way.
      </p>
      <p>
        The assistant plans before it acts and checks its work: when it proposes changes to
        modules it runs the stack with them before it answers, so the reply says what the change
        does. It can propose several items that depend on each other in one answer (a wildcard
        and a constraint on it); the later card waits until the first is applied. An answer that
        comes back garbled is asked for again once, with the problem named. It doesn't ask "should I go
        ahead?" before proposing, since the card is already the asking; if it does, or answers your
        "yes" by asking again, it is told once to make the change.
      </p>
      <p>
        Each card lists what it changes and warns about anything it left out (a duplicate option, a
        variable nothing sets). <b>Undo</b> on an applied card puts back what it replaced, or
        deletes what it created. <b>Dismiss</b> tells the assistant you said no. When two cards
        change the same item, the second builds on the first, so apply them in order. The chat
        stays when you close the drawer; <b>New chat</b> starts over.
      </p>
      <DocCallout variant="tip">
        Chat works best with a model that follows instructions well; use one of the builder
        models below. A small model may need a second try or a more specific request.
      </DocCallout>
    </DocSection>

    <DocSection title="Tidy up an imported wildcard pack">
      <p>
        Packs converted from Dynamic Prompts, Prompt Post-Processor or Impact files arrive as flat
        lists. After an import in <b>Import / Export → Wildcard packs</b>, a bar offers
        <b>Tag and connect with AI</b>: the chat opens with the imported wildcards and asks the
        assistant to tag their options, group the tags, link the lists with constraints (with a
        fallback where a rule could leave a list empty), gather them into a bundle and run a test.
        Every change comes back as a card to apply or skip; the option text stays as it was.
      </p>
    </DocSection>

    <DocSection title="Ask about a test run">
      <p>
        After a run in the <b>Test Runner</b>, a bar above the results asks the assistant about
        it: <b>Explain this run</b>, <b>Fix the warnings</b> (when there are any) or <b>Why do I
        never get…</b> with an option you expected to see. The chat gets the scenario's stack,
        pins and results, runs it again itself to check its answer, and offers any fix as cards
        you apply.
      </p>
    </DocSection>

    <DocSection title="Ask about the docs">
      <p>
        The assistant answers questions about Wildcard Pipeline from these docs and says which
        page it used, with a button to open it. On any docs page, <b>Ask the assistant</b> at the
        top of the page list opens the chat ready to explain the page in simpler words. Select a
        part of the page first to ask about just that part. It doesn't guess: if the docs don't
        cover something, it says so.
      </p>
    </DocSection>

    <DocSection title="Build a whole pack">
      <p>
        <b>Pack builder</b> in the sidebar (shown once the assistant is on) makes a complete pack
        from one description: wildcards, fixed values, derivation rules, combines, constraints
        between wildcards and a prompt template, filed into one bundle. It can also make
        vocabulary wildcards that other options draw from (<code>@{Colors:warm}</code>), give an
        item per-use settings in the bundle ("pick 2-3", "hold"), and plan inputs: values the
        pack reads but you set, like the subject, through a WP Context Injector row.
      </p>
      <ol>
        <li><b>Describe</b> what the pack makes and the rules between its parts ("elves never use
          guns, mages get robes").</li>
        <li><b>Plan.</b> The assistant lists every item it will build, by variable, and may ask up
          to three questions. Inputs are listed under the plan. Click an answer, remove items you don't want (the ✕ on a row), or
          type a change, then press <b>Update plan</b>. Nothing is built yet. Above the items, a
          line says how the pack is written (tags or sentences), which checkpoint family it is
          for, and the variable everything follows. Items marked <b>yours</b> are wildcards from
          your library the pack reuses instead of building a copy.</li>
        <li><b>Plan review.</b> Before anything is built, the plan is checked for what would
          break: a template or rule that reads a variable nothing sets, a constraint keyed on a tag
          neither wildcard lists, two constraints that loop, wildcards that ignore the pack's
          anchor, picks that nothing links. <b>Review with AI</b> asks the model for a second
          opinion, and <b>Fix these in the plan</b> sends the findings back as a change.</li>
        <li><b>Build &amp; check.</b> Each item is written in its own request, wildcards first so
          rules can use their tags. Then the pack runs 200 seeds on the real engine. An item with
          a problem (a rule that never applies, a variable nothing sets) is rebuilt with the
          problem as a note, up to twice, and the row says what was fixed. An item whose answer
          fails is asked again once with the error, and one that doesn't fit what it reads (a rule
          testing for an option its wildcard lacks) is rebuilt once with that named. The run also
          flags options that never came up or that take most of the picks; rebuild the item to
          spread them. Click a row to see what
          it holds; the refresh button builds that one again. The test run shows each variable's
          most common values and a few sample prompts.</li>
        <li><b>Install</b> adds the modules, the template and a bundle that runs them in the right
          order, all tagged with the pack's name so they show up together under Tags, and says how
          to wire it on the canvas (the bundle in a WP Context, the template in a WP Prompt
          Assembler, an Injector row per input). <b>Undo</b> removes all of it.</li>
      </ol>
      <p>
        The planner reads your library's conventions first: whether your options are tags or
        sentences and how long, the tags and tag groups you use, the variables your stacks set and
        the standing negatives in your templates, so the pack matches what you have. Open
        <b>Start from a prompt you like</b> and paste a prompt to build a pack that makes more like
        it: the planner splits it into slots, one wildcard each.
      </p>
      <DocCallout variant="tip">
        Building a pack takes one request per item, so a local model needs a few minutes. Use a
        builder model; a small one may leave an item unbuilt, which you can rebuild or remove.
      </DocCallout>
    </DocSection>

    <DocSection title="Refine an answer">
      <p>
        You don't have to start over when an answer is close but not right. Once it shows, the
        request box takes a follow-up: type what to change ("darker", "shorter names", "keep the
        first three, drop the rest") and press <b>Refine</b>. The model gets your earlier requests
        and its own answers, plus which items you unticked, and sends back a revised answer in
        full. Your requests so far are listed above the box.
      </p>
      <ul>
        <li><b>Try again</b> asks the same thing again for another take.</li>
        <li>Every answer is kept: the arrows next to <b>Answer 2 of 3</b> flip back to an earlier one,
          and a refine from there continues from that answer.</li>
        <li><b>Start over</b> drops the conversation and puts your first request back in the box to
          edit.</li>
        <li>Adding or applying ends the conversation; the next request starts fresh and sees what
          you added.</li>
      </ul>
      <p>
        A follow-up works on the same rows, rules and options the first request saw, even if you
        edit the list meanwhile, so the model's answers keep pointing at the same things.
      </p>
    </DocSection>

    <DocSection title="Which model">
      <p>
        Hosted models (Claude, OpenAI) follow instructions best but may refuse explicit content.
        For NSFW packs, run an uncensored model yourself. Not refusing isn't enough, though: a
        model also has to know the words, so the suggestions come in two groups. Install one in
        Ollama with <code>ollama pull</code> and the name below, or download it from Hugging Face
        for LM Studio or llama.cpp. With a 24 GB GPU, one of the 24 GB builders is enough on its
        own; below 16 GB, Gemma 4 12B heretic is the best single model. "Heretic" and
        "abliterated" builds are the original model with its refusals removed; heretic ones keep
        more of the original. None of these is proven to know Danbooru tags, so check a draft
        before you rely on it.
      </p>
      <template v-for="g in SUGGESTED_MODEL_GROUPS" :key="g.use">
        <p><b>{{ g.title }}.</b> {{ g.note }}</p>
        <ul class="wp-doc-ai-models">
          <li v-for="m in SUGGESTED_LOCAL_MODELS.filter((x) => x.use === g.use)" :key="m.name">
            <code>{{ m.name }}</code> ({{ m.vram }} GPU): {{ m.goodFor }}.
            <template v-if="m.ollamaUrl">
              <a :href="m.ollamaUrl" target="_blank" rel="noopener noreferrer">Ollama</a> ·
            </template>
            <a :href="m.hfUrl" target="_blank" rel="noopener noreferrer">Hugging Face</a>
          </li>
        </ul>
      </template>
      <DocCallout variant="tip">
        With two models, keep a writer selected for drafting and switch to a builder in Settings
        when you organize a library, chat or build a whole pack. Load local models with at least
        16k of context.
      </DocCallout>
    </DocSection>

    <DocSection title="Privacy">
      <p>
        With a local server nothing leaves your PC. With Claude or OpenAI, your request and the
        wildcard's name, options and tags go to that provider under your account. Writing
        derivation rules also sends the variables your library sets, with the first options of
        each wildcard; constraint rules send the two wildcards' options and tags; Describe sends
        what the item holds and the tags your library uses; Organize sends that for every selected
        item, plus your category names. The chat sends a list of your items (names, types and
        variables) and the conversation so far, plus whatever items and docs pages the
        assistant reads to answer, the results of stacks it runs (they run on your PC) and a
        short note of what the page shows (the open editor's item, a list's selection, the Test
        Runner's stack and last results). The fixed values, combine and template panels send the
        item and the variables your library sets. The pack builder sends your description, a sample prompt if you gave one,
        a summary of your library's conventions (option style, tags, variables, negatives and the
        wildcards worth reusing) and, for each item, what the pack has built so far. A follow-up sends the earlier requests
        and answers of that conversation again; nothing is kept on the server between requests.
      </p>
      <DocCallout variant="warn">
        ComfyUI has no login, so anyone who can reach its port can use the assistant while it is
        on, which spends your credits on a paid provider. Keep it off on a ComfyUI you share.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
          { id: 'chips-and-references', label: 'Chips & references', icon: 'pi pi-tag', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-ai-models { list-style: disc; padding-left: 20px; }
.wp-doc-ai-models li { margin: 4px 0; }
.wp-doc-ai-models a { color: var(--wp-accent); text-decoration: none; white-space: nowrap; }
.wp-doc-ai-models a:hover { text-decoration: underline; }
</style>
