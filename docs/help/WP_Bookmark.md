# WP Bookmark

Marks a spot on the canvas so you can jump back to it with a shortcut or from the **Bookmarks** dock. Frontend only: it never runs and is left out of the prompt; its settings are saved with the workflow.

## Adding one

- From the node search (`WP Bookmark`), or right-click the empty canvas › **Add WP Bookmark here**.
- **Bookmark this view** (in the dock's edit mode, or as a command) adds one at the top-left of the screen with the zoom you're at, so jumping to it brings back this exact view.
- A new bookmark gets the first free shortcut (Alt+1, Alt+2…).

A **WP Note** can be a bookmark too: turn on **Also a bookmark** in its editor (see WP Note). It gets the same settings and shows in the dock, but never hides.

## On the canvas

A bookmark has no node frame: it is a small pill with its icon, name and shortcut (a warning mark when something else uses the key, a pin when it is pinned). Hover it for where it lands. Select it to show its pencil; the pencil or a double-click opens the editor, and **Done** closes it. A new bookmark opens in the editor.

## Settings

| Setting | Notes |
|---|---|
| Icon, colour, name | The icon opens the full icon list. The colour marks the pill and its dock row. |
| Lands at | A 3×3 grid: the corner, edge or centre of the free part of the screen the bookmark goes to, 24 px in. The free part is what ComfyUI's sidebar, breadcrumb, toolbar and zoom controls leave; a jump that would land under the dock moves just enough to clear it. |
| Use this view | Lands on the view on screen now, at its zoom, instead of a grid spot. |
| Zoom | **Set** jumps to that zoom (0.1–10×; the magnifier takes the zoom you're at). **Keep current** leaves the zoom alone. |
| Shortcut | Click **Record**, then press the keys. Esc cancels, Backspace clears. The bolt picks a free one (a new one on each press). |
| Show on canvas | Off hides the node when you press **Done**: it isn't drawn and can't be clicked or selected. Show it again from the dock's eye. |
| Pinned | ComfyUI's own pin: a pinned bookmark can't be moved by accident. |
| Go | Tries the jump. |

Muting or bypassing a bookmark turns it off: its shortcut does nothing and the dock greys it.

## Shortcut clashes

While you set a shortcut the node lists who else uses it:

- **Refused**: keys the browser keeps (Ctrl+T, Ctrl+W, Ctrl+1–9, F5…).
- **Warning**: a ComfyUI shortcut (including ones you changed in Settings › Keybinding), another extension's shortcut, another WP Bookmark, or an rgthree bookmark in the same workflow.
- **Note**: a key with no Ctrl or Alt fires whenever the canvas has focus (never while you type).

Extensions that read keys themselves can't be seen in advance. If one of them takes the key first, the bookmark doesn't jump and a toast names the combo once, so you can pick another. The key is remembered: the clash check marks it from then on and the bolt never suggests it.

## The Bookmarks dock

The bookmark button in the top bar shows or hides it; it also opens by itself in a workflow with bookmarks (unless you closed it). It sits inside ComfyUI's bars and is see-through until you point at it, so what is under it still shows. It has two modes:

- **View**: each row shows its number (a Step note's number in its circle), icon, name and shortcut (a mark for one hidden on the canvas or in a subgraph, OFF for a muted one). **Click** a row to jump. **Back** returns to where you were before the last jump; **↑ / ↓** step through the bookmarks in dock order.
- **Edit** (the pencil): drag the dock by its header to put it anywhere (it stays there), drag the grips to reorder, the **eye** shows or hides a bookmark on the canvas, the arrow puts the dock back on the other side, and **Bookmark this view** adds one. **Done** goes back to view.

The caret folds the dock. Bookmarks inside a subgraph are listed too; jumping opens the subgraph.

## Commands

**Next bookmark**, **Previous bookmark**, **Back**, **Bookmark this view** and **Show or hide the dock** are in Extensions › Wildcard Pipeline › Bookmarks. They have no keys by default: bind them in Settings › Keybinding.
