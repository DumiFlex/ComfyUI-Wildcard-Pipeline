/**
 * The component kit: every shared control, with where it lives and when to
 * use it. The kit page (`views/Kit.vue`, route `/kit`) draws one entry per
 * row here, and `__tests__/kit-coverage.test.ts` fails when a component in a
 * kit folder is neither listed here nor in `KIT_EXEMPT`.
 *
 * Reuse first: before writing a new control, find the entry that fits. Make a
 * new component only when none does, put it in a kit folder and add it here.
 *
 * Every user-facing string is in this file so the page is easy to translate.
 */

export type KitGroup = "actions" | "inputs" | "choice" | "display" | "navigation" | "layout" | "feedback" | "overlays" | "pieces" | "brand";
export type KitSurface = "manager" | "canvas";

export interface KitEntry {
  /** Stable id: the `data-kit-entry` on the kit page. */
  id: string;
  name: string;
  group: KitGroup;
  /** Repo path of the component, or of the stylesheet for a CSS-only piece. */
  file: string;
  /** Where it works. A canvas piece can't use the manager's stylesheet. */
  surfaces: KitSurface[];
  /** When to reach for it. */
  use: string;
  /** What it replaces, so nobody builds that by hand again. */
  instead?: string;
}

export const KIT_GROUPS: { id: KitGroup; label: string; blurb: string }[] = [
  { id: "actions", label: "Actions", blurb: "Things you press." },
  { id: "inputs", label: "Inputs", blurb: "Things you type into or pick from a list." },
  { id: "choice", label: "Choices", blurb: "On or off, one of a few, which tab." },
  { id: "display", label: "Display", blurb: "Showing a thing: cards, chips, icons, empty pages." },
  { id: "navigation", label: "Navigation", blurb: "Moving through steps and pages." },
  { id: "layout", label: "Layout", blurb: "Dividing, resizing and ordering space." },
  { id: "feedback", label: "Feedback", blurb: "Telling the user what happened or that something is busy." },
  { id: "overlays", label: "Dialogs and menus", blurb: "Anything that opens above the page." },
  { id: "pieces", label: "Library pieces", blurb: "Bigger parts built from the kit that several screens share. Reuse them before writing another." },
  { id: "brand", label: "Brand", blurb: "The logo." },
];

