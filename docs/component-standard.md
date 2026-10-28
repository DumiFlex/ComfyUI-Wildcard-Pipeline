# Component standard

Every custom control in the extension follows these rules. The component kit (Settings › Advanced › Component kit, route `/wp/kit`) shows each one live. Build screens from the kit. When nothing fits, make a new kit component that follows this page, in the same PR as the screen that needs it.

## 1. Where it lives

| Folder | What goes there |
|---|---|
| `src/components/shared/` | Pieces the canvas uses, and pieces both the canvas and the manager use: overlays (`Popover`, `DropdownMenu`, `ContextMenu`, `tooltip.ts`, `ModalShell`), controls (`SearchInput`, `WpNumber`, `WpCheck`, `WpSelect`, `WpButton`, `WpSwitch`, `WpTabs`, `WpSegmented`, `Disclosure`, `Banner`, `CopyButton`, `CloseButton`, `Slider`, `TagInput`, `InlineEdit`, `DropZone`, `Toolbar`, `Combobox`, `DatePicker`, `RangeSlider`, `RadioGroup`), display and layout pieces (`Badge`, `Kbd`, `DescriptionList`, `CodeBlock`, `Separator`, `Stepper`, `Pagination`, `ResizeHandle`, `SplitPane`, `SortableList`, `Avatar`, `Timeline`, `DiffView`, `ImageGrid`, `VirtualList`, `VisuallyHidden`), the `Lightbox` overlay, feedback (`ProgressBar`, `Skeleton`) and the toast look (`ToastCard`). |
| `src/manager/components/ui/` | Manager-only controls: `Button`, `Input`, `Select`, `Modal`, `ConfirmModal`, `Drawer`, `DataTable`, `ChoiceCards` and the rest. |

A component anywhere else is a part of one screen, not a control. If a second screen needs it, move it into a kit folder first.

## 2. Kit entry and demo

- Add an entry to `src/manager/kit/registry.ts` with:
  - `id`, `name`, `group`, `file` and `surfaces`;
  - a `use` line saying when to reach for it;
  - an `instead` line naming what it replaces;
  - a `KIT_EXAMPLES` line.
- The demo goes in `src/manager/kit/demos/<id>.vue`, one file per entry, so PRs don't collide.
  - Show every variant and every state that applies: default, disabled, invalid, loading, empty.
- `kit-coverage.test.ts` fails when a kit-folder component has no entry, or when a demo file has no matching entry.

## 3. Prop names

Use one name per meaning, everywhere:

| Prop | Values | Meaning |
|---|---|---|
| `size` | `sm` / `md` / `lg` | Control height (see 4). |
| `variant` | `primary` / `secondary` / `ghost` / `danger` / `link` | What the control is. An icon-only button is any variant with `icon` and an `aria-label`. |
| `tone` | `neutral` / `info` / `success` / `warn` / `danger` / `accent` | What it means. Chips, banners and badges use it. |
| `disabled`, `readonly`, `invalid`, `loading` | boolean | States. |
| `v-model` (`modelValue`) | | The value. |
| `v-model:open` (`open`) | boolean | Whether an overlay is open. |
| `label` / `aria-label` | | The control's accessible name. |
| `placement` | `bottom-start`, `top`, `right-start`… | Overlays only. |

Don't add synonyms such as `kind`, `small`, `busy` or `visible` for these meanings. (ModalShell and ContextMenu keep `visible` until they are next touched.)

## 4. Sizes

- Controls come in three heights: 24 px (`sm`), 32 px (`md`) and 40 px (`lg`). Buttons, inputs, selects, number fields and segmented controls share these heights.
- The canvas defaults to `sm`, the manager to `md`.
- Button, Input, Select and WpNumber are on it (`size` sm/md/lg). The manager's Density setting scales all three heights together through `--wp-density`. `SearchInput` takes `size` on the scale too (canvas `sm`, manager forms `md`).
- Hit targets are at least 20 px on the canvas and 24 px in the manager. An icon inside a chip may draw smaller, but its click area must not be.

## 5. Tokens only

