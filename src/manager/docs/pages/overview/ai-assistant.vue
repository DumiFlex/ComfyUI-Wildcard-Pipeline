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
    blurb="Optional and off by default: connect a model you choose and let it write wildcard options, edit the ones you have, write derivation and constraint rules, and describe and tag your modules, all for you to review."
  >
    <DocSection title="What it does">
      <p>
        The assistant uses a model <em>you</em> supply: one running on your own PC (Ollama,
        LM Studio, llama.cpp or any OpenAI-compatible server) or the Claude or OpenAI API with
        your own key. Wildcard Pipeline ships no model and sends nothing anywhere until you turn
        the assistant on.
      </p>
      <p>
        Today it adds wildcard options and removes, rewrites, retags or re-weights the ones
        you have, writes derivation and constraint rules from a description, and writes a
        description and tags for anything in your library. Every request includes the item's
        name, description and tags, so writing a good description first points the model in
        the right direction. More is planned: organizing your library, a chat that can edit modules, and building a whole
        pack from a description.
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
          { term: 'Test connection', desc: 'Lists the models, then asks the chosen one for a tiny JSON answer, and tells you whether it worked and how long it took.' },
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
      <DocCallout variant="tip">
        Options that repeat an existing one, or that use <code>$</code>, <code>@</code>,
        <code>{</code>, <code>}</code> or <code>|</code>, are left out and listed under
        the result, so a draft can never add a broken reference.
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
        fantasy pack?") or ask for a change. The assistant searches and reads your items itself;
        the lines above each reply say what it looked at. It knows which item you have open, so
        "this wildcard" means that one.
      </p>
      <p>
        Every change comes back as a card, and nothing is saved until you press <b>Apply</b> on
        it. It can:
      </p>
      <ul>
        <li>create a wildcard, a derivation or a constraint between two wildcards,</li>
        <li>add options to a wildcard or rules to a derivation,</li>
        <li>change an item's description, tags, category or rating,</li>
        <li>open an item's editor.</li>
      </ul>
      <p>
        Each card lists what it adds and warns about anything it left out (a duplicate option, a
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
        for LM Studio or llama.cpp.
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
        Keep a writer selected for drafting, and switch the model to a builder in Settings when
        you organize a library or build a whole pack.
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
        variables) and the conversation so far, plus whatever items the assistant reads to
        answer. A follow-up sends the earlier requests
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
