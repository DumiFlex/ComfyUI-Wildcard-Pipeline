# WP Note

A note that explains a workflow. It looks like a panel, not a node: no title bar, no frame, no sockets, in both the classic renderer and Nodes 2.0. The selection outline hugs the panel. It never runs and is left out of the prompt; its text is saved with the workflow.

## Using it

- **Add** it from the node search (`WP Note`). A new note opens in its editor and starts pinned.
- **Edit** by double-clicking the note or with the indigo pencil in the selection toolbar while it is selected. **Done** goes back to reading.
- **Move** it by dragging like any node (unpin it first).
- **Resize** a Card or Sticky note from its corner: the width is yours, the height follows the text. A Label sizes itself to its title.
- **Hover** a Label to see its text and links in a card. Move onto the card to click a link or **Edit**. Marks on the pill show that it has text (lines) or a link (chain).
- **Links** in a note open in a new tab: a docs link opens that page (and section) of the built-in docs, a community link opens that pack in the manager's Community tab.
- **Add to library**: a `wp:library` button puts the workflow's bundles and modules into your library after a review (below).

<!-- fields:start -->
## Editing

- **Tone**: Step (a numbered circle), Icon (pick any icon from the list next to it) or Plain (no badge).
- **Colour**: Presets that follow the theme (Accent, Tip, Info, Warning, Danger, Teal, Violet, Neutral), or any colour from the picker.
- **Look**: Card, Sticky or Label (above).
- **Pinned**: ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start pinned.
- **Title**: Shown in bold at the top, or on the pill of a Label.
- **Text**: Its first line and length on the node; Edit text opens the text window, with the editor beside a live preview. Done (Ctrl+Enter) puts it on the note, Cancel or Escape leaves the note as it was. Markdown, with the formatting bar below over it: headings (# to ####), bold, italic, strikethrough, code, bulleted, numbered and nested lists, task lists (- [x] / - [ ]), quotes and callouts (> [!TIP], > [!WARNING]), tables with column alignment (:--, :-:, --:), rules (---) and code blocks.

## The formatting bar

- **Undo and redo** (Ctrl+Z / Ctrl+Y): Step back or forward through your changes, typing and the bar's own edits alike (Ctrl+Shift+Z and the right-click Undo and Redo work too). Typing counts as one step until you pause, move the caret or start a new line. The steps last while the text window is open.
- **Bold, italic, strikethrough** (Ctrl+B / Ctrl+I): Wraps the selection in **, * or ~~.
- **Code**: Wraps it in backticks, for a $variable.
- **Lists and quote**: Puts - , 1. or > before each selected line (press again to take it off).
- **Link** (Ctrl+K): A Docs page (type to find any page of these docs, then pick a section or the whole page), a Web address, a Library button (below) or a Community pack (owner/pack, or paste the pack's address), drawn as a Button with an icon or as a Text link, in its own colour or the note's. The selected text becomes the link's text. It goes where the caret is when you press Insert link, so you can click in the text after opening the panel.
- **Icon**: Any PrimeIcons icon, searchable, in a colour or the text's own, inserted where the caret is.
- **Pictures**: Add a picture from a file, or paste or drop one into the text; it goes on a line of its own where the caret is. Or pick one the extension ships (the node toolbar with its ? help button). The panel lists the note's pictures with a Width slider (a share of the note), Own size and Remove.
<!-- fields:end -->

Keys you type in the editor stay in the editor: Delete, Ctrl+Z and the other ComfyUI shortcuts don't reach the canvas.

## Pictures

Open **Pictures** in the bar and press **Add a picture…**, or paste or drop a picture into the text. Or pick the picture the extension ships of the node toolbar with its **?** help button. A picture is never wider than the note: its width is a share of the note's (the **Width** slider), or **Own size** up to the note's width, so it never makes the note bigger. Pasted and dropped pictures are saved in the workflow, made smaller first (at most 1280 px, about 400 KB, camera and location data dropped); a note holds up to six and 2 MB. Pictures never load from a web address.

## Add to library

A `wp:library` button lets someone who opened a shared workflow keep its lists. Its tooltip says what it would add; with everything there already it stays off. Pressing it opens a review listing every item:

- New items go in under their own id.
- An item your library holds with other content: **Use mine** (default, nothing changes), **Replace**, or **Keep both** (added as a copy; the workflow points at the copy).
- An id another kind of item holds: **Keep both** or **Leave out**.

**Add** installs it all in one step with the Import tab's checks (one refused item and nothing goes in). EXAMPLE and MISSING marks clear, and the message has **Undo**. Nothing is added before you press Add, and the button only reads the workflow's own rows.

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
| `[Add the pack](wp:library){button pi-download}` | A button that adds this workflow's bundles and modules to your library |
| `[Add these](wp:library#node-12){button}` | The same for one WP Context (its node id) |
| `[Get the pack](wp:community/owner/pack)` | That published pack in the Community tab |
| `:pi-heart:` / `:pi-heart:{#ef4444}` | An icon, optionally coloured |
| `![What it shows](wp:image/1a2b3c4d)` | A picture saved in the note (the Pictures panel, a paste or a drop writes it) |
| `![The ? button](wp:asset/toolbar-help)` | A picture the extension ships |
| `![What it shows](wp:image/1a2b3c4d){width=60%}` | The picture as wide as 60% of the note (10 to 100); without it, its own size, never wider than the note |

Any other kind of link shows as plain text.
