<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  parse,
  matches,
  readsAs,
  validateExpression,
} from "@/manager/parsing/subcatFilter";
import {
  collectTermPolarity,
  livingTags,
  nearestTerm,
  termState,
  type TermState,
} from "@/manager/parsing/subcatTermState";
import { highlightExpression } from "@/manager/parsing/exprHighlight";
import { useGrowableField } from "@/components/shared/useGrowableField";
import WpCheck from "@/components/shared/WpCheck.vue";

interface Props {
  /** Sub-categories declared by the picked wildcard's payload. Used as
   *  the known-term set for live validation and as the flat fallback
   *  palette when no `tagGroups` axis covers a tag. */
  subCategories: string[];
  /** Map axis-name → member sub-categories, for the grouped insert
   *  palette. Tags not in any axis fall into an implicit "ungrouped"
   *  cluster. */
  tagGroups?: Record<string, string[]>;
  /** Each entry is one option's tag set — drives the live "N of M
   *  options match" count by running `matches(parse(expr), Set(tags))`. */
  optionTagSets?: string[][];
  /** Initial expression — empty for a fresh insert, prepopulated for edit. */
  initialExpr?: string;
  /** Initial exclude-null flag (inverted-null semantic: true = the
   *  wildcard's null option is dropped from the resolved pool). */
  initialExcludeNull?: boolean;
  /** "insert" hides the Delete button; "edit" shows it. */
  mode: "insert" | "edit";
  /** True when the target wildcard carries a null option. Renders the
   *  "Exclude null" toggle row above the expression editor. */
  hasNullOption?: boolean;
  /** Display name of the wildcard being filtered, for the panel header. */
  wildcardName?: string;
  /** Where the pool being filtered came from. `"node"` means this Context
   *  node's own snapshot of the wildcard, which can differ from the library
   *  row of the same uuid — so the counts below describe the node's copy, and
   *  the header says so. `undefined` in the SPA, which only ever has one. */
  poolOrigin?: "node" | "library";
}

const props = withDefaults(defineProps<Props>(), {
  tagGroups: () => ({}),
  optionTagSets: () => [],
  initialExpr: "",
  initialExcludeNull: false,
  mode: "insert",
  hasNullOption: false,
  wildcardName: "",
  poolOrigin: undefined,
});

const emit = defineEmits<{
  /** User confirmed the filter. Carries the raw boolean expression and
   *  the exclude-null flag as separate fields (§3.3 — null is a flag,
   *  not a term inside the expression). */
  "apply": [filter: { expr: string; excludeNull: boolean }];
  /** Insert / keep the ref WITHOUT a filter. */
  "skip": [];
  /** Edit mode only — remove the ref entirely. */
  "delete": [];
  /** Insert mode only — return to the suggestion list without inserting.
   *  Distinct from `skip`, which inserts an unfiltered ref, and from a
   *  backdrop cancel, which abandons the insert entirely. */
  "back": [];
}>();

const expr = ref<string>(props.initialExpr);
const excludeNull = ref<boolean>(props.initialExcludeNull);
/** A textarea, not an input: expressions run past what one line can hold
 *  (`(warm or cool) and not vivid and (hair-natural or eye-vivid)` is 56
 *  characters) and a single-line field clipped everything past ~40, so the
 *  thing being authored was the thing you could not see. */
const inputEl = ref<HTMLTextAreaElement | null>(null);
const growable = useGrowableField(() => inputEl.value, { minHeight: 44 });
const { hasMoreBelow, startResize } = growable;
onMounted(() => {
  growable.attach();
  growable.autosize();
});
watch(expr, () => growable.autosize());

/**
 * Coloured tokens for the mirror layer painted behind the textarea.
 *
 * A textarea cannot render coloured text, so the highlight is a second element
 * holding the same string with the same metrics, sitting exactly beneath a
 * textarea whose own text is transparent. The two must agree on font, padding,
 * wrapping and scroll offset or the colours drift off the characters — hence
 * `syncMirrorScroll` and the shared `--wp-subcat-expr-*` metrics in the CSS.
 */
const exprTokens = computed(() => highlightExpression(expr.value, known.value));

const mirrorEl = ref<HTMLElement | null>(null);
/** A long expression scrolls inside the box; the paint has to follow it. */
function syncMirrorScroll(): void {
  const src = inputEl.value;
  const dst = mirrorEl.value;
  if (!src || !dst) return;
  dst.scrollTop = src.scrollTop;
  dst.scrollLeft = src.scrollLeft;
}

/** Palette search. A wildcard here declares 30 tags across 5 axes; scanning
 *  that by eye to find `hair-natural` is slower than typing it. */
const tagQuery = ref("");

