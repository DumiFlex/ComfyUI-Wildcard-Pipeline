/**
 * One field list per WP node: the docs pages draw it (`DocFields`), the
 * native help pages (`docs/help/WP_*.md`, ComfyUI's Node Info panel) get it
 * written between their `fields` markers by `pnpm docs:help`, and
 * `node-fields.test.ts` fails when a node's socket (from
 * `tests/fixtures/node-sockets.json`, `python scripts/dump_node_sockets.py`)
 * has no field here, or a field names a socket the node no longer has.
 *
 * Groups are the lists a page shows (ports, controls, the edit view …).
 * `sockets` names the inputs / outputs a field covers (`in:name`,
 * `out:name`, `out:toggle_*` for numbered ones). A node's own widget input
 * (a `WP_*` widget type) is its body, documented by its other groups.
 */

export interface NodeField {
  term: string;
  desc: string;
  /** The row's key or chord (Kbd's grammar), drawn after the term. */
  kbd?: string;
  /** Inputs / outputs this field covers: `in:name`, `out:name`, `out:toggle_*`. */
  sockets?: string[];
  /**
   * Where the field sits on the node's docs picture, for its numbered pin
   * (`scripts/docs-shots/shoot.mjs`): `in:` / `out:` a socket, `widget:name`,
   * `css:selector` inside the node, `page:selector` anywhere (the selection
   * toolbar), `text:exact text` or `title`; `@left` / `@right` / `@top` /
   * `@inside` moves the pin. Without it the first socket that shows is used.
   */
  pin?: string;
}

export type NodeFieldGroups = Record<string, NodeField[]>;

/** Headings for the groups on the native help pages (`docs/help/WP_*.md`). */
export const GROUP_TITLES: Record<string, string> = {
  ports: "Inputs and outputs",
  controls: "On the node",
  edit: "Editing",
  markers: "Row markers",
  tabs: "Tabs",
  settings: "Settings on the node",
  label: "Label",
  grid: "Grid",
  dock: "The Bookmarks dock",
  bar: "The formatting bar",
  rowOptions: "Row options",
};

