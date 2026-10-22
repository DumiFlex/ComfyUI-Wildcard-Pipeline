This release adds an AI assistant that works with a model you choose, fixes how random picks share their seeds, and moves the Community tab into its own frame. The full list of changes, with every detail, is on the wiki: [Changes in 2.21](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Changes-in-2.21).

> [!WARNING]
> **Saved seeds can give a different prompt once.** Every random pick now rolls on its own sequence (see Fixes). Locked seeds still reproduce what you locked and Hold still holds, but a seed you saved before updating may land on a different prompt the first time.

### AI assistant

The assistant is new and **off by default**. Turn it on under **Settings › AI assistant** and connect it to Ollama, LM Studio, llama.cpp or any OpenAI-compatible server on your PC, or to the Claude or OpenAI API with your own key. The key stays on ComfyUI's side and is never sent back to the browser. **Test connection** checks the model, its context size and whether it can call tools, and the page suggests models for the provider you picked.

**Draft with AI.** Every editor has an **AI** button. In the wildcard editor it writes new options in the style of the ones you have, or removes, rewrites, retags and re-weights the ones you select, always as a list to tick through first. Fixed values, combines, templates, derivations and constraints get drafts too, with a preview of what a constraint changes. Panels take reference images and, with web search set up, can ask to look something up; nothing leaves your machine until you allow it.

**The chat.** The **AI** button in the top bar opens a chat that searches and reads your library, runs stacks on the real engine, and answers from the built-in docs. Changes come back as cards you **Apply** or **Dismiss**, with **Undo**; many cards of one kind arrive as one group card. It sees the page you're on, can point at parts of it, and answers questions about the Test Runner's last run. Type **@** to name an item and **$** to complete a variable. Select any text in the manager to have it explained. The chat header has a **Thinking** picker next to the model: Off, or Low, Medium or High for models that reason in levels (also in Settings). Changes to one item in one answer come as one card that lists each step, and a new category comes with the card that files items into it. Settings can hide the model's thinking, its working notes and the list of what it did, each on its own. Small and medium local models keep one thinking setting for a whole answer, so LM Studio no longer reads the whole prompt again (about 20 s) partway through each answer.

**Pack builder.** In the sidebar, the Pack builder makes a whole pack from one description. It plans a graph of choices and the rules between them, asks a few questions, builds every item, tests the pack on 200 seeds, fixes what failed and installs it as one bundle with one Undo. It knows how each image model reads a prompt (Pony, Illustrious, Flux and more), can plan a story over a Context Loop or a sweep sheet, and can extend or split an existing bundle.

**Small local models.** A 9B model on a 16 GB card is a supported setup. The assistant sizes its instructions and tools to the model and its context, plans multi-item asks one step at a time, and gets worked examples for common jobs.

**Safety.** No AI feature keeps content that puts a minor in a sexual context, and a pack request that asks for it is refused before anything is planned. Web calls (search, reading a result page, Danbooru tag lookup) each ask first.

### Editors and nodes

- **Variables are coloured text.** `$variables` in combine, derivation, negative and template text are plain words in their own colour instead of chips.
- **Negatives on the node and in bundles.** A fixed value's or combine's negative can be changed for one use, with a reset to the library's.
- **Constraint preview.** The constraint editor shows each target option's chance for every source option before you run anything.
- **New docs guides.** Recommended pack structure, writing prompts per image model, and adult (NSFW) packs.
- **A new loading mark** replaces the spinners across the manager.

### Community

- **The Community tab runs in its own frame** from the community site, so nothing it loads can reach ComfyUI or other custom nodes, and your community sign-in no longer sits in ComfyUI's storage. An existing sign-in moves over on its own.
- **Broken packs are refused before anything is installed.** Import, Community install and dependency downloads check every item and name the one that's wrong.

### Fixes

- **Every random pick rolls on its own.** Derivations, fixed values and each pick inside a module used to share random sequences, so changing one could move another. This is the change behind the seed warning above.
- **Constraints hold on multi-picks.** `{2$$…}` picks from a nested wildcard and `2-3` picks no longer bring back options a constraint or a weight of 0 shut out.
- **Cleaner prompts from empty variables.** The Assembler drops leftover commas, dangling joining words ("wearing with,") and doubled articles.
- **`!warm` and `{2$$a|b|c}` work** the way other tools write them.
- **Rules and runs.** A linked-picks rule no longer empties a wildcard that links onward, a bundle inserted twice keeps each copy's constraints to itself, a held wildcard stays put over a Loop, and a later derivation rule reads what an earlier one wrote.
- **Clearer warnings.** A deleted pinned option says **Pinned option missing**, recipe wildcards no longer warn on every run, and Hide/Hold no longer show "unknown field".
- **Long sessions stay fast.** Deleting a node now shuts its widget down, and WP Context no longer leaves a database connection open on every run.