/** Axes the user has folded away, by axis name.
 *
 *  Deliberately per-component-instance and NOT persisted: it is scratch state
 *  for one authoring session, and a collapse remembered across wildcards would
 *  hide axes the user has never seen. */
const collapsedAxes = ref<Set<string>>(new Set());
function toggleAxis(axis: string): void {
  const next = new Set(collapsedAxes.value);
  if (next.has(axis)) next.delete(axis);
  else next.add(axis);
  collapsedAxes.value = next;
}

// External prop changes (e.g. opening the picker on a different chip)
// reset the local state.
watch(() => props.initialExpr, (next) => { expr.value = next; });
watch(() => props.initialExcludeNull, (next) => { excludeNull.value = next; });

const known = computed(() => new Set(props.subCategories));

/** Live two-layer validation error (§3.7), or null when valid/empty. */
const error = computed<string | null>(() =>
  validateExpression(expr.value, known.value),
);

/** Parsed AST — null when empty or unparseable. Only consulted for the
 *  reads-as preview + match count (both guard on `error`). */
const ast = computed(() => {
  try {
    return parse(expr.value);
  } catch {
    return null;
  }
});

/** Normalized "reads as" preview — empty string for an empty/invalid
 *  expression. */
const readsAsText = computed(() => (error.value ? "" : readsAs(ast.value)));

/** Live "N of M options match" count. When the expression is invalid we
 *  show 0 matches but keep the denominator so the user still sees scope. */
/**
 * The option sets the filter is actually measured against.
 *
 * `optionTagSets` carries only the NON-null options, but the null option is a
 * real member of the pool: it is selectable until `Exclude null` drops it. So
 * the popover would advertise "132 options" while this panel counted against
 * 131, and ticking the flag changed nothing on screen.
 *
 * Null carries no tags, so it joins as an empty set — which lets it fall out
 * of a positive expression and survive a negative one, exactly as any
 * tagless option would.
 */
const effectiveTagSets = computed<string[][]>(() =>
  props.hasNullOption && !excludeNull.value
    ? [...props.optionTagSets, []]
    : [...props.optionTagSets],
);

const matchCount = computed(() => {
  const total = effectiveTagSets.value.length;
  if (error.value) return { matched: 0, total };
  const a = ast.value;
  const matched = effectiveTagSets.value.filter((tags) =>
    matches(a, new Set(tags)),
  ).length;
  return { matched, total };
});

/** Apply is blocked only when the expression is BOTH non-empty AND
 *  invalid — an empty expression is a valid "no filter". */
const applyDisabled = computed(
  () => expr.value.trim().length > 0 && error.value !== null,
);

/** How each tag participates, read off the AST rather than off what the user
 *  clicked — so the chips stay honest for a typed or pasted expression. */
const polarity = computed(() => collectTermPolarity(ast.value));
/** Tags carried by at least one option. Anything outside this can be typed
 *  and parsed but can never match. */
const live = computed(() => livingTags(effectiveTagSets.value));
function stateOf(tag: string): TermState {
  return termState(tag, polarity.value, live.value);
}

/**
 * The first term the wildcard does not declare, and the closest thing it does.
 *
 * Taken from the polarity map, which already holds every term in the AST, so
 * this does not re-walk what `validateExpression` just walked. Only meaningful
 * for an expression that PARSED — a syntax error has no terms to correct.
 */
const unknownTerm = computed<string | null>(() => {
  for (const t of polarity.value.keys()) if (!known.value.has(t)) return t;
  return null;
});
const didYouMean = computed<string | null>(() =>
  unknownTerm.value ? nearestTerm(unknownTerm.value, props.subCategories) : null,
);

/**
 * Valid, non-empty, and matches nothing.
 *
 * Distinct from an error: `skin-tone and pastel` is a perfectly well-formed
 * expression over declared tags, it just happens that no single option carries
 * both. Today that applies silently and you find out at run time, with the ref
 * resolving to nothing and no clue why.
 */
const zeroMatch = computed(
  () =>
    error.value === null &&
    expr.value.trim().length > 0 &&
    effectiveTagSets.value.length > 0 &&
    matchCount.value.matched === 0,
);

/** Match count as a 0-100 width for the bar. An empty expression is "no
 *  filter", which keeps every option, so the bar reads full. */
const matchPct = computed(() => {
  const { matched, total } = matchCount.value;
  if (total === 0) return 0;
  return Math.round((matched / total) * 100);
});

