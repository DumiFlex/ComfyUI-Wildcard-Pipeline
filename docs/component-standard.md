# Component standard

Every custom control in the extension follows these rules. The component kit (Settings › Advanced › Component kit, route `/wp/kit`) shows each one live. Build screens from the kit. When nothing fits, make a new kit component that follows this page, in the same PR as the screen that needs it.

## 1. Where it lives

| Folder | What goes there |
|---|---|
| `src/components/shared/` | Pieces the canvas uses, and pieces both the canvas and the manager use: overlays (`Popover`, `DropdownMenu`, `ContextMenu`, `tooltip.ts`, `ModalShell`) and canvas controls (`WpCheck`, `WpSelect`, `WpNumber`). |
| `src/manager/components/ui/` | Manager-only controls: `Button`, `Input`, `Select`, `Modal`, `Drawer` and the rest. |

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
- Today's Button (28/36/44), Input (38) and WpNumber (28) are not on this scale yet. The fix-up PRs move them onto it; new controls start on it.
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
- Icon-only buttons have an `aria-label`.
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
| Dialog | `Modal` (manager), `ModalShell` / `ConfirmDialog` (canvas) |

Anything that floats next to a trigger follows it when the page scrolls or resizes; a menu opened at the pointer closes on scroll. Never write another Teleport with its own placement maths, scroll handling or outside-click handler.

## 8. Canvas twins share a stylesheet

When the canvas needs its own version of a manager control (Button, Switch, Select, Number), both versions use the same stylesheet in `src/components/shared/`. A change to one then changes both. The kit shows each shared piece in both looks.

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