export const NODE_FIELDS = {
  WP_Bookmark: {
    controls: [
      { term: "Icon, colour, name", pin: "css:[data-test=wp-bookmark] button@left", desc: "The icon opens the full icon list. The colour marks the pill and its dock row." },
      { term: "Lands at", pin: "text:Lands at", desc: "A 3×3 grid: the corner, edge or centre of the free part of the screen (what ComfyUI's toolbar, the open side panel and the bottom panel leave, following them as they open and close), 24 px in. A jump that would land under the dock, the minimap or the zoom controls moves just enough to clear them all (the dock only while its Land clear of the dock switch is on). It lands in the same place however often you press the key, selected or not. Only the layout counts: what pops up on its own (the job progress panel while a workflow runs, the error card, toasts, menus, tooltips, dialogs) never moves it." },
      { term: "Use this view", pin: "text:Use this view", desc: "Lands on the view on screen now, at its zoom, instead of a grid spot." },
      { term: "Zoom", pin: "text:Zoom", desc: "Set jumps to that zoom (0.1–10×; the magnifier takes the zoom you're at). Keep current leaves it alone." },
      { term: "Shortcut", pin: "css:[aria-label^='Alt plus']@right", desc: "Record, then press the keys (Esc cancels, Backspace clears). The bolt picks a free one, a new one on each press." },
      { term: "Show on canvas", pin: "text:Show on canvas", desc: "Off hides the node when you press Done: not drawn, not clickable, not selectable. The dock's eye shows it again." },
      { term: "Pinned", pin: "text:Pinned", desc: "ComfyUI's own pin: a pinned bookmark can't be moved by accident." },
      { term: "Go", pin: "css:[data-test=bm-go]@right", desc: "Tries the jump." },
    ],
    dock: [
      { term: "Row", desc: "Click to jump. Number (a Step note's in its circle), icon, name and shortcut; a mark for one hidden on the canvas or inside a subgraph, OFF for a muted one." },
      { term: "Back", desc: "Return to where you were before the last jump." },
      { term: "↑ / ↓", desc: "Step through the bookmarks that are on, in dock order." },
      { term: "Pencil", desc: "Edit mode: drag the dock by its header and it snaps to the nearest spot of a 3×3 grid on the free canvas (a dashed outline shows where); drag the grips to reorder, the eye shows or hides a bookmark on the canvas, and Bookmark this view adds one. Land clear of the dock (on by default) moves a jump out from under the dock; off, bookmarks land where they would without it, behind the see-through dock. Done goes back. The dock follows the layout (side panels, the bottom panel, the top bar, the minimap and zoom controls, a floating run bar) and stays put when the job progress panel, the error card, a toast or a menu pops up; those float over it." },
    ],
  },
  WP_Context: {
    ports: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional. Another WP Context, an Injector, Model Info or a Loop. This node starts with their variables and can add to them or replace them." },
      { term: "seed", sockets: ["in:seed"], desc: "Decides every random pick in this node. See Seeds & loops." },
      { term: "context (out)", sockets: ["out:context"], desc: "The variables. Wire it into a WP Prompt Assembler, a WP Debug or another WP Context." },
    ],
    markers: [
      { term: "Coloured dot or label", pin: "css:.wp-conflict-badge, .wp-conflict-dot", desc: "Something to look at, such as MISSING VAR or a variable set twice. Blue is for your information, amber is worth a look. Hover for the message. Nothing here stops a run." },
      { term: "drift", desc: "The library entry changed after you added it. Right-click → Refresh from library to take the change. On a bundle it reads library updated; right-click the bundle → Reset to library snapshot." },
      { term: "missing", desc: "The entry isn't in your library (deleted, or the workflow came from someone else). The row still works from its own copy; right-click → Save to library to add it." },
      { term: "mod", desc: "You changed this row on the node, so it differs from the library." },
      { term: "held", desc: "Hold across run is on." },
      { term: "Lock / globe / bin", pin: "css:[data-test=row-action-lock]@top", desc: "The row buttons: lock the pick, hide the variable from the prompt, remove the row. Set Row buttons to On hover (ComfyUI Settings or the Display Playground) to show them only when the pointer is on the row; a pressed lock or globe always shows." },
    ],
  },
  WP_ContextInjector: {
    ports: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional. Another WP Context, Injector, Model Info or Loop to add to. Only nodes after the injector see its variables." },
      { term: "input_0 … input_9 (in)", pin: "in:input_0", desc: "Wire any ComfyUI output (text, a LoRA name, a number) into the next free input_N. Each wired input becomes a row; a new free one appears as you wire, up to 10." },
      { term: "context (out)", sockets: ["out:context"], desc: "The variables from before, plus one per row." },
    ],
    rowOptions: [
      { term: "Name", pin: "css:[data-test=inj-row-binding]@top", desc: "The $variable the value becomes. Letters, digits and underscores, starting with a letter." },
      { term: "Template", desc: "Optional. Wrap the value in text, e.g. wearing $input_0. Leave empty to use the value as it is. $$ prints a dollar sign. Inline {a|b} picks need a seed, so they print as written (the editor warns)." },
      { term: "Negative", desc: "Optional negative words for this variable (it can use $input_0 too, so another node can write it). Only reaches an Assembler that prints the variable. Rows with one show a NEG badge." },
      { term: "Hide from prompt (globe)", pin: "css:[data-test=inj-row-internal]@top", desc: "The variable still reaches combines and derivations, but prints nothing in the prompt." },
    ],
  },
  WP_ContextLoop: {
    controls: [
      { term: "seed", sockets: ["in:seed"], desc: "The loop's own seed. Only used when Override Context seed is on." },
      { term: "count", sockets: ["in:count"], desc: "How many frames one Generate makes (1–999). 1 switches looping off without unwiring the node." },
      { term: "values", sockets: ["in:values"], desc: "Optional text from another node: one frame per line (or per list entry), each writing its line to $iteration_value. The values set the frame count and count follows the last run; with a sweep on, every value runs every combination. Its dot sits beside the iteration variable (beside the values note once wired) and shows when you hover it." },
      { term: "Strategy", pin: "css:[aria-label='Seed strategy']", desc: "hash, sequential or stride: how the frame seeds are worked out when Override Context seed is on. See Seeds & loops." },
      { term: "Per-iteration seeds", pin: "css:[data-test=loop-seeds-btn]", desc: "The seed each frame will use. Lock single frames, Lock all, Copy / Paste, or Prev to keep the seed a frame used last run. Locks need Override Context seed on." },
      { term: "Sweep combinations", pin: "css:[data-test=loop-sweep-btn]@right", desc: "Run every combination of the options you pick instead of random rolls. See below." },
      { term: "Edit frame", pin: "css:[data-test=loop-frames-toggle]", desc: "The base / #1 #2 … chips. Pick a frame to change just that frame (see Per-iteration overrides). Ctrl-click skips a frame, Alt-click locks its seed." },
      { term: "Override Context seed", pin: "css:[data-test=loop-override-toggle]", desc: "On: the loop sets every frame's seed from its own seed, so the batch can be repeated. Off (default): each WP Context keeps its own seed and the loop changes it a little per frame." },
      { term: "Iteration var", pin: "css:[data-test=loop-iteration-var]", desc: "The name of the frame-number variable ($iteration). The globe and Σ buttons hide or show $iteration and $iteration_total in the prompt." },
      { term: "Bypass loop", pin: "css:[data-test=loop-bypass-toggle]", desc: "Runs a single frame while the node stays wired." },
      { term: "context (out)", sockets: ["out:context"], desc: "One Context per frame. ComfyUI runs the nodes after it once per frame." },
      { term: "loop_config (out)", sockets: ["out:loop_config"], desc: "Wire it into a WP Seed List so each frame also gets its own sampler seed." },
    ],
  },
  WP_Debug: {
    ports: [
      { term: "context (in)", sockets: ["in:context"], desc: "Any WP node's context output. The node has no output and changes nothing; drag its corner to resize." },
    ],
    tabs: [
      { term: "Variables", pin: "css:[role=tab]:nth-of-type(1)@top", desc: "Every $variable and its value at this point, with the module that set it. The quickest way to check what your wildcards picked. Negative words show under the value in red, with the module they came from when it isn't the variable's own." },
      { term: "Trace", pin: "css:[role=tab]:nth-of-type(2)@top", desc: "Every module in the order it ran, grouped by Context. Open one to see why it did what it did: a wildcard's odds and the constraints that changed them, which derivation branch ran, and the negative each one left." },
      { term: "Warnings", pin: "css:[role=tab]:nth-of-type(3)@top", desc: "What came up during the run, such as missing variables or a constraint that changed nothing. Look here first when something seems off." },
      { term: "Raw", pin: "css:[role=tab]:nth-of-type(4)@top", desc: "Everything as JSON, with a download button. Handy for bug reports." },
    ],
  },
  WP_ImageFilter: {
    ports: [
      { term: "images", sockets: ["in:images", "out:images"], desc: "The images to pick from. Required: this is what the picker shows." },
      { term: "latent, masks", sockets: ["in:latent", "in:masks", "out:latent", "out:masks"], desc: "Sliced to the picked images. A mask you paint in the picker replaces that image's mask." },
      { term: "positive, negative", sockets: ["in:positive", "in:negative", "out:positive", "out:negative"], desc: "CONDITIONING. A batched conditioning is sliced with the images; a single one is kept for every frame that keeps an image." },
      { term: "positive_text, negative_text", sockets: ["in:positive_text", "in:negative_text", "out:positive_text", "out:negative_text"], desc: "The prompt strings, kept or dropped with their frame." },
      { term: "context", sockets: ["in:context", "out:context"], desc: "Each frame's WP Context, kept or dropped with it." },
      { term: "clip (in)", sockets: ["in:clip"], desc: "Optional. Re-encodes a prompt you edit in the picker, so the positive/negative conditioning follows the edit. Without it, an edit changes only the text outputs." },
      { term: "extra_1, extra_2", sockets: ["in:extra_1", "in:extra_2", "out:extra_1", "out:extra_2"], desc: "Any type. The output takes the type of what you connect. Batched values are sliced, anything else follows its frame." },
      { term: "picks (out)", sockets: ["out:picks"], desc: "What was kept, as frame:image (1-based), for example 1:2, 3:1." },
      { term: "labels (out)", sockets: ["out:labels"], desc: "One label per item, in step with images: #3 · red · 2 by default, or the name you gave the image in the picker. An item with several images has one line per image." },
    ],
    settings: [
      { term: "Mode", pin: "css:[aria-label=Mode]", desc: "Pause & pick asks every run. Reuse last picks keeps the same picks without asking, and asks again when they no longer fit. Pass all lets everything through." },
      { term: "Send picks as", pin: "css:[data-test=if-send-as]", desc: "Same shape keeps each frame's picks together as one batch. One per image sends every pick as its own item, with its own copy of its frame's prompt, conditioning and Context." },
      { term: "Timeout", pin: "css:[data-test=if-timeout]", desc: "Seconds to wait; 0 waits until you answer. After a timeout it keeps all, keeps the first image, or stops the branch." },
    ],
  },
  WP_LabelGrid: {
    ports: [
      { term: "images", sockets: ["in:images"], desc: "One image, a batch, a list, or a list of batches (a Context Loop's frames). Required." },
      { term: "labels", sockets: ["in:labels"], desc: "Optional text, one entry per item and one line per image of its batch. One line covers the whole batch, and a single one-line label covers every image of every item. The Image Filter's labels output fits straight in. One typed text with a line per image works too." },
      { term: "label_text", sockets: ["in:label_text"], desc: "Optional text from another node for what each image shows; {label}, {index} and the other tokens still work. A list gives one text per item, the last one covering any item past it." },
      { term: "title", sockets: ["in:title"], desc: "Optional text from another node for the grid title. Once wired, the panel's Title box shows that it comes from the wire." },
      { term: "row_headers, column_headers", sockets: ["in:row_headers", "in:column_headers"], desc: "Optional text from another node, one header per line (a list gives one header per entry). Wiring one sets that side to typed headers and replaces its dropdown on the panel. Like a built-in widget's, each text input's dot sits beside the field it feeds and shows when you hover that field or wire it." },
      { term: "images (out)", sockets: ["out:images"], desc: "The labelled images, in the shape they came in. A batch stays a batch." },
      { term: "grid (out)", sockets: ["out:grid"], desc: "Every image in one labelled grid. The node also shows it on the canvas, so it can end a branch." },
    ],
    label: [
      { term: "Text", pin: "css:[data-test=lg-template]", desc: "What each image shows. {label} is the incoming label (the default), {frame} and {image} count from 1 per input item, {index} counts across all images, {count} is how many there are. \\n breaks a line." },
      { term: "Place", pin: "css:[aria-label='Label position']", desc: "Above, below, left or right adds a strip beside the image. Over image draws a see-through band over the top or bottom and keeps the size. The last button draws no label." },
      { term: "Font and size", pin: "css:[data-test=lg-font]", desc: "Your system fonts plus any you drop into the extension's fonts folder; type to search. An empty size is automatic: a share of the image width, so labels read the same at 512 px and at 4K." },
      { term: "Colours", pin: "css:[data-test=lg-text-color]", desc: "Click a swatch for the colour square and a hex box. The strip or band also has an opacity, and None drops it." },
    ],
    grid: [
      { term: "Layout", pin: "css:[aria-label='Grid presets']", desc: "Fit the run, one row or column per frame, fill rows (with a column count), all in one row, all in one column. Label-part headers set the layout themselves." },
      { term: "Rows, Columns", pin: "css:[data-test=lg-rows-from]", desc: "No headers, typed (one header per line in the box that opens), or a label part. The list shows what each part held on the last run." },
      { term: "Title, Spacing", pin: "css:[data-test=lg-title]", desc: "A line of text above the grid; the gap between cells, the edge around the grid, and the cell width (empty keeps image sizes, a number scales every cell to it)." },
      { term: "Colours", pin: "css:[data-test=lg-background]", desc: "The grid's background and the colour of headers and title. Reset puts spacing and these back." },
    ],
  },
  WP_ModeRelay: {
    controls: [
      { term: "watch dots (in)", pin: "in:node_*", desc: "Wire the nodes to watch. A new free dot appears as you wire." },
      { term: "drives (out)", pin: "out:*", desc: "Wire it into a WP Node Group: the relay sets that group's nodes." },
      { term: "All muted", pin: "css:[aria-label='All muted: send']", desc: "What to send when every watched node is muted: Run, Mute, Bypass or nothing (—)." },
      { term: "All bypassed", pin: "css:[aria-label='All bypassed: send']", desc: "What to send when every watched node is bypassed." },
      { term: "Any runs", pin: "css:[aria-label='Any runs: send']", desc: "What to send when at least one watched node runs." },
    ],
  },
  WP_ModelInfo: {
    ports: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "An existing Context to extend. Only nodes after Model Info see its variables, so it usually goes first." },
      { term: "model (in)", sockets: ["in:model"], desc: "The MODEL from your checkpoint loader. Gives the family, and the node follows the wire back to the loader for the file name, stepping over LoRA loaders and other model patches." },
      { term: "family, variant, name (in)", sockets: ["in:family", "in:variant", "in:name"], desc: "Optional text from another node, such as a switch that names the model you're testing. A wired value beats the pin and detection (an empty one is ignored); a wired name goes through the variant rules like the loader's. The row shows wired, and its value after a run. Each input's dot sits beside its row, like a built-in widget's, and shows when you hover the row or wire it." },
      { term: "Detected", pin: "css:[data-test=mi-value-family]", desc: "The three values and where each comes from. Variant and name update as soon as you change the loader's checkpoint; the family shows after the first run." },
      { term: "Globe", pin: "css:[data-test=mi-internal-family]@top", desc: "Whether the variable can print. All three start hidden: rules and constraints read them, but the Assembler leaves them out. Click the globe to print one." },
      { term: "Pin", pin: "css:[data-test=mi-pin-family]@right", desc: "Use your own value for a row instead of the detected one: a file name when no model is wired, or a variant to try your Pony rules without switching checkpoint. Click it again to go back to detection." },
      { term: "Variant rules", pin: "css:[data-test=mi-rule-0]", desc: "Rows of variant and pattern. The first pattern found in the file name sets $model_variant, and its row lights up. Capitals don't matter; | separates alternatives (pony|pdxl). A broken row is outlined in red and skipped. Reset brings back the built-in rules." },
      { term: "context (out)", sockets: ["out:context"], desc: "The upstream Context plus the three variables." },
    ],
  },
  WP_NodeGroup: {
    controls: [
      { term: "node dots (in)", pin: "in:node_*", desc: "Wire any node's output in. A new free dot appears as you wire; a freed one goes. Each shows its node's title." },
      { term: "nodes (out)", pin: "out:*", desc: "Wire it into a WP Toggles control dot: that toggle then mutes or bypasses every node here." },
      { term: "Whole group", desc: "With nothing wired into its dots (a WP Mode Relay doesn't count), the node gathers every node of the canvas group it sits in, the smallest one when groups nest, and the bar names that group. Nodes a wired-in relay watches stay out. Wire any node in and it goes back to only the wired ones." },
      { term: "Covers", pin: "css:[aria-label='Which canvas groups it covers']@right", desc: "Shown while it stands for a canvas group. Its group: the smallest group it sits in, inner groups included. Not inner: that group, leaving out the nodes of groups inside it. Every group: every group it sits in, outer ones too." },
      { term: "Run / Mute / Bypass", pin: "css:[aria-label='Set every node']@right", desc: "Set every node in the group at once." },
      { term: "Mode chip", pin: "css:[data-test^=ng-mode-]@right", desc: "Each row's chip shows its node's mode. Click it to go Runs → Muted → Bypassed." },
    ],
  },
  WP_Note: {
    edit: [
      { term: "Tone", desc: "Step (a numbered circle), Icon (pick any icon from the list next to it) or Plain (no badge)." },
      { term: "Colour", desc: "Presets that follow the theme (Accent, Tip, Info, Warning, Danger, Teal, Violet, Neutral), or any colour from the picker." },
      { term: "Look", desc: "Card, Sticky or Label (above)." },
      { term: "Pinned", desc: "ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start pinned." },
      { term: "Title", desc: "Shown in bold at the top, or on the pill of a Label." },
      { term: "Text", desc: "Markdown, with the formatting bar below over it: headings (# to ####), bold, italic, strikethrough, code, bulleted, numbered and nested lists, task lists (- [x] / - [ ]), quotes and callouts (> [!TIP], > [!WARNING]), tables with column alignment (:--, :-:, --:), rules (---) and code blocks." },
    ],
    bar: [
      { term: "Undo and redo", kbd: "Ctrl+Z / Ctrl+Y", desc: "Step back or forward through your changes, typing and the bar's own edits alike (Ctrl+Shift+Z and the right-click Undo and Redo work too). Typing counts as one step until you pause, move the caret or start a new line. The steps last while the editor is open." },
      { term: "Bold, italic, strikethrough", kbd: "Ctrl+B / Ctrl+I", desc: "Wraps the selection in **, * or ~~." },
      { term: "Code", desc: "Wraps it in backticks, for a $variable." },
      { term: "Lists and quote", desc: "Puts - , 1. or > before each selected line (press again to take it off)." },
      { term: "Link", kbd: "Ctrl+K", desc: "A Docs page (type to find any page of these docs, then pick a section or the whole page), a Web address, a Library button (below) or a Community pack (owner/pack, or paste the pack's address), drawn as a Button with an icon or as a Text link, in its own colour or the note's. The selected text becomes the link's text. It goes where the caret is when you press Insert link, so you can click in the text after opening the panel." },
      { term: "Icon", desc: "Any PrimeIcons icon, searchable, in a colour or the text's own, inserted where the caret is." },
      { term: "Pictures", desc: "Add a picture from a file, or paste or drop one into the text; it goes on a line of its own where the caret is. Or pick one the extension ships (the node toolbar with its ? help button). The panel lists the note's pictures with a Width slider (a share of the note), Own size and Remove." },
      { term: "Preview (eye)", desc: "Shows the note as it will read." },
    ],
  },
  WP_PromptAssembler: {
    ports: [
      { term: "context (in)", sockets: ["in:context"], desc: "The variables from a WP Context (or anything that ends in one)." },
      { term: "template", sockets: ["in:template"], desc: "Your prompt with $variables in it." },
      { term: "negative_template", sockets: ["in:negative_template"], desc: "Optional, in the collapsible negative section. Your standing negative, with $negatives where the collected negative words go. New Assemblers start with $negatives; without it the negative is only your own text (empty = no negative)." },
      { term: "prompt (out)", sockets: ["out:prompt"], desc: "The finished prompt. Wire it into CLIP Text Encode or a WP Prompt Cleaner." },
      { term: "negative (out)", sockets: ["out:negative"], desc: "The negative words of the variables this template printed, plus your negative template. Wire it into your negative CLIP Text Encode." },
    ],
  },
  WP_PromptCleaner: {
    ports: [
      { term: "prompt (in)", sockets: ["in:prompt"], desc: "The text to clean, usually from a WP Prompt Assembler. Any text works." },
      { term: "cleaner widget", pin: "css:[aria-label='Cleaning mode']", desc: "Pick a mode and a preset, switch single rules on or off, and edit the blocklist. After a run it shows how many fixes each rule made." },
      { term: "negative (in)", sockets: ["in:negative"], desc: "Optional. A negative to clean too: type it or wire in the Assembler's negative. Left empty, the negative output is empty." },
      { term: "prompt (out)", sockets: ["out:prompt"], desc: "The cleaned prompt, for CLIP Text Encode." },
      { term: "blocklist (in)", sockets: ["in:blocklist"], desc: "Optional text from another node, such as one shared word list feeding several cleaners. Its entries join the panel's blocklist (comma- or newline-separated in list mode, one per line in regex mode) and turn the blocklist on; the Blocklist button reads + input. Its dot sits beside that button and shows when you hover it or wire it." },
      { term: "negative (out)", sockets: ["out:negative"], desc: "The cleaned negative, using the negative column's rules. Wire it into your negative CLIP Text Encode." },
    ],
  },
  WP_SeedList: {
    controls: [
      { term: "base_seed", sockets: ["in:base_seed"], desc: "Where the seed list starts. Same base, same seeds." },
      { term: "count", sockets: ["in:count"], desc: "How many seeds it gives (1–999). Follows the loop's count while Override count from loop is on." },
      { term: "Strategy", pin: "css:[data-test=seedlist-strategy]", desc: "hash, sequential (base, base+1 …) or stride. It changes which numbers you get, not how varied the images are." },
      { term: "Per-iteration seeds", pin: "css:[data-test=seedlist-seeds-btn]", desc: "Lock single seeds, Lock all, Copy / Paste, or Prev to keep the seed a frame used last run." },
      { term: "Override … from loop", pin: "css:[data-test=seedlist-override-seed-toggle]", desc: "Three switches: take the base seed, the count and the strategy from the wired loop. Count and strategy switch on by themselves when you connect loop_config; base seed stays yours unless you switch it on." },
      { term: "loop_config (in)", sockets: ["in:loop_config"], desc: "Optional. A WP Context Loop's loop_config output, so the seeds follow its frames." },
      { term: "seed (out)", sockets: ["out:seed"], desc: "The list of seeds, one per frame. ComfyUI runs the node after it once per seed: wire it into a KSampler's seed." },
    ],
  },
  WP_Toggles: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional Context to extend. Only nodes after this one see the toggle variables. It can also set toggles (see below)." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view: the mode, the grips to reorder, a pencil per row, Add toggle and Add label. Done goes back to the clean view, which shows only the switches." },
      { term: "Any on / Pick one", desc: "Any on: every toggle is on or off by itself. Pick one: exactly one is on, like radio buttons." },
      { term: "writes (Pick one)", desc: "Optional variable that also gets the picked toggle's value (or its name), so one rule can branch on it." },
      { term: "Globe (row)", desc: "Edit view only. On (the default) keeps the toggle's variable internal: rules read it, the Assembler doesn't offer it and it never prints. Turn it off to use the variable in a prompt. Same in Any on and Pick one." },
      { term: "Show in Assembler (Pick one)", desc: "The picked variable shows in the Assembler and can print in the prompt. Off, it is internal." },
      { term: "Style (Pick one)", desc: "How every row looks in Pick one: Radio (a round dot, the default), Chip (the name across the row, lit when picked), Switch or Check. Turning one on turns the others off." },
      { term: "Pencil (row)", desc: "Opens the toggle's edit panel: name, variable, style, needs, what off mutes or bypasses, group and its output." },
      { term: "Add toggle / Add label", desc: "A new toggle, or a label that groups the toggles under it. Click a label's arrow to fold it. Drag a toggle's grip under a label to move it into that group; a dragged label takes its toggles along." },
      { term: "control dots (in)", pin: "in:ctl_*", desc: "A toggle that mutes or bypasses has a dot at the left of its row: wire the nodes it drives into it." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context with every toggle variable added. Internal ones (the globe) are for rules only; the rest show in the Assembler." },
      { term: "toggle outputs", sockets: ["out:toggle_*"], desc: "One BOOLEAN per toggle that has an output, at the right of its row. Up to 16." },
    ],
    edit: [
      { term: "Name", desc: "Shown on the row and on its output." },
      { term: "Variable", desc: "Gets true or false. It follows the name until you change it. Internal until you turn off the row's globe. Show puts it under the name." },
      { term: "Style", desc: "Switch, Check, Buttons (two words of your own, like Day / Night) or Chip (a small chip with the name). Greyed out in Pick one, where the Style in the top bar sets every row's look." },
      { term: "Value (Pick one)", desc: "What the picked variable gets when this toggle is picked, instead of its name. A text box like the Assembler's: $ lists every variable upstream (Context Injector ones included) and the toggles' own, and tag, LoRA and embedding autocomplete work when they are on. A $name nothing upstream sets is flagged under the box and in WP Debug. Inline {a|b} picks need a seed, so they print as written; roll them in a wildcard instead. Drag the corner to make it taller." },
      { term: "Needs", desc: "Another toggle this one needs. While that one is off, this one is off too; it keeps your choice for when it comes back on." },
      { term: "When off", desc: "Nothing, Mute or Bypass: what happens to the nodes wired into the row's dot (and to the canvas groups you pick) while the toggle is off. On, they run. When several toggles drive one node, off wins: it runs only while all of them let it (Mute beats Bypass)." },
      { term: "Invert", desc: "Mute or bypass while the toggle is ON instead, for a node used only as a switchboard." },
      { term: "Canvas groups", desc: "Groups on the canvas whose nodes When off also covers, by title. No wires needed." },
      { term: "Upstream can set it", desc: "When the upstream Context holds this toggle's variable as a yes/no word (true, yes, on, 1, false, no, off, 0), that value sets the switch for the run." },
      { term: "Group", desc: "Which label it sits under. You can also drag the toggle's grip under another label, or above the first one." },
      { term: "BOOLEAN output", desc: "Show an output for switch nodes. Off for a toggle only rules read." },
    ],
  },
  WP_VarToBool: {
    controls: [
      { term: "context (in)", sockets: ["in:context"], desc: "The Context that holds the $variable." },
      { term: "var_name", sockets: ["in:wp_var_name"], desc: "The $variable to read. The list shows every variable the wired Context has." },
      { term: "index", sockets: ["in:index"], desc: "Which yes/no word to use when there are several: 0 is the first, 1 the second. Other words don't count." },
      { term: "default", sockets: ["in:default"], desc: "Used when the variable is missing or has no yes/no word. The node never stops the run; it uses this instead." },
      { term: "value (out)", sockets: ["out:value"], desc: "True or false, for any BOOLEAN input: a switch node, a toggle and so on." },
    ],
  },
  WP_VarToChoice: {
    controls: [
      { term: "context (in)", sockets: ["in:context"], desc: "The Context that holds the $variable." },
      { term: "var_name", sockets: ["in:wp_var_name"], desc: "The $variable to read. The list shows every variable the wired Context has." },
      { term: "match", sockets: ["in:match"], desc: "How close the text must be to an option: exact, loose (the default) or closest. See below." },
      { term: "fallback", sockets: ["in:fallback"], desc: "A dropdown of the options of the input it's wired into, filled when you connect it. Used when nothing matches or the variable is empty. (first option) means the first option in the list." },
      { term: "if_no_match", sockets: ["in:if_no_match"], desc: "use fallback carries on with the fallback and warns you. stop the run stops here and lists some of the options." },
      { term: "choice (out)", sockets: ["out:choice"], desc: "Wire it into a dropdown input: ckpt_name, sampler_name, scheduler, vae_name, lora_name and so on. The line under the picker names what it feeds and how many options that has." },
    ],
  },
  WP_VarToFloat: {
    controls: [
      { term: "context (in)", sockets: ["in:context"], desc: "The Context that holds the $variable." },
      { term: "var_name", sockets: ["in:wp_var_name"], desc: "The $variable to read. The list shows every variable the wired Context has." },
      { term: "index", sockets: ["in:index"], desc: "Which number to take when there are several: 0 is the first, 1 the second. Usually 0." },
      { term: "default", sockets: ["in:default"], desc: "Used when the variable is missing, has no number, or has fewer numbers than the index. The node never stops the run; it uses this instead." },
      { term: "value (out)", sockets: ["out:value"], desc: "The number, for any FLOAT input: CFG, denoise, a LoRA strength and so on." },
    ],
  },
  WP_VarToInt: {
    controls: [
      { term: "context (in)", sockets: ["in:context"], desc: "The Context that holds the $variable." },
      { term: "var_name", sockets: ["in:wp_var_name"], desc: "The $variable to read. The list shows every variable the wired Context has." },
      { term: "index", sockets: ["in:index"], desc: "Which number to take when there are several: 0 is the first, 1 the second. Usually 0." },
      { term: "default", sockets: ["in:default"], desc: "The value to use when the variable is missing, has no numbers in it, or the index is beyond what was found. The node never stops the run; it uses this instead." },
      { term: "value (out)", sockets: ["out:value"], desc: "The whole number, for any INT input: width, steps, batch size and so on." },
    ],
  },
} satisfies Record<string, NodeFieldGroups>;

export type FieldNodeId = keyof typeof NODE_FIELDS;

/** The fields of one group, for `DocFields`. Empty for an unknown group. */
export function fieldsOf(node: FieldNodeId, group: string): NodeField[] {
  const groups: NodeFieldGroups = NODE_FIELDS[node];
  return groups[group] ?? [];
}