const groups = computed<{ axis: string; tags: string[] }[]>(() => {
  const out: { axis: string; tags: string[] }[] = [];
  const claimed = new Set<string>();
  for (const [axis, tags] of Object.entries(props.tagGroups)) {
    const present = tags.filter((t) => props.subCategories.includes(t));
    for (const t of present) claimed.add(t);
    if (present.length > 0) out.push({ axis, tags: present });
  }
  const ungrouped = props.subCategories.filter((t) => !claimed.has(t));
  if (ungrouped.length > 0) out.push({ axis: "", tags: ungrouped });
  return out;
});

/** Groups narrowed by the palette search. An axis whose every tag is filtered
 *  out disappears rather than rendering an empty header — a heading over
 *  nothing reads as "this axis has no tags", which is a different claim. */
const visibleGroups = computed(() => {
  const q = tagQuery.value.trim().toLowerCase();
  if (!q) return groups.value;
  return groups.value
    .map((g) => ({ axis: g.axis, tags: g.tags.filter((t) => t.toLowerCase().includes(q)) }))
    .filter((g) => g.tags.length > 0);
});

/** Total tags offered, for the search field's placeholder. */
const tagTotal = computed(() => props.subCategories.length);

/** Per-axis summary shown on the header, so a folded axis still says whether
 *  anything inside it is in play. */
function axisSummary(tags: string[]): string {
  let used = 0;
  let negated = 0;
  for (const t of tags) {
    const st = stateOf(t);
    if (st === "in") used++;
    else if (st === "negated") negated++;
  }
  const parts: string[] = [];
  if (used > 0) parts.push(`${used} used`);
  if (negated > 0) parts.push(`${negated} negated`);
  return parts.join(" · ");
}

const OPERATORS = ["and", "or", "not", "(", ")"] as const;

/** Insert `token` at the caret (or selection) inside the expression
 *  input, padding with a single space so adjacent tokens stay parseable
 *  (`warm` + `or` → `warm or`, not `warmor`). Re-focuses + restores the
 *  caret after the inserted token. */
function insertAtCursor(token: string): void {
  const el = inputEl.value;
  const current = expr.value;
  const selStart = el?.selectionStart ?? current.length;
  const selEnd = el?.selectionEnd ?? current.length;
  const before = current.slice(0, selStart);
  const after = current.slice(selEnd);
  // Pad with a space on each side unless we're already at a space / edge.
  const needLead = before.length > 0 && !/\s$/.test(before);
  const needTrail = after.length > 0 && !/^\s/.test(after);
  const insert = (needLead ? " " : "") + token + (needTrail ? " " : "");
  const next = before + insert + after;
  expr.value = next;
  const caret = (before + insert).length;
  void Promise.resolve().then(() => {
    const e = inputEl.value;
    if (!e) return;
    e.focus();
    e.setSelectionRange(caret, caret);
  });
}

/**
 * Swap the mistyped term for the suggestion, in place.
 *
 * Word-boundary replace of that term only, rather than rebuilding the
 * expression from the AST: re-serialising would silently normalise the user's
 * spacing and parens, so a one-character typo fix would reformat the whole
 * line they were in the middle of writing.
 */
