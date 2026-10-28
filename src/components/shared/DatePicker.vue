<script setup lang="ts">
/**
 * A date field: the button shows the picked day; it opens a month grid in
 * a kit Popover. The value is a "YYYY-MM-DD" string (a calendar day, no
 * time zone) or null.
 *
 *   <DatePicker v-model="since" aria-label="Changed since" clearable />
 *   <DatePicker v-model="day" :min="firstRun" :max="today" />
 *
 * APG date picker dialog: the grid is one Tab stop; arrows move a day or a
 * week, PageUp / PageDown a month (Shift: a year), Home / End to the start
 * or end of the week, Enter or Space picks, Escape closes and gives focus
 * back to the button. Days outside `min` / `max` can't be picked.
 */
import { computed, nextTick, ref, useId, watch } from "vue";
import Popover from "./Popover.vue";
import {
  addDays, addMonths, compareYmd, fromDate, monthGrid, parseYmd, toYmd, weekdayNames, type Ymd,
} from "./calendar";

const props = withDefaults(defineProps<{
  modelValue: string | null;
  min?: string;
  max?: string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  clearable?: boolean;
  /** 0 = Sunday, 1 = Monday. */
  weekStart?: 0 | 1;
  /** Language for month and day names; the browser's by default. */
  locale?: string;
}>(), {
  min: undefined, max: undefined, placeholder: "Pick a date", size: "md",
  ariaLabel: "Date", weekStart: 1, locale: undefined,
});

const emit = defineEmits<{ (e: "update:modelValue", v: string | null): void }>();

const uid = useId();
const gridId = `wp-date-grid-${uid}`;
const titleId = `wp-date-title-${uid}`;
const open = ref(false);
const gridEl = ref<HTMLElement | null>(null);

const value = computed(() => parseYmd(props.modelValue));
const lo = computed(() => parseYmd(props.min));
const hi = computed(() => parseYmd(props.max));
const today = fromDate(new Date());

/** The day with the keyboard focus; the shown month follows it. */
const focus = ref<Ymd>(value.value ?? today);
const days = computed(() => monthGrid(focus.value.y, focus.value.m, props.weekStart));
const weeks = computed(() => Array.from({ length: 6 }, (_, w) => days.value.slice(w * 7, w * 7 + 7)));
const names = computed(() => weekdayNames(props.weekStart, props.locale));
const title = computed(() => new Date(focus.value.y, focus.value.m, 1)
  .toLocaleDateString(props.locale, { month: "long", year: "numeric" }));

const shown = computed(() => (value.value
  ? new Date(value.value.y, value.value.m, value.value.d).toLocaleDateString(props.locale, { day: "numeric", month: "short", year: "numeric" })
  : ""));

