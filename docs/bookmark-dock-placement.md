# Where the Bookmarks dock sits and where jumps land

The dock and bookmark jumps are placed in the **free area**: `freeArea()` in
`src/widgets/bookmark.ts`. The rule: it follows the host's **layout** only.
Anything that comes and goes on its own floats over the canvas (like a toast)
and never moves the dock or a jump.

## How the free area is built

1. **The pane frame.** ComfyUI's `#graph-canvas-panel` gives what the side
   panel, the right (properties / agent) panel and the bottom panel leave.
   Its TOP is not used as is: the top menu sits in the page flow above the
   pane, and its right-hand column stacks the job progress panel, the error
   card and the inline progress line under the run bar, so the menu grows
   while a workflow runs and pushes the pane down. `paneTop()` takes the
   bottom of the menu's bars (breadcrumb, run bar card; a `position: fixed`
   floating run bar is no bar) plus ComfyUI's 4 px gap instead. The menu is
   found by `menuAbove()`: the sibling just before the pane's column (the
   `graph-canvas-gutter` group on 1.54+, the PrimeVue splitter before that),
   only if it sits above the pane. Frontends before 1.55 have no
   `#graph-canvas-panel` id, so the pane is also matched by its
   `.graph-canvas-panel` class.
2. **Floating pieces in the pane** (`paneOverlays`): the first
   pointer-taking element down each branch: minimap, zoom controls. Boxes to
   keep clear of.
3. **The edge walk** (`walkInsets`): `elementsFromPoint` from each edge, for
   bars the pane doesn't know (another extension's toolbar, an older
   frontend). The element hit is grown to its whole piece (`pieceOf`, up
   through parents that take the pointer); only a piece spanning at least
   half of that edge is a bar. A smaller one (a floating run bar near an
   edge) is a box to keep clear of, not a bar across the whole edge.

`IGNORED` = `GRAPH_CONTENT` (nodes, DOM widgets, our dock and toasts, the
selection toolbox) + `TRANSIENT` (see below). Both the pane walk and the
edge walk skip them. `dockLayoutKey()` (the dock's 500 ms poll) is built
from the same frame, so a transient piece doesn't trigger a re-place either.

## Audit: what can change the free area

| Source | Kind | Effect now |
| --- | --- | --- |
| Window resize, browser zoom | layout | dock re-places (resize event, ResizeObserver) |
| Side panel (left/right) open, close, drag | layout | pane narrows; dock follows |
| Right properties panel, docked agent panel | layout | pane narrows; dock follows |
| Bottom panel (console, shortcuts, terminal) | layout | pane shorter; dock follows |
| Workflow tabs in the top bar / focus mode | layout | whole layout moves; dock follows |
| Top menu bars (breadcrumb, run bar card) | layout | pane top from their bottom |
| Floating (undocked) run bar | user-placed floating | box to keep clear of, never a bar |
| Minimap, zoom controls shown/hidden | user-toggled floating | boxes to keep clear of |
| Job progress panel (`queue-progress-overlay`), expanded job list | transient | ignored (was: pushed pane down; the bug) |
| Inline progress line, error card (`error-overlay`), `role=status` | transient | ignored |
| Toasts (reka viewport, PrimeVue `.p-toast`), notification popups | transient | ignored (#228 fixed toasts) |
| Menus, popovers, tooltips, dialogs, selects (role / reka popper / PrimeVue / litegraph context menu, search box, prompt dialog) | transient | ignored |
| Selection toolbox, title editor, node tooltip | follows nodes / transient | ignored (#228 fixed the toolbox) |
| Nodes 2.0 nodes (`[data-node-id]`), DOM widgets, link overlay | graph content | ignored (link overlay and transform pane take no pointer) |
| Node-picking mode (app builder) | transient | menu bars hide; top still from their box |
| Canvas zoom / pan | none | dock is screen-fixed; jumps use the bookmark's own zoom |
| Dock's own height (fold, more rows, edit mode) | own | a bottom spot keeps its bottom edge (intended) |

## When a new host piece shows up

If it comes and goes on its own, add its selector to `TRANSIENT`; if it is
part of the graph, to `GRAPH_CONTENT`. Then add a case to
"The free area only follows the host's layout" in
`src/widgets/bookmark.test.ts`. Prefer a `data-testid` or ARIA role over a
utility class: the frontend's Tailwind classes change between releases.
