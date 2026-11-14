# WP Bookmark

Marks a spot on the canvas so you can jump back to it with a shortcut or from the **Bookmarks** dock. Frontend only: it never runs and is left out of the prompt; its settings are saved with the workflow.

## Adding one

- From the node search (`WP Bookmark`), or right-click the empty canvas › **Add WP Bookmark here**.
- **Bookmark this view** (in the dock's edit mode, or as a command) adds one at the top-left of the screen with the zoom you're at, so jumping to it brings back this exact view.
- A new bookmark gets the first free shortcut (Alt+1, Alt+2…).

A **WP Note** can be a bookmark too: turn on **Also a bookmark** in its editor (see WP Note). It gets the same settings and shows in the dock, but never hides.

## On the canvas

A bookmark has no node frame and can't be resized: it is a small pill with its icon, name and shortcut (a warning mark when something else uses the key, a pin when it is pinned). Hover it for where it lands. A double-click, or the indigo pencil in ComfyUI's selection toolbar while it is selected, opens the editor, and **Done** closes it. A new bookmark opens in the editor.

<!-- fields:start -->
## On the node

- **Icon, colour, name**: The icon opens the full icon list. The colour marks the pill and its dock row.
- **Lands at**: A 3×3 grid: the corner, edge or centre of the free part of the screen (what ComfyUI's toolbar, the open side panel and the bottom panel leave, following them as they open and close), 24 px in. A jump that would land under the dock, the minimap or the zoom controls moves just enough to clear them all (the dock only while its Land clear of the dock switch is on). It lands in the same place however often you press the key, selected or not. Only the layout counts: what pops up on its own (the job progress panel while a workflow runs, the error card, toasts, menus, tooltips, dialogs) never moves it.
- **Use this view**: Lands on the view on screen now, at its zoom, instead of a grid spot.
- **Zoom**: Set jumps to that zoom (0.1–10×; the magnifier takes the zoom you're at). Keep current leaves it alone.
- **Shortcut**: Record, then press the keys (Esc cancels, Backspace clears). The bolt picks a free one, a new one on each press.
- **Show on canvas**: Off hides the node when you press Done: not drawn, not clickable, not selectable. The dock's eye shows it again.
- **Pinned**: ComfyUI's own pin: a pinned bookmark can't be moved by accident. New bookmarks start unpinned; a saved workflow keeps each bookmark's pin.
- **Go**: Tries the jump.

## The Bookmarks dock

- **Row**: Click to jump. Number (a Step note's in its circle), icon, name and shortcut; a mark for one hidden on the canvas or inside a subgraph, OFF for a muted one.
- **Grid / List**: Shows the bookmarks as small tiles (number, icon in its colour, name, shortcut with Shift as ⇧; the tooltip has the full name and keys) that wrap four to a line, or as rows. The dock remembers your choice; edit mode always shows rows.
- **Back**: Return to where you were before the last jump.
- **↑ / ↓**: Step through the bookmarks that are on, in dock order.
- **Pencil**: Edit mode: drag the dock by its header and it snaps to the nearest spot of a 3×3 grid on the free canvas (a dashed outline shows where); drag the grips to reorder, the eye shows or hides a bookmark on the canvas, and Bookmark this view adds one at the zoom you're at: the small 3×3 grid beside it picks where on screen the new bookmark sits, and it lands there, so jumping to it brings back that exact view. Land clear of the dock (on by default) moves a jump out from under the dock; off, bookmarks land where they would without it, behind the see-through dock. Done goes back. The dock follows the layout (side panels, the bottom panel, the top bar, the minimap and zoom controls, a floating run bar) and stays put when the job progress panel, the error card, a toast or a menu pops up; those float over it.
<!-- fields:end -->

## Shortcut clashes

While you set a shortcut the node lists who else uses it:

- **Refused**: keys the browser keeps (Ctrl+T, Ctrl+W, Ctrl+1–9, F5…).
- **Warning**: a ComfyUI shortcut (including ones you changed in Settings › Keybinding), another extension's shortcut, another WP Bookmark, or an rgthree bookmark in the same workflow.
- **Note**: a key with no Ctrl or Alt fires whenever the canvas has focus (never while you type).

Extensions that read keys themselves declare nothing a keymap could show, so the node also asks the page: when you record a key or press the bolt, it sends a pretend key press and watches for anything that claims it. A key something answers is listed as taken, and the bolt skips it. The pretend press carries the same key codes a real press does, so extensions that only read those (like ComfyUI-Easy-Use's Alt+0–9 node template keys) are found too. It stops a handler at the moment it claims the key, so nothing runs; a handler that acts without claiming the key can't be seen this way.

If an extension still takes the key first when you press it, the bookmark doesn't jump and a toast names the combo once, so you can pick another. The key is remembered: the clash check marks it from then on and the bolt never suggests it.

## Commands

**Next bookmark**, **Previous bookmark**, **Back**, **Bookmark this view** and **Show or hide the dock** are in Extensions › Wildcard Pipeline › Bookmarks. They have no keys by default: bind them in Settings › Keybinding.
