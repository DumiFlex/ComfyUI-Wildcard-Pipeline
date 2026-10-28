<script setup lang="ts">
import CodeBlock from "@/components/shared/CodeBlock.vue";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import { SUGGESTED_LOCAL_MODELS, SUGGESTED_MODEL_GROUPS } from "../../../components/settings/ai-models";

const MODELFILE = "FROM hf.co/<repo>:<quant>\nRENDERER qwen3.5\nPARSER qwen3.5\n";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Set up a model"
    icon="pi pi-cog"
    tone="neutral"
    blurb="Turn the assistant on, connect a local server or an API key, and pick a model."
  >
    <DocSection title="Connect in four steps">
      <ol>
        <li>Open <b>Settings → AI assistant</b> and switch on <b>Enable</b>.</li>
        <li>Pick a <b>Provider</b>: Ollama, LM Studio, llama.cpp, Claude, OpenAI, or Other for any
          OpenAI-compatible server. The server address is filled in for you.</li>
        <li>For Claude or OpenAI, paste your <b>API key</b>. A local server doesn't need one.</li>
        <li>Pick a <b>Model</b> from the list your server reports, then press <b>Test
          connection</b>.</li>
      </ol>
      <p>
        Test connection lists the models, asks the chosen one for a tiny answer and tells you
        whether it worked and how long it took. It also checks that the model has enough room
        (context) for the chat, and warns when it doesn't.
      </p>
      <DocImage
        src="images/docs/ai-setup.png"
        ratio="2 / 1"
        caption="Settings › AI assistant: the switch that turns it on, the provider buttons, and the server address, model and API key fields."
      />
      <DocCallout variant="tip">
        Load local models with at least 16k of context; that is the minimum. 32k or more is
        recommended for chats that take several steps, which often reach 20k to 26k on a 27B model.
        In LM Studio that's the Context Length in the model's load settings; load the model again
        after you change it.
      </DocCallout>
    </DocSection>

    <DocSection title="The basic settings">
      <DocKeyList
        :items="[
          { term: 'Enable', desc: 'Turns the assistant on. While it is off, the AI buttons are hidden and nothing is sent anywhere.' },
          { term: 'Provider', desc: 'Each provider remembers its own address, model and key, so you can switch back and forth. A key icon means a key is saved. The settings that depend on the model are kept for each model too (see below).' },
          { term: 'Server address', desc: 'Change it if your server runs on another port or machine.' },
          { term: 'API key', desc: 'Stored on the ComfyUI side and never shown again; Remove deletes it. A key is only sent to the address it was saved for.' },
          { term: 'Model', desc: 'Picked from your server\'s list (refresh after downloading a new one), or typed in.' },
          { term: 'Unload after', desc: 'For local servers: how long an idle model stays loaded, so ComfyUI gets the GPU memory back. From right after each answer up to 1 hour, or Custom.' },
          { term: 'Thinking', desc: 'How much a thinking model reasons before it answers. The list shows what the chosen model takes: Off and On for a model with an on/off switch, or its own levels (Low to Max) for a model with levels, and a line under it says which. The same picker sits in the chat header. For a small or medium local model, As the model does means Off, and a choice you pick holds for the whole answer (switching between steps made LM Studio re-read the whole prompt).' },
        ]"
      />
      <p>
        Each setting shows its <b>Recommended</b> value under it, and lists mark the recommended
        choice. <b>Reset to recommended</b> puts every AI setting back after showing what will
        change; your provider, keys, addresses and chosen models stay as they are. Context is the
        one exception: Reset raises a window under 16k to 32k and leaves a bigger one alone.
      </p>
      <p>
        <b>Kept for each model.</b> Thinking, Model size, Most context to use, Tool format, Sampling,
        Choose the tool first and Short tool list are saved for the provider and model you set them
        on, and Unload after for the provider. Switch from Claude at Medium thinking to a Qwen in LM
        Studio and you get the Qwen's own settings back, not Claude's. A model you haven't used yet
        keeps the provider's values but starts Thinking and Model size at automatic, since another
        model's level or size may not fit it. Permissions, web search and the chat display options
        are the same for every provider.
      </p>
      <DocDetails title="Advanced settings">
        <DocKeyList
          :items="[
            { term: 'Model size', desc: 'How much the assistant asks of the model. Small models (under 20B) get shorter instructions, smaller tool results and the extra help described on Troubleshooting. Automatic reads the size from the model\'s name; set it when the name doesn\'t say.' },
            { term: 'Most context to use', desc: 'Tokens of context the assistant uses (16384 by default; presets 4k to 128k, or Custom). 16k is the minimum and 32k is recommended for chats that take several steps. Ollama gets exactly this much, because its own default is far smaller and silently cuts the instructions off. Lower it if the model no longer fits on your GPU. A new chat also checks how much context the model really has and starts leaner when it is tight.' },
            { term: 'Tool format', desc: 'How the chat calls its tools. Native tool calls are what most models are trained for; JSON steps work with any model. Automatic uses JSON steps for small and medium local models (a 9B on LM Studio did twice as well that way) and for any server that refuses or garbles native calls. A chat keeps the format it started with.' },
            { term: 'Choose the tool first', desc: 'Off by default. A small or medium model names the tool it will call, then writes only that tool\'s arguments. Some models pick better this way; each step is a little slower.' },
            { term: 'Short tool list', desc: 'Off by default. A small model in JSON steps gets one line per tool in its instructions, and a tool\'s full description (its arguments and an example) the first time a step offers it. About 2,000 fewer tokens per step, which helps when the context is tight. Applies to new chats.' },
            { term: 'Debug log', desc: 'Off by default. Records every AI request you make in this browser: each model call with the prompt as sent, the reply, thinking, tool calls and tokens. A Debug button in the top bar lists them with Copy debug, a readable copy to paste into a bug report. Images are left out (only their size is noted) and keys are hidden. Copies are also saved in the ai-debug folder of the Wildcard Pipeline data folder; the last 300 are kept.' },
            { term: 'Sampling', desc: 'Optional top K, top P, min P, repeat penalty and presence penalty, sent with every request to a local or OpenAI-compatible server. Empty uses the server\'s own setting for the model (LM Studio\'s, Ollama\'s). The assistant still sets the temperature itself, low for tool steps. Claude and OpenAI\'s own API get none. For Qwen 3.5 and later, top K 20, top P 0.8, min P 0 and repeat penalty 1.0 follow the model card.' },
            { term: 'Embedding model', desc: 'Under Search. Turns on meaning search, so “warm colors” finds a wildcard of amber and crimson. Pick a small embedding model such as nomic-embed-text or embeddinggemma (Ollama) or text-embedding-3-small (OpenAI). Off by default; word search already covers most questions. Claude has no embeddings.' },
            { term: 'Embedding server', desc: 'Leave empty to use the server above. A llama.cpp server only serves embeddings when started with --embeddings, so run a second one and put its address here.' },
            { term: 'Library index', desc: 'How many items the chat\'s search index holds. It lives next to your library database (wildcard-pipeline.ai-index.db) and keeps itself up to date; Rebuild builds it again.' },
          ]"
        />
        <p>
          Keys from the environment work too: <code>ANTHROPIC_API_KEY</code> and
          <code>OPENAI_API_KEY</code> only go to Claude's or OpenAI's own address;
          <code>WP_AI_API_KEY</code> goes to the provider's usual address, or to the one in
          <code>WP_AI_API_KEY_HOST</code>. Change the server address and a saved key stays saved
          but isn't sent until you paste it again or change the address back.
        </p>
        <p>
          Test connection also shows how many tokens every new chat starts with (instructions,
          tool list and your library summary), and for small models it tries one tool step. If
          the server still says a request is too long, the chat tries once more with less and
          otherwise tells you how much context to load the model with.
        </p>
        <p>
          OpenAI is reached through its Responses API, which its newest models need for tool
          calls; their reasoning is carried between steps in encrypted form.
        </p>
        <p>
          <b>Thinking per model.</b> The assistant asks the server what the model takes: LM Studio
          and Ollama list each model's options, OpenRouter and Claude list each model's levels, and
          OpenAI models are known by name. A model with only on and off (Qwen 3 under LM Studio,
          most Ollama models) shows Off and On; a level you picked for another model counts as On.
          A model that must think (the newest Claude and GPT models) has no Off, so Off asks for
          its lowest level. A level a model doesn't have becomes the nearest one it has. If the
          server refuses a choice, the assistant asks again without it and remembers that for the
          model. If thinking uses up a whole reply, it asks again with thinking off and keeps it off
          for that model until you change Thinking.
        </p>
        <p>
          <b>Draft with AI panels.</b> The panels in the editors (Add, Remove, Rewrite, Retag and
          Weights on a wildcard, and the rule, text, description and organize panels) write short,
          checked answers, so with Thinking on Auto a local model answers them without thinking.
          Pick On or a level to have it think there too. A model that keeps thinking for about
          4,000 tokens without starting its answer is stopped and asked again without thinking,
          and the working line counts its thinking as it goes.
        </p>
        <p>
          LM Studio turns a model's thinking only on or off: it never hands a level to the model's
          chat template. A template with its own levels (Qwen 3.8: low, medium, xhigh) then always
          runs at its default, so On there means the template's default effort. llama.cpp does
          hand the level to the template.
        </p>
        <p>
          To get the levels in LM Studio, give the model a small <code>model.yaml</code> that
          declares them. Make a folder such as
          <code>~/.lmstudio/hub/models/you/qwen3.8-27b-effort/</code> with a
          <code>model.yaml</code> whose <code>base</code> names the GGUF you already have, and add
          two <code>customFields</code> entries, each with the effect <code>setJinjaVariable</code>:
          a <code>boolean</code> on <code>enable_thinking</code> (without it, thinking can't be
          turned off) and a <code>select</code> on <code>reasoning_effort</code> with the
          template's levels (<code>low</code>, <code>medium</code>, <code>xhigh</code>). It shows
          up as a second model that uses the same file, so nothing is stored twice. LM Studio then
          lists its levels and the Thinking picker offers them. A level only counts while thinking
          is on: in LM Studio's own chat, turn its Thinking switch on as well. The new model doesn't take the old one's
          load settings, so put its context length, KV cache and thinking budget in the yaml too
          (a <code>config</code> section), or a full-precision cache can make it too slow to answer.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="Which model">
      <p>
        <b>Settings › AI assistant › Suggested models</b> lists picks for the provider you chose.
        Only the ones marked <b>Tested</b> were tried with Wildcard Pipeline; the rest come from
        benchmarks and community reports.
      </p>
      <ul>
        <li><b>Claude or OpenAI</b> are good for organizing, rules and safe packs (GPT-6 Luna is
          plenty; GPT-6.1 Sol costs more and isn't needed). They don't allow explicit writing.</li>
        <li><b>OpenRouter</b> reaches many more models, most paid with credits, including
          unmoderated ones.</li>
        <li><b>Your own server</b>: the list names the model only, in two groups. Which build you download
          is up to you: who uploaded it, the quant, and whether it is uncensored ("heretic" and
          "abliterated" builds have refusals removed). None is proven to know Danbooru tags, so
          check a draft before relying on it.</li>
      </ul>
      <template v-for="g in SUGGESTED_MODEL_GROUPS" :key="g.use">
        <p><b>{{ g.title }}.</b> {{ g.note }}</p>
        <ul class="wp-doc-ai-models">
          <li v-for="m in SUGGESTED_LOCAL_MODELS.filter((x) => x.use === g.use)" :key="m.name">
            <b>{{ m.name }}</b> ({{ m.vram }} GPU): {{ m.goodFor }}.
          </li>
        </ul>
      </template>
      <p>
        Search the name in Ollama, LM Studio or Hugging Face and pick a build that fits your GPU.
      </p>
      <DocCallout variant="tip">
        With two models, keep a writer selected for drafting and switch to a chat model when you
        organize, chat or build a whole pack.
      </DocCallout>
      <DocCallout variant="warn">
        In Ollama, a Qwen 3.5 / 3.6 model pulled straight from Hugging Face
        (<code>ollama pull hf.co/…</code>) misses Ollama's tool-call reader, so tool calls can come
        back as plain text. Fix: make a file named <code>Modelfile</code> holding
        <CodeBlock :code="MODELFILE" title="Modelfile" size="sm" />
        run <code>ollama create my-model -f Modelfile</code> and pick <code>my-model</code>. For Gemma 4 use <code>RENDERER gemma4-large</code> (or
        <code>gemma4-small</code> below 12B) and <code>PARSER gemma4</code>. Ollama's own
        <code>qwen3.5</code> and <code>gemma4</code> models already have it.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-assistant', label: 'AI assistant', icon: 'pi pi-microchip-ai', tone: 'neutral' },
          { id: 'ai-troubleshooting', label: 'Troubleshooting', icon: 'pi pi-wrench', tone: 'neutral' },
          { id: 'ai-privacy', label: 'Privacy and safety', icon: 'pi pi-lock', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-ai-models { list-style: disc; padding-left: 20px; }
.wp-doc-ai-models li { margin: 4px 0; }
</style>
