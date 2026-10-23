This release adds an AI assistant that runs on a model you choose, gives every random pick its own seed sequence, and moves the Community tab into its own frame. Every change, in full, is on the wiki: [Changes in 2.21](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Changes-in-2.21).

> [!WARNING]
> **A saved seed can give a different prompt once.** Each random pick now rolls on its own sequence (see Fixes). Locked seeds still reproduce what you locked and Hold still holds, but a seed you saved before updating may land on a different prompt the first time.

### AI assistant

The assistant is new and **off by default**. Turn it on in **Settings › AI assistant**. It works with Ollama, LM Studio, llama.cpp or any OpenAI-compatible server on your PC, or with the Claude or OpenAI API and your own key. Keys stay on ComfyUI's side and never go back to the browser. **Test connection** checks the model, its context size and whether it can use tools. Local models need at least 16k of context, and 32k is recommended for chats that take several steps.

- **Draft with AI.** Every editor has an **AI** button. In the wildcard editor it writes new options in the style of yours, or rewrites, retags, re-weights or removes the ones you select. You tick through a list before anything changes. Fixed values, combines, templates, derivations and constraints get drafts too.
- **Chat.** The **AI** button in the top bar opens a chat that can search your library, test stacks on the real engine and answer from these docs. Changes come back as cards you **Apply** or **Dismiss**, with **Undo**. Type **@** to name an item or **$** for a variable, or select any text in the manager to have it explained. Picked items show as chips while you type, and each reply shows how long it took.
- **Pack builder.** In the sidebar. Describe a pack and it plans the choices and rules, asks a few questions, builds every item, tests it on 200 seeds, fixes what failed and installs it as one bundle with one Undo. It knows how each image model reads a prompt (Pony, Illustrious, Flux and more) and can plan a story over a Context Loop.
- **Small local models.** A 9B model on a 16 GB card is a supported setup. The assistant fits its instructions and tools to the model and works through bigger asks one step at a time. A message that touches a feature (refs, constraints, rules, negatives and more) brings a few lines on how it works. Tool calls can only name items that exist, and edits only the ones you pointed at. Each step offers about ten tools that fit the message, and a question gets an answer instead of a card.
- **Thinking per model.** The Thinking setting lists only what the chosen model takes: Off and On for a model with an on/off switch (Qwen under LM Studio), or its own levels for Claude, OpenAI, OpenRouter, Ollama and llama.cpp. A refused choice is remembered for the model, and if thinking uses up a whole reply the assistant asks again with it off.
- **Settings.** Settings mark the recommended choice for each option, and **Reset to recommended** puts them back without touching your provider, keys or models (a context window bigger than 16k is kept). A warning shows when ComfyUI is open to your network (`--listen`). **Type out replies** (off by default) shows the chat's reply word by word as the model writes it, and its Thinking box as it thinks, local models included; a reply that has sent nothing for ten seconds says the model may be busy. **Suggested models** for your own server name the model only (Qwen3.6 35B A3B, Qwen3.8 27B and Qwen3.5 9B, all tested, plus two untested writers with why they were picked); which build you download is up to you.
- **Safety.** Web search, reading a result page and Danbooru tag lookups each ask first; **Allow for this chat** lasts 8 hours. No AI feature writes content that puts a minor in a sexual context.

### Editors and nodes

- **Variables are coloured text** in combine, derivation, negative and template text, instead of chips.
- **Negatives can change per use.** On the node and in bundles, a fixed value's or combine's negative can be changed for one use and reset to the library's.
- **Constraint preview.** The constraint editor shows each target option's chance for every source option before you run anything.
- **Docs rewritten in plain words.** Every docs page and node help panel is shorter, with new screenshots of the current nodes. New **How to** pages cover variations in one click, making two picks agree, keeping something the same, sharing a pack and fixing common problems. The AI docs are split into short pages, and importing A1111/Forge wildcard packs has its own page.
- **New guides** for pack structure, writing prompts per image model, and adult (NSFW) packs.
- **A new loading mark** replaces the spinners in the manager.

### Wildcard pack import

- **Pack logic carries over.** Dynamic Prompts and PPP variables, template arguments like `__outfit(season=winter)__` and PPP `if` blocks used to be dropped or left as text. They now become stacks: bundles that roll each variable once, keep picks consistent with constraints and write the prompt with a Combine.
- **Model checks.** A PPP test on the model, like `_is_sdxl` or `_is_pony`, becomes a stack that reads **WP Model Info**.
- **Negatives and LoRAs.** PPP `<ppp:stn>` and Umi `**text**` go to the option's negative, and PPP LoRA commands become `<lora:…>` text.
- **Umi AI packs.** Umi YAML entries keep their tags, and tag queries like `<[female][casual]>` pick from the matching entries.
- **Tables.** Subfolders that repeat the same list names become one wildcard per list name, tagged by folder. Tag groups can be renamed in the review.
- **Template copies fold.** Entry points that are copies of one template, differing by one value, become one wildcard steered by a choice.
- **Sample rolls.** The review shows a few prompts each stack and entry point makes, rolled on the real engine.
- **Installed folders.** The wildcard folders of Impact Pack, Dynamic Prompts, Easy-Use, PPP and LoRA Manager are listed for a one-click convert.
- **Bundles are stacks only by default.** The old bundle per folder is still under **Bundles** in the settings.

### Community

- **The Community tab runs in its own frame**, so nothing it loads can reach ComfyUI or other custom nodes. Your community sign-in moves over on its own.
- **Broken packs are refused before install.** Import, Community install and dependency downloads check every item and name the one that's wrong.

### Fixes

- **Every random pick rolls on its own.** Picks used to share random sequences, so changing one could move another. This is the change behind the seed warning above.
- **Constraints hold on multi-picks.** `{2$$…}` picks and `2-3` picks no longer bring back options a constraint or a weight of 0 shut out.
- **Clear template clears the negative too** on the Assembler.
- **Cleaner prompts when a variable is empty.** The Assembler drops leftover commas, dangling joining words and doubled articles.
- **`!warm` and `{2$$a|b|c}` work** the way other tools write them.
- **Rules and runs.** A linked-picks rule no longer empties a wildcard that links onward, a bundle inserted twice keeps each copy's constraints to itself, a held wildcard stays put over a Loop, and a later derivation rule reads what an earlier one wrote.
- **Clearer warnings.** A deleted pinned option says **Pinned option missing**, recipe wildcards no longer warn on every run, and Hide/Hold no longer show "unknown field".
- **Long sessions stay fast.** Deleting a node shuts its widget down, and WP Context no longer leaves a database connection open on every run.
