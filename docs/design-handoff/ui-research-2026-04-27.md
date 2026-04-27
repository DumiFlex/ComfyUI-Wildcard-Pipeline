# Prototype UI Deep-Research — 2026-04-27

> Read-only audit. Working dir: `E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-WildcardPipeline`.
> Prototype source: `docs/design-handoff/wildcardpipeline/project/`.
> Vue port source: `src/manager/`.

## Summary

- **Primitives surveyed**: Button, Field/Input, Textarea, Select (custom), Checkbox, Toggle, Star, Chip, Tag input, Card, Toast, KindChip, TokenAutocomplete, ColorPicker, RuleCard/Branch, Matrix cell + tune popover, Hero, Stat card, Modal, Sticky footer, ModuleListView toolbar, syntax pills, autocomplete popup, RichText overlay, Pipeline step rows, Community card/featured/detail.
- **Major mismatches**: **15** (sort dropdown sized `sm` while Filters/Search are `md`, footer overlap from missing body padding, Rule card always-expanded, IdentityCard missing `varBinding` for derivations, "Tags" column rendered as `.wp-row-tag` (3px radius rectangles) instead of `.wp-chip` (999px pills), `Card` header padding mismatch, Categories has separate "New category" Card vs prototype expects an inline strip-style row but Vue actually matches mostly, etc.).
- **Quick wins**: **8** (drop `size="sm"` on Sort Select, add `padding-bottom: 96px` on `.wp-editor` (already present but needs fluff cleanup re: footer absolute pseudo-element), collapse Rule card by default, replace `.wp-row-tag` with `<Chip>`, raise `.wp-toolbar__search` `max-width` from 320 → 440 (already done in port, OK), align `.wp-page-toolbar__sort` width to `160px` matching prototype, restore `.wp-cat-chip` to use `wp-chip` 999px pill base, mount toast at `bottom-right` not top to match prototype).

---

## 1. Button

### Prototype spec (from `ui.jsx` 11–55 + `styles.css` 329–376)

| Variant | Look (real CSS) | Default size | Icon-only? |
|---|---|---|---|
| **default** (no variant prop) | `.wp-btn { height: var(--wp-btn-h); padding: 0 12px; border-radius: 7px; font-size: 12.5px; font-weight: 500; background: var(--wp-bg-3); color: var(--wp-text); border: 1px solid var(--wp-border); }` | 34px H · 12.5px font | yes via `.wp-btn--icon` |
| **primary** | `.wp-btn--primary { background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600)); border-color: var(--wp-accent-600); color: #fff; box-shadow: 0 0 0 1px color-mix(in oklab, var(--wp-accent-500) 40%, transparent) inset; }` | 34px / 12.5px | yes |
| **ghost** | `.wp-btn--ghost { background: transparent; border-color: transparent; color: var(--wp-text-muted); }` hover → `background: var(--wp-bg-3); color: var(--wp-text);` | 34px / 12.5px | yes |
| **outline** | `.wp-btn--outline { background: transparent; border: 1px solid color-mix(in oklab, var(--wp-accent-500) 40%, transparent); color: var(--wp-accent-text); }` | 34px / 12.5px | yes |
| **danger** | `.wp-btn--danger { color: var(--wp-danger); }` hover → `background: color-mix(in oklab, var(--wp-danger) 14%, transparent); border-color: color-mix(in oklab, var(--wp-danger) 40%, transparent); color: #fff;` | 34px / 12.5px | yes |
| **link** | *Not present in prototype* — Vue port adds `.wp-btn--link` (token line 407) | n/a | no |

**Note**: prototype's variant set in `ui.jsx` is `default | primary | ghost | outline | danger`. Vue's `Button.vue` adds `secondary` (alias of default) and `link` (new), and changes the default variant to `secondary`. Matches the prototype's "no variant => default look" semantics, but the explicit `secondary` name would not be referenced by any prototype CSS rule.

### Sizes

Prototype only defines two sizes:

```css
.wp-btn--sm { height: var(--wp-btn-h-sm); padding: 0 10px; font-size: 12px; border-radius: 6px; }
.wp-btn--icon { width: var(--wp-btn-h); padding: 0; }
.wp-btn--icon.wp-btn--sm { width: var(--wp-btn-h-sm); }
```

Tokens (`styles.css` 60–63):

```css
--wp-input-h:    34px;    --wp-input-h-sm: 28px;
--wp-btn-h:      34px;    --wp-btn-h-sm:   28px;
```

| Size | Height | Font | Radius |
|---|---|---|---|
| `sm` | 28px | 12px | 6px |
| `md` (default) | 34px | 12.5px | 7px |
| `lg` (Vue-port-only) | 40px | 13.5px | 8px (`tokens.css:419`) |

### Hover/active/disabled states

```css
.wp-btn:hover  { background: var(--wp-bg-4); border-color: var(--wp-border-strong); }
.wp-btn:active { transform: translateY(0.5px); }
.wp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-btn .pi, .wp-btn svg { font-size: 13px; }

.wp-btn--primary:hover {
  background: linear-gradient(180deg, var(--wp-accent-400), var(--wp-accent-500));
  border-color: var(--wp-accent-500);
}
.wp-btn--ghost:hover   { background: var(--wp-bg-3); color: var(--wp-text); }
.wp-btn--outline:hover {
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  color: var(--wp-accent-text-strong);
}
```

### Current Vue port deviation

- `Button.vue` defaults to `variant="secondary"`; prototype defaults to plain `wp-btn` (no modifier). Functionally identical because `.wp-btn--secondary` is an empty-rule alias (`tokens.css:406`). Cosmetic only.
- Adds `lg` size + `link` variant — extensions, not deviations.
- Adds `loading` prop with `pi-spinner` + `aria-busy`. Prototype has no loading state.
- All correct otherwise.

---

## 2. Select dropdown

### Prototype spec (from `ui.jsx` 207–286)

- Anchor: `<button type="button" class="wp-select wp-select--sm?">` — same `wp-select` rules as `.wp-input` → height = `var(--wp-input-h)` = 34px.
- Inline-style on the anchor: `display: inline-flex; align-items: center; gap: 6; justify-content: space-between; text-align: left`.
- Selected option label uses `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: selected ? var(--wp-text) : var(--wp-text-dim)">`.
- Caret: `<Icon name="pi-chevron-down" style="font-size: 11; color: var(--wp-text-dim)" />`.
- Optional leading `wp-chip__dot` swatch (8×8) when option carries a `dot` color (used for category Selects).
- Popup is **inline-styled** in the prototype (no `.wp-select__menu` class — Vue port introduced one, see token block at `tokens.css:1370`):

```js
{
  position: "absolute",
  ...(flip ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
  left: 0, right: 0,
  background: "var(--wp-bg-3)",
  border: "1px solid var(--wp-border-strong)",
  borderRadius: 7,
  boxShadow: "var(--wp-shadow-lg)",
  zIndex: 50,
  padding: 4,
  maxHeight: 240,
  overflow: "auto",
}
```

- Option row uses `.wp-list__row` (`styles.css:856–865`) + inline `padding: 6px 8px; border-radius: 6px`.
- Active-option style:
  ```
  background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent)
  color:      var(--wp-text)
  ```
- Selected indicator: trailing `<Icon name="pi-check" style="font-size: 11; color: var(--wp-accent-text)" />`.
- Position-aware flip: opens upward when `spaceBelow < need + 16 && spaceAbove > spaceBelow`, where `need = min(240, options.length * 30 + 12)` (`ui.jsx:223–225`).
- **Clearable**: when `allowClear` is true, the **first popup row** is a "Clear" entry (`<Icon name="pi-times-circle" /> Clear`) inside the menu. There is **no inline X on the anchor** in the prototype. Vue port shows an X chip on the anchor — **deviation**.
- Empty list message: prototype has none (the menu just renders zero options).

### Anatomy details

