# WP Note

A note that explains a workflow. It looks like a panel, not a node: no title bar, no frame, no sockets, in both the classic renderer and Nodes 2.0. The selection outline hugs the panel. It never runs and is left out of the prompt; its text is saved with the workflow.

## Using it

- **Add** it from the node search (`WP Note`). A new note opens in its editor and starts pinned.
- **Edit** by double-clicking the note or with the indigo pencil in the selection toolbar while it is selected. **Done** goes back to reading.
- **Move** it by dragging like any node (unpin it first).
- **Resize** a Card or Sticky note from its corner: the width is yours, the height follows the text. A Label sizes itself to its title.
- **Hover** a Label to see its text and links in a card. Move onto the card to click a link or **Edit**. Marks on the pill show that it has text (lines) or a link (chain).
- **Links** in a note open in a new tab: a docs link opens that page (and section) of the built-in docs.

<!-- fields:start -->
## Editing

- **Tone**: Step (a numbered circle), Icon (pick any icon from the list next to it) or Plain (no badge).
- **Colour**: Presets that follow the theme (Accent, Tip, Info, Warning, Danger, Teal, Violet, Neutral), or any colour from the picker.
- **Look**: Card, Sticky or Label (above).
- **Pinned**: ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start pinned.
- **Title**: Shown in bold at the top, or on the pill of a Label.
- **Text**: Markdown, with the formatting bar below over it: headings (# to ####), bold, italic, strikethrough, code, bulleted, numbered and nested lists, task lists (- [x] / - [ ]), quotes and callouts (> [!TIP], > [!WARNING]), tables with column alignment (:--, :-:, --:), rules (---) and code blocks.

## The formatting bar

- **Bold, italic, strikethrough** (Ctrl+B / Ctrl+I): Wraps the selection in **, * or ~~.
- **Code**: Wraps it in backticks, for a $variable.
- **Lists and quote**: Puts - , 1. or > before each selected line (press again to take it off).
- **Link** (Ctrl+K): A Docs page (type to find any page of these docs, then pick a section or the whole page) or a Web address, drawn as a Button with an icon or as a Text link, in its own colour or the note's. The selected text becomes the link's text. It goes where the caret is when you press Insert link, so you can click in the text after opening the panel.
- **Icon**: Any PrimeIcons icon, searchable, in a colour or the text's own, inserted where the caret is.
- **Preview (eye)**: Shows the note as it will read.
<!-- fields:end -->

## Also a bookmark

Turn on **Also a bookmark** at the bottom of the editor and the note joins the **Bookmarks** dock: pick where it lands on screen, its zoom and a shortcut, the same settings and clash check as a WP Bookmark. A new one gets the next free shortcut. The dock shows it in the note's colour and icon, and a small bookmark mark on the note (its tooltip names the key) says it is one; a pinned note shows a pin mark next to it. A note can't be hidden on the canvas, and muting it turns its shortcut off without fading it.

## Syntax

| Write | Shows |
|---|---|
| `[Read more](https://example.com)` | A link that opens in a new tab |
| `[Seeds](docs:seeds-and-loops)` | A link to that docs page |
| `[The grid](docs:wp-label-grid#s-the-grid)` | A link to a section of it |
| `[Start here](docs:quick-start){button pi-play}` | The link drawn as a button with an icon (`{button}` for none) |
| `{button pi-play #22c55e}` / `[Read more](https://example.com){#22c55e}` | A button or a text link in its own colour (without one it takes the note's) |
| `:pi-heart:` / `:pi-heart:{#ef4444}` | An icon, optionally coloured |

Any other kind of link shows as plain text.