- Colours, radii, spacing, shadows and type come from `--wp-*` tokens. kit-guard counts raw hex colours, and a file's count may not go up.
- A component in `src/components/shared/` uses only the names both surfaces define. The list is `SHARED_TOKENS` in `src/components/shared/shared-tokens.test.ts`; the test fails when either side stops defining one, or when a shared overlay reads a name outside it. That is how one component wears the canvas colours in a node and the manager colours on a page.
- Shadows follow the floating thing's size: `--wp-shadow-sm` for resting cards, `--wp-shadow-md` for menus, popovers, tooltips and dropdown lists, `--wp-shadow-lg` for dialogs, `--wp-shadow-xl` for drawers and full-page panels. A small menu never gets a dialog's shadow.
- Every component must work in both light and dark.
- A component never `@import`s `theme.css`: the canvas loads it once from the boot chunk (`extension/settings.ts`), so its tokens and `.wp-*` classes are always there.
- A component never writes to `:root`. The canvas colour sets in `theme.css` skip `html.wp-manager`, and a canvas piece shown in the manager puts `wp-canvas-scope` on its own root.

## 6. Accessible by default

- Everything a mouse can do, the keyboard can do. Tab moves between controls. Inside a group (tabs, menus, radios, segmented controls), the arrow keys move and Home/End jump to the ends.
- Overlays:
  - close on Escape;
  - give focus back to whatever opened them;
  - dialogs keep Tab inside (use `useDialogFocus`).
- Hints use `v-tooltip`, not `title=`.
- Icon-only buttons have an `aria-label`. The × that closes something is `CloseButton`; a copy is `CopyButton` (or `copyText` from `components/shared/clipboard.ts` behind a menu item), never `navigator.clipboard` directly, which is missing over plain http.
- Shared pieces style themselves in `<style scoped>`, not in `@layer wp-extension`: the manager's Tailwind reset is unlayered and would beat a layered rule on `<button>`.
- Motion respects `prefers-reduced-motion`.

## 7. Overlays go through the kit

Anything that floats goes through the kit's overlays and positions with `floating.ts`:

| What floats | Use |
|---|---|
| Panel next to a control | `Popover` |
| Menu behind a button | `DropdownMenu` |
| Menu at the pointer | `ContextMenu` |
| Hint | `v-tooltip` |
| Side panel | `Drawer` |
| Dialog | `Modal` / `ConfirmModal` (manager), `ModalShell` / `ConfirmDialog` (canvas) |

Anything that floats next to a trigger follows it when the page scrolls or resizes; a menu opened at the pointer closes on scroll. Never write another Teleport with its own placement maths, scroll handling or outside-click handler.

A panel closes once its trigger has scrolled out of view. A scroll inside the panel itself changes nothing.

## 7b. Loading, empty and disabled

- Loading: `LoadingMark`. A page or panel that is loading gets the full logo (`block`); a tight inline spot (a text row, a button, a list item) gets the sparkle, which is the default below 24 px. A busy button keeps its own colours and draws the sparkle in its label colour.
- Empty: `EmptyState` with `size` `page` (an empty list page), `panel` (the default, in a card or panel) or `inline` (one row).
- Disabled: 45% opacity and a not-allowed cursor, with no hover change. A ticked checkbox or picked radio turns grey, so it can't be mistaken for a live one.
- Readonly: dashed border, dimmer fill, no focus ring, and a lock on Input.

## 8. Canvas twins share a stylesheet