- Anchor padding (md): `0 10px` (inherited from `.wp-input` rule `styles.css:382–388`); 0 8px for `--sm`.
- Anchor radius: `7px` (token `--wp-radius`-ish, but explicit in `.wp-input`).
- Anchor border: `1px solid var(--wp-border)`.
- Anchor focus: `border-color: var(--wp-accent-500); box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 25%, transparent); background: var(--wp-bg-1);` (`styles.css:400–406`).
- Option padding: `6px 8px` (inline) — but the rendered effective height is ~30px because of inherited line-height.
- Option border-radius: `6px`.
- Active-while-keyboard-nav: same accent overlay as selected; prototype binds `setActive` only on `onMouseEnter`. **No keyboard nav implementation in prototype** — selecting via keyboard is not wired. Vue port adds Up/Down/Enter/Esc, which is an **upgrade**, not a regression.

### Current Vue port deviation

| Aspect | Prototype | Vue (`Select.vue` + `tokens.css:1370`) | Severity |
|---|---|---|---|
| **Sort dropdown sizing in toolbar** | `<Select>` md (34px) | `<Select size="sm">` (28px) at `ModuleListView.vue:348` | **HIGH** — visual mismatch with 38px Filters button + 38px Search input |
| Anchor "Clear" affordance | Clear is *first row of popup* | X chip rendered on anchor *next to* selected label | Medium — different UX |
| Popup background | `var(--wp-bg-3)` (`#1c1c28`) | `var(--wp-bg-3)` (matches) | OK |
| Popup option radius | `6px` | `6px` | OK |
| Selected highlight | `accent-500 @ 16%` | `accent-500 @ 16%` (`tokens.css:1408`) | OK |
| Highlighted-via-keyboard | not implemented | `accent-500 @ 18%` | OK addition |
| Has `wp-select__menu`/`__option` classes | NO (inline styles) | YES | OK / cleaner |
| Caret rendering | inline `pi-chevron-down` | `class="wp-select__chevron"` | OK |
| Position flip math | `min(240, opts*30+12)` | identical (`Select.vue:57`) | OK |
| `clearable` re-emits `null` | yes via menu Clear row | yes via inline X | OK |

**Sort-dropdown sizing root cause** (per user pain point): `ModuleListView.vue:348` passes `size="sm"`, which adds `wp-select--sm` → `tokens.css:454` clamps to `var(--wp-input-h-sm)` = **28px**. The Filters button next to it is `<Button>` md = **34px** in dark theme, but the **toolbar** itself sits at the page-toolbar density which the port has shifted using inline styles (the toolbar Search input via `.wp-input-group` at `tokens.css:478` is **34px**). At the same time the picker-modal's input-group is overridden to **38px** (`tokens.css:2275–2287`). Three different heights coexist in the same toolbar in the worst case (28 / 34 / 38). Drop `size="sm"` on the sort select to bring it back to 34px, matching the Filters button + Search input. (Prototype confirms this at `lists.jsx:122`: `<div style={{ width: 160 }}><Select value={sort} … /></div>` — no `size` prop.)

---

## 3. Chips

### Prototype variants (`styles.css` 452–472)

```css
.wp-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  border: 1px solid var(--wp-border);
  white-space: nowrap;
  font-weight: 500;
}
.wp-chip--accent {
  color: var(--wp-accent-text-strong);
  background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
}
.wp-chip--success { color: #86efac; background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.32); }
.wp-chip--warn    { color: #fcd34d; background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.32); }
.wp-chip--danger  { color: #fca5a5; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.32); }
.wp-chip__dot     { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
```

- Tones: `default | accent | success | warn | danger` (no `info` in prototype — Vue port adds it at `tokens.css:555`).
- `<Chip onClose>` renders a trailing `pi-times` (9px font, `cursor: pointer`, `marginLeft: 2`). Inline-styled, no class.
- Density: padding 2/8, height ≈ 18px after font + line-height, radius 999.
- A **freeform color** Chip is supported by passing a `color` prop. It computes:
  ```
  color: <c>
  background: color-mix(in oklab, <c> 14%, transparent)
  borderColor: color-mix(in oklab, <c> 35%, transparent)
  ```
  This is the rendering used for Category chips in the Wildcards table (`lists.jsx:367`).

### Comparison vs Tag chip / Pill / Cat-chip

The prototype has only **one** chip primitive (`.wp-chip`). Distinct concepts:

- **Tag chip** in *prototype*: not a separate class. The filter panel renders inactive tags with `<button class="wp-chip">` and toggles `data-active=""` to swap colors via inline style overrides (`lists.jsx:167–183`). So tag-pills are just `wp-chip`.
- **Pill** (`.wp-pill`): not present in prototype `styles.css`. **Pill is a Vue-port invention** at `tokens.css:510–533`. It mirrors `.wp-chip` but with `padding 1px 8px`, `font-weight 600`, `letter-spacing 0.02em`, and a built-in `.wp-pill__count` slot.
- **Cat-chip** (`.wp-cat-chip`): not a class in prototype CSS. The Wildcards table uses `<Chip color={c.color}>` (`lists.jsx:367`). The Vue port has invented a `.wp-cat-chip` class used inline at `Wildcards.vue:255–260` with `:style="{ background: cat.color }"` and the Categories screen reuses the same idea on `.wp-cat-name` (Categories.vue:291–305).
- **Syntax pill** (`.wp-syntax-pill`, `styles.css:538–570`): a separate primitive — height 20px, mono font, border-radius 999, used for `outgoing/incoming/inline` reference indicators on the Wildcards row. Distinct from `.wp-chip`.
- **Visual hierarchy**: chip (mute, neutral) → chip with tone (semantic) → chip-with-color (categorical) → syntax pill (mono, semantic, fixed-height row insert) → kbd (mono, shadow). The prototype keeps **one base** and modifies via tone/color/data attribute. The Vue port has fragmented this into three+ classes (`.wp-chip`, `.wp-pill`, `.wp-cat-chip`, `.wp-tag-chip`, `.wp-row-tag`, `.wp-syntax-pill`, `.wp-filter-toggle`), several of which are not in the prototype CSS.

**When to use which** (recommendation):

| Concept | Prototype | Vue port today | Suggested |
|---|---|---|---|
| neutral tag in a row | `<Chip>tag</Chip>` (radius 999, 11px, bg-3) | `.wp-row-tag` rectangle (3px radius, 10px font) at `ModuleListView.vue:727–733` | **Replace `.wp-row-tag` with `<Chip>`** to match prototype `lists.jsx:289–293` |
| semantic state (success/warn/error) | `<Chip variant="…">` | `<Pill tone="…">` | **Use Chip**, retire Pill, or keep Pill as alias |
| count badge | `<Chip>+{N}</Chip>` | `<Pill :count>` | Either is fine |
| free-color category | `<Chip :color>` | `.wp-cat-chip` inline-styled | Keep, but base it on `.wp-chip` tokens |
| toggle filter (extra-filter row) | `<button class="wp-chip" data-active="">` | `.wp-filter-toggle` (radius 11px, padding 3/10) | Restore to `.wp-chip` with `data-active` |

### Current Vue port deviation

- **Tag rendering inside list rows differs**: prototype renders `<Chip key={t}>{t}</Chip>` (11px font, pill radius, bg-3) at `lists.jsx:290`. Vue uses `.wp-row-tag` rectangles at `ModuleListView.vue:487`. Mismatch — pill loses its identity.
- `.wp-filter-toggle` is a Vue-port-specific class with 11px radius (`ModuleListView.vue:625`); prototype uses `.wp-chip` with `data-active=""` (`lists.jsx:194–211`).
- `.wp-pill` (`tokens.css:510`) is not in the prototype.
- Chip primitive itself is correct (`Chip.vue` renders `wp-chip` + `wp-chip--<tone>`). `info` tone added is OK.

---

## 4. Pills (`.wp-pill`, `.wp-syntax-pill`)