export const KIT_ENTRIES: KitEntry[] = [
  // Actions
  {
    id: "button", name: "Button", group: "actions", file: "src/manager/components/ui/Button.vue", surfaces: ["manager"],
    use: "Every button in the manager. Primary for the one main action on a surface, secondary by default, ghost for quiet toolbar actions, danger for deletes, link for inline actions, add for the dashed \"Add a row\" button at the end of a list (with block for full width). Leave out the text for an icon button and give it an aria-label. pressed makes it a toggle. Sizes sm 24 / md 32 / lg 40; outline is a neutral bordered ghost; loading keeps its colours with the sparkle in the label colour; disabled fades.",
    instead: "A <button> with its own class and colours.",
  },
  {
    id: "btn-css", name: "Button classes (.wp-btn)", group: "actions", file: "src/components/shared/button.css", surfaces: ["manager"],
    use: "The same look on a plain element where the Button component can't go, like a router-link that must stay an <a>. On the canvas use WpButton: the canvas never loads these classes globally.",
  },
  {
    id: "wp-button", name: "WpButton", group: "actions", file: "src/components/shared/WpButton.vue", surfaces: ["canvas", "manager"],
    use: "Every button inside a canvas widget or canvas dialog: the canvas twin of Button, with the same variants (add included), sizes and stylesheet (button.css), a PrimeIcons icon and the canvas size sm by default. Leave out the text for an icon button; its aria-label is also its tooltip. hint sets a tooltip on a labelled button and kbd adds its key chip (P, Enter). pressed makes it a toggle (favourites only, filters open). A shared piece that shows on both sides uses it too; manager screens use Button. Inside a row, use WpIconButton.",
    instead: "A <button> with its own __btn class and colours.",
  },
  {
    id: "wp-icon-button", name: "WpIconButton", group: "actions", file: "src/components/shared/WpIconButton.vue", surfaces: ["canvas", "manager"],
    use: "The 20 px icon button inside a canvas row (module, injector, bundle and Model Info rows, the Context toolbar, and the Settings live preview of those rows): lock, internal, remove. tone tints the icon on hover and the whole box while pressed; pressed \"mixed\" is a bundle's \"some children\" state; variant bare is the row's fold caret. Rows are too tight for WpButton's 24 px.",
    instead: "A <button class=\"wp-btn--icon-sm\"> or a hand-made caret button.",
  },
  {
    id: "copy-button", name: "CopyButton", group: "actions", file: "src/components/shared/CopyButton.vue", surfaces: ["manager", "canvas"],
    use: "Copy text to the clipboard. The icon turns into a check (or a cross when the copy fails) and says so to screen readers, so no toast is needed. Works on plain-http pages too.",
    instead: "A button that calls navigator.clipboard and shows its own message.",
  },
  {
    id: "close-button", name: "CloseButton", group: "actions", file: "src/components/shared/CloseButton.vue", surfaces: ["manager", "canvas"],
    use: "The × that closes a dialog, drawer, panel or banner. Other icon actions in the manager use Button with an icon and no text.",
    instead: "A hand-made × button (or one that borrows .wp-topbar__icon-btn).",
  },
  {
    id: "toolbar", name: "Toolbar", group: "actions", file: "src/components/shared/Toolbar.vue", surfaces: ["manager", "canvas"],
    use: "A row of buttons that is one Tab stop: the arrow keys move between them and Home/End jump to the ends. attached joins the buttons into one button group. Put a vertical Separator between groups of actions.",
    instead: "A flex row of buttons where Tab stops on every one, or joined buttons with their own corner rules.",
  },
  // Inputs
  {
    id: "input", name: "Input", group: "inputs", file: "src/manager/components/ui/Input.vue", surfaces: ["manager"],
    use: "One-line text in the manager, on the 24/32/40 scale (size sm/md/lg). Optional inline icon, a prefix like $ for variable names, a suffix like a unit, and a readonly look (dashed, dimmer, lock). Numbers use WpNumber, searches SearchInput.",
    instead: "A bare <input> with its own border and focus ring.",
  },
  {
    id: "textarea", name: "Textarea", group: "inputs", file: "src/manager/components/ui/Textarea.vue", surfaces: ["manager"],
    use: "Several lines of plain text. Turn on autoResize when the box should grow with its text. Prompt text with $variables uses RichTextInput instead.",
  },
  {
    id: "field", name: "Field", group: "inputs", file: "src/manager/components/ui/Field.vue", surfaces: ["manager"],
    use: "A label, a hint and an error around any control, so they line up the same everywhere.",
    instead: "A <label> and a <p class=\"hint\"> written per form.",
  },
  {
    id: "select", name: "Select", group: "inputs", file: "src/manager/components/ui/Select.vue", surfaces: ["manager"],
    use: "Pick one value from a list in the manager. It filters as you type and can be cleared (the ✕ shows on hover or focus, set apart from the chevron). The list follows the field when the page scrolls.",
    instead: "A native <select>, which can't be themed in the dark.",
  },
  {
    id: "wp-select", name: "WpSelect", group: "inputs", file: "src/components/shared/WpSelect.vue", surfaces: ["canvas", "manager"],
    use: "A small dropdown for canvas widgets and dense rows, where the manager's Select is too big.",
  },
  {
    id: "wp-number", name: "WpNumber", group: "inputs", file: "src/components/shared/WpNumber.vue", surfaces: ["canvas", "manager"],
    use: "Every number field, canvas and manager. Our up and down arrows, keys and the wheel step it and clamp to min and max; typed values snap float fuzz. size sm (24, canvas default) / md (32, manager) / lg (40); suffix shows a unit; nullable when an empty box means \"use the default\".",
    instead: "<input type=\"number\"> with the browser's spinner, or Input type=\"number\" (removed).",
  },
  {
    id: "search-input", name: "SearchInput", group: "inputs", file: "src/components/shared/SearchInput.vue", surfaces: ["canvas", "manager"],
    use: "Every search or filter box: magnifier, text, an optional \"3 of 12\" count or key hint, and a ✕ that clears it. Escape clears it first. size sm on the canvas and in tight rows.",
    instead: "PickerSearch, Input with a search icon, or a hand-made box with its own icon and clear button.",
  },
  {
    id: "list-filter", name: "ListFilter", group: "inputs", file: "src/manager/components/ui/ListFilter.vue", surfaces: ["manager"],
    use: "SearchInput for a long list inside an editor card: the count sits in the box, and it hides itself while the list is short.",
    instead: "Another search box with its own icon and count.",
  },
  {
    id: "slider", name: "Slider", group: "inputs", file: "src/components/shared/Slider.vue", surfaces: ["manager", "canvas"],
    use: "A number you set by feel along a range: a weight, a threshold, a brush size. Arrows step, PageUp/PageDown take ten steps, Home/End jump to the ends; marks label key values and format says the value in words. with-input adds a WpNumber for the exact number.",
    instead: "<input type=\"range\"> with the browser's track and thumb.",
  },
  {
    id: "tag-input", name: "TagInput", group: "inputs", file: "src/components/shared/TagInput.vue", surfaces: ["manager", "canvas"],
    use: "A list of short words as chips: tags, accepts axes, #tags. Enter or a comma adds, Backspace in the empty box removes the last, pasting \"a, b, c\" adds three; suggestions open under the box and follow it. allow-new=false keeps it to the suggestions.",
    instead: "A text box split on commas, or chips plus a separate Add box.",
  },
  {
    id: "inline-edit", name: "InlineEdit", group: "inputs", file: "src/components/shared/InlineEdit.vue", surfaces: ["manager", "canvas"],
    use: "Rename in place: the name is a button, a click (or Enter or F2) makes it a text box, Enter or a click away saves and Escape puts the old name back. validate refuses a value with a message.",
    instead: "A pencil button that swaps in an <input> with its own Enter, Escape and blur handling.",
  },
  {
    id: "drop-zone", name: "DropZone", group: "inputs", file: "src/components/shared/DropZone.vue", surfaces: ["manager", "canvas"],
    use: "Where files go: drag them in or Browse. It lights up for a file it takes and turns red with the reason for one it won't (type, size, one at a time). overlay wraps a panel (the chat) and shows only while a file is over it.",
    instead: "dragover and drop handlers on a div, with a hidden file input and its own highlight.",
  },
  {
    id: "color-picker", name: "ColorPicker", group: "inputs", file: "src/manager/components/ColorPicker.vue", surfaces: ["manager"],
    use: "Pick a colour from presets, the HSV square or a typed hex, as categories do. The closed picker shows the swatch, the hex and a chevron (`compact`: swatch and chevron only, for a name row); the panel is a kit Popover.",
  },
  {
    id: "hsv-picker", name: "HsvPicker", group: "inputs", file: "src/components/shared/HsvPicker.vue", surfaces: ["canvas", "manager"],
    use: "A full colour square and hue bar, for when presets are not enough.",
  },
  {
    id: "combobox", name: "Combobox", group: "inputs", file: "src/components/shared/Combobox.vue", surfaces: ["manager", "canvas"],
    use: "A select you can type in, for long lists: models, LoRAs, categories, variables. Typing filters, the arrows light an option, Enter takes it. multiple keeps the picks as chips and the list open, with a tick on each pick. Use WpSelect for a few fixed choices and TagInput when people may type their own words.",
    instead: "A search box over a hand-made list, or a native <select> nobody can type in.",
  },
  {
    id: "date-picker", name: "DatePicker", group: "inputs", file: "src/components/shared/DatePicker.vue", surfaces: ["manager", "canvas"],
    use: "Pick a calendar day (a \"changed since\" filter, a history range). The value is a YYYY-MM-DD string; the month grid opens in a Popover. Arrows move a day or a week, PageUp/PageDown a month (Shift a year), Enter picks; min and max fence it.",
    instead: "<input type=\"date\">, which looks different in every browser and ignores the theme.",
  },
  {
    id: "range-slider", name: "RangeSlider", group: "inputs", file: "src/components/shared/RangeSlider.vue", surfaces: ["manager", "canvas"],
    use: "A low and a high number on one track: a weight range, a token budget, a sweep's from and to. The thumbs can't cross and keep min-gap apart; with-input adds a WpNumber for each end.",
    instead: "Two Sliders or two number boxes that can end up the wrong way round.",
  },
  // Choice
  {
    id: "checkbox", name: "Checkbox", group: "choice", file: "src/manager/components/ui/Checkbox.vue", surfaces: ["manager"],
    use: "Tick one item, or one row in a list. Supports a mixed state for \"some selected\". Disabled turns grey with a dimmed label. `field` draws it as an input-height box for a yes/no filter beside dropdowns (Favorites only).",
    instead: "<input type=\"checkbox\"> drawn by the browser.",
  },
  {
    id: "wp-check", name: "WpCheck", group: "choice", file: "src/components/shared/WpCheck.vue", surfaces: ["canvas", "manager"],
    use: "The checkbox for canvas widgets.",
  },
  {
    id: "toggle", name: "Toggle", group: "choice", file: "src/manager/components/ui/Toggle.vue", surfaces: ["manager"],
    use: "A setting that takes effect at once (on or off). Use a Checkbox when the choice is saved later with a button. It is WpSwitch at the manager size.",
  },
  {
    id: "wp-switch", name: "WpSwitch", group: "choice", file: "src/components/shared/WpSwitch.vue", surfaces: ["canvas", "manager"],
    use: "On or off, taking effect at once, on the canvas or in the manager (one component, so one stylesheet). The track look is a sliding knob; the chip look is a labelled chip that lights up, for a row of runtime switches (Hide from prompt, Lock pick). mixed draws a bulk switch where only some children are on.",
    instead: "A button with role=\"switch\" and its own toggle--on class.",
  },
  {
    id: "radio", name: "Radio (.wp-radio)", group: "choice", file: "src/manager/styles/tokens.css", surfaces: ["manager"],
    use: "One of a few options that all need to be visible. A real radio input with the class wp-radio, so arrow keys work. Disabled turns grey.",
  },
  {
    id: "tabs", name: "Tabs", group: "choice", file: "src/components/shared/WpTabs.vue", surfaces: ["manager", "canvas"],
    use: "Switch between views of the same thing. The arrow keys move between tabs, a long row scrolls, and an optional count follows each label. size=\"sm\" on the canvas.",
    instead: "A tab strip of buttons with role=\"tab\" and its own underline and key handling (the old .wp-tabs class).",
  },
  {
    id: "segmented", name: "Segmented control", group: "choice", file: "src/components/shared/WpSegmented.vue", surfaces: ["manager", "canvas"],
    use: "Pick one of two to five short options that all stay visible (theme, mode, view). The arrow keys move the choice. icon-only for a row of icons with tooltips; an option's hint and kbd show in its tooltip (\"Grid\" with the key G).",
    instead: "A row of joined buttons with its own active colour, or a select with three options.",
  },
  {
    id: "radio-group", name: "RadioGroup", group: "choice", file: "src/components/shared/RadioGroup.vue", surfaces: ["manager", "canvas"],
    use: "One of a few options that each need a line of explanation (prompt style, install mode). One Tab stop, the arrows move and choose; cards draws each option as a bordered card, and the label slot adds a badge after an option's name (the AI provider list). For two to five short words on one row use Segmented.",
    instead: "A column of .wp-radio inputs with their own labels and hint text.",
  },
  {
    id: "choice-cards", name: "ChoiceCards", group: "choice", file: "src/manager/components/ui/ChoiceCards.vue", surfaces: ["manager"],
    use: "Pick one of a handful of options that each need a picture (a colour theme, a look, a layout). Each card shows a preview slot, a name and a hint; compact puts three to a row and the hint in a tooltip. The arrow keys move the choice. For options a line of text explains, use RadioGroup.",
    instead: "A grid of hand-made buttons with role=\"radio\" and their own selected border.",
  },
  // Display
  {
    id: "card", name: "Card", group: "display", file: "src/manager/components/ui/Card.vue", surfaces: ["manager"],
    use: "A panel with an optional title row (the card's name, 14px semibold). Editors and settings are made of these.",
  },
  {
    id: "chip", name: "Chip", group: "display", file: "src/manager/components/ui/Chip.vue", surfaces: ["manager"],
    use: "A short label: a tag, a status, a count, a category. Tones carry meaning (success, warn, danger, info); color tints it for a category or kind (the text blends toward the theme's text so any pick stays readable), and icon puts the category's icon in front. removable adds a plain ✕ that keeps the chip's height.",
    instead: "CategoryChip (merged into Chip: <Chip :color :icon>{{ name }}</Chip>) or a hand-made pill span.",
  },
  {
    id: "kbd", name: "Kbd", group: "display", file: "src/components/shared/Kbd.vue", surfaces: ["manager", "canvas"],
    use: "A keyboard shortcut in help text or a menu, drawn as keys. Write Mod for the main modifier: it shows ⌘ on a Mac and Ctrl elsewhere. Screen readers hear the whole chord once.",
    instead: "<kbd class=\"wp-kbd\"> written key by key, or a hard-coded ⌘.",
  },
  {
    id: "badge", name: "Badge", group: "display", file: "src/components/shared/Badge.vue", surfaces: ["manager", "canvas"],
    use: "A count bubble or a status dot. Wrapped around a button or icon it sits on the corner (3 problems); alone it sits in the line, with text for a status (● Running). A dot without text needs a label; pulse for something running.",
    instead: "A coloured span dot or a count pill drawn per screen.",
  },
  {
    id: "description-list", name: "DescriptionList", group: "display", file: "src/components/shared/DescriptionList.vue", surfaces: ["manager", "canvas"],
    use: "Label and value rows: an item's details, a trace step, model info. Labels line up in one column; stacked puts each label above its value in a narrow panel. mono for ids and seeds, copy adds a copy button, an empty value draws a dash.",
    instead: "A two-column grid or table of labels and values written per panel.",
  },
  {
    id: "code-block", name: "CodeBlock", group: "display", file: "src/components/shared/CodeBlock.vue", surfaces: ["manager", "canvas"],
    use: "Text that must stay as written (JSON, a prompt as sent, a log): mono font, a copy button and a wrap switch, scrolling past max-height. line-numbers for logs; bare drops the head.",
    instead: "A <pre> with its own copy button, or none.",
  },
  {
    id: "icon", name: "Icon", group: "display", file: "src/manager/components/ui/Icon.vue", surfaces: ["manager"],
    use: "Every icon. Use the ICON_SM, ICON_MD and ICON_LG sizes. Icons are decoration: the button or text next to them carries the meaning.",
    instead: "An inline <svg> pasted into a component.",
  },
  {
    id: "empty-state", name: "EmptyState", group: "display", file: "src/manager/components/ui/EmptyState.vue", surfaces: ["manager"],
    use: "A page or list with nothing in it yet: say what goes here and offer the one action that fills it. size page (an empty list page), panel (the default, in a card or panel) or inline (one row).",
  },
  {
    id: "image-zoom", name: "WpImageZoom", group: "display", file: "src/components/shared/WpImageZoom.vue", surfaces: ["canvas", "manager"],
    use: "Look at one picture closely: real zoom levels (Fit, 100%, 200%, − / +), scroll to zoom toward the pointer, drag to move, double-click for Fit or 100% at that spot, keys + − 0 1 2 when focused. v-model:zoom keeps the level (null = Fit), and the spot carries over when src changes, so a series is checked in one place. Slots bar-start / bar-end add buttons to its bar; `fullscreen` adds a Fullscreen button (key F) that fills the screen with the viewer, bar included, plus a #fullscreen slot along the bottom that shows only then. `minimap` adds a small copy in the corner once zoomed past the stage (its box is the part in view; click or drag it to move). `autohide` fades the bar, hint and mini-map after 2 s without a move or key. `second` shows another picture beside the first, locked to the same level and spot (synced compare); #first / #second put captions over each.",
    instead: "An <img> with max-width: 100% called a zoom, or a hand-made transform with its own wheel and drag code.",
  },
  {
    id: "disclosure", name: "Disclosure", group: "display", file: "src/components/shared/Disclosure.vue", surfaces: ["manager", "canvas"],
    use: "A section that folds open under its heading (advanced options, details, a long list). The chevron turns and the body grows; boxed draws it as a card. Controls that must not fold it (an on/off switch, a select-all box) go in #actions (right) or #lead (left), outside the heading button.",
    instead: "A button with its own aria-expanded, chevron and v-if.",
  },
  {
    id: "data-table", name: "DataTable", group: "display", file: "src/manager/components/ui/DataTable.vue", surfaces: ["manager"],
    use: "Rows and columns: sticky header, sort by a column, tick rows, loading and empty rows. Put custom cells in #cell-<key>.",
    instead: "A <table class=\"wp-table\"> with its own sort state and select-all.",
  },
  {
    id: "avatar", name: "Avatar", group: "display", file: "src/components/shared/Avatar.vue", surfaces: ["manager", "canvas"],
    use: "A person or bot: community authors, chat participants, history entries. Shows the picture, or initials on a colour picked from the name when there is none or it fails to load. decorative when the name is written beside it.",
  },
  {
    id: "timeline", name: "Timeline", group: "display", file: "src/components/shared/Timeline.vue", surfaces: ["manager", "canvas"],
    use: "Events in order on one line: history, an AI trace, a pack build log. Each has a title, a time, an optional body and a tone; the last can be pending (a pulsing dot). #body and #time slots take a diff, a code block or a RelativeDate.",
    instead: "A list with its own dots and connecting line.",
  },
  {
    id: "diff-view", name: "DiffView", group: "display", file: "src/components/shared/DiffView.vue", surfaces: ["manager", "canvas"],
    use: "What changed between two texts, by words (an option, a template) or by lines (a pack, JSON). Removed is struck through on red, added is on green, and screen readers hear \"removed\"/\"added\". layout=\"split\" puts Before and After side by side.",
    instead: "Two text boxes next to each other, or colour alone marking the change.",
  },
  {
    id: "image-grid", name: "ImageGrid", group: "display", file: "src/components/shared/ImageGrid.vue", surfaces: ["manager", "canvas"],
    use: "A grid of image tiles that fills its width: run outputs, frames, community previews. A click opens the Lightbox; selectable puts a check box on each tile with v-model:selected holding the ids. A tile without a src shimmers while it loads.",
    instead: "A flex wrap of <img> tags with its own zoom overlay.",
  },
  {
    id: "visually-hidden", name: "VisuallyHidden", group: "display", file: "src/components/shared/VisuallyHidden.vue", surfaces: ["manager", "canvas"],
    use: "Text only screen readers hear: a label for an icon-only area, a live status line. focusable shows it again when it gets focus (a \"Skip to\" link).",
    instead: "Another copy of the 1 px clip rule (.wp-sr-only, __sr spans).",
  },
  // Navigation
  {
    id: "stepper", name: "Stepper", group: "navigation", file: "src/components/shared/Stepper.vue", surfaces: ["manager", "canvas"],
    use: "The 1 · 2 · 3 header of a job done in steps (pack builder, import, setup). Done steps show a check, a step with a problem a mark; clickable makes the steps buttons and linear stops jumping past the next one. vertical for a side rail.",
    instead: "A row of numbered circles and lines drawn per wizard.",
  },
  {
    id: "pagination", name: "Pagination", group: "navigation", file: "src/components/shared/Pagination.vue", surfaces: ["manager", "canvas"],
    use: "Move through a long list a page at a time (first, last and the pages around the current one), or mode=\"more\" for a Load more button under \"Showing 50 of 230\". Draws nothing when everything fits on one page.",
    instead: "Prev / Next buttons and a page count written per list.",
  },
  // Layout
  {
    id: "separator", name: "Separator", group: "layout", file: "src/components/shared/Separator.vue", surfaces: ["manager", "canvas"],
    use: "A thin line between groups, across or upright, with optional text in the middle (or). Decorative by default; decorative=false when it really divides the content.",
    instead: "An <hr>, a bordered div, or a menu divider styled per menu.",
  },
  {
    id: "resize-handle", name: "ResizeHandle", group: "layout", file: "src/components/shared/ResizeHandle.vue", surfaces: ["manager", "canvas"],
    use: "The grip on a panel's edge that drags it wider or taller (the chat drawer, a column, a box). v-model is the size in px; the arrow keys move it, Home/End jump to min/max, Enter or a double click puts back the default. reverse for a left or top edge.",
    instead: "mousedown, mousemove and mouseup handlers on a hand-made edge, with no keyboard.",
  },
  {
    id: "split-pane", name: "SplitPane", group: "layout", file: "src/components/shared/SplitPane.vue", surfaces: ["manager", "canvas"],
    use: "Two panels side by side, or one above the other, with a ResizeHandle between them. v-model is the first panel's size in px.",
    instead: "A grid with a dragged column width kept by hand.",
  },
  {
    id: "sortable-list", name: "SortableList", group: "layout", file: "src/components/shared/SortableList.vue", surfaces: ["manager", "canvas"],
    use: "Rows you put in order: drag the grip (a line shows where it lands, Escape cancels), or from the keyboard Space picks up, the arrows move, Space drops; Alt+↑/↓ moves one step. Each move is said to screen readers.",
    instead: "HTML drag and drop with its own handle, drop line and no keyboard.",
  },
  {
    id: "virtual-list", name: "VirtualList", group: "layout", file: "src/components/shared/VirtualList.vue", surfaces: ["manager", "canvas"],
    use: "A long list of same-height rows (thousands of options, every library item): only the rows in view are built, so it scrolls smoothly. Rows keep their place for screen readers; scrollToIndex brings one into view.",
    instead: "Rendering every row, or a hand-made windowing loop.",
  },
  // Feedback
  {
    id: "progress", name: "ProgressBar", group: "feedback", file: "src/components/shared/ProgressBar.vue", surfaces: ["manager", "canvas"],
    use: "How far a job is: give value and max for a bar that fills, leave value out while nobody knows and it sweeps. show-value puts the label and the percent above it. For a whole page that is loading use LoadingMark.",
    instead: "A div whose width is set by hand, or a counter in text.",
  },
  {
    id: "skeleton", name: "Skeleton", group: "feedback", file: "src/components/shared/Skeleton.vue", surfaces: ["manager", "canvas"],
    use: "Grey shapes where content is about to land (rows, lines, a card), so nothing jumps. label says Loading… to screen readers. A whole page or panel uses LoadingMark block instead.",
    instead: "The wp-skel classes from _skeleton.css, or a Loading… flash.",
  },
  {
    id: "toast", name: "Toast (manager)", group: "feedback", file: "src/manager/composables/useToast.ts", surfaces: ["manager"],
    use: "A short note after an action, with an optional Undo. Call useToast().push(); the app shows it.",
  },
  {
    id: "toast-card", name: "ToastCard", group: "feedback", file: "src/components/shared/ToastCard.vue", surfaces: ["canvas", "manager"],
    use: "The one toast look both stacks draw (manager bottom right, canvas under the menu bar). You push to a store, never mount it yourself.",
    instead: "A toast styled per surface.",
  },
  {
    id: "canvas-toast", name: "Toast (canvas)", group: "feedback", file: "src/components/shared/toast-store.ts", surfaces: ["canvas"],
    use: "The same note from a canvas widget. Push to the shared toast store; never console.log a warning.",
  },
  {
    id: "banner", name: "Banner", group: "feedback", file: "src/components/shared/Banner.vue", surfaces: ["manager", "canvas"],
    use: "A message that stays on the page until it no longer applies: a draft to restore, a failed load, out-of-date items. Tone sets the colour and icon; add actions and a close button when they help.",
    instead: "A tinted <div> with its own icon, colours and Dismiss button.",
  },
  {
    id: "loading-mark", name: "LoadingMark", group: "feedback", file: "src/components/shared/LoadingMark.vue", surfaces: ["manager", "canvas"],
    use: "Anything busy. Inline (a text row, a button, a list item) it draws the AI sparkle; a block (a page or panel that is loading) draws the full logo animation. Give it a label, or slot text for a \"Loading bundle…\" row; mono draws it in the text colour.",
    instead: "A spinner or plain \"Loading…\" text.",
  },
  {
    id: "ai-working", name: "AiWorking", group: "feedback", file: "src/manager/components/ai/AiWorking.vue", surfaces: ["manager"],
    use: "The \"the AI is working\" line: one of four animated sparkle marks (typing, shuffle, orbit, burst), a changing word and the time so far. Pass text for your own status, or leave it out to follow the AI request in flight.",
  },
  // Overlays
  {
    id: "modal", name: "Modal", group: "overlays", file: "src/manager/components/ui/Modal.vue", surfaces: ["manager"],
    use: "A dialog in the manager with a title, body and footer buttons.",
    instead: "A div with role=\"dialog\" and its own backdrop.",
  },
  {
    id: "drawer", name: "Drawer", group: "overlays", file: "src/manager/components/ui/Drawer.vue", surfaces: ["manager"],
    use: "A panel that slides in from the side: an inspector, history, settings beside the work. Escape closes it and focus goes back. Turn modal off to keep the page usable behind it.",
    instead: "Another fixed side panel with its own width, header and close button.",
  },
  {
    id: "popover", name: "Popover", group: "overlays", file: "src/components/shared/Popover.vue", surfaces: ["canvas", "manager"],
    use: "A panel anchored to a button: a colour picker, a filter, a small form. It flips to stay on screen, follows on scroll and closes on Escape or a click outside. Every floating panel builds on it. One panel shared by many triggers (the cells of a rule grid) passes the clicked element as anchor instead of a trigger slot.",
    instead: "A Teleport with its own placement maths and outside-click handler.",
  },
  {
    id: "dropdown-menu", name: "DropdownMenu", group: "overlays", file: "src/components/shared/DropdownMenu.vue", surfaces: ["canvas", "manager"],
    use: "A list of actions behind a button (the ⋯ menu, More, Add…). Arrows, Home/End and Enter work. Takes the same items as ContextMenu, so a row's right-click and ⋯ menus can share one list.",
    instead: "A hand-built menu of buttons under a ⋯ button.",
  },
  {
    id: "tooltip", name: "Tooltip (v-tooltip)", group: "overlays", file: "src/components/shared/tooltip.ts", surfaces: ["canvas", "manager"],
    use: "A short hint on hover and on keyboard focus. One attribute: v-tooltip=\"'Copy the prompt'\", or an object with a shortcut (kbd: 'Ctrl C'). Icon-only buttons still need an aria-label; the tooltip is for sighted mouse and keyboard users.",
    instead: "title=\"…\", which is slow, can't be styled, never shows from the keyboard and is cut off on the canvas.",
  },
  {
    id: "modal-shell", name: "ModalShell", group: "overlays", file: "src/components/shared/ModalShell.vue", surfaces: ["canvas", "manager"],
    use: "The backdrop, focus trap and Escape handling for a canvas dialog. Put the dialog's own frame inside.",
  },
  {
    id: "confirm-modal", name: "ConfirmModal", group: "overlays", file: "src/manager/components/ui/ConfirmModal.vue", surfaces: ["manager"],
    use: "Ask before something that can't be undone, in the manager. Built on Modal, so Escape, Tab and focus return work like every other dialog. Name the action on the confirm button (Delete, not OK); tone=\"danger\" for deletes and discards.",
    instead: "ConfirmDialog in a manager screen, or window.confirm().",
  },
  {
    id: "confirm-dialog", name: "ConfirmDialog", group: "overlays", file: "src/components/shared/ConfirmDialog.vue", surfaces: ["canvas"],
    use: "The same question from a canvas widget, in the node colours. In the manager use ConfirmModal.",
  },
  {
    id: "context-menu", name: "ContextMenu", group: "overlays", file: "src/components/shared/ContextMenu.vue", surfaces: ["canvas", "manager"],
    use: "A right-click menu at the pointer: sections, icons, dividers, a danger item. It stays on screen near the edges. For a menu behind a button use DropdownMenu.",
    instead: "Another absolutely positioned list of buttons.",
  },
  {
    id: "lightbox", name: "Lightbox", group: "overlays", file: "src/components/shared/Lightbox.vue", surfaces: ["manager", "canvas"],
    use: "One image full screen over a dimmed page: arrows or the side buttons step through the rest, Escape or the close button shuts it and focus goes back. Built on ModalShell, so keys inside never reach ComfyUI. zoom shows each picture in WpImageZoom, keeping the level and the spot as you step. ImageGrid opens it for you.",
    instead: "A fixed-position <img> with its own Escape listener (DocImage's zoom).",
  },
  // Library pieces
  {
    id: "rich-text", name: "RichTextInput", group: "pieces", file: "src/manager/components/RichTextInput.vue", surfaces: ["manager"],
    use: "Prompt text: colours $variables, @{references}, {a|b} picks, LoRAs and #tags, and completes them as you type. Every template, combine and option text box uses it.",
    instead: "A Textarea for text that holds prompt syntax.",
  },
  {
    id: "negative-field", name: "NegativeField", group: "pieces", file: "src/manager/components/NegativeField.vue", surfaces: ["manager"],
    use: "The folded \"Negative\" box under an option, value or template. Opens when clicked or when it has text.",
  },
  {
    id: "breadcrumb", name: "Breadcrumb", group: "pieces", file: "src/manager/components/Breadcrumb.vue", surfaces: ["manager"],
    use: "The Library › Wildcards › Hair colour trail at the top of an editor.",
  },
  {
    id: "draft-banner", name: "DraftBanner", group: "pieces", file: "src/manager/components/DraftBanner.vue", surfaces: ["manager"],
    use: "Offer to restore unsaved changes found when an editor opens.",
  },
  {
    id: "selection-toolbar", name: "SelectionToolbar", group: "pieces", file: "src/manager/components/SelectionToolbar.vue", surfaces: ["manager"],
    use: "The bar that appears when rows are selected: tag, weight, negative, move and delete them together.",
  },
  {
    id: "validity-icon", name: "ValidityIcon", group: "pieces", file: "src/manager/components/ValidityIcon.vue", surfaces: ["manager"],
    use: "The check, warning or error mark in a list's Valid column, with the problems in its tooltip.",
  },
  {
    id: "relative-date", name: "RelativeDate", group: "pieces", file: "src/manager/components/RelativeDate.vue", surfaces: ["manager"],
    use: "\"5 min ago\" for a timestamp, with the full date on hover.",
  },
  {
    id: "icon-picker", name: "IconPicker", group: "pieces", file: "src/manager/components/IconPicker.vue", surfaces: ["manager"],
    use: "Pick an icon for a category or bundle from the curated set. The closed picker names the icon (or says Choose icon); compact drops the name for a table cell. The panel is a kit Popover.",
  },
  // Brand
  {
    id: "logo", name: "Logo", group: "brand", file: "src/components/shared/Logo.vue", surfaces: ["manager", "canvas"],
    use: "The Wildcard Pipeline mark. Draw it at 16, 20, 28 or 40 px.",
  },
];