function applySuggestion(): void {
  const wrong = unknownTerm.value;
  const right = didYouMean.value;
  if (!wrong || !right) return;
  const pattern = new RegExp(`(^|[^\\w-])${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g");
  expr.value = expr.value.replace(pattern, (_m, lead: string) => `${lead}${right}`);
}

/**
 * Toggle from anywhere on the row.
 *
 * Clicks that land on `WpCheck` itself are left alone: it already toggles on
 * its own click, and that event bubbles up here too, so handling both would
 * flip the flag twice and appear to do nothing. Keyboard users keep reaching
 * the real control, which is why it stays focusable rather than becoming
 * decoration.
 */
function onNullRowClick(ev: MouseEvent): void {
  if ((ev.target as HTMLElement | null)?.closest(".wp-check")) return;
  excludeNull.value = !excludeNull.value;
}

function onApply(): void {
  if (applyDisabled.value) return;
  emit("apply", { expr: expr.value.trim(), excludeNull: excludeNull.value });
}
</script>

<template>
  <div class="wp-subcat-picker" data-test="subcat-picker">
    <!-- Header. The two hosts differ ONLY here: the insert flow arrived from
         the suggestion list and can go back to it, so it shows a breadcrumb;
         the chip-edit flow was opened on an existing chip and has nothing
         behind it, so it shows a plain title. Everything below is identical. -->
    <div class="wp-subcat-picker__head">
      <template v-if="mode === 'insert'">
        <button
          type="button"
          class="wp-subcat-picker__crumb"
          data-test="picker-back"
          @click="emit('back')"
        >
          <i class="pi pi-angle-left" aria-hidden="true" />
          Suggestions
        </button>
        <span class="wp-subcat-picker__crumb-sep">/</span>
      </template>
      <i v-else class="pi pi-filter" aria-hidden="true" />
      <span class="wp-subcat-picker__title" data-test="picker-title">@{{ wildcardName }}</span>
      <!-- Matches the chip's own marker, so "this pool is the node's copy"
           reads the same in both places. -->
      <span
        v-if="poolOrigin === 'node'"
        class="wp-subcat-picker__origin"
        data-test="picker-origin-node"
        title="Filtering this node's copy of the wildcard, not the library row"
      ><i class="pi pi-database" aria-hidden="true" /> this node</span>
      <span class="wp-spacer" />
      <span class="wp-subcat-picker__keys">
        Esc {{ mode === "insert" ? "back" : "cancel" }}
      </span>
    </div>
    <!-- The whole row toggles, not just the 13px box. `WpCheck` is a
         `role="checkbox"` span rather than a native input, so wrapping it in a
         <label> associates nothing — the row needs its own handler. -->
    <div
      v-if="hasNullOption"
      class="wp-subcat-picker__null-row"
      data-test="subcat-exclude-null"
      @click="onNullRowClick"
    >
      <WpCheck v-model="excludeNull" aria-label="Exclude null" />
      <i class="pi pi-ban" aria-hidden="true" />
      <span>Exclude null</span>
      <!-- Null is a FLAG on the ref, not a term inside the expression — the
           engine reads `!null` as a separate segment. Saying so here stops
           people reaching for the palette to find a `null` chip. -->
      <span class="wp-subcat-picker__null-note">flag, not a term</span>
    </div>

    <!-- Expression — the source of truth. The palette below is a VIEW of this
         string, never a second place the filter is stored. -->
    <div class="wp-subcat-picker__field">
      <label class="wp-subcat-picker__field-label" for="wp-subcat-expr">Expression</label>
      <div class="wp-subcat-picker__field-wrap">
        <!-- The paint. `aria-hidden` because the textarea beneath already
             carries the value for assistive tech; this is presentation only,
             and announcing the string twice would be worse than not colouring
             it at all. -->
        <div ref="mirrorEl" class="wp-subcat-picker__mirror" aria-hidden="true">
          <span
            v-for="(tok, i) in exprTokens"
            :key="i"
            :class="`wp-subcat-tok wp-subcat-tok--${tok.kind}`"
          >{{ tok.text }}</span>
          <!-- A trailing newline is not rendered by the browser unless
               something follows it, which would let the mirror come up one
               line short of the textarea mid-edit. -->
          <span>&#8203;</span>
        </div>
        <textarea
          id="wp-subcat-expr"
          ref="inputEl"
          v-model="expr"
          rows="1"
          aria-label="Sub-category filter expression"
          class="wp-subcat-picker__input"
          :class="{ 'wp-subcat-picker__input--invalid': error !== null }"
          data-test="expr-input"
          placeholder="e.g. warm or cold"
          spellcheck="false"
          autocomplete="off"
          @scroll="growable.updateOverflowHint(); syncMirrorScroll();"
          @input="syncMirrorScroll"
        ></textarea>
        <span v-if="hasMoreBelow" class="wp-subcat-picker__more" aria-hidden="true" />
        <!-- Triangle grip, matching every other resizable field in the app.
             Native `resize` is used nowhere here: it accumulates travel past
             its own limits, so dragging back does nothing until the invisible
             total unwinds. -->
        <span
          class="wp-subcat-picker__grip"
          data-test="expr-grip"
          aria-hidden="true"
          @pointerdown="startResize"
        />
      </div>
    </div>

    <!-- Inline validation error (§3.7), with a correction when one is close
         enough to be worth offering. -->
    <p v-if="error" class="wp-subcat-picker__error" data-test="expr-error">
      <i class="pi pi-exclamation-circle" aria-hidden="true" />
      <!-- For an unknown term the message is composed here rather than taken
           from the validator, so the offending word can be set in mono and the
           correction picked out — the two words the eye needs are the two that
           are hardest to find inside a quoted sentence. -->
      <span v-if="unknownTerm">
        Unknown sub-category <code>{{ unknownTerm }}</code>
        <template v-if="didYouMean">
          — did you mean
          <button
            type="button"
            class="wp-subcat-picker__fixit"
            data-test="did-you-mean"
            @click="applySuggestion"
          >{{ didYouMean }}</button>?
        </template>
      </span>
      <span v-else>{{ error }}</span>
    </p>

    <!-- Reads-as normalized preview + live match count and bar. -->
    <div class="wp-subcat-picker__derived">
      <div class="wp-subcat-picker__reads">
        <span class="wp-subcat-picker__derived-label">Reads as</span>
        <code class="wp-subcat-picker__reads-val" data-test="reads-as">{{
          readsAsText || "—"
        }}</code>
      </div>
      <div
        v-if="optionTagSets.length > 0"
        class="wp-subcat-picker__match"
        data-test="match-count"
      >
        <!-- The bar carries the proportion, which is what you read at a
             glance; the numbers carry the precision. -->
        <span class="wp-subcat-picker__bar" :data-empty="matchCount.matched === 0 ? '' : null">
          <span class="wp-subcat-picker__bar-fill" :style="{ width: matchPct + '%' }" />
        </span>
        <span
          class="wp-subcat-picker__match-num"
          :data-zero="matchCount.matched === 0 ? '' : null"
        >
          {{ matchCount.matched }} of {{ matchCount.total }}
        </span>
      </div>
    </div>

    <!-- Valid, and matches nothing. Not an error — the expression is
         well-formed over declared tags, it just happens that no option carries
         the combination. Today this applies silently and the ref resolves to
         nothing at run time with no clue why. -->
    <p v-if="zeroMatch" class="wp-subcat-picker__warn" data-test="zero-match">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <span>Valid, but no option carries this — the ref would resolve to nothing.</span>
    </p>

    <!-- Insert-at-cursor palettes: grouped sub-categories + operators. -->
    <div v-if="subCategories.length > 0" class="wp-subcat-picker__palette">
      <label class="wp-subcat-picker__search">
        <i class="pi pi-search" aria-hidden="true" />
        <input
          v-model="tagQuery"
          type="text"
          class="wp-subcat-picker__search-input"
          data-test="tag-search"
          :placeholder="`Filter ${tagTotal} tags…`"
          :aria-label="`Filter ${tagTotal} tags`"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <!-- Only the GROUPS scroll. Putting the scrollbar on the whole popover
           would push the expression, the live count and the Apply button out
           of view exactly when a big tag list makes them most useful, and the
           search box has to stay put or you cannot see what you are typing
           against. -->
      <div class="wp-subcat-picker__groups">
      <div
        v-for="g in visibleGroups"
        :key="g.axis || '__ungrouped'"
        class="wp-subcat-picker__group"
      >
        <!-- An axis header is a button because it folds. Ungrouped tags have
             no axis to fold, so they render bare. -->
        <button
          v-if="g.axis"
          type="button"
          class="wp-subcat-picker__group-head"
          data-test="axis-head"
          :aria-expanded="!collapsedAxes.has(g.axis)"
          @click="toggleAxis(g.axis)"
        >
          <i
            :class="collapsedAxes.has(g.axis) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            aria-hidden="true"
          />
          <span class="wp-subcat-picker__group-name">{{ g.axis }}</span>
          <span class="wp-subcat-picker__group-count">{{ g.tags.length }}</span>
          <span class="wp-spacer" />
          <!-- A folded axis still reports whether anything inside it is in
               play, so folding never hides state. -->
          <span v-if="axisSummary(g.tags)" class="wp-subcat-picker__group-sum">
            {{ axisSummary(g.tags) }}
          </span>
        </button>
        <div v-if="!g.axis || !collapsedAxes.has(g.axis)" class="wp-subcat-picker__chips">
          <button
            v-for="sub in g.tags"
            :key="sub"
            type="button"
            class="wp-subcat-chip"
            data-test="subcat-chip"
            :data-value="sub"
            :data-state="stateOf(sub)"
            :title="stateOf(sub) === 'dead'
              ? `${sub} — declared by this wildcard but carried by no option`
              : undefined"
            @click="insertAtCursor(sub)"
          >{{ sub }}</button>
        </div>
      </div>
      <p v-if="visibleGroups.length === 0" class="wp-subcat-picker__no-tags" data-test="no-tags">
        No tag matches this search.
      </p>
      </div>
    </div>
    <div class="wp-subcat-picker__ops">
      <button
        v-for="op in OPERATORS"
        :key="op"
        type="button"
        class="wp-subcat-chip wp-subcat-chip--op"
        :data-test="'subcat-op'"
        :data-value="op"
        @click="insertAtCursor(op)"
      >{{ op }}</button>
    </div>

    <div class="wp-subcat-picker__actions">
      <button
        v-if="mode === 'edit'"
        type="button"
        class="wp-btn wp-btn--danger wp-subcat-picker__delete"
        data-test="picker-delete"
        @click="emit('delete')"
      >Delete</button>
      <button
        type="button"
        class="wp-btn"
        data-test="picker-skip"
        @click="emit('skip')"
      >Skip</button>
      <button
        type="button"
        class="wp-btn wp-btn--primary"
        data-test="picker-apply"
        :disabled="applyDisabled || undefined"
        @click="onApply"
      >Apply</button>
    </div>
  </div>
</template>

<style scoped>
.wp-subcat-picker {
  padding: 16px 18px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-accent);
  border-radius: 8px;
  min-width: 400px;
  max-width: 540px;
}
/* A bordered box, not a bare line. The flag is a distinct decision from the
   expression below it — it is a separate segment of the ref (`!null`), not a
   term — and boxing it stops the two reading as one continuous form. */
.wp-subcat-picker__null-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
}
.wp-subcat-picker__null-note {
  margin-left: auto;
  opacity: 0.5;
  font-size: 10px; /* audit-exempt: micro annotation — below scale floor */
}
.wp-subcat-picker__null-row .pi { font-size: 11px; }

.wp-subcat-picker__field { margin-bottom: 6px; }
/* The expression box grows with its content and can be dragged. `position:
   relative` anchors the overflow hint and the grip to it. */
/* The expression box.
 *
 * The textarea and the mirror painted behind it MUST agree on every metric
 * that affects where a glyph lands, or the colours slide off the characters.
 * They are declared once here and inherited by both, so the two cannot drift
 * apart in a later edit. */
.wp-subcat-picker__field-wrap {
  position: relative;
  --wp-subcat-expr-pad-y: 8px;   /* audit-exempt: shared metric, see above */
  --wp-subcat-expr-pad-x: 10px;  /* audit-exempt: shared metric, see above */
  --wp-subcat-expr-line: 1.6;
}
/* SHARED METRICS. Every property here changes where a glyph lands, so the two
   layers must inherit them from one declaration — if the mirror and the
   textarea disagree on padding, font or wrapping, the colours slide off the
   characters they belong to. */
.wp-subcat-picker__mirror,
.wp-subcat-picker__input {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 44px;
  padding: var(--wp-subcat-expr-pad-y) var(--wp-subcat-expr-pad-x);
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-sm, 12px);
  line-height: var(--wp-subcat-expr-line);
  letter-spacing: normal;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
}
/* The editable layer, on top. */
.wp-subcat-picker__input {
  position: relative;
  z-index: 1;
  resize: none;
  overflow: auto;
  /* Transparent, so the mirror beneath shows through. The textarea's job on
     this layer is the border, the focus ring, the caret and the selection. */
  background: transparent;
  border-color: var(--wp-border-strong);
  /* The glyphs are drawn by the mirror; the textarea contributes the caret,
     the selection and the editing. `-webkit-text-fill-color` is needed too —
     without it WebKit keeps painting the real text over the paint. */
  color: transparent;
  -webkit-text-fill-color: transparent;
  caret-color: var(--wp-text);
}
.wp-subcat-picker__input::selection {
  /* Selection has to stay visible against transparent glyphs. */
  background: color-mix(in oklab, var(--wp-accent-500) 40%, transparent);
}
.wp-subcat-picker__input:focus {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
}
.wp-subcat-picker__input::placeholder {
  color: var(--wp-text-dim, var(--wp-text3));
  -webkit-text-fill-color: var(--wp-text-dim, var(--wp-text3));
}
/* The paint sits UNDER a textarea whose own glyphs are transparent, so the
   caret, the selection and every native editing behaviour stay real — only
   the colour comes from here. */
.wp-subcat-picker__mirror {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: var(--wp-text);
  z-index: 0;
  /* The FILL lives here, on the lower layer. It cannot live on the textarea:
     an opaque background there paints straight over the mirror and the
     expression disappears, since the textarea's own glyphs are transparent.
     The border stays transparent so the textarea's real one above is the only
     one drawn. */
  background: var(--wp-bg-1);
}
.wp-subcat-tok--term { color: var(--wp-accent-300); }
.wp-subcat-tok--op { color: var(--wp-info); }
.wp-subcat-tok--paren { color: var(--wp-text-dim, var(--wp-text3)); }
/* Marked as you type, before the validator has finished the sentence. */
.wp-subcat-tok--bad {
  color: var(--wp-danger);
  text-decoration: wavy underline var(--wp-danger);
  text-underline-offset: 3px; /* audit-exempt: keeps the wave clear of descenders */
}
/* Sits over the bottom edge to say "there is more below". Inset on the right
   so it never sits under the grip, and pointer-events:none so it can never
   swallow the drag that starts on the grip beneath it. */
.wp-subcat-picker__more {
  position: absolute;
  /* Also above the textarea, for the same reason — painted under it, the hint
     would never be seen. `pointer-events: none` below keeps it from stealing
     the drag that starts on the grip beside it. */
  z-index: 2;
  inset: auto 16px 1px 1px; /* audit-exempt: hairline overlay inset, right gap clears the grip */
  height: 14px;
  pointer-events: none;
  border-radius: 0 0 var(--wp-radius-sm) var(--wp-radius-sm);
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in oklab, var(--wp-bg-deep, var(--wp-bg)) 92%, transparent)
  );
}
/* Triangle, matching the other resizable fields. `clip-path` rather than a
   border trick so the hit area is the visible shape. */
/* Above the textarea. The textarea sits at z-index 1 so it can take the caret
   and the clicks; without lifting the grip past it, the drag handle is buried
   under a full-size element and never receives the pointerdown. */
.wp-subcat-picker__grip {
  position: absolute;
  z-index: 2;
  right: 1px; /* audit-exempt: sits inside the 1px border */
  bottom: 1px;
  width: 12px;
  height: 12px;
  cursor: ns-resize;
  background: var(--wp-text-dim, var(--wp-text3));
  opacity: 0.45;
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  touch-action: none;
}
.wp-subcat-picker__grip:hover { opacity: 0.8; }

/* Did-you-mean. A button, not prose: the correction is one click, and making
   the user retype a word the app already identified is busywork. */
/* The correction is highlighted, not underlined. Underlining the whole clause
   made the sentence the link; what the reader actually needs to spot is the
   one WORD they should have typed. */
.wp-subcat-picker__fixit {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--wp-font-mono);
  font-size: inherit;
  font-weight: 600;
  color: var(--wp-accent-text, var(--wp-accent-300));
  cursor: pointer;
}
.wp-subcat-picker__fixit:hover { text-decoration: underline; }
.wp-subcat-picker__error code {
  font-family: var(--wp-font-mono);
  color: var(--wp-danger);
}

/* Valid-but-empty. Amber, not red: nothing is wrong with the expression, it
   simply keeps nothing. */
.wp-subcat-picker__warn {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0 0;
  font: 11px var(--wp-font-sans);
  color: var(--wp-warn);
}
.wp-subcat-picker__error { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }

/* Match bar. */
.wp-subcat-picker__match { display: flex; align-items: center; gap: 6px; }
.wp-subcat-picker__bar {
  width: 52px;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in oklab, var(--wp-text) 12%, transparent);
  overflow: hidden;
}
.wp-subcat-picker__bar-fill {
  display: block;
  height: 100%;
  background: var(--wp-success);
}
/* Zero matches is the one value worth colouring differently — a green bar of
   width zero is indistinguishable from an empty track. */
.wp-subcat-picker__bar[data-empty] { background: color-mix(in oklab, var(--wp-warn) 35%, transparent); }
.wp-subcat-picker__match-num {
  font-family: var(--wp-font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--wp-success);
}
/* Zero is the one count worth colouring differently — "0 of 132" in the same
   green as "132 of 132" reads as success at a glance. */
.wp-subcat-picker__match-num[data-zero] { color: var(--wp-danger); }

/* Palette search. */
.wp-subcat-picker__palette { margin-top: var(--wp-space-5); }
/* The tag list is the only unbounded part of this panel — a wildcard can
   declare 30 tags across 5 axes, and nothing stops it declaring 300. Capping
   it here keeps the popover a fixed, predictable size no matter what it is
   pointed at. `vh` rather than a pixel count because the popover is anchored
   to a chip that can sit anywhere on screen. */
.wp-subcat-picker__groups {
  max-height: 32vh;
  overflow-y: auto;
  overflow-x: hidden;
  /* Without this, hitting either end hands the leftover wheel delta to the
     page and the editor behind the popover lurches. */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  /* Room for the scrollbar so it never lands on top of a chip. */
  padding-right: 2px; /* audit-exempt: gutter for the scrollbar */
}
.wp-subcat-picker__search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px; /* audit-exempt: compact inline search affordance */
  margin-bottom: 6px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-subcat-picker__search .pi { font-size: 11px; }
.wp-subcat-picker__search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--wp-text);
  font: 11px var(--wp-font-sans);
}

/* Axis header — a fold control, so it is a full-width button row. */
.wp-subcat-picker__group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 2px 0; /* audit-exempt: hairline row padding */
  background: none;
  border: none;
  cursor: pointer;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-subcat-picker__group-head .pi { font-size: 9px; }
.wp-subcat-picker__group-count { opacity: 0.65; }
.wp-subcat-picker__group-sum { text-transform: none; letter-spacing: 0; opacity: 0.8; }
.wp-subcat-picker__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin: -4px -4px var(--wp-space-5); /* audit-exempt: bleeds the rule to the panel edges */
  padding: 0 4px var(--wp-space-3);
  border-bottom: 1px solid var(--wp-border);
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-subcat-picker__head .pi { font-size: 10px; }
.wp-subcat-picker__crumb {
  display: inline-flex;
  align-items: center;
  gap: 3px; /* audit-exempt: glyph-to-word gap inside the crumb */
  padding: 0;
  background: none;
  border: none;
  font: inherit;
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
}
.wp-subcat-picker__crumb:hover { color: var(--wp-text); }
.wp-subcat-picker__crumb-sep { opacity: 0.4; }
.wp-subcat-picker__title {
  font-family: var(--wp-font-mono);
  color: var(--wp-accent-text, var(--wp-accent-300));
}
.wp-subcat-picker__origin {
  display: inline-flex;
  align-items: center;
  gap: 3px; /* audit-exempt: glyph-to-word gap */
  padding: 0 4px; /* audit-exempt: micro tile padding */
  border-radius: 3px; /* audit-exempt: tile below the radius scale */
  background: color-mix(in oklab, var(--wp-info) 15%, transparent);
  color: var(--wp-info);
  font-size: 10px; /* audit-exempt: micro annotation */
}
.wp-subcat-picker__origin .pi { font-size: 9px; }
.wp-subcat-picker__keys { opacity: 0.55; }
.wp-subcat-picker__no-tags {
  margin: 4px 0 0;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}

/* Chip states, derived from the parsed expression.
   `in`      — the term is present and reachable.
   `negated` — present only under a `not`, so struck through.
   `dead`    — declared by the wildcard but carried by no option: offerable,
               and guaranteed to match nothing. Dashed rather than disabled,
               because inserting it is legal and sometimes deliberate. */
.wp-subcat-chip[data-state="in"] {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 28%, transparent);
  border-color: var(--wp-accent);
  color: var(--wp-text);
}
.wp-subcat-chip[data-state="negated"] {
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  border-color: color-mix(in oklab, var(--wp-danger) 55%, transparent);
  text-decoration: line-through;
}
.wp-subcat-chip[data-state="dead"] {
  border-style: dashed;
  opacity: 0.55;
}
.wp-subcat-picker__field-label {
  display: block;
  font: 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 3px;
}
/* Geometry and fill are defined once, up with the mirror they must match. All
   that is left here is the invalid state. */
.wp-subcat-picker__input--invalid {
  border-color: var(--wp-danger);
}
.wp-subcat-picker__error {
  margin: 0 0 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-danger, #ef4444);
}

/* Boxed, matching the null row above it: this is derived OUTPUT — what the
   engine will actually read, and how much it keeps — not another field. */
.wp-subcat-picker__derived {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  margin-top: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  min-width: 0;
}
.wp-subcat-picker__reads {
  display: flex;
  align-items: baseline;
  gap: var(--wp-space-3);
  min-width: 0;
}
.wp-subcat-picker__match { margin-left: auto; flex-shrink: 0; }
.wp-subcat-picker__reads {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.wp-subcat-picker__derived-label {
  font: 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim, var(--wp-text3));
  flex: none;
}
.wp-subcat-picker__reads-val {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  word-break: break-word;
}
.wp-subcat-picker__match {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}

.wp-subcat-picker__palette {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.wp-subcat-picker__group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wp-subcat-picker__group-name {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-subcat-picker__chips,
.wp-subcat-picker__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-subcat-picker__ops {
  margin-bottom: 10px;
  padding-top: 6px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.wp-subcat-chip {
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-subcat-chip:hover {
  border-color: var(--wp-accent);
  color: var(--wp-text, var(--wp-text1));
}
/* Operators are structure, not content, so they get their own hue — the same
   blue the expression itself paints them, so the palette and the text agree
   about what a word IS. */
.wp-subcat-chip--op {
  font-family: var(--wp-font-mono);
  font-weight: 600;
  color: var(--wp-info);
  background: color-mix(in oklab, var(--wp-info) 12%, transparent);
}
/* The generic chip hover recolours to accent, which would fight the blue. */
.wp-subcat-chip--op:hover {
  color: var(--wp-info);
  border-color: color-mix(in oklab, var(--wp-info) 55%, transparent);
}
.wp-subcat-picker__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
}
/* Shrink the Delete/Skip/Apply buttons — the default .wp-btn size reads
 *  as oversized inside this popover. Compact them to fit the density. */
.wp-subcat-picker__actions .wp-btn {
  /* .wp-btn height is a fixed token (--wp-btn-h ~34px) — that, not padding,
   * is what kept the buttons tall. Override it for the popover's density. */
  height: 24px;
  padding: 0 11px;
  font-size: 11px;
  border-radius: 5px;
}
/* Destructive action sits far left, separated from Skip/Apply on the right. */
.wp-subcat-picker__delete {
  margin-right: auto;
}
</style>