`.wp-pill` is **not in `styles.css`**. The only "pill"-style classes the prototype defines are:

- `.wp-syntax-pill` (`styles.css:538–570`): mono, height 20, padding 0/6, radius 999, font 10.5px, weight 600. Three modifiers (`--ref`, `--in`, `--dp`) for outgoing/incoming/dp-brace. `.pi { font-size: 9.5px }`.
- `.wp-id` (`styles.css:618–623`): mono inline label (10.5px, `--wp-text-dim`), used for module IDs.
- `.wp-kbd` (`styles.css:474–483`): shadow keycap (mono, 11px, 4px radius, 1px+2px-bottom border).
- `.wp-syntax-link` (`styles.css:589–616`): clickable graph-edge link inside row-expand (radius 999, 1/8 padding).

Border-radius variation in prototype:

| Use | Radius | When |
|---|---|---|
| `.wp-chip`, `.wp-syntax-pill`, `.wp-syntax-link`, `.wp-cat-chip-style` | **999px** | True pills/chips |
| `.wp-input` `.wp-select` `.wp-btn` | **7px** | Form controls (md) |
| `.wp-btn--sm` `.wp-cat-strip` etc. | **6px** | Form controls (sm), small icon-buttons |
| `.wp-card` `.wp-stat` | **var(--wp-radius-lg) = 12px** | Surfaces |
| `.wp-hero` | **var(--wp-radius-xl) = 16px** | Big hero panels |
| `.wp-kbd` `.wp-token-…` `.wp-rt-var` | **3–4px** | Inline tokens in code |
| `.wp-table-wrap` | **12px** outer | Surface |
| **NEVER 11px or 9px** in prototype | — | The Vue port introduced 11px on `.wp-filter-toggle`. There is no `9px` radius value in prototype either. |

**Pill differences from Chip**: the Vue port's `.wp-pill` has `font-weight 600` + `letter-spacing 0.02em` + `padding 1px 8px` and a built-in `__count` slot with a `border-left: 1px solid currentColor` divider. None of that exists in the prototype. The prototype achieves the same visual using `.wp-chip` + custom inline-style spans.

---

## 5. Filter chip / toggle (`.wp-filter-toggle`)

**Not present in the prototype CSS.** The Vue port invented this class at `ModuleListView.vue:620–646`:

```css
.wp-filter-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  border-radius: 11px;          /* ← non-standard radius */
  font-size: 11.5px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);   /* ← prototype uses bg-3 */
  color: var(--wp-text-muted);
  cursor: pointer;
}
.wp-filter-toggle[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
```

Prototype equivalent (`lists.jsx:185–211`) is just `<button class="wp-chip" data-active>`:

```jsx
<button
  type="button"
  className="wp-chip"
  data-active={active ? "" : null}
  style={{
    cursor: "pointer",
    background: active ? "color-mix(in oklab, var(--wp-accent-500) 22%, transparent)" : undefined,
    borderColor: active ? "color-mix(in oklab, var(--wp-accent-500) 45%, transparent)" : undefined,
    color: active ? "var(--wp-accent-text)" : undefined,
  }}
>
  {f.label}
  <span className="wp-dim" style={{ marginLeft: 4, fontSize: 10.5 }}>{count}</span>
</button>
```

So same visual concept, different class. Prototype's effective height (chip): ~18–19px; Vue port's `.wp-filter-toggle` is ~22–23px (taller because of `padding: 3px 10px` and `font-size: 11.5px`).

### Vs `.wp-tag-chip` and `.wp-chip`

`.wp-tag-chip` is also a Vue-port invention (`Wildcards.vue:347–351` / scoped). It styles its `data-active="true"` state but inherits its base look from the global `.wp-chip` — i.e. the markup is `class="wp-tag-chip"` but the active-state CSS is targeted as `.wp-tag-chip[data-active="true"]`. Without the base `.wp-chip` class on the same element it loses the `border-radius: 999px`, `padding: 2px 8px`, `font-size: 11px`. Test by inspecting `Wildcards.vue:208–217` — the button has only `class="wp-tag-chip"` so the inactive state is **un-styled** unless something else paints it. Likely a regression.

---

## 6. Category chip (`.wp-cat-chip`)

**Not a defined class in the prototype.** Categories are rendered via the generic `<Chip color={cat.color}>{cat.name}</Chip>` at `lists.jsx:367` and `editors.jsx`/utilities.jsx via the same `Chip` primitive. The component (`ui.jsx:323–337`) sets:

```js
{
  color: c,
  background: `color-mix(in oklab, ${c} 14%, transparent)`,
  borderColor: `color-mix(in oklab, ${c} 35%, transparent)`,
}
```

So:

- **Background** = `color @ 14%` (semi-transparent tint, NOT solid color).
- **Text color** = the raw category color (assumed contrast-safe against the muted bg).
- **Border** = `color @ 35%`.
- **Radius** = inherits `.wp-chip`'s `999px` (full pill).
- **No text-shadow** in the prototype.

The Vue port (`Wildcards.vue:254–260`) does it differently:

```html
<span
  class="wp-cat-chip"
  :style="{ background: categoryById.get(row.category_id)!.color || 'var(--wp-bg-3)' }"
>
```

…with `background = the raw color` (solid, fully opaque) and no text color management. There's no `.wp-cat-chip` rule defined in `tokens.css` either — so the element gets browser default styling unless rendered alongside a sibling rule. On `Categories.vue:291–305` `.wp-cat-name` defines:

```css
display: inline-flex; align-items: center;
padding: 3px 9px;
border-radius: 999px;
color: #fff;
font-size: 12px;
font-weight: 500;
text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
```

This is closer but still uses solid background + white text + text-shadow (none of which the prototype has).

### Different from `.wp-chip`?

- **In prototype: identical** (`<Chip color>` is `.wp-chip` with inline color styles).
- **In Vue port**: different (solid color background, white text, optional text-shadow, 9px padding instead of 8). Effectively a mini-pill.

### Current Vue port deviation

- Background should be `color @ 14%` (transparent tint), not solid.
- Text color should be the category's color, not `#fff`.
- Text-shadow should be removed.
- Border should be `color @ 35%`.
- Radius should remain 999.

---

## 7. Categories screen UI

Compare prototype's `CategoriesScreen` (utilities.jsx:40–123) vs `src/manager/views/Categories.vue`.

