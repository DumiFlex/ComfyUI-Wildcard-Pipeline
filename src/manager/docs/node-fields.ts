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
      { term: "Pinned", pin: "text:Pinned", desc: "ComfyUI's own pin: a pinned bookmark can't be moved by accident. New bookmarks start unpinned; a saved workflow keeps each bookmark's pin." },
      { term: "Go", pin: "css:[data-test=bm-go]@right", desc: "Tries the jump." },
    ],
    dock: [
      { term: "Row", desc: "Click to jump. Number (a Step note's in its circle), icon, name and shortcut; a mark for one hidden on the canvas or inside a subgraph, OFF for a muted one." },
      { term: "Grid / List", desc: "Shows the bookmarks as small tiles (number, icon in its colour, name, shortcut with Shift as ⇧; the tooltip has the full name and keys) that wrap four to a line, or as rows. The dock remembers your choice; edit mode always shows rows." },
      { term: "Back", desc: "Return to where you were before the last jump." },
      { term: "↑ / ↓", desc: "Step through the bookmarks that are on, in dock order." },
      { term: "Pencil", desc: "Edit mode: drag the dock by its header and it snaps to the nearest spot of a 3×3 grid on the free canvas (a dashed outline shows where); drag the grips to reorder, the eye shows or hides a bookmark on the canvas, and Bookmark this view adds one that stores the view on screen and its zoom (Use this view), so jumping to it brings back that exact view wherever the bookmark sits; the small 3×3 grid beside it picks where on screen the new bookmark goes. Land clear of the dock (on by default) moves a jump out from under the dock; off, bookmarks land where they would without it, behind the see-through dock. Done goes back. The dock follows the layout (side panels, the bottom panel, the top bar, the minimap and zoom controls, a floating run bar) and stays put when the job progress panel, the error card, a toast or a menu pops up; those float over it." },
    ],
  },
  WP_Context: {
    ports: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional. Another WP Context, an Injector, Model Info or a Loop. This node starts with their variables and can add to them or replace them." },
      { term: "seed", sockets: ["in:seed"], desc: "Decides every random pick in this node. See Seeds & loops." },
      { term: "Seed from", pin: "css:[data-test=seed-from]", desc: "Shows once a Context Loop or a WP Seeds node is upstream. Auto (the default): the Loop's frame seed while Override Context seed is on, else this node's seed. Loop: always the Loop's frame seed. Own seed: the seed widget, or whatever is wired into it, even while the Loop overrides. A WP Seeds row: that row's seed for each frame. A wired seed is only used on Own seed and Auto. When the picked source isn't upstream, the node runs as Auto and WP Debug says so." },
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
      { term: "Variables", pin: "css:[role=tab]:nth-of-type(1)@top", desc: "Every $variable and its value at this point, with the module or node that set it (its icon and colour on the left edge say which kind: wildcard, derivation, Toggles, Model Info, Context Loop, Injector …). The quickest way to check what your wildcards picked. Negative words show under the value in red, with the module they came from when it isn't the variable's own." },
      { term: "Trace", pin: "css:[role=tab]:nth-of-type(2)@top", desc: "Every module and node row in the order it ran, grouped by the node it ran in. Open one to see why it did what it did: a wildcard's odds and the constraints that changed them, which derivation branch ran, the negative each one left, and for rows from other nodes where the value came from (a Loop frame and its seed, a Model Info detection, a Toggles switch set upstream)." },
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
      { term: "labels", sockets: ["in:labels"], desc: "Optional text, one entry per item and one line per image of its batch. One line covers the whole batch, and a single one-line label covers every image of every item. The Image Filter's labels output fits straight in. One typed text with a line per image works too, spread over the images in order. When the lines and images don't match, a warning on the node says how many images got no line or how many lines were left over." },
      { term: "label_text", sockets: ["in:label_text"], desc: "Optional text from another node for what each image shows; {label}, {index} and the other tokens still work. A list gives one text per item, the last one covering any item past it." },
      { term: "title", sockets: ["in:title"], desc: "Optional text from another node for the grid title. Once wired, the panel's Title box shows that it comes from the wire." },
      { term: "row_headers, column_headers", sockets: ["in:row_headers", "in:column_headers"], desc: "Optional text from another node, one header per line (a list gives one header per entry). Wiring one sets that side to typed headers and replaces its dropdown on the panel. Like a built-in widget's, each text input's dot sits beside the field it feeds and shows when you hover that field or wire it." },
      { term: "images (out)", sockets: ["out:images"], desc: "The labelled images, in the shape they came in. A batch stays a batch." },
      { term: "grid (out)", sockets: ["out:grid"], desc: "Every image in one labelled grid. The node also shows it on the canvas, so it can end a branch." },
    ],
    label: [
      { term: "Text", pin: "css:[data-test=lg-template]", desc: "What each image shows. {label} is the incoming label (the default), {frame} and {image} count from 1 per input item, {index} counts across all images, {count} is how many there are. \\n breaks a line." },
      { term: "Place", pin: "css:[aria-label='Label position']", desc: "Above, below, left or right adds a strip beside the image. Over image draws a see-through band over that edge instead and keeps the size, on any side. The last button draws no label." },
      { term: "Text direction", pin: "css:[aria-label='Text direction']", desc: "Left and right only: horizontal text, or vertical text turned along the edge (reading upwards on the left, downwards on the right), which keeps the strip thin." },
      { term: "Font and size", pin: "css:[data-test=lg-font]", desc: "Your system fonts plus any you drop into the extension's fonts folder; type to search. An empty size is automatic: a share of the image width, so labels read the same at 512 px and at 4K." },
      { term: "Colours", pin: "css:[data-test=lg-text-color]", desc: "Click a swatch for the colour square and a hex box. The strip or band also has an opacity, and None drops it." },
    ],
    grid: [
      { term: "Layout", pin: "css:[aria-label='Grid presets']", desc: "Fit the run, one row or column per frame, fill rows (with a column count), all in one row, all in one column. Label-part headers set the layout themselves." },
      { term: "Rows, Columns", pin: "css:[data-test=lg-rows-from]", desc: "No headers, typed (one header per line in the box that opens), or a label part. The list shows what each part held on the last run. An image whose label lacks the part goes to a last row or column headed (no label), and the node warns when typed headers are fewer or more than the rows or columns." },
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
      { term: "Pinned", desc: "ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start unpinned; a saved workflow keeps each note's pin." },
      { term: "Title", desc: "Shown in bold at the top, or on the pill of a Label." },
      { term: "Text", desc: "Its first line and length on the node; Edit text opens the text window, with the editor beside a live preview. Done (Ctrl+Enter) puts it on the note, Cancel or Escape leaves the note as it was. Markdown, with the formatting bar below over it: headings (# to ####), bold, italic, strikethrough, code, bulleted, numbered and nested lists, task lists (- [x] / - [ ]), quotes and callouts (> [!TIP], > [!WARNING]), tables with column alignment (:--, :-:, --:), rules (---) and code blocks." },
    ],
    bar: [
      { term: "Undo and redo", kbd: "Ctrl+Z / Ctrl+Y", desc: "Step back or forward through your changes, typing and the bar's own edits alike (Ctrl+Shift+Z and the right-click Undo and Redo work too). Typing counts as one step until you pause, move the caret or start a new line. The steps last while the text window is open." },
      { term: "Bold, italic, strikethrough", kbd: "Ctrl+B / Ctrl+I", desc: "Wraps the selection in **, * or ~~." },
      { term: "Code", desc: "Wraps it in backticks, for a $variable." },
      { term: "Lists and quote", desc: "Puts - , 1. or > before each selected line (press again to take it off)." },
      { term: "Link", kbd: "Ctrl+K", desc: "A Docs page (type to find any page of these docs, then pick a section or the whole page), a Web address, a Library button (below) or a Community pack (owner/pack, or paste the pack's address), drawn as a Button with an icon or as a Text link, in its own colour or the note's. The selected text becomes the link's text. It goes where the caret is when you press Insert link, so you can click in the text after opening the panel." },
      { term: "Icon", desc: "Any PrimeIcons icon, searchable, in a colour or the text's own, inserted where the caret is." },
      { term: "Pictures", desc: "Add a picture from a file, or paste or drop one into the text; it goes on a line of its own where the caret is. Or pick one the extension ships (the node toolbar with its ? help button, or any docs screenshot), with a search box to find it. The panel stays open after adding and lists the note's pictures with a Width slider (a share of the note), Own size and Remove." },
    ],
  },
  WP_PromptAssembler: {
    ports: [
      { term: "context (in)", sockets: ["in:context"], desc: "The variables from a WP Context (or anything that ends in one)." },
      { term: "template", sockets: ["in:template"], desc: "Your prompt with $variables in it. Wire another node's text into it to use that text as the template instead: the box then says \"From the template input\", and the $variables in the wired text still fill in." },
      { term: "negative_template", sockets: ["in:negative_template"], desc: "Optional, in the collapsible negative section. Your standing negative, with $negatives where the collected negative words go. New Assemblers start with $negatives; without it the negative is only your own text (empty = no negative). It takes a wired text the same way the template does." },
      { term: "prompt (out)", sockets: ["out:prompt"], desc: "The finished prompt. Wire it into CLIP Text Encode or a WP Prompt Cleaner." },
      { term: "negative (out)", sockets: ["out:negative"], desc: "The negative words of the variables this template printed, plus your negative template. Wire it into your negative CLIP Text Encode." },
    ],
    controls: [
      { term: "Load / Save (toolbar)", desc: "Load a template from your library into both boxes, or save this one (prompt and negative) to it." },
      { term: "Mark unused internal (toolbar)", desc: "The eye button. Marks every upstream variable that neither box reads as internal, so it stops showing here; combines and rules still read it. Variables another Assembler on the same context reads are kept, and so is a module that also writes a variable in use. Undo in the message puts it back." },
      { term: "Clear (toolbar)", desc: "Empties the template and the negative template, after asking." },
      { term: "Frame arrows (preview)", desc: "Only with a WP Context Loop upstream: ‹ 1/4 › steps the preview through the loop's frames and moves the Loop's Edit frame pick with it. A variable only some frames set shows as a blue chip with its frames (#4), never as missing." },
    ],
  },
  WP_PromptCleaner: {
    ports: [
      { term: "prompt (in)", sockets: ["in:prompt"], desc: "The text to clean, usually from a WP Prompt Assembler. Any text works." },
      { term: "cleaner widget", pin: "css:[aria-label='Cleaning mode']", desc: "Pick a mode and a preset, switch single rules on or off, and edit the blocklist. After a run it shows how many fixes each rule made, and the Last run strip opens the run's before and after with what each rule changed and why." },
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
  WP_Seeds: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional. A Context or a Context Loop. Put it after the Loop to get a seed per frame; Contexts after it can read its rows." },
      { term: "base_seed", sockets: ["in:base_seed"], desc: "The seed every Follow row is made from, like the Loop's and Seed List's base seed. Reroll (above the rows inside a Loop, or in the edit view) or control after generate moves all of them at once; locked frames stay." },
      { term: "From Loop", pin: "css:[data-test=seeds-from-loop]", desc: "Shown with a Context Loop upstream. On, the rows follow the Loop's seed instead of base_seed (which greys out), like Seed List's base seed from loop: change the Loop's seed and every Follow row moves. Off (the default), the node keeps its own." },
      { term: "Rows", desc: "One row per named seed, under labels that group and fold them. A row shows its name, the seed it gives the frame shown (in the row's colour) and its mode, then three buttons: mode, last run and lock." },
      { term: "Mode button (row)", desc: "Cycles the row Follow → Random → Fixed without opening anything. Leaving Follow keeps the seed the row has, so nothing jumps until you reroll." },
      { term: "Last run (row)", desc: "Puts the row back on the seed it started from last run and sets it to Fixed: the way back after a Random row rolled on, or to keep a result you liked. Greyed out before the first run and when the row is already on it." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the pencil in ComfyUI's selection toolbar opens the edit view: grips to reorder, label names, each row's pencil (its window) and bin, Add seed, Add label and Reroll. Done goes back to the clean view." },
      { term: "Follow / Random / Fixed", desc: "Follow: made from the base seed and the row's name, so renaming a row changes its seed. Random: its own seed, rolled again after every queue. Fixed: its own seed, never changes." },
      { term: "Per frame", desc: "New (the default): every frame of a Context Loop gets its own seed, frame 1 being the row's seed. Same: every frame uses the row's seed." },
      { term: "Lock (row)", desc: "Pins the shown frame's seed: the one it used last run if there was one, else the one it will use. The Frame box picks which frame the rows show." },
      { term: "Seed window", desc: "A row's pencil opens its window: name, mode, seed (New rolls one, Last run puts back last run's), New each frame or Same every frame, its INT output, and Frames: the row's seed on every frame of the Loop, each one a lock. Lock last run pins what the last run used; Unlock all clears them. Changes land when you press Done." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context, carrying the rows. A Context after it picks a row with its Seed from chip." },
      { term: "seed outputs", sockets: ["out:seed_*"], desc: "One INT per row with its output dot on, at the right of its row: wire it into a KSampler's seed or any INT input. After a Loop it gives one seed per frame. Up to 16." },
    ],
  },
  WP_Toggles: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional Context to extend. Only nodes after this one see the toggle variables. It can also set toggles (see below)." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view: the mode, the Pick one options, the grips to reorder, the row buttons, Add toggle and Add label. Done goes back to the clean view, which shows only the switches." },
      { term: "Any on / Pick one", desc: "Any on: every toggle is on or off by itself. Pick one: at most one is on; tick Always one on to keep exactly one on, like radio buttons." },
      { term: "writes (Pick one)", desc: "Optional variable that also gets the picked toggle's value (or its name), so one rule can branch on it." },
      { term: "Globe (row)", desc: "Edit view only. On (the default) keeps the toggle's variable internal: rules read it, the Assembler doesn't offer it and it never prints. Turn it off to use the variable in a prompt. Same in Any on and Pick one." },
      { term: "Always one on (Pick one)", desc: "Like radio buttons: one toggle is always on. Clicking the picked one does nothing; pick another to switch. With none on, the first toggle is picked. Off (the default), the picked toggle can be switched off so none is on." },
      { term: "Show in Assembler (Pick one)", desc: "The picked variable shows in the Assembler and can print in the prompt. Off, it is internal." },
      { term: "Style (Pick one)", desc: "How every row looks in Pick one: Radio (a round dot, the default), Chip (the name across the row, lit when picked), Switch or Check. Turning one on turns the others off." },
      { term: "Layout", desc: "Edit view: Rows (one row per toggle, the default) or Grid (each toggle in a tile, the tiles wrapping to the node's width), in both modes and every style. Each label has a grid button for its own group; setting it back to the node's layout makes the group follow the node again. Under a grid's tiles, thin lines carry the dots: mute/bypass dots stack on the left with their toggle's name, BOOLEAN outputs on the right with theirs, each side packed on its own (so Dawn | Dawn, Sunset | Night). The arrow on the first line merges the group's lines into one that carries every dot and says how many go in and out (the names on hover), and the arrow on the merged line opens them again." },
      { term: "Pencil, globe, trash (row)", desc: "Each row in the edit view has three buttons, like a module on a Context node: the pencil opens the toggle's own settings in a window (name, variable, looks, style, needs, what off mutes or bypasses, group and its output) with the row drawn on top as the node will show it; the globe keeps its variable internal; the trash removes it." },
      { term: "Add toggle / Add label", desc: "A new toggle, or a label that groups the toggles under it. Click a label's arrow to fold it; its icon and colour buttons pick any icon and any colour. Drag a toggle's grip under a label to move it into that group; a dragged label takes its toggles along." },
      { term: "Mute / bypass icon", desc: "Next to a toggle's name once it drives something: coloured while it mutes or bypasses, dim while not, the nodes on hover. Click it to glide the canvas to the wired node or group; with several targets it opens a list (All targets first, then each node or canvas group). The Bookmarks dock's Back returns." },
      { term: "control dots (in)", pin: "in:ctl_*", desc: "A toggle that mutes or bypasses has a dot at the left of its row: wire the nodes it drives into it. A toggle that drives only canvas groups can hide its dot (Wire dot in its window)." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context with every toggle variable added. Internal ones (the globe) are for rules only; the rest show in the Assembler." },
      { term: "toggle outputs", sockets: ["out:toggle_*"], desc: "One BOOLEAN per toggle that has an output, at the right of its row. Up to 16." },
    ],
    edit: [
      { term: "Name", desc: "Shown on the row and on its output. A Chip shows Name · $variable (the variable while Show is on). A name colour also colours its variable." },
      { term: "Variable", desc: "Gets true or false, or the toggle's Value while on and nothing while off. $name.bool is always true or false. It follows the name until you change it. Internal until you turn off the row's globe. Show puts it under the name, or after it on a Chip." },
      { term: "Looks", desc: "An icon before the name, and colours for the icon, the name and the control (switch, check, radio, chip or buttons), so Day can be yellow and Night blue. None keeps the theme's colour." },
      { term: "Style", desc: "Switch, Check, Buttons (two words of your own, like Day / Night; the On side lights up in the control colour while picked, and a click on the lit side flips it too) or Chip (a small chip with the name). Any on only: in Pick one the Style in the top bar sets every row's look." },
      { term: "Value", desc: "What the toggle's variable gets while it is on, instead of true; off, it gets its Off value (nothing when that is empty), so $rain can print \"heavy rain\" or nothing. $rain.bool still reads true or false, for rules. In Pick one the picked variable gets it too, instead of the toggle's name. A text box like the Assembler's: $ lists every variable upstream (Context Injector ones included) and the toggles' own, and tag, LoRA and embedding autocomplete work when they are on. A $name nothing upstream sets is flagged under the box and in WP Debug. Inline {a|b} picks need a seed, so they print as written; roll them in a wildcard instead. Drag the corner to make it taller." },
      { term: "Negative", desc: "Words to keep out of the image while this toggle is on. They go with its variable (and, in Pick one, with the picked variable), so an Assembler that prints it sends them to its negative output, like a wildcard option's negative. It can read $variables; off, or without one, the variable carries none." },
      { term: "Off value (Any on)", desc: "What the variable gets while the toggle is off, with its own Off negative. Empty prints nothing. With both, one toggle writes either side: a Buttons toggle Anime / Real can write \"anime style\" or \"photorealistic\", each keeping the other's look out of the image. Either one makes the variable hold text, not true or false; $name.bool still reads the switch." },
      { term: "Needs", desc: "Any on only. Another toggle this one needs. While that one is off, this one is off too; it keeps your choice for when it comes back on." },
      { term: "Advanced", desc: "A folded section under the main settings, with When off, When on and Upstream can set it. Its header says in one line what the toggle also does (\"Bypasses when off · Locks the seed of 2 rows\"), and it starts open when any of them is set." },
      { term: "When off", desc: "Nothing, Mute or Bypass: what happens to the nodes wired into the row's dot (and to the canvas groups you pick) while the toggle is off. On, they run. When several toggles drive one node, off wins: it runs only while all of them let it (Mute beats Bypass)." },
      { term: "Invert", desc: "Mute or bypass while the toggle is ON instead, for a node used only as a switchboard." },
      { term: "Canvas groups", desc: "Groups on the canvas whose nodes When off also covers, by title. No wires needed." },
      { term: "Wire dot in front of the row", desc: "Untick it for a toggle that drives only canvas groups: the row, or its line under a grid, loses its dot, so nothing hangs there unwired. Picking the first group for a toggle with nothing wired unticks it for you. Unticking drops a wire that is in the dot." },
      { term: "When on", desc: "Nothing, Lock seed or Lock value: switching the toggle on locks the Rows to lock to what the last run did (Lock seed keeps each row's seed, Lock value each wildcard's pick); off unlocks only the rows it locked. Rows locked by hand stay as they are." },
      { term: "Rows to lock", desc: "Rows of any WP Context on the canvas, named by the node's codename, its title and the row, each with its module's icon. No wires. Constraints aren't offered (they have no seed), and Lock value offers wildcards only: switching to it takes off rows that can only lock their seed, and says so. A row or node that is gone shows red on the toggle and the node, with a Remove missing targets button." },
      { term: "Upstream can set it", desc: "When the upstream Context holds this toggle's variable as a yes/no word (true, yes, on, 1, false, no, off, 0), that value sets the switch for the run. A small arrow next to the name shows it is on, in every style (a Chip too)." },
      { term: "Group", desc: "Which label it sits under. You can also drag the toggle's grip under another label, or above the first one." },
      { term: "BOOLEAN output", desc: "Show an output for switch nodes. Off for a new toggle; leave it off for a toggle only rules read." },
    ],
  },
  WP_Slider: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional Context to extend. Only nodes after this one see the slider variables." },
      { term: "Sliders", desc: "Drag a slider's track or type the number in the box after it (its arrows step by the slider's step). Each slider writes its $variable when the run reaches the node: the number, your text, or the word of the range it is in." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the pencil in ComfyUI's selection toolbar opens the edit view: the grips to reorder, the row buttons, Add slider and Add label. Done goes back to the clean view, which shows only the sliders." },
      { term: "Pencil, globe, trash (row)", desc: "Edit view only. The pencil opens the slider's own settings in a window with the row drawn on top as the node will show it; the globe keeps its variable internal (for rules only, never printed); the trash removes it. A new slider's variable shows in the Assembler." },
      { term: "Add slider / Add label", desc: "A new slider (0 to 1, step 0.05), or a label that groups the sliders under it. Click a label's arrow to fold it; a folded label carries its sliders' output dots. Drag a slider's grip under a label to move it into that group; a dragged label takes its sliders along." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context with every slider variable added, and the numbers $name.num reads." },
      { term: "number outputs", sockets: ["out:value_*"], desc: "One output per slider that has one, at the right of its row: an INT or a FLOAT (by default an INT when the slider writes 0 decimals, else a FLOAT; the slider's window can pick either), so it wires into a sampler's steps or cfg, a LoRA strength or any number input. Up to 16." },
    ],
    edit: [
      { term: "Name", desc: "Shown on the row and on its output." },
      { term: "Variable", desc: "What the slider writes. It follows the name until you change it. Show puts it under the name, with the picked word in Words mode." },
      { term: "Range", desc: "Min, Max and Step of the track, and how many decimals the number is written with (0 writes a whole number, and an Auto output is then an INT). The value is rounded to those decimals." },
      { term: "Snap to step", desc: "On (the default), a drag lands on the step: 0, 0.05, 0.1 … Hold Shift while dragging to land on any value the decimals can write (0.37). Off, every drag does that, and the arrows still move by the step." },
      { term: "Value: Number", desc: "The variable gets the number as text, e.g. 0.45 or 28." },
      { term: "Value: Text", desc: "The variable gets your text, which can read the slider's own number as $name.num and any other $variable: (intricate details:$detail.num) prints (intricate details:1.2). A text box like the Assembler's, with $ suggestions." },
      { term: "Value: Words", desc: "Ranges, each with a word and an optional negative: the variable gets the word of the first range whose up to is at least the number; the last range catches the rest. 0 to 0.3 close-up, to 0.7 medium shot, the rest wide shot. The window marks the range the number is in now." },
      { term: "$name.num", desc: "Reads the slider's number whatever the variable holds (like $name.bool for a toggle), in a template, a derivation or another text. For any other variable it reads the value when that already is a number, else nothing." },
      { term: "Negative", desc: "Words to keep out of the image, carried by the slider's variable to an Assembler that prints it. In Words mode a word's own negative wins over this one." },
      { term: "Style", desc: "How the slider is drawn. Row: the name, then a thin track. Bar: the whole row is the track, with the name inside it (a LoRA strength you drag anywhere on). Fader: an upright track with its value on top and the name under it; faders next to each other stand side by side, and their output dots line up on a list of their names at the right. The edit view draws every slider as a row or bar." },
      { term: "Looks", desc: "An icon before the name and colours for the icon, the name and the track. Marks puts ticks at the ends of the track and at each Words range." },
      { term: "Group", desc: "Which label it sits under. You can also drag the slider's grip under another label, or above the first one." },
      { term: "INT / FLOAT output", desc: "Show an output with the number. Off for a new slider; leave it off for a slider only prompts and rules read. Auto makes it an INT at 0 decimals, else a FLOAT; INT sends the number rounded to a whole number, FLOAT sends it at the slider's decimals." },
    ],
  },
  WP_Slider2D: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional Context to extend. Only nodes after this one see the pad's variables." },
      { term: "Pad", desc: "Drag the point (or click anywhere on the pad) to set both numbers at once: X grows to the right, Y grows upward. Shift while dragging lands on finer values. With the point focused, the arrow keys move it one step (Shift: ten), Home and End put X at its ends." },
      { term: "X and Y", desc: "Above the pad: each axis's name, its $variable (with the picked word in Words mode) and its number now." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the pencil in ComfyUI's selection toolbar shows the edit strip: a pencil on each axis, the pad's style, shape, size and looks, Swap and Done." },
      { term: "Style", desc: "Edit strip. Pad is the plain pad. Size is for a picture size: the box from the bottom-left corner to the point is shaded, dashed lines mark 1:1, 4:3, 3:4, 16:9 and 9:16, and the corner reads Width × Height. Stick is round with zero in the middle (set both ranges from -1 to 1) and keeps the point inside the circle. Map writes each Words axis's words on the pad as sections, each in its own soft colour, the one the point is in highlighted." },
      { term: "Shape and size", desc: "Edit strip. Square, Wide (3:2), Tall (2:3) or Auto, which follows the two ranges (0–1024 across and 0–1344 up is a 3:4 pad). S, M or L sets how wide the pad is; L fills the node." },
      { term: "Dots and Snap to dots", desc: "Edit strip. Dots empty (Auto) puts a dot on every step of each axis, spread over the steps past 16; a number puts up to that many per side, always on steps; 0 hides them. Snap to dots makes the point land on a dot (or an edge), and the arrow keys walk dot to dot." },
      { term: "Area, Colours, Lines", desc: "Edit strip. Area shades the box from the bottom-left corner to the point (Size always does); Colours (Map style, on by default) gives each word section its own soft colour, the point's one a little stronger; Lines draws lines through the point." },
      { term: "Swap", desc: "Edit strip. Swaps the two axes' settings: X's go up, Y's go across. The outputs stay where they are." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context with both axis variables added, and the numbers $name.num reads." },
      { term: "x / y (out)", sockets: ["out:x", "out:y"], desc: "Each axis's number, named after the axis: an INT or a FLOAT (by default an INT when the axis writes 0 decimals, else a FLOAT; the axis window can pick either), so it wires into width and height, cfg and steps, or any number input." },
    ],
    edit: [
      { term: "Axis window", desc: "An axis's pencil opens the same window as a WP Slider slider, with the axis drawn on top as a slider: Name, Variable, Range, Snap to step, Value (Number, Text or Words, with $name.num), Negative and Looks work the same way." },
      { term: "Output", desc: "Auto, INT or FLOAT for the axis's output. An axis always has its output." },
    ],
  },
  WP_Slider3D: {
    controls: [
      { term: "upstream (in)", sockets: ["in:upstream"], desc: "Optional Context to extend. Only nodes after this one see the node's variables." },
      { term: "Pad and Z fader", desc: "The Pad, Size, Stick and Map styles: the XY pad of WP Slider 2D for X and Y, and an upright fader beside it for Z. A ring round the point grows with Z, and the mouse wheel over the pad moves Z one step." },
      { term: "Orbit", desc: "The Orbit style: a camera or a light round the subject. The top view sets X, the angle round it (0 the front, 90 the right, ±180 the back), and how far from the middle sets Z, the distance; the side view sets Y, the height angle from below to straight above. The arrow keys turn it and move it out and in." },
      { term: "Mix", desc: "The Mix style: a blend of three things, one at each corner of a triangle (X on top, Y bottom left, Z bottom right, named after the axes). The closer the point to a corner, the more of it, and the three shares add up to 100%. Each axis writes its share of its own range: with 0 to 1 a 50% share is 0.50, with 0 to 1.5 it is 0.75. The arrows move the point, Home makes the shares equal and 1, 2, 3 jump to a corner." },
      { term: "X, Y and Z", desc: "Above the pad: each axis's name, its $variable (with the picked word in Words mode) and its number now." },
      { term: "Phrase", desc: "Under the axes once the Orbit words or the Mix example are on: one $variable that joins the three, like front-left view, high angle, medium shot, or (watercolor:0.40), (ink sketch:0.30), (oil painting:0.30). It is a Text value reading the axes' variables, so you can change its wording in its pencil." },
      { term: "Pencil (toolbar)", pin: "page:.wp-tb-icon--edit", desc: "Select the node and the pencil in ComfyUI's selection toolbar shows the edit strip: a pencil on each axis and the phrase, the style and its looks, and Done." },
      { term: "Style", desc: "Edit strip. Pad, Size, Stick and Map work as in WP Slider 2D, with the Z fader beside the pad. Orbit draws the camera or light round the subject; picking it puts the camera words on the axes unless X already turns from -180 to 180. Mix draws the triangle; picking it puts the style example on the axes unless there is a phrase already." },
      { term: "Style example", desc: "Edit strip, Mix. Three art styles (Watercolor, Ink sketch, Oil painting) as Number axes from 0 to 1, kept out of the prompt, and the phrase $style_mix that weights each one: (watercolor:0.40), (ink sketch:0.30), (oil painting:0.30). Rename the axes and reword the phrase for your own three. It replaces the axes and the phrase. S/M/L sets the triangle's size." },
      { term: "Look and Words", desc: "Edit strip, Orbit. Look draws a camera or a light (an amber sun). Camera or Light puts that word set on all three axes: X the side (front, front-left … back), Y the height (eye level, high angle …; for a light low, high or overhead), Z the shot (close-up … wide shot; for a light soft, diffused or hard), and the phrase that joins them. It replaces the axes' ranges and words." },
      { term: "Shape, size, dots and looks", desc: "Edit strip, pad styles. The same as WP Slider 2D: shape, S/M/L, dots and Snap to dots, Area, Colours and Lines. Swap swaps X and Y." },
      { term: "context (out)", sockets: ["out:context"], desc: "The Context with the three axis variables (and the phrase) added, and the numbers $name.num reads." },
      { term: "x / y / z (out)", sockets: ["out:x", "out:y", "out:z"], desc: "Each axis's number, named after the axis: an INT or a FLOAT (by default an INT when the axis writes 0 decimals, else a FLOAT; the axis window can pick either)." },
    ],
    edit: [
      { term: "Axis window", desc: "An axis's pencil opens the same window as a WP Slider slider: Name, Variable, Range, Snap to step, Value (Number, Text or Words, with $name.num), Negative and Looks work the same way. Output picks Auto, INT or FLOAT; an axis always has its output." },
      { term: "Phrase window", desc: "The phrase's pencil opens the same window in Text mode: change the variable's name or the wording, for example $view_side shot from $view_height. It has no output." },
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
      { term: "if_no_match", sockets: ["in:if_no_match"], desc: "use fallback carries on with the fallback and warns you. stop the run stops here and lists some of the options: the reason shows in red on the node and in a message." },
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