When the canvas needs its own version of a manager control (Button, Switch, Select, Number), both versions use the same stylesheet in `src/components/shared/`. A change to one then changes both. The kit shows each shared piece in both looks (`kit/KitLooks.vue` draws a demo twice, at the canvas size `sm` and the manager size `md`; the manager never loads the canvas colours, so both wear the manager's).

Better still is one component for both sides, with only `size` changing. `WpSwitch` is the on/off switch everywhere (the manager's `Toggle` is `WpSwitch` at `md`), and `WpTabs` and `WpSegmented` are the tabs and value pickers everywhere. A canvas widget never draws its own `role="switch"`, tab strip or joined-button group.

`WpButton` is the canvas Button: the manager `Button`'s variants, sizes and `button.css`, pulled in scoped (so the 20 px row icon buttons, `.wp-btn--icon-sm` in `row-primitives.css`, keep their own tone classes), with a PrimeIcons `icon` and `sm` by default. Every canvas dialog footer and toolbar button is a `WpButton`; never another `__btn` class with its own colours. Every checkmark box is `WpCheck`, including the 12 px on/off box of module, bundle and injector rows (`size="sm"`). The Settings live preview (`components/settings/`) uses the same pieces as the nodes it previews.

## 9. Isolation

- Every class starts with `.wp-`.
- Standalone CSS sits in `@layer wp-extension`.
- Litegraph state goes in WeakMaps.
- Saved state goes on `node.properties`.

See CLAUDE.md, "Extension isolation".

## 10. Reuse first

kit-guard (`scripts/kit-guard.mjs`) counts hand-built controls per file: native select, number, checkbox and range inputs; inline SVG; own dialogs; raw `<button>` in the manager; raw hex colours.

- A file's count may not go up.
- When a file's count goes down, run `pnpm kit:baseline` and commit the new baseline.
- A raw control needs a reason the kit can't cover. Usually the fix is to add the missing piece to the kit.

## 11. One component per job

Each of these jobs has exactly one component. Don't build a second one, and don't style a native element to look like it.

| Job | Use | Not |
|---|---|---|
| Search or filter a list | `SearchInput` (with `visible` / `total` for "3 of 12"); `ListFilter` in an editor card | `Input` with a search icon, a hand-made box |
| A number | `WpNumber` (`nullable` when empty means "default") | `<input type="number">`, `Input type="number"` (removed) |
| A tag, status or category | `Chip` (`tone` for meaning, `color` + `icon` for a category) | `CategoryChip` (merged), a pill `span` |
| A toast | `useToast()` (manager) or `pushToast()` (canvas); both draw `ToastCard` | a toast styled per surface |
| Look at a picture closely | `WpImageZoom` (`v-model:zoom`, Fit / 100% / 200%, wheel, drag) | an `<img>` with `max-width: 100%` called a zoom, a hand-made transform with its own wheel and drag code |
| Ask before acting | `ConfirmModal` (manager), `ConfirmDialog` (canvas) | `window.confirm()`, `ConfirmDialog` in the manager |
| How far a job is | `ProgressBar` (no `value` while unknown) | a div with a width set by hand |
| Content about to land | `Skeleton`; a whole page or panel: `LoadingMark block` | `wp-skel` classes, a "Loading…" flash |
| A count or a status dot | `Badge` (`dot` + `text` or `label`) | a coloured span, a count pill |
| A number on a range | `Slider` (`with-input` for the exact value) | `<input type="range">` |
| A list of words | `TagInput` | a comma-split text box |
| Rename in place | `InlineEdit` | a pencil that swaps in an `<input>` |
| Take files | `DropZone` (`overlay` over a panel) | own `dragover` / `drop` handlers |
| Put rows in order | `SortableList` | HTML drag and drop with its own handle |
| Drag a panel's size | `ResizeHandle`, or `SplitPane` for two panels | own mousemove maths |
| Steps of a job | `Stepper` | numbered circles per wizard |
| A long list in pages | `Pagination` (`mode="more"` for Load more) | own Prev / Next |
| Label and value rows | `DescriptionList` | a grid per panel |
| Text kept as written | `CodeBlock` | a bare `<pre>` |
| A shortcut | `Kbd` (`Mod+K`) | `<kbd class="wp-kbd">`, a hard-coded ⌘ |
| A divider | `Separator` | `<hr>`, a bordered div |
| A row of tool buttons | `Toolbar` (`attached` for a button group) | a flex row with a Tab stop per button |
| Pick from a long list | `Combobox` (`multiple` for several) | a search box over a hand-made list |
| A calendar day | `DatePicker` | `<input type="date">` |
| A low and high number | `RangeSlider` | two Sliders that can cross |
| One of a few explained options | `RadioGroup` (`cards` for big choices) | `.wp-radio` inputs with own hint text |
| One of a few options that need a picture | `ChoiceCards` (`compact` for a side panel) | a grid of `role="radio"` buttons with their own selected border |
| A person or bot | `Avatar` | an initials circle per screen |
| Events in order | `Timeline` | a list with its own dots and line |
| What changed | `DiffView` | two boxes side by side, colour alone |
| Images in a grid, full screen | `ImageGrid`, `Lightbox` (`zoom` puts each in `WpImageZoom`) | `<img>` wraps with own zoom overlay |
| Thousands of rows | `VirtualList` | rendering every row |
| Text for screen readers only | `VisuallyHidden` | another 1 px clip rule |