| Element | Prototype | Current Vue port | Diff |
|---|---|---|---|
| Page wrapper | `<div class="wp-page wp-page--fill">` | `<div class="wp-page wp-page--fill wp-cat-page">` with **scoped extra padding** `padding: 18px 22px 40px; max-width: 1200px; margin: 0 auto;` (Categories.vue:252) | Vue port double-pads (the `.wp-page` rule already does this in `tokens.css:296`). Could double-margin. |
| New category card layout | `<Card title="New category">` containing `<div style="display:flex; gap:12; align-items:flex-end; flex-wrap:wrap">` with: Name field (flex:1, min-width:200), Color field, Add button | Same structure via `.wp-cat-newrow` (Categories.vue:254–260) — **matches** | OK |
| Category table | `<table class="wp-table wp-table--sticky-head">` with cols: Name, Color (width 360), Modules (width 110), Actions (width 110, right) | Cols: Name, Color (240px), **Sort (90px — extra)**, Modules (90px), Actions (80px right) | Vue port adds a **Sort** column for `sort_order`. Prototype has no sort column. Width differs (240 vs 360 for Color). |
| Color cell | View: `<span class="wp-mono wp-dim" font-size 11.5>{c.color}</span>` (just the hex). Edit mode: `<ColorField>` (swatch + hex input + 8-color palette) | Always shows `<ColorPicker>` swatch + hex right next to it (`wp-cat-color`). | Vue port shows the picker inline at all times (no view/edit mode). Works but is busier. Different: prototype uses inline-edit pattern (one row at a time), Vue lets you change colors directly without click-to-edit. |
| Inline name edit | View: `<Chip color={c.color}>{c.name}</Chip>`. Edit mode (after pencil): `<Input>` with autoFocus + Enter to save | View: `<span class="wp-cat-name" :style="{ background: row.color }">{name}</span>` clickable to enter edit. Edit: `<Input>` with Enter/Esc/blur to save. | **OK** UX, but the rendered chip is different (see §6 — solid bg + white text + text-shadow vs prototype's tinted Chip). |
| Sort cell | n/a | `<Input type="number" size="sm" :model-value="row.sort_order">` blurs to commit | Extra in Vue port. |
| Modules count | `<td class="wp-mono">{count}</td>` raw mono number | `<span class="wp-cat-count">{moduleCount}</span>` styled as a pill with bg-3, 999 radius, padding 0/8 | Vue port turns the number into a pill — visually busier. |
| Empty state | `<div class="wp-empty"><div class="wp-empty__icon"><Icon name="pi-bookmark"/></div><div class="wp-dim">No categories yet.</div></div>` (no CTA) | Same icon + `wp-dim` text (no CTA) | OK |
| Edit button | Pencil button per row to enter edit mode (sets `editing = {id, name, color}`) | Click directly on the chip name to inline-edit; **no pencil button** | Vue port skips the explicit pencil. Works but discoverability suffers. |
| Save/cancel buttons in edit mode | Two icon buttons in Actions cell: `<Button size="sm" variant="primary" icon="pi-check">` + `<Button size="sm" variant="ghost" icon="pi-times">` | Implicit (Enter / Esc / blur) — no explicit save/cancel buttons | Different UX. Vue is faster but less affordant. |

**Class names in prototype**:

```jsx
<div className="wp-page wp-page--fill">
  <PageHeader title="Categories" subtitle="…" />
  <Card title="New category">…</Card>
  <div className="wp-table-wrap wp-table-wrap--scroll">
    <table className="wp-table wp-table--sticky-head">…</table>
  </div>
</div>
```

**Structural mismatch**: Vue port adds a `Sort` column + inline color picker + module-count pill. Prototype keeps it minimal: name chip, hex string, count, action icons. Recommend **moving Sort to a drag-handle column instead of a numeric input** to match `Pipeline` step rows pattern (see §15).

---

## 8. Card

### Prototype spec (`ui.jsx:370–384` + `styles.css:316–327`)

```css
.wp-card {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);    /* 12px */
}
.wp-card__header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  display: flex; align-items: center; gap: 10px;
}
.wp-card__title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-muted);
  margin: 0;
  font-weight: 600;
}
.wp-card__body { padding: 14px; }
```

Component renders:

```jsx
<div className="wp-card">
  {title && (
    <div className="wp-card__header">
      <h3 className="wp-card__title">{title}</h3>
      <div className="wp-spacer" />
      {action}
    </div>
  )}
  <div className={padded ? "wp-card__body" : ""}>{children}</div>
</div>
```

So `padded={false}` removes the inner padding entirely (used by Dashboard's Recent Edits list).

### Hover/click states

- Prototype `.wp-card` has **no** `:hover` rule. Static surface.
- `.wp-stat` (Dashboard stat card) is also static at the rule level (`styles.css:826–854`); the prototype only adds `cursor: pointer` inline when the card is keyboard-navigable (Dashboard.jsx:37).
- Cards inside the Discover screen have hover-lift (`.wp-comm-card:hover`, `styles-community.css:83–87`):
  ```css
  transform: translateY(-1px);
  border-color: var(--wp-border-strong);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  ```
- Featured (`.wp-comm-feat:hover`, `styles-community.css:34`): `transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35);`.

### Current `Card.vue` deviation

- Adds `subtitle` prop + `.wp-card__title-wrap` (`tokens.css:350`) + `.wp-card__subtitle` block. Prototype has no subtitle in Card — uses `.wp-page__subtitle` at the page level only. Cosmetic addition.
- `slots.actions` rendered after a `<span class="wp-spacer" />`. Matches prototype.
- `padding` prop default `true`; matches `padded` prop in prototype.
- Header padding: prototype `12px 14px`; tokens.css value: `12px 14px` — matches.
- Body padding: prototype `14px`; tokens.css `14px` — matches.
- No hover on `.wp-card`. Same as prototype.

**OK as-is.**

---

## 9. ModuleListView toolbar (Search / Filters / Sort)

### Prototype CSS

The prototype's toolbar is a single flex row:

```css
.wp-toolbar {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
}
.wp-toolbar__search { flex: 1; min-width: 220px; max-width: 320px; }
.wp-toolbar__count  { font-size: 11.5px; color: var(--wp-text-dim); margin-left: auto; }
```

Markup (`lists.jsx:111–135`):

```jsx
<div className="wp-toolbar">
  <div className="wp-toolbar__search">
    <div className="wp-input-group">
      <span className="wp-input-group__addon"><Icon name="pi-search" /></span>
      <input className="wp-input" placeholder="Search by name, id, tag…" … />
    </div>
  </div>
  <Button variant={filtersOpen ? "outline" : "default"} icon="pi-filter" …>
    Filters {activeFilterCount > 0 ? <span className="wp-chip" style={{ padding: "0 6px", marginLeft: 2 }}>{n}</span> : null}
  </Button>
  <div style={{ width: 160 }}>
    <Select value={sort} … />
  </div>
  <span className="wp-toolbar__count">{filtered.length} / {items.length} items</span>
</div>
```

| Element | Height | Font | Border-radius | Border |
|---|---|---|---|---|
| Search `wp-input-group` (md) | **34px** (`var(--wp-input-h)` `styles.css:425`) | 12.5px | 7px | 1px solid var(--wp-border) |
| Filters `<Button>` (no `size`) | **34px** (`var(--wp-btn-h)`) | 12.5px | 7px | 1px solid var(--wp-border) |
| Sort `<Select>` (no `size`, width `160`) | **34px** (`var(--wp-input-h)`) | 12.5px | 7px | 1px solid var(--wp-border) |

All three at the **same** 34px height in the prototype. Active filter count rendered inline as a `<span class="wp-chip" style="padding: 0 6px; margin-left: 2;">N</span>`.

### Current Vue port heights

From `ModuleListView.vue:325–350`:

| Element | Vue height | Source |
|---|---|---|
| Search `wp-input-group` | **34px** | `tokens.css:478` `.wp-input-group { height: var(--wp-input-h); }` |
| Filters `<Button>` (no size prop) | **34px** | `tokens.css:362` `.wp-btn { height: var(--wp-btn-h); }` |
| Sort `<Select size="sm">` | **28px** ⚠ | `tokens.css:454` `.wp-input--sm, .wp-select--sm { height: var(--wp-input-h-sm); }` |
| Width of sort container | 180px | `ModuleListView.vue:580` `.wp-page-toolbar__sort { width: 180px; }` |

### Source of the size mismatch

The line `<Select v-model="sortBy" :options="SORT_OPTIONS" aria-label="Sort" size="sm" />` at `ModuleListView.vue:348` clamps the sort dropdown to **28px** while everything else in the row is **34px**.

**Fix**: drop `size="sm"` (and `size="sm"` on the per-page Select at line 535 if you want same density there too — prototype uses md there as well, `lists.jsx:327–331`).

Active-count badge: prototype uses `.wp-chip` (radius 999, fits inside button line-height); Vue port uses `.wp-filter-count` (`ModuleListView.vue:582–594`) — a 18×18 circle filled with `var(--wp-accent-500)` and white text. **Visual mismatch**: prototype's badge is a low-key chip, Vue's is a loud accent-filled pill.

---

## 10. Editor footer (sticky Cancel/Save)

### Prototype footer (`styles.css:885–905`)

```css
.wp-footer-bar {
  position: sticky; bottom: 0;
  margin-top: auto;
  background: var(--wp-bg);
  border-top: 1px solid var(--wp-border);
  padding: 12px 0;
  display: flex; justify-content: flex-end; gap: 8px;
  z-index: 5;
}
.wp-footer-bar::before {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 100%;
  height: 20px;
  background: linear-gradient(180deg, transparent, var(--wp-bg));
  pointer-events: none;
}
.wp-footer-bar__inner {
  display: contents;
}
```

Markup (`editors.jsx:101–122`):

```jsx
<div className="wp-page" style={{ maxWidth: 980 }}>
  <button className="wp-breadcrumb" …>…</button>
  <div className="wp-page__header">…</div>
  {children}
  <div className="wp-footer-bar">
    <div className="wp-footer-bar__inner">
      {hasHistory && <Button icon="pi-history">…</Button>}
      <div style={{ flex: 1 }} />
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" icon="pi-check" onClick={onSave}>Save</Button>
    </div>
  </div>
</div>
```

**Mechanics**:

- Footer height = `var(--wp-btn-h)` (34px) + `12px × 2` padding = **58px** total.
- The `::before` pseudo-element provides a 20px **top fade** so content scrolling underneath is visually softened.
- `position: sticky; bottom: 0` requires the **scrolling parent** to be the `.wp-content` (`styles.css:264-270`), not the page itself.
- Prototype `.wp-page` has `min-height: 100%` and `display: flex; flex-direction: column`. The footer's `margin-top: auto` shoves it to the bottom of the page; while scrolling, sticky pins it at viewport bottom.
- **Body padding-bottom**: there is no explicit `padding-bottom` on `.wp-page` for editors — the prototype relies on `margin-top: auto` pushing the footer flush against the next-to-last child. Because the footer has `padding: 12px 0` and no `position: absolute`, content above is naturally pushed up. There is **no overlap in the prototype** because the footer's height takes its own row in normal flow before sticky activates.
- **However**, the `::before` fade is positioned `bottom: 100%; height: 20px` — it only paints **above** the footer, not into it. So the fade is visible at the seam where content meets footer.

### Current Vue port deviation

`EditorFrame.vue` body styles (lines 109–124):

```css
.wp-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 96px;   /* present */
}
```

So the port **does** add `padding-bottom: 96px`. Why does the user see overlap?

Likely causes (worth verifying live):

1. **Inner content scroll**: `.wp-page--fill > .wp-table-wrap--scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }` (`tokens.css:310–314`). Combined with `wp-editor`'s `padding-bottom: 96px` on the *outer* page, **the inner scroll container does not get the 96px buffer**. If the editor uses `wp-page--fill` (it does — `EditorFrame.vue:58`) and an inner scrollable area exists (e.g. the `Card` containing the rule list expands beyond viewport), then the table-wrap-scroll's last row sits flush against viewport bottom and the sticky footer paints over it.
2. The `position: sticky` footer needs the scroll container's height to be reduced so its content can be scrolled into view above the sticky element. With `padding-bottom: 96px` on `.wp-editor` (the flex child) + `wp-page--fill` height: 100% with overflow: hidden on the parent, the padding affects the wrong axis.
3. `EditorFrame` lacks the `::before` fade gradient that styles.css defines globally — but the global rule should cover it.

**Recommended fix**: move `padding-bottom: 96px` to **the closest scrolling container** (i.e., on `.wp-page--fill` itself or on the wrapping `.wp-content` that scrolls). For editors that use plain (non-fill) pages, keep on `.wp-editor`. Alternatively, switch the footer from `position: sticky` to `position: fixed; bottom: 0; left: var(--wp-sidebar-w); right: 0` to mirror native PrimeVue toolbar pattern — but that requires sidebar-aware layout.

Footer height in port: same 58px (token unchanged).

---

## 11. Derivation rule card

### Prototype rule (editors.jsx:565–636 + styles.css:657–768)

The prototype renders **always-expanded** cards with a flat IF/ELIF/ELSE branch list. There is **no collapsed state** in the prototype.

```jsx
<div className="wp-rule wp-rule--group">
  <div className="wp-rule__head">
    <span className="wp-rule__num">RULE</span>
    <span className="wp-rule__index">#{ri + 1}</span>
    <div className="wp-spacer" />
    <Button size="sm" variant="ghost" icon="pi-arrow-up"   disabled={ri === 0} onClick={…} />
    <Button size="sm" variant="ghost" icon="pi-arrow-down" disabled={…}        onClick={…} />
    <Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" disabled={v.rules.length === 1} onClick={…} />
  </div>

  <div className="wp-rule__branches">
    {rule.branches.map((b, bi) => (
      <div key={bi} className="wp-branch">
        <div className="wp-branch__head">
          <span className="wp-branch__tag" data-kind={bi === 0 ? "if" : "elif"}>{bi === 0 ? "IF" : "ELIF"}</span>
          <div className="wp-spacer" />
          {bi > 0 && <Button size="sm" variant="ghost" icon="pi-times" className="wp-btn--danger" onClick={…} />}
        </div>
        <div className="wp-rule__row">
          <span className="wp-rule__label">When</span>
          <ConditionRow … />
        </div>
        <div className="wp-rule__row">
          <span className="wp-rule__label">Then</span>
          <ActionRow … />
        </div>
      </div>
    ))}
    {rule.hasElse && (
      <div className="wp-branch wp-branch--else">…</div>
    )}
  </div>

  <div className="wp-rule__addbar">
    <Button size="sm" variant="ghost" icon="pi-plus" onClick={…}>Add elif</Button>
    {!rule.hasElse && <Button size="sm" variant="ghost" icon="pi-plus" onClick={…}>Add else</Button>}
  </div>
</div>
```

CSS (`styles.css:657–768`):

```css
.wp-rule {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md);   /* not defined ! See §16 */
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.wp-rule__head { display: flex; align-items: center; gap: 8px; }
.wp-rule__num {
  font-family: var(--wp-font-mono);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em;
  padding: 2px 8px; border-radius: 4px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
}
.wp-rule__index { font-size: 11px; color: var(--wp-text-dim); font-variant-numeric: tabular-nums; }
.wp-rule__row {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  align-items: center;
}
.wp-rule__label {
  font-size: 11.5px; color: var(--wp-text-muted);
  text-transform: uppercase; letter-spacing: 0.04em; font-weight: 500;
}
.wp-rule__cond { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wp-rule--group {
  border: 1px solid var(--wp-border-strong);
  background: var(--wp-bg-1);
  padding: 12px;
}
.wp-rule--group .wp-rule__num {
  background: color-mix(in oklab, var(--wp-accent-500) 24%, transparent);
}
.wp-rule__branches {
  display: flex; flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid color-mix(in oklab, var(--wp-accent-500) 30%, transparent);
}
.wp-branch {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.wp-branch__head { display: flex; align-items: center; gap: 8px; }
.wp-branch__tag {
  font-family: var(--wp-font-mono);
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  padding: 2px 7px; border-radius: 4px; text-transform: uppercase;
}
.wp-branch__tag[data-kind="if"]   { background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent); color: var(--wp-accent-text); }
.wp-branch__tag[data-kind="elif"] { background: color-mix(in oklab, var(--wp-info,#60a5fa) 22%, transparent); color: var(--wp-info,#60a5fa); }
.wp-branch__tag[data-kind="else"] { background: color-mix(in oklab, var(--wp-warn) 22%, transparent); color: var(--wp-warn); }
.wp-branch--else { border-style: dashed; }
.wp-rule__addbar { display: flex; gap: 6px; margin-top: 8px; padding-left: 12px; }
```

**Branch row layout**:

- Each branch is a 10×12 padded panel inside the rule's `2px` accent left-border container.
- `When` / `Then` labels in 64px cells.
- Condition row uses `<div class="wp-input-group">` with `@` addon + input for the variable name + `<Select>` for op + `<Input>` for value.
- Action row uses `<Select>` for kind, `<Select>` for target, `<Input>` for value.

**No collapse mechanism** — every rule expands every branch all the time. With many rules + many ELIFs the editor gets tall (each branch ≈ 100px; rule with `IF + 2 ELIF + ELSE` is ~440px tall; 6 such rules = 2640px page). The user's "too big / no collapsing" complaint is **valid** in absolute terms but is **faithful to prototype behavior**.

Default = expanded. Height per single-branch rule with no condition value: `~145px`; with `IF + ELSE`: `~245px`; with `IF + ELIF + ELSE`: `~345px`.

### Compare to current `DerivationRuleCard.vue`

Differences (`DerivationRuleCard.vue` 153–326):

- **Markup wrapped in `<Card>`**: prototype uses raw `.wp-rule.wp-rule--group`. Vue uses `Card` primitive with no header (passes children directly), losing the `.wp-rule--group` background+padding+border-strong rule. The scoped `derivation-rule-card { border-left: var(--wp-kind-stripe-w) solid var(--wp-kind-derivation, #fbbf24); background: var(--wp-bg, #1e1e22); }` reads instead — different visual.
- **Header pill uses `<Pill tone="info">Rule {n}</Pill>`** at line 156. Prototype uses `.wp-rule__num` (mono caps "RULE" badge in accent color) + `.wp-rule__index` "#1". Vue replaces both with one info-toned pill — different look.
- **Adds a "branchCount" meta line** (`{n} branches + ELSE`) — not in prototype.
- **Move-up/move-down buttons missing** from header.
- **Action row split into TWO rows** (target+mode on one row, then a separate `value` row with `<Textarea :rows="2" auto-resize>`):
  ```html
  <div class="row row--textarea">
    <span class="row-label">Value</span>
    <Textarea :model-value="branch.action.value" :rows="2" auto-resize ...>
  </div>
  ```
  Prototype uses a single row with `<Input>` for value (one-line, no textarea). Effect: each branch is **~50px taller** in Vue port due to the textarea row.
- **Row label cell width**: Vue uses `grid-template-columns: 56px 1fr` (line 397) vs prototype `64px 1fr`. Minor.
- **Condition variable input**: Vue uses plain `<Input>` with `placeholder="$variable"`. Prototype uses an `<div class="wp-input-group"><span class="wp-input-group__addon">@</span><Input mono></div>` — note the `@` prefix because the prototype models conditions as `@var contains "x"`, not `$var equals "x"`. This is a **schema mismatch**, not just visual.
- **Op options**: Prototype has `contains | equals | matches | absent | always` (5). Vue port has `equals | not_equals | contains | matches` (4). Different semantics — Vue lacks `absent` and `always` (no condition).
- **Action target options**: Prototype uses fixed list `subject | scene | prompt | negative` (clauses of the prompt). Vue uses freeform `target_var` text input. Different model.
- **Action mode options**: Vue has `replace | append | prepend` (3). Prototype has `append | prepend | replace | remove` (4) — Vue lacks `remove`.
- **No collapse toggle**: same as prototype. User's pain ("no collapsing") is therefore a request for a new feature, not a regression.

### Recommendations

1. Add a header chevron + click-to-collapse on the rule. Default to collapsed when `rules.length > 2`.
2. Show a one-line summary in collapsed state: `IF $var op "value" THEN action target` + `(N branches + ELSE)` count.
3. Use a single-line `<Input>` for action value, not a 2-row textarea. Wrap with autocomplete (`TokenAutocomplete`) for `$var` references.
4. Add move-up/move-down buttons.
5. Replace `<Pill>Rule N</Pill>` with `.wp-rule__num` "RULE" + `.wp-rule__index` "#N".
6. Reconcile op/action/target schemas with prototype's clause-targeted model OR document the deliberate difference.

---

## 12. Community card hover + dropdown patterns

### Featured card (`styles-community.css:6–46`)

```css
.wp-comm-featured__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}
.wp-comm-feat {
  position: relative; min-height: 160px;
  border-radius: var(--wp-radius-lg);
  border: 1px solid var(--wp-border);
  padding: 0; overflow: hidden;
  cursor: pointer; text-align: left;
  color: #fff;
  transition: transform .15s ease, box-shadow .15s ease;
}
.wp-comm-feat::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.65) 100%);
  pointer-events: none;
}
.wp-comm-feat:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
.wp-comm-feat__inner {
  position: relative; z-index: 1;
  height: 100%; padding: 14px;
  display: flex; flex-direction: column; justify-content: space-between;
  gap: 10px;
}
.wp-comm-feat h3 { margin: 0; font-size: 16px; font-weight: 700; }
.wp-comm-feat p  { margin: 0; font-size: 12px; color: rgba(255,255,255,0.84); }
.wp-comm-feat__stats { display: flex; gap: 10px; font-size: 11px; color: rgba(255,255,255,0.92); }
```

### Discover card grid (`styles-community.css:67–135`)

```css
.wp-comm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.wp-comm-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  border-radius: var(--wp-radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease;
  text-align: left;
}
.wp-comm-card:hover {
  transform: translateY(-1px);
  border-color: var(--wp-border-strong);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
}
.wp-comm-card__hero { position: relative; height: 100px; display: flex; align-items: flex-start; justify-content: space-between; padding: 8px; }
.wp-comm-card__kind {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px;
  background: rgba(0,0,0,0.42);
  border: 1px solid rgba(255,255,255,0.16);
  color: #fff; font-size: 10px; font-weight: 600;
}
.wp-comm-card__nsfw    { background: rgba(190, 18, 60, 0.85); border-color: rgba(255,255,255,0.2); }
.wp-comm-card__incompat { background: rgba(245, 158, 11, 0.85); border-color: rgba(255,255,255,0.2); margin-left: 4px; }
.wp-comm-card__body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.wp-comm-card__title-row { display: flex; align-items: flex-start; gap: 6px; }
.wp-comm-card__title { margin: 0; flex: 1; font-size: 14px; font-weight: 700; line-height: 1.25; }
.wp-comm-card__tagline {
  margin: 0; font-size: 12px; color: var(--wp-text-muted); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wp-comm-card__stats {
  display: flex; gap: 10px; font-size: 11px; color: var(--wp-text-muted);
  align-items: center; padding-top: 4px;
  border-top: 1px solid var(--wp-border);
}
.wp-comm-card__tags { display: flex; flex-wrap: wrap; gap: 3px; }
```

Discover card structure (`community.jsx:197–230`):

- Hero (100px, gradient bg) → kind badge top-left + NSFW/incompat top-right.
- Body: title row (h3 + star), 2-line clamped tagline, author row, stats row (icons + numbers).

### Detail card (`styles-community.css:147–213`)

```css
.wp-comm-detail-hero {
  position: relative;
  border-radius: var(--wp-radius-lg);
  border: 1px solid var(--wp-border);
  overflow: hidden;
  color: #fff;
  margin-bottom: 12px;
}
.wp-comm-detail-hero::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.55) 100%);
}
.wp-comm-detail-hero__inner {
  position: relative; z-index: 1;
  display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between;
  padding: 24px;
  min-height: 200px;
}
.wp-comm-detail-hero__title { margin: 0; font-size: 28px; font-weight: 800; line-height: 1.1; }
.wp-comm-detail-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1px; background: var(--wp-border);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  overflow: hidden; margin-bottom: 12px;
}
```

### Upload wizard (`styles-community.css:333–397`)

```css
.wp-comm-stepper {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  border-radius: var(--wp-radius-lg);
}
.wp-comm-step {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--wp-bg-2);
  font-size: 12px; font-weight: 600; color: var(--wp-text-muted);
}
.wp-comm-step__num {
  width: 20px; height: 20px; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--wp-bg-3); color: var(--wp-text-muted);
  font-size: 11px;
}
.wp-comm-step[data-active="true"] { background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent); color: var(--wp-accent-text-strong); }
.wp-comm-step[data-active="true"] .wp-comm-step__num { background: var(--wp-accent-500); color: #fff; }
.wp-comm-step[data-done="true"]   .wp-comm-step__num { background: var(--wp-success); color: #fff; }
```

### Identifying overlap source

Discover grid uses `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))` + `gap: 12px`. Cards have `transform: translateY(-1px)` on hover. With each card's height:

- hero `100px`
- body padding `10/12/12` → 34px chrome
- title (line-height 1.25 × 14px) `~17px`
- tagline 2 lines (line-height 1.4 × 12px × 2) `~33px`
- author/stats rows + gap-6 `~24px`
- = card height **≈ 220–240px**

Hover lifts -1px and adds box-shadow 6/18. **No overlap is possible from the prototype CSS** because cards are siblings in a CSS grid with explicit gap.

If user reports overlap on the community page in the Vue port, likely the Vue port has:
1. Stripped the explicit grid (`.wp-comm-grid`) and reverted to flexbox without `flex-wrap` + gap.
2. Set padding directly on the card (instead of on `.wp-comm-card__body`) such that `padding + content > cell height`.
3. Forgot the `border-top: 1px solid var(--wp-border)` on `.wp-comm-card__stats` and `padding-top: 4px` — causing the stats row to slide under the tags.

The Vue port's community views live under `src/manager/views/community/` (not yet inspected in detail in this audit; report user to that area for fix).

---

## 13. Dashboard hero + stat cards

### Hero (`styles.css:770–822`)

```css
.wp-hero {
  position: relative;
  border-radius: var(--wp-radius-xl);   /* 16px */
  padding: 18px 20px;
  display: flex; align-items: center; gap: 16px;
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--wp-brand-1) 55%, transparent) 0%, transparent 55%),
    radial-gradient(120% 140% at 100% 100%, color-mix(in oklab, var(--wp-brand-3) 50%, transparent) 0%, transparent 60%),
    linear-gradient(135deg, #2c1f6b, #1a2747);
  border: 1px solid rgba(255,255,255,0.06);
  overflow: hidden;
  color: #fff;
}
.wp-hero::after {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(80% 100% at 50% 0%, rgba(255,255,255,0.06), transparent 70%);
  pointer-events: none;
}
.wp-hero__icon {
  width: 52px; height: 52px;
  border-radius: 14px;
  background: rgba(0,0,0,0.18);
  border: 1px solid rgba(255,255,255,0.1);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.wp-hero__icon img { width: 44px; height: 44px; display: block; }
.wp-hero__title { font-size: 17px; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.01em; color: #fff; }
.wp-hero__sub { font-size: 12.5px; color: rgba(255,255,255,0.82); margin: 0; max-width: 640px; }
.wp-hero .wp-btn {
  background: rgba(255,255,255,0.10);
  border-color: rgba(255,255,255,0.16);
  color: #fff;
}
.wp-hero .wp-btn:hover { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.24); color: #fff; }
.wp-hero .wp-btn--primary {
  background: rgba(255,255,255,0.92);
  color: var(--wp-accent-700, #5b21b6);
  border-color: transparent;
}
.wp-hero .wp-btn--primary:hover { background: #fff; color: var(--wp-accent-700, #5b21b6); }
```

### Stat card (`styles.css:824–854`)

```css
.wp-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
@media (max-width: 880px) { .wp-stats { grid-template-columns: repeat(2, 1fr); } }
.wp-stat {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 4px;
  position: relative;
  overflow: hidden;
}
.wp-stat__label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--wp-text-dim);
  font-weight: 600;
  display: flex; align-items: center; gap: 6px;
}
.wp-stat__value { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
.wp-stat__delta { font-size: 11px; color: var(--wp-text-dim); display: flex; align-items: center; gap: 4px; }
.wp-stat__icon {
  position: absolute; top: 10px; right: 10px;
  width: 26px; height: 26px;
  border-radius: 7px;
  display: grid; place-items: center;
  background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent);
  color: var(--wp-accent-text);
  font-size: 13px;
}
```

**Hover state**: prototype `.wp-stat` has **no `:hover`** at the rule level. When `s.screen` is set, the inline-style adds `cursor: pointer`. The card does not lift on hover in the prototype.

**Kind-tinted accent strip**: not present on Stat cards. The `.wp-pl-row` (Pipeline step rows, `styles.css:1509–1519`) has `border-left: 3px solid var(--step-color, var(--wp-accent-500));` — this is what provides the kind tint on pipeline rows, not on stat cards.

### Current Dashboard.vue

Has 6 stat cards (one per kind) + a "recent / favorites" tabbed area. Not surveyed in full here, but the structure follows prototype's hero + stats idea, with extensions (more stat cards, tabs).

---

## 14. Modal

Two modal definitions exist — pick one canonical:

### Prototype (`styles.css:1818–1869`)

```css
.wp-modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: 24px;
  animation: wp-modal-fade 120ms ease;
}
@keyframes wp-modal-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.wp-modal {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: wp-modal-pop 160ms cubic-bezier(.2,.7,.3,1.2);
}
@keyframes wp-modal-pop {
  from { opacity: 0; transform: translateY(8px) scale(.98); }
  to   { opacity: 1; transform: translateY(0)  scale(1); }
}
.wp-modal__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--wp-border); background: var(--wp-bg); }
.wp-modal__body { padding: 12px 14px; overflow: auto; flex: 1; min-height: 0; }
.wp-modal__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--wp-border); background: var(--wp-bg); }
```

Variants:
- `.wp-modal--picker` (`styles.css:1872–1879`): `width: 560px; max-width: 100%; max-height: 80vh;`.
- Picker layout uses `.wp-pl-picker__body` with tabs row + scrolling list.

### Animation

- Backdrop: 120ms ease fade-in.
- Modal pop-in: 160ms `cubic-bezier(.2,.7,.3,1.2)` (slightly bouncy, translateY 8 → 0 + scale .98 → 1).
- Mobile: `@media (max-width: 640px)` shrinks padding to 12px + reduces head/body/foot horizontal padding to 12px.

### Current Vue port (`Modal.vue`)

- Uses `Teleport to="body"` (good).
- Sizes: `sm | md | lg` via `.wp-modal--{size}`. Prototype has only `wp-modal--picker` (a width variant, not a t-shirt size).
- Closes on backdrop mousedown (`closeOnBackdrop`).
- Esc key listener attached via `watch(open)`.
- Animation: not surveyed in detail but assumed handled at the CSS level using the same `wp-modal-fade` / `wp-modal-pop` keyframes (they're in the global tokens.css).

---

## 15. Toast

### Prototype (`styles.css:971–991` + `ui.jsx:387–405`)

```css
.wp-toast-stack {
  position: fixed; right: 16px; bottom: 16px;
  display: flex; flex-direction: column; gap: 8px;
  z-index: 100;
  pointer-events: none;
}
.wp-toast {
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border-strong);
  border-left: 3px solid var(--wp-accent-500);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  display: flex; align-items: center; gap: 8px;
  box-shadow: var(--wp-shadow-lg);
  pointer-events: auto;
  animation: wp-slide-in .18s ease-out;
  min-width: 220px;
}
@keyframes wp-slide-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
```

- **Position: bottom-right** of the viewport.
- **Severity colors**: prototype only has one (accent purple left-border, neutral bg). The `useToasts` hook (`ui.jsx:389–393`) accepts `opts.icon` but no severity prop. Single `pi-check-circle` default icon.
- **Auto-dismiss**: 2400ms hardcoded (`ui.jsx:392`).
- **Animation**: 180ms ease-out slide-in from `translateY(8px)` + opacity 0.

### Current Vue port

- `useToast` composable uses `severity: 'success' | 'error' | 'info' | 'warn'` with `summary` + `detail` + `life` — Vue port mirrors PrimeVue's API.
- Color/severity differentiation likely handled by `ToastHost.vue` (not surveyed in detail in this audit).
- Default position would need verification — prototype is **bottom-right** but the Vue port uses ComfyUI's native PrimeVue toast anchor in production (per CLAUDE.md). For SPA stand-alone the position should still be bottom-right.

---

## 16. Animations & transitions used in prototype

| Class / Keyframe | CSS | Where |
|---|---|---|
| `wp-slide-in` | `from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; }` — 180ms ease-out | Toast (`.wp-toast`) |
| `wp-fade-in` | `from { opacity: 0 } to { opacity: 1 }` — used at 100ms / 150ms ease-out | History overlay, autocomplete popup |
| `wp-modal-fade` | `from { opacity: 0 } to { opacity: 1 }` — 120ms ease | Modal backdrop |
| `wp-modal-pop` | `from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); }` — 160ms `cubic-bezier(.2,.7,.3,1.2)` | Modal |
| `wp-skel-shimmer` | `0% { background-position: 200% 0 } 100% { background-position: -200% 0 }` — 1.4s linear infinite | Community card skeleton |
| `wp-tweaks-in` | (not in styles.css — see `tweaks-panel.jsx`) | Tweaks panel popover |
| `wp-rt-suggestions-in` | (not in styles.css — see `rich-input.jsx`) | Rich text suggestions |
| `.wp-comm-feat:hover` | `transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35);` — 150ms | Featured card hover |
| `.wp-comm-card:hover` | `transform: translateY(-1px); border-color: var(--wp-border-strong); box-shadow: 0 6px 18px rgba(0,0,0,0.28);` — 120ms | Discover card hover |
| `.wp-pl-row` | `transition: border-color 120ms ease, background 120ms ease, transform 120ms ease, opacity 120ms ease;` | Pipeline step row |
| `.wp-btn` | `transition: background .12s, border-color .12s, color .12s, transform .04s;` + `:active { transform: translateY(0.5px) }` | Buttons |
| `.wp-input,.wp-select,.wp-textarea` | `transition: border-color .12s, background .12s, box-shadow .12s;` | Form controls |
| `.wp-card` | (no transition) | Static cards |
| `.wp-nav` | `transition: background .12s, color .12s, border-color .12s;` | Sidebar nav rows |
| `.wp-toggle` | `transition: background .15s;` + `::after { transition: transform .15s }` | Toggle switch |
| `.wp-check` | `transition: background .12s, border-color .12s, color .12s;` | Checkbox |
| `.wp-star` | `transition: color .12s, transform .1s;` | Favorite star |
| `.wp-color-picker__chip` | `transition: transform .08s, box-shadow .12s;` + `:hover { transform: scale(1.08) }` | Palette swatch |
| `.wp-matrix-cell` | `transition: background .12s, border-color .12s, transform .04s;` + `:hover { transform: translateY(-1px) }` | Constraint matrix cell |
| `.wp-comm-feat`, `.wp-comm-card`, `.wp-pl-tab`, `.wp-pl-pickrow`, `.wp-pl-flow__step` | `transition: ... .12s ease` | Various community/pipeline cards |
| `.wp-theme-switching` | `transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important;` (briefly applied during theme flip to avoid frame-by-frame transition flash) | Theme toggle |

**Sidebar collapse**: prototype uses `data-collapsed="true"` on `.wp-body` to switch grid columns from `var(--wp-sidebar-w)` (232px) to `56px`. **No `transition`** is defined on `.wp-body`'s `grid-template-columns`. The collapse is an instant jump.

**Filter panel open**: `lists.jsx:138` renders the `.wp-card` filter panel inline based on `filtersOpen`. The prototype has **no max-height transition**, so the panel pops in/out without animation. Vue port at `ModuleListView.vue:354–376` adds a `<Transition name="filter-collapse">` with `opacity` + `translateY(-4px)` 150ms — an **upgrade** over the prototype.

**`--wp-radius-md` is undefined** in prototype tokens (`styles.css:55–58`). Token defines `radius-sm: 6px`, `radius: 8px`, `radius-lg: 12px`, `radius-xl: 16px`. `.wp-rule`, `.wp-pl-row`, `.wp-pagination`, `.wp-pl-empty`, `.wp-pl-flow__step`, `.wp-pl-add` reference `var(--wp-radius-md)` which falls back to the property's initial value (`0`). So the prototype is silently rendering 0-radius corners on rule cards and pipeline rows. Likely a bug in the prototype the Vue port should NOT replicate — define `--wp-radius-md: 8px` (or 10px to match modal head padding intent).

---

## Recommendations

In rough priority order:

1. **Fix Sort dropdown sizing.** Drop `size="sm"` from the toolbar Select at `ModuleListView.vue:348` (and optionally line 535 for the per-page selector) so it shares the 34px height with Filters/Search. One-character change, biggest visual delta.
2. **Fix editor footer overlap.** Move `padding-bottom: 96px` from `.wp-editor` to the actual scrolling container of the editor body. For `wp-page--fill`, set `--wp-content-pb: 96px` on `.wp-content` while an editor is mounted, or apply the bottom padding to the inner-scroll container. Verify by scrolling a tall Wildcard editor (with 30+ options) until last row is visible above the sticky footer.
3. **Add collapse to DerivationRuleCard.** Header with chevron + summary; default expanded for the first rule and collapsed otherwise. Each rule's collapsed height ≈ 36px.
4. **Make rule branch action a single-line input** (not a 2-row textarea). Wrap with `TokenAutocomplete` (`$var`/`@var`) where appropriate. Cuts each branch by ~50px.
5. **Restore Chip rendering for tag pills inside table rows.** `ModuleListView.vue` `.wp-row-tag` should be `<Chip>{tag}</Chip>` (radius 999, 11px, bg-3). Same for the active-filter-count badge — use the prototype's `.wp-chip` form, not the loud `.wp-filter-count` accent circle.
6. **Restore `.wp-cat-chip` to tinted Chip pattern** (background `color @ 14%`, text = color, border `color @ 35%`, no text-shadow, radius 999). Update both the Categories screen pill and the per-row category chip in Wildcards/Fixed/Combine list views.
7. **Define `--wp-radius-md`** (e.g. 8px) in `tokens.css`. The prototype silently renders 0-radius `.wp-rule`, `.wp-pl-row`, `.wp-pagination` because the token is undefined. The Vue port might inherit this. Pick 8px (same as `--wp-radius`) to keep faithful.
8. **Match toolbar markup to prototype.** Prototype uses `<div class="wp-toolbar">` with `.wp-toolbar__search` (max-width 320). Vue port renamed to `.wp-page-toolbar` + `.wp-page-toolbar__search` (max-width 440) + `.wp-page-toolbar__sort` (180px). Either pick the rename and remove the legacy `.wp-toolbar*` rules from `tokens.css:786–791`, or rename back. The dual-name maintenance is a footgun.
9. **Replace `.wp-filter-toggle` (Vue-only) with `.wp-chip[data-active]` pattern** (prototype). Fewer classes, identical visual.
10. **Verify community grid uses `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))` and gap: 12px**, since the user reports overlap. The prototype has no overlap by construction.
11. **Bottom-right toast position** — confirm `ToastHost.vue` mounts at `right: 16px; bottom: 16px;` matching `.wp-toast-stack` (the global rule already says so). The CLAUDE.md mentions ComfyUI native PrimeVue anchor for the extension, but for the SPA route the prototype rule should win.
12. **Categories screen** — drop the inline `.wp-cat-page { padding: 18px 22px 40px }` at `Categories.vue:252` since `.wp-page` already paints that. Decide whether to keep `Sort` column or move to drag-handle. Add explicit pencil button for clearer affordance (or document the click-to-edit pattern).

---

*End of report. File paths cited absolute. Cross-reference line numbers against the file versions snapshotted on 2026-04-27.*