/**
 * Components in a kit folder that are not kit entries, and why. The coverage
 * test accepts these; everything else in a kit folder must be in KIT_ENTRIES.
 */
export const KIT_EXEMPT: Record<string, string> = {
  "src/manager/components/ui/ToastHost.vue": "Mounted once by the app; use useToast().",
  "src/components/shared/Toast.vue": "Mounted once by the canvas toast store; push to toast-store.",
  "src/components/shared/SeedListModal.vue": "The seed list dialog itself, not a building block.",
  "src/components/shared/SeedLockRow.vue": "One row of the seed list; only the seed widgets use it.",
  "src/components/shared/FrameChips.vue": "Loop frame chips; only the loop and seed widgets use them.",
};

/** The folders whose components must each be a kit entry or exempt. */
export const KIT_FOLDERS = ["src/manager/components/ui", "src/components/shared"];

/**
 * How to use each entry, shown under its demo. Code, so not translated.
 */
export const KIT_EXAMPLES: Record<string, string> = {
  "button": `<Button variant="primary" icon="pi-plus" @click="add">New module</Button>`,
  "btn-css": `<button class="wp-btn wp-btn--primary wp-btn--sm">Run</button>`,
  "input": `<Input v-model="name" prefix="$" aria-label="Variable name" />`,
  "textarea": `<Textarea v-model="notes" :rows="3" auto-resize />`,
  "field": `<Field label="Name" hint="Shown in the library." for="name"><Input id="name" v-model="name" /></Field>`,
  "select": `<Select v-model="category" :options="options" clearable />`,
  "wp-select": `<WpSelect v-model="mode" :options="[{ value: 'hash', label: 'Hash' }]" aria-label="Strategy" />`,
  "wp-number": `<WpNumber v-model="count" :min="1" :max="64" aria-label="Count" />`,
  "search-input": `<SearchInput v-model="query" placeholder="Search modules" :visible="shown.length" :total="rows.length" />`,
  "list-filter": `<ListFilter v-model="query" :total="rows.length" :visible="shown.length" noun="rules" test-prefix="rules" />`,
  "color-picker": `<ColorPicker v-model="color" aria-label="Category colour" />`,
  "hsv-picker": `<HsvPicker v-model="color" aria-label="Colour" />`,
  "checkbox": `<Checkbox v-model="picked" label="Include in bundle" />`,
  "wp-check": `<WpCheck v-model="on" aria-label="Hold" />`,
  "toggle": `<Toggle v-model="enabled" label="Show tooltips" />`,
  "wp-switch": `<WpSwitch v-model="held" variant="chip" icon="pi-link" label="Hold across run" />`,
  "radio": `<label><input v-model="mode" type="radio" class="wp-radio" value="a"> Tags</label>`,
  "tabs": `<WpTabs v-model="tab" :tabs="[{ id: 'options', label: 'Options', count: 12 }, { id: 'rules', label: 'Rules' }]" aria-label="Editor sections" />`,
  "image-zoom": `<WpImageZoom v-model:zoom="zoom" :src="url" alt="Frame 3" hint="Drag to move · scroll to zoom" minimap autohide />`,
  "segmented": `<WpSegmented v-model="theme" :options="[{ value: 'dark', label: 'Dark', icon: 'pi-moon' }, { value: 'light', label: 'Light', icon: 'pi-sun' }]" aria-label="Theme" />`,
  "disclosure": `<Disclosure v-model:open="open" label="Advanced" :count="3">…</Disclosure>`,
  "data-table": `<DataTable v-model:sort="sort" v-model:selected="picked" :columns="columns" :rows="rows" row-key="id" selectable aria-label="Tags" />`,
  "banner": `<Banner tone="warn" title="2 modules are out of date" dismissible @dismiss="hide">Update them before you publish.</Banner>`,
  "wp-button": `<WpButton variant="primary" icon="pi-plus" @click="add">Add module</WpButton>`,
  "copy-button": `<CopyButton :text="prompt" label="Copy prompt" />`,
  "close-button": `<CloseButton kbd="Esc" @click="close" />`,
  "wp-icon-button": `<WpIconButton icon="pi-lock" tone="warn" :pressed="locked" label="Lock seed" @click="toggle" />`,
  "card": `<Card title="Options" subtitle="12 options">…</Card>`,
  "chip": `<Chip tone="warn" icon="pi-exclamation-triangle">2 conflicts</Chip>  <Chip :color="cat.color" :icon="cat.icon">{{ cat.name }}</Chip>`,
  "kbd": `<Kbd keys="Mod+K" />`,
  "icon": `<Icon name="pi-bolt" :size="ICON_MD" />`,
  "empty-state": `<EmptyState icon="pi-inbox" headline="No bundles yet" body="…"><template #cta>…</template></EmptyState>`,
  "toast": `useToast().push({ severity: "success", summary: "Saved", action: { label: "Undo", run: undo } })`,
  "toast-card": `<ToastCard tone="success" summary="Saved Hair colour" action-label="Undo" @action="undo" @dismiss="close" />`,
  "canvas-toast": `pushToast("Copied to the library", { severity: "success" })`,
  "loading-mark": `<LoadingMark block>Loading bundle…</LoadingMark>`,
  "ai-working": `<AiWorking text="Planning the pack" variant="orbit" />`,
  "modal": `<Modal v-model:open="open" title="Rename"><template #footer>…</template></Modal>`,
  "modal-shell": `<ModalShell :visible="open" @close="open = false"><div class="my-dialog">…</div></ModalShell>`,
  "confirm-modal": `<ConfirmModal :open="ask" title="Delete Hair colour?" confirm-label="Delete" tone="danger" @confirm="del" @cancel="ask = false" />`,
  "confirm-dialog": `<ConfirmDialog :visible="ask" title="Delete Hair colour?" confirm-label="Delete" variant="danger" @confirm="del" @cancel="ask = false" />`,
  "context-menu": `<ContextMenu :visible="open" :x="ev.clientX" :y="ev.clientY" :items="items" @close="open = false" />`,
  "drawer": `<Drawer v-model:open="open" title="History" width="380px">…<template #footer>…</template></Drawer>`,
  "popover": `<Popover v-model:open="open" label="Colour"><template #trigger="{ props }"><Button v-bind="props">Colour</Button></template>…</Popover>`,
  "dropdown-menu": `<DropdownMenu :items="actions" label="Hair colour actions"><template #trigger="{ props }"><Button v-bind="props" variant="ghost" icon="pi-ellipsis-h" /></template></DropdownMenu>`,
  "tooltip": `<Button v-tooltip="{ text: 'Copy to clipboard', kbd: 'Ctrl C' }" variant="ghost" icon="pi-copy" aria-label="Copy" />`,
  "logo": `<Logo :size="28" />`,
  "rich-text": `<RichTextInput v-model="template" surface="assembler" multiline :var-suggestions="vars" />`,
  "negative-field": `<NegativeField v-model="option.negative" label="option" />`,
  "breadcrumb": `<Breadcrumb :items="[{ to: '/wildcards', label: 'Wildcards' }, { label: name }]" />`,
  "draft-banner": `<DraftBanner :has-draft="hasDraft" :age-ms="age" @restore="restore" @discard="discard" />`,
  "selection-toolbar": `<SelectionToolbar :count="selected.length" :tags="tags" @apply-tag="tag" @delete-selected="del" />`,
  "validity-icon": `<ValidityIcon :issues="validate(row)" />`,
  "relative-date": `<RelativeDate :value="row.updated_at" />`,
  "toolbar": `<Toolbar label="Text tools" attached><WpButton icon="pi-bold" aria-label="Bold" /><WpButton icon="pi-italic" aria-label="Italic" /></Toolbar>`,
  "slider": `<Slider v-model="weight" :min="0" :max="2" :step="0.05" aria-label="Weight" with-input />`,
  "tag-input": `<TagInput v-model="tags" :suggestions="libraryTags" aria-label="Tags" />`,
  "inline-edit": `<InlineEdit v-model="mod.name" label="Wildcard name" :validate="(v) => taken(v) ? 'That name is taken' : null" />`,
  "drop-zone": `<DropZone accept=".txt,.yaml,.yml,.zip" multiple hint="Wildcard files or a zip" @files="load" @reject="explain" />`,
  "badge": `<Badge :count="3" tone="danger" label="3 problems"><Button variant="ghost" icon="pi-bell" aria-label="Problems" /></Badge>  <Badge dot tone="success" text="Running" pulse />`,
  "description-list": `<DescriptionList :items="[{ label: 'Family', value: 'SDXL' }, { label: 'ID', value: id, mono: true, copy: true }]" />`,
  "code-block": `<CodeBlock :code="json" language="JSON" max-height="240px" />`,
  "stepper": `<Stepper v-model="step" :steps="[{ id: 'describe', label: 'Describe' }, { id: 'plan', label: 'Plan' }, { id: 'build', label: 'Build' }]" clickable linear />`,
  "pagination": `<Pagination v-model:page="page" :total="rows.length" :page-size="50" />`,
  "separator": `<Separator label="or" />`,
  "resize-handle": `<ResizeHandle v-model="width" axis="x" reverse :min="280" :max="720" :default-size="380" label="Chat width" />`,
  "split-pane": `<SplitPane v-model="listWidth" :min="200" :max="520" label="List width"><template #start>…</template><template #end>…</template></SplitPane>`,
  "sortable-list": `<SortableList v-model="rules" :item-key="(r) => r.id" :item-label="(r) => r.name" label="Rules"><template #item="{ item }">{{ item.name }}</template></SortableList>`,
  "progress": `<ProgressBar :value="done" :max="total" label="Testing seeds" show-value />`,
  "skeleton": `<Skeleton shape="row" :lines="4" label="Loading modules" />`,
  "icon-picker": `<IconPicker v-model="icon" aria-label="Category icon" />`,
  "combobox": `<Combobox v-model="cats" multiple :options="categories" aria-label="Categories" />`,
  "date-picker": `<DatePicker v-model="since" :max="today" clearable aria-label="Changed since" />`,
  "range-slider": `<RangeSlider v-model="range" :min="0" :max="2" :step="0.1" aria-label="Weight" with-input />`,
  "choice-cards": `<ChoiceCards v-model="look" :options="LOOKS" aria-label="Look"><template #preview="{ option }"><LookDrawing :id="option.value" /></template></ChoiceCards>`,
  "radio-group": `<RadioGroup v-model="style" :options="[{ value: 'tags', label: 'Tags', hint: 'Comma separated' }]" aria-label="Prompt style" />`,
  "avatar": `<Avatar :name="post.author" :src="post.avatar_url" size="sm" />`,
  "timeline": `<Timeline :items="history"><template #time="{ item }"><RelativeDate :value="item.at" /></template></Timeline>`,
  "diff-view": `<DiffView :before="old.text" :after="draft.text" />`,
  "image-grid": `<ImageGrid v-model:selected="keep" :images="outputs" selectable />`,
  "visually-hidden": `<VisuallyHidden aria-live="polite">{{ status }}</VisuallyHidden>`,
  "virtual-list": `<VirtualList :items="options" :item-height="32" :item-key="(o) => o.id" label="Options"><template #item="{ item }">{{ item.text }}</template></VirtualList>`,
  "lightbox": `<Lightbox v-model:open="open" v-model:index="at" :images="shots" />`,
};

export function kitEntry(id: string): KitEntry {
  const e = KIT_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`No kit entry "${id}"`);
  return e;
}