const same = (a: Ymd | null, b: Ymd): boolean => !!a && compareYmd(a, b) === 0;
const outOfRange = (v: Ymd): boolean => (!!lo.value && compareYmd(v, lo.value) < 0) || (!!hi.value && compareYmd(v, hi.value) > 0);
const clamp = (v: Ymd): Ymd => (lo.value && compareYmd(v, lo.value) < 0 ? lo.value : hi.value && compareYmd(v, hi.value) > 0 ? hi.value : v);
const long = (v: Ymd): string => new Date(v.y, v.m, v.d).toLocaleDateString(props.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function focusDay(): void {
  void nextTick(() => gridEl.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
}

watch(open, (v) => {
  if (!v) return;
  focus.value = clamp(value.value ?? today);
  focusDay();
});

function pick(v: Ymd): void {
  if (outOfRange(v)) return;
  emit("update:modelValue", toYmd(v));
  open.value = false;
}

function move(v: Ymd): void {
  focus.value = clamp(v);
  focusDay();
}

function shiftMonth(n: number): void {
  move(addMonths(focus.value, n));
}

function onGridKey(ev: KeyboardEvent): void {
  const f = focus.value;
  const dow = (new Date(f.y, f.m, f.d).getDay() - props.weekStart + 7) % 7;
  const to: Record<string, () => Ymd> = {
    ArrowLeft: () => addDays(f, -1),
    ArrowRight: () => addDays(f, 1),
    ArrowUp: () => addDays(f, -7),
    ArrowDown: () => addDays(f, 7),
    Home: () => addDays(f, -dow),
    End: () => addDays(f, 6 - dow),
    PageUp: () => addMonths(f, ev.shiftKey ? -12 : -1),
    PageDown: () => addMonths(f, ev.shiftKey ? 12 : 1),
  };
  if (to[ev.key]) {
    ev.preventDefault();
    move(to[ev.key]());
  } else if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    pick(f);
  }
}

function clear(): void {
  emit("update:modelValue", null);
}
</script>

<!-- Popover's autofocus prop is off: focus goes to the picked day, not the first button. -->
<!-- eslint-disable vuejs-accessibility/no-autofocus -->
<template>
  <span class="wp-date" :data-size="size">
    <Popover v-model:open="open" :autofocus="false" :label="ariaLabel">
      <template #trigger="{ props: tp }">
        <button
          type="button"
          class="wp-date__field"
          :data-invalid="invalid || undefined"
          :disabled="disabled"
          :aria-label="shown ? `${ariaLabel}: ${shown}` : ariaLabel"
          v-bind="tp"
        >
          <i class="pi pi-calendar wp-date__icon" aria-hidden="true" />
          <span :class="shown ? 'wp-date__text' : 'wp-date__placeholder'">{{ shown || placeholder }}</span>
        </button>
      </template>
      <div class="wp-date__panel">
        <div class="wp-date__head">
          <button type="button" class="wp-date__nav" aria-label="Previous month" @click="shiftMonth(-1)">
            <i class="pi pi-chevron-left" aria-hidden="true" />
          </button>
          <span :id="titleId" class="wp-date__title" aria-live="polite">{{ title }}</span>
          <button type="button" class="wp-date__nav" aria-label="Next month" @click="shiftMonth(1)">
            <i class="pi pi-chevron-right" aria-hidden="true" />
          </button>
        </div>
        <!-- The grid is reached through its days (roving tabindex); it only listens for their keys. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions, vuejs-accessibility/interactive-supports-focus -->
        <table :id="gridId" ref="gridEl" class="wp-date__grid" role="grid" :aria-labelledby="titleId" @keydown="onGridKey">
          <thead>
            <tr>
              <th v-for="n in names" :key="n.long" scope="col" :abbr="n.long">{{ n.short }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(week, w) in weeks" :key="w">
              <td
                v-for="d in week"
                :key="toYmd(d)"
                class="wp-date__day"
                :tabindex="same(focus, d) ? 0 : -1"
                :aria-selected="same(value, d)"
                :aria-disabled="outOfRange(d) || undefined"
                :aria-label="long(d)"
                :aria-current="same(today, d) ? 'date' : undefined"
                :data-other="d.m !== focus.m || undefined"
                :data-today="same(today, d) || undefined"
                @click="pick(d)"
              >{{ d.d }}</td>
            </tr>
          </tbody>
        </table>
        <div class="wp-date__foot">
          <button type="button" class="wp-date__link" :disabled="outOfRange(today)" @click="pick(today)">Today</button>
          <button v-if="clearable && modelValue" type="button" class="wp-date__link" @click="clear(); open = false">Clear</button>
        </div>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.wp-date { display: inline-flex; --_h: var(--wp-control-h-md); }
.wp-date[data-size="sm"] { --_h: var(--wp-control-h-sm); }
.wp-date[data-size="lg"] { --_h: var(--wp-control-h-lg); }
.wp-date__field {
  display: inline-flex; align-items: center; gap: var(--wp-space-2); box-sizing: border-box;
  min-width: 150px; height: var(--_h); padding: 0 var(--wp-space-3);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-1); color: var(--wp-text); cursor: pointer;
  font: 400 var(--wp-text-sm)/1 var(--wp-font-sans); text-align: left;
  transition: border-color var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-date[data-size="sm"] .wp-date__field { min-width: 120px; padding: 0 var(--wp-space-2); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); }
.wp-date__field:hover:not(:disabled) { border-color: var(--wp-border-strong); }
.wp-date__field:focus-visible { outline: none; border-color: var(--wp-border-focus); box-shadow: 0 0 0 3px var(--wp-focus-ring); }
.wp-date__field[data-invalid] { border-color: var(--wp-error-border); }
.wp-date__field:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-date__icon { color: var(--wp-text-muted); font-size: 12px; }
.wp-date__placeholder { color: var(--wp-text-dim); }
.wp-date__panel { display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-date__head { display: flex; align-items: center; justify-content: space-between; gap: var(--wp-space-2); }
.wp-date__title { font-weight: 600; color: var(--wp-text); }
.wp-date__nav, .wp-date__link {
  display: inline-grid; place-items: center; height: var(--wp-control-h-sm); min-width: var(--wp-control-h-sm);
  padding: 0 var(--wp-space-2); border: 0; border-radius: var(--wp-radius-sm);
  background: transparent; color: var(--wp-text-muted); cursor: pointer; font: inherit;
}
.wp-date__nav .pi { font-size: 11px; }
.wp-date__nav:hover, .wp-date__link:hover:not(:disabled) { background: var(--wp-row-hover); color: var(--wp-text); }
.wp-date__nav:focus-visible, .wp-date__link:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-date__link:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-date__grid { border-collapse: collapse; }
.wp-date__grid th {
  width: 32px; height: 24px; color: var(--wp-text-muted); font-size: var(--wp-text-xs); font-weight: 500;
}
.wp-date__day {
  width: 32px; height: 30px; padding: 0; text-align: center; border-radius: var(--wp-radius-sm);
  color: var(--wp-text); font-variant-numeric: tabular-nums; cursor: pointer;
}
.wp-date__day[data-other] { color: var(--wp-text-dim); }
.wp-date__day[data-today] { box-shadow: inset 0 0 0 1px var(--wp-border-strong); }
.wp-date__day:hover { background: var(--wp-row-hover); }
.wp-date__day[aria-selected="true"] { background: var(--wp-accent); color: var(--wp-bg); }
.wp-date__day[aria-disabled="true"] { opacity: 0.35; cursor: not-allowed; background: transparent; text-decoration: line-through; }
.wp-date__day:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-date__foot { display: flex; justify-content: space-between; }
@media (prefers-reduced-motion: reduce) {
  .wp-date__field { transition: none; }
}
</style>
