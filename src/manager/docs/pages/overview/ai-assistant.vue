<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import { SUGGESTED_LOCAL_MODELS } from "../../../components/settings/ai-models";
</script>

<template>
  <DocPage
    group="Overview"
    title="AI assistant"
    icon="pi pi-microchip-ai"
    tone="neutral"
    blurb="Optional and off by default: connect a model you choose and let it draft wildcard options for you to review."
  >
    <DocSection title="What it does">
      <p>
        The assistant uses a model <em>you</em> supply: one running on your own PC (Ollama,
        LM Studio, llama.cpp or any OpenAI-compatible server) or the Claude or OpenAI API with
        your own key. Wildcard Pipeline ships no model and sends nothing anywhere until you turn
        the assistant on.
      </p>
      <p>
        Today it drafts wildcard options. More is planned: quick actions in every editor,
        organizing and re-tagging your library, a chat that can edit modules, and building a
        whole pack from a description.
      </p>
    </DocSection>

    <DocSection title="Set it up">
      <p>Open <b>Settings → AI assistant</b>.</p>
      <DocKeyList
        :items="[
          { term: 'Enable', desc: 'Turns the assistant on. While it is off, the Draft with AI button is hidden and the model routes refuse every call.' },
          { term: 'Provider', desc: 'Ollama, LM Studio, llama.cpp, Claude, OpenAI, or Custom for any other OpenAI-compatible server. Changing it clears the address, key and model.' },
          { term: 'Server address', desc: 'Filled in for each provider; change it if your server runs on another port or machine.' },
          { term: 'API key', desc: 'Only needed for Claude, OpenAI or a server that asks for one. It is stored on ComfyUI\'s side and never shown again; Remove deletes it. WP_AI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment work too.' },
          { term: 'Model', desc: 'Picked from the list your server reports (refresh after downloading a new one), or typed in.' },
          { term: 'Unload after', desc: 'For local servers: how many idle seconds before the model leaves the GPU, so ComfyUI gets its memory back. 0 unloads right away.' },
          { term: 'Test connection', desc: 'Lists the models, then asks the chosen one for a tiny JSON answer, and tells you whether it worked and how long it took.' },
        ]"
      />
    </DocSection>

    <DocSection title="Draft wildcard options">
      <p>
        In a wildcard's editor, press <b>Draft with AI</b>. Say what you want (for example
        <em>more outfits for a rainy city at night</em>) and how many, then <b>Draft</b>
        (Ctrl + Enter). The model sees the wildcard's name, its options and its tags, so it
        writes in the same style and reuses your tags.
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

    <DocSection title="Which model">
      <p>
        Hosted models (Claude, OpenAI) give the best results but may refuse explicit content.
        These uncensored local builds write NSFW lists without refusing. Install one in Ollama
        with <code>ollama pull</code> and the name below, or download it from Hugging Face for
        LM Studio or llama.cpp.
      </p>
      <ul class="wp-doc-ai-models">
        <li v-for="m in SUGGESTED_LOCAL_MODELS" :key="m.name">
          <code>{{ m.name }}</code> ({{ m.vram }} GPU): {{ m.goodFor }}.
          <a :href="m.ollamaUrl" target="_blank" rel="noopener noreferrer">Ollama</a> ·
          <a :href="m.hfUrl" target="_blank" rel="noopener noreferrer">Hugging Face</a>
        </li>
      </ul>
    </DocSection>

    <DocSection title="Privacy">
      <p>
        With a local server nothing leaves your PC. With Claude or OpenAI, your request and the
        wildcard's name, options and tags go to that provider under your account.
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
